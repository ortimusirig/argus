// The Argus panel: a webview view in the side bar. This file only wires VS Code to the core: what is shown is
// decided and built in src/core (panelHtml.ts, messages.ts, selection.ts), where it is tested.

import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { Index } from "./index";
import { resolveLink } from "./core/links";
import { LinkTo } from "./core/markdown";
import { Matcher } from "./core/matching";
import { Context, handle, hrefsIn } from "./core/messages";
import { Entry } from "./core/noteIndex";
import { parseOtherNote } from "./core/notes";
import { Badge, Listed, View, body, page } from "./core/panelHtml";
import { Project } from "./core/projects";
import { projectKey } from "./core/settings";

const QUIET_MS = 200;
const MATCHING_MS = 400;
const PATIENCE_MS = 80;      // a match that ends sooner is shown at once, without "matching…" in between

export class Panel implements vscode.WebviewViewProvider {
  static readonly viewId = "argus.panel";
  private view?: vscode.WebviewView;
  private readonly media: vscode.Uri;
  private whole = false;                                      // "Explain this file"
  private pinned?: { uri: string; from: number; to: number };   // lines asked for by a CodeLens
  private shown?: View;                                       // a note or a list of places, shown in place of the file
  private notice?: string;
  private project?: Project;                                  // the project of what is shown
  private duplicates = false;                                 // the file view is the list of duplicate notes
  private hrefs: ReadonlySet<string> = new Set();
  private inner = "";
  private quiet?: NodeJS.Timeout;
  private again?: NodeJS.Timeout;
  private editor?: vscode.TextEditor;
  private asked?: { key: string; at: number };                // the match the panel waits for, and since when
  /** The validation badge of a file's note; piece 6 (check.ts) sets it. */
  validation: (project: Project, sourceRel: string, note: Entry) => Badge =
    () => ({ label: "not checked", why: "no check has been run" });

  constructor(extensionUri: vscode.Uri, private readonly index: Index, private readonly matcher: Matcher) {
    this.media = vscode.Uri.joinPath(extensionUri, "media");
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.media] };
    view.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); });
    view.onDidChangeVisibility(() => { if (view.visible) { this.render(); } });
    view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.inner = ""; } });
    this.inner = "";
    this.render();
  }

  get visible(): boolean {
    return this.view?.visible === true;
  }

  /** The editor the panel speaks of: the active one, else the last one that was, while it is still open. */
  private current(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active) { this.editor = active; }
    return this.editor && vscode.window.visibleTextEditors.includes(this.editor) ? this.editor : active;
  }

  /** The document the panel speaks of. */
  document(): vscode.TextDocument | undefined {
    return this.current()?.document;
  }

  /** The selection or the text changed: the panel follows after 200 ms of quiet, and shows the file again. */
  follow(): void {
    if (!this.visible) { return; }
    if (this.quiet) { clearTimeout(this.quiet); }
    this.quiet = setTimeout(() => {
      this.quiet = undefined;
      this.shown = undefined; this.pinned = undefined; this.notice = undefined;
      this.render();
    }, QUIET_MS);
  }

  /** "Explain selection" and "Explain this file": opens the panel on the lines or on the file. */
  async explain(whole: boolean, pinned?: { uri: string; from: number; to: number }): Promise<void> {
    this.whole = whole;
    this.pinned = pinned;
    this.shown = undefined; this.notice = undefined;
    await vscode.commands.executeCommand(`${Panel.viewId}.focus`);
    this.render();
  }

  /** A sentence shown above everything in the panel. */
  say(text: string): void {
    this.notice = text;
    this.render();
    if (!this.visible) { void vscode.window.showInformationMessage(`Argus: ${text}`); }
  }

  render(): void {
    const view = this.view;
    if (!view || !view.visible) { return; }
    if (this.again) { clearTimeout(this.again); this.again = undefined; }
    const shown = this.shown ?? this.fileView();
    if (!shown) { return; }                          // a match is on its way: what is shown stays for a moment
    const inner = body(shown, this.notice);
    if (inner === this.inner) { return; }            // the same page is not loaded again: scrolling and focus stay
    this.inner = inner;
    this.hrefs = hrefsIn(inner);
    const web = view.webview;
    view.webview.html = page({ cspSource: web.cspSource, nonce: crypto.randomBytes(16).toString("hex"),
      cssUri: web.asWebviewUri(vscode.Uri.joinPath(this.media, "panel.css")).toString(),
      jsUri: web.asWebviewUri(vscode.Uri.joinPath(this.media, "panel.js")).toString(), body: inner });
  }

  private listed(entries: Entry[]): Listed[] {
    return entries.map((entry) => ({ id: entry.id, name: entry.name, folder: path.dirname(entry.path) }));
  }

  /** Which name of a [[link]] is a note of this project or its vault; any other name stays text. */
  private linkTo(project: Project): LinkTo {
    const own = this.index.notes.notesOf(project, "notes"), vault = this.index.notes.notesOf(project, "vault");
    return (name) => resolveLink(name, own, vault).kind === "none" ? undefined : name;
  }

  private fileView(): View | undefined {
    this.duplicates = false;
    const editor = this.current();
    if (!editor) { this.project = undefined; return { kind: "message", text: "Open a file to see its Argus explanation." }; }
    const document = editor.document;
    if (document.isUntitled || document.uri.scheme !== "file") {
      this.project = undefined;
      return { kind: "message", text: "Argus explains saved files only; this document has no path on disk." };
    }
    const at = this.index.locate(document);
    this.project = at.project;
    if (!at.project || at.sourceRel === undefined) {
      return this.index.written === 0
        ? { kind: "message", text: "This file is in no Argus project yet. Choose the folder that holds the Argus notes; "
          + "the first workspace folder is taken as the source root.", button: "setup" }
        : { kind: "message", text: `${path.basename(document.uri.fsPath)} is not in an Argus project.` };
    }
    if (at.notes.length === 0) {
      return { kind: "message", text: `No note: no Argus note explains ${at.sourceRel}.`, button: "create" };
    }
    if (!at.note || !at.note.file) {
      this.duplicates = true;
      return { kind: "duplicates", file: at.sourceRel, notes: this.listed(at.notes) };
    }
    const entry = at.note, note = at.note.file, uri = document.uri.toString();
    let assignment, matching: number | undefined;
    if (note.problems.length === 0) {
      this.matcher.want({ uri, version: document.version, text: () => document.getText() }, note, entry.revision);
      assignment = this.matcher.fresh(uri, document.version, entry.revision);
      if (!assignment) {
        const key = `${uri} ${document.version} ${entry.revision}`;
        if (this.asked?.key !== key) { this.asked = { key, at: Date.now() }; }
        const patient = Date.now() - this.asked.at < PATIENCE_MS && this.inner !== "";
        this.again = setTimeout(() => { this.again = undefined; this.render(); }, patient ? PATIENCE_MS : MATCHING_MS);
        if (patient) { return undefined; }
        matching = this.matcher.progress(uri) ?? 0;   // shown with the number of blocks done; the count moves on
      }
    }
    let selection = this.pinned && this.pinned.uri === uri ? { from: this.pinned.from, to: this.pinned.to } : undefined;
    if (!selection) {
      const chosen = editor.selection;
      // A selection that ends at the start of a line does not take that line in.
      const end = chosen.end.line > chosen.start.line && chosen.end.character === 0 ? chosen.end.line : chosen.end.line + 1;
      selection = { from: chosen.start.line + 1, to: end };
    }
    return { kind: "file", file: at.sourceRel, note, noteId: entry.id, assignment, matching, selection, whole: this.whole,
      badge: this.validation(at.project, at.sourceRel, entry), linkTo: this.linkTo(at.project),
      problems: this.index.notes.problemsOf(at.project) };
  }

  private showNote(entry: Entry): void {
    // The text is the index's own copy of the note; that its path still lies in the folders was tested just now.
    this.shown = { kind: "note", id: entry.id, folder: path.dirname(entry.path),
      note: { name: entry.name, body: parseOtherNote(entry.name, entry.path, entry.text).body }, linkTo: this.linkTo(entry.project) };
  }

  /** A message from the page. What it may do is decided by `handle`; anything it does not allow is dropped. */
  private async receive(message: unknown): Promise<void> {
    const project = this.project, notes = this.index.notes;
    const context: Context<Entry> = {
      resolve: (name) => project ? resolveLink(name, notes.notesOf(project, "notes"), notes.notesOf(project, "vault")) : { kind: "none" },
      byId: (id) => notes.noteById(id),
      holds: (entry) => project !== undefined && projectKey(entry.project) === projectKey(project) && notes.holds(entry),
      hrefs: this.hrefs,
    };
    const action = handle(message, context);
    switch (action.do) {
      case "drop": return;
      case "say": this.notice = action.text; break;
      case "show": this.notice = undefined; this.showNote(action.note); break;
      case "list": this.notice = undefined; this.shown = { kind: "places", name: action.name, places: this.listed(action.places) }; break;
      case "pick":
        this.notice = undefined;
        if (this.duplicates && !this.shown && action.note.file) { this.index.choose(action.note); } else { this.showNote(action.note); }
        break;
      case "obsidian": this.notice = "Open in Obsidian is not built yet (piece 8 of the plan)."; break;
      case "open":
        try {
          await vscode.env.openExternal(vscode.Uri.parse(action.href, true));
        } catch {
          this.notice = `this address could not be opened: ${action.href}`;
        }
        break;
      case "ask": {
        let target: vscode.Uri;
        try { target = vscode.Uri.parse(action.href, true); } catch { this.notice = `this address could not be opened: ${action.href}`; break; }
        const answer = await vscode.window.showWarningMessage("A note asks to open a file on this computer.",
          { modal: true, detail: target.fsPath }, "Open");
        if (answer === "Open") { await vscode.env.openExternal(target); }
        break;
      }
      case "create": await vscode.commands.executeCommand("argus.create"); return;
      case "check": await vscode.commands.executeCommand("argus.check"); return;
      case "setup": await this.setup(); return;
    }
    this.render();
  }

  /** First use: the person picks the notes folder; one entry goes into the user's own settings. */
  private async setup(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== "file") {
      this.say("Open a folder first: the first workspace folder becomes the source root.");
      return;
    }
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      title: "Argus: choose the notes folder", openLabel: "Use as the notes folder" });
    if (!picked || picked.length === 0) { return; }
    const config = vscode.workspace.getConfiguration("argus");
    const own = config.inspect<unknown>("projects")?.globalValue;
    await config.update("projects", [...(Array.isArray(own) ? own : []), { sourceRoot: folder.uri.fsPath, notesFolder: picked[0].fsPath }],
      vscode.ConfigurationTarget.Global);
  }
}
