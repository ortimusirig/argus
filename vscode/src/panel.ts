// The Argus panel: a webview view in the side bar. This file only wires VS Code to the core: what is shown is
// decided and built in src/core (panelHtml.ts, messages.ts, selection.ts, shown.ts, links.ts), where it is tested.

import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { Index } from "./index";
import { LinkTo } from "./core/markdown";
import { Matcher } from "./core/matching";
import { Latest } from "./core/latest";
import { needsExactAddress, obsidianAddress } from "./core/links";
import { Context, handle, hrefsIn } from "./core/messages";
import { Entry } from "./core/noteIndex";
import { Badge, Creating, Listed, View, body, page, withoutNote } from "./core/panelHtml";
import { Project } from "./core/projects";
import { projectKey } from "./core/settings";
import { STEPS, Shown, Trail, shownNote, shownView } from "./core/shown";

const QUIET_MS = 200;
const MATCHING_MS = 400;
const PATIENCE_MS = 80;      // a match that ends sooner is shown at once, without "matching…" in between

export class Panel implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "argus.panel";
  private view?: vscode.WebviewView;
  private readonly media: vscode.Uri;
  private whole = false;                                      // "Explain this file"
  private pinned?: { uri: string; from: number; to: number };   // lines asked for by a CodeLens
  private readonly trail = new Trail();                       // a note (by its id) or a list of places, shown in place of the file, and the way back
  private notice?: string;
  private project?: Project;                                  // the project of what is shown
  private duplicates = false;                                 // the file view is the list of duplicate notes
  private hrefs: ReadonlySet<string> = new Set();
  private inner = "";
  private quiet?: NodeJS.Timeout;
  private readonly latest = new Latest();                     // what was asked for after the selection moved stays (core/latest.ts)
  private again?: NodeJS.Timeout;
  private drawn?: vscode.TextDocument;                        // the document whose explanation the page shows: its buttons act on it
  private viewed?: vscode.TextDocument;                       // the document fileView() last looked at; it becomes `drawn` when its page is shown
  private pageNo = 0;                                         // the number of the page that is shown; a click names its page
  private opening = false;                                    // a command is opening the panel right now
  private editor?: vscode.TextEditor;
  private asked?: { key: string; at: number };                // the match the panel waits for, and since when
  /** The validation badge of a file's note; piece 6 (check.ts) sets it. */
  validation: (project: Project, sourceRel: string, note: Entry) => Badge =
    () => ({ label: "not checked", why: "no check has been run" });
  /** What a run of Create says for a file of a project, given the notes that explain it; piece 7 (create.ts) sets it. */
  creating: (project: Project, sourceRel: string, notes: readonly Entry[]) => Creating | undefined = () => undefined;

  constructor(extensionUri: vscode.Uri, private readonly index: Index, private readonly matcher: Matcher) {
    this.media = vscode.Uri.joinPath(extensionUri, "media");
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.media] };
    view.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); });
    view.onDidChangeVisibility(() => { if (view.visible) { this.expire(); this.render(); } });
    view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.inner = ""; } });
    this.inner = "";
    this.render();
  }

  /** Shut down: no timer is left to draw the panel later. */
  dispose(): void {
    if (this.quiet) { clearTimeout(this.quiet); this.quiet = undefined; }
    if (this.again) { clearTimeout(this.again); this.again = undefined; }
    this.view = undefined;
  }

  get visible(): boolean {
    return this.view?.visible === true;
  }

  /** The editor the panel speaks of: the active one, else the last one that was, while it is still open. */
  private current(): vscode.TextEditor | undefined {
    // Lines asked for by a CodeLens name their document: the panel speaks of that one, also when another editor
    // is the active one, so that Create and Check act on the file that is shown.
    // Not a pin that is older than the last move of the selection: the person went on to another place.
    const pinned = this.pinned;
    if (pinned && !this.latest.stale("pinned")) {
      const asked = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === pinned.uri);
      if (asked) { this.editor = asked; return asked; }
    }
    const active = vscode.window.activeTextEditor;
    if (active) { this.editor = active; }
    return this.editor && vscode.window.visibleTextEditors.includes(this.editor) ? this.editor : active;
  }

  /** The document the panel speaks of. */
  document(): vscode.TextDocument | undefined {
    return this.current()?.document;
  }

  /** The selection or the text changed: the panel follows after 200 ms of quiet, and shows the file again.
   *  What the person asked for in that time (a CodeLens, a linked note, a notice) is newer than the change and stays. */
  follow(): void {
    // Not while a command opens the panel: a move that the opening itself causes is not the person's, and must
    // not take away the lines the command asked for.
    if (this.opening) { return; }
    if (!this.visible) {
      // Hidden: nothing is drawn, but the move is remembered, so what was kept before it goes when the panel
      // is shown again.
      this.latest.moved();
      return;
    }
    this.latest.moved();
    if (this.quiet) { clearTimeout(this.quiet); }
    this.quiet = setTimeout(() => {
      this.quiet = undefined;
      this.expire();
      this.render();
    }, QUIET_MS);
  }

  /** Drops what was kept before the selection last moved. */
  private expire(): void {
    if (this.latest.stale("shown")) { this.trail.clear(); }
    if (this.latest.stale("pinned")) { this.pinned = undefined; }
    if (this.latest.stale("notice")) { this.notice = undefined; }
    if (this.latest.stale("whole")) { this.whole = false; }          // "Explain this file" lasts until the selection moves
  }

  /** Sets the notice (or takes it away) as asked for now. */
  private tell(text: string | undefined): void {
    this.notice = text;
    this.latest.asked("notice");
  }

  /** "Explain selection" and "Explain this file": opens the panel on the lines or on the file. */
  async explain(whole: boolean, pinned?: { uri: string; from: number; to: number }): Promise<void> {
    this.whole = whole;
    this.pinned = pinned;
    this.trail.clear(); this.notice = undefined;
    this.latest.asked("pinned", "shown", "notice", "whole");
    this.opening = true;
    try {
      // The document of the asked lines is shown when no editor shows it (the focus stays where it is).
      if (pinned && !vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === pinned.uri)) {
        try { await vscode.window.showTextDocument(vscode.Uri.parse(pinned.uri, true), { preserveFocus: true, preview: true }); }
        catch { this.pinned = undefined; this.tell("the file of these lines could not be opened"); }
      }
      await vscode.commands.executeCommand(`${Panel.viewId}.focus`);
    } finally { this.opening = false; }
    // What the opening itself moved is no move of the person: the asked things are the newest again.
    this.latest.asked("pinned", "shown", "notice", "whole");
    this.render();
  }

  /** A sentence shown above everything in the panel. */
  say(text: string): void {
    this.tell(text);
    this.render();
    if (!this.visible) { void vscode.window.showInformationMessage(`Argus: ${text}`); }
  }

  render(): void {
    const view = this.view;
    if (!view || !view.visible) { return; }
    if (this.again) { clearTimeout(this.again); this.again = undefined; }
    // A shown note is asked of the index at each drawing: its text now, or the sentence that it is gone.
    const notes = this.index.notes;
    const now = this.trail.now;
    // What the page stands for (document, project, a list of duplicates) belongs to the page that is shown. While
    // a match is on its way the old page stays, and so does what it stands for: a click on it acts on its file.
    const before = { project: this.project, duplicates: this.duplicates };
    const shown = now
      ? shownView(now, { byId: (id) => notes.noteById(id), holds: (entry) => notes.holds(entry), linkTo: (project) => this.linkTo(project) })
      : this.fileView();
    if (!shown) { this.project = before.project; this.duplicates = before.duplicates; return; }
    if (!now) { this.drawn = this.viewed; }
    const inner = body(shown, this.notice);
    if (inner === this.inner) { return; }            // the same page is not loaded again: scrolling and focus stay
    this.inner = inner;
    this.hrefs = hrefsIn(inner);
    const web = view.webview;
    view.webview.html = page({ cspSource: web.cspSource, nonce: crypto.randomBytes(16).toString("hex"),
      cssUri: web.asWebviewUri(vscode.Uri.joinPath(this.media, "panel.css")).toString(),
      jsUri: web.asWebviewUri(vscode.Uri.joinPath(this.media, "panel.js")).toString(), body: inner, pageId: ++this.pageNo });
  }

  private listed(entries: Entry[]): Listed[] {
    return entries.map((entry) => ({ id: entry.id, name: entry.name, folder: path.dirname(entry.path) }));
  }

  /** Which name of a [[link]] is a note of this project or its vault; any other name stays text. */
  private linkTo(project: Project): LinkTo {
    // One lookup for each link in the index's map of names, which is built once for each state of the notes.
    const links = this.index.notes.linksOf(project);
    return (name) => links.resolve(name).kind === "none" ? undefined : name;
  }

  private fileView(): View | undefined {
    this.duplicates = false;
    const editor = this.current();
    this.viewed = editor?.document;
    if (!editor) { this.project = undefined; return { kind: "message", text: "Open a file to see its Argus explanation." }; }
    const document = editor.document;
    if (document.isUntitled || document.uri.scheme !== "file") {
      this.project = undefined;
      return { kind: "message", text: "Argus explains saved files only; this document has no path on disk." };
    }
    const found = this.index.locate(document);
    // Only notes that still lie inside the project's folders are drawn, as for a shown note.
    const holds = (entry: Entry): boolean => this.index.notes.holds(entry);
    const at = { ...found, notes: found.notes.filter(holds), note: found.note && holds(found.note) ? found.note : undefined };
    this.project = at.project;
    if (!at.project || at.sourceRel === undefined) {
      return this.index.written === 0
        ? { kind: "message", text: "This file is in no Argus project yet. Choose the folder that holds the Argus notes; "
          + "the first workspace folder is taken as the source root.", button: "setup" }
        : { kind: "message", text: `${path.basename(document.uri.fsPath)} is not in an Argus project.` };
    }
    if (!at.note || !at.note.file) {
      // No note, or several: the project's problems are shown too, so a refused note is not hidden (core/panelHtml.ts).
      const view = withoutNote(at.sourceRel, this.listed(at.notes), this.index.notes.problemsOf(at.project),
        this.creating(at.project, at.sourceRel, at.notes));
      this.duplicates = view.kind === "duplicates";
      return view;
    }
    const entry = at.note, note = at.note.file, uri = document.uri.toString();
    let assignment, matching: number | undefined;
    if (note.problems.length === 0) {
      this.matcher.want({ uri, version: document.version, text: () => document.getText() }, note, entry);
      assignment = this.matcher.fresh(uri, document.version, entry);
      if (!assignment) {
        const key = `${uri} ${document.version} ${entry.id} ${entry.revision}`;
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
    // While the agent writes the explanation of this file, a success of a check says nothing yet: no success badge.
    const create = this.creating(at.project, at.sourceRel, at.notes);
    const badge: Badge = create?.running
      ? { label: "not checked", why: "the agent is still writing this explanation; the result of the check is shown when it has ended" }
      : this.validation(at.project, at.sourceRel, entry);
    return { kind: "file", file: at.sourceRel, note, noteId: entry.id, assignment, matching, selection, whole: this.whole,
      badge, linkTo: this.linkTo(at.project),
      create,
      problems: this.index.notes.problemsOf(at.project) };
  }

  private showNote(entry: Entry): void {
    // Only which note is kept: its text is the index's own copy at the time of each drawing (core/shown.ts).
    this.trail.open(shownNote(entry));
    this.latest.asked("shown");
    this.sayWithheld();
  }

  /** The way back is bounded: when old steps were left out, the panel says how many. */
  private sayWithheld(): void {
    const n = this.trail.withheld;
    if (n > 0) { this.tell(`Back keeps the last ${STEPS} steps. ${n} older ${n === 1 ? "step is" : "steps are"} not kept.`); }
  }

  /** What a message is tested against: the notes of the project being shown, as the index holds them now. */
  private context(project: Project | undefined): Context<Entry> {
    const notes = this.index.notes;
    return {
      resolve: (name) => project ? notes.linksOf(project).resolve(name) : { kind: "none" },
      byId: (id) => notes.noteById(id),
      holds: (entry) => project !== undefined && projectKey(entry.project) === projectKey(project) && notes.holds(entry),
      hrefs: this.hrefs,
    };
  }

  /** A list of places, built again from the index as it is now: the list, the one note left, or nothing. */
  private placesAgain(name: string, context: Context<Entry>): Shown | undefined {
    const found = handle({ type: "openNote", name }, context);
    if (found.do === "show") { return shownNote(found.note); }
    return found.do === "list" ? { kind: "places", name: found.name, places: this.listed(found.places) } : undefined;
  }

  /** Opens a note in Obsidian. The caller has tested that the note lies, now, in the notes folder or the vault
   *  folder of the project shown (`handle`). The address is built in core/links.ts, every part percent-encoded,
   *  and goes to VS Code's own "open external" and nowhere else. Returns a sentence when it did not open. */
  private async openInObsidianNote(entry: Entry): Promise<string | undefined> {
    const address = obsidianAddress(entry.path, process.platform === "win32");
    if (address === undefined) { return `the path of '${entry.name}' cannot be written as an obsidian address; it was not opened`; }
    const closed = `Obsidian did not open '${entry.name}'. Is Obsidian installed, and is the note inside one of its vaults?`;
    try {
      // The address is handed over as text, so it reaches Obsidian as it was built. Given as a Uri, VS Code would
      // write it again by its own rules and turn the encoded & or # of a file name back into a sign of the address.
      return await vscode.env.openExternal(address as unknown as vscode.Uri) ? undefined : closed;
    } catch {
      // This VS Code takes a Uri only. A path without such a sign arrives the same when it is written again
      // (core/links.ts, needsExactAddress); any other path is not opened, rather than opened wrongly.
      if (needsExactAddress(entry.path)) {
        return `'${entry.name}' could not be opened in Obsidian: its path holds one of & # + = ; and this VS Code does not pass such an address on unchanged`;
      }
      try {
        return await vscode.env.openExternal(vscode.Uri.parse(address, true)) ? undefined : closed;
      } catch {
        return `this address could not be opened: ${address}`;
      }
    }
  }

  /** Opens an address of a note outside VS Code; answers a sentence when it could not. The address is handed over
   *  as text, so it arrives as the note wrote it. Given as a Uri, VS Code would write it again by its own rules,
   *  and an encoded & or # (as in ?q=R%26D) would become a sign of the address. */
  private async openAddress(href: string): Promise<string | undefined> {
    const failed = `this address could not be opened: ${href}`;
    try {
      return await vscode.env.openExternal(href as unknown as vscode.Uri) ? undefined : failed;
    } catch {
      // This VS Code takes a Uri only. The address is opened that way only when it stays the same when written again.
      try {
        const uri = vscode.Uri.parse(href, true);
        if (uri.toString() !== href && uri.toString(true) !== href) {
          return `this address was not opened, because this VS Code does not pass it on unchanged: ${href}`;
        }
        return await vscode.env.openExternal(uri) ? undefined : failed;
      } catch {
        return failed;
      }
    }
  }

  /** "Argus: Open note in Obsidian": the note that is shown, or the note of the file that is shown. */
  async openInObsidian(): Promise<void> {
    const now = this.trail.now;
    let id: number | undefined, project = this.project;
    if (now?.kind === "note") {
      id = now.id;
    } else if (!now) {
      const document = this.document();
      const at = document ? this.index.locate(document) : undefined;
      id = at?.note?.id;
      project = at?.project;
    }
    const action = id === undefined ? undefined : handle({ type: "obsidian", id }, this.context(project));
    if (action?.do === "obsidian") {
      const failed = await this.openInObsidianNote(action.note);
      if (failed !== undefined) { this.say(failed); }
    } else {
      this.say(action?.do === "say" ? action.text : "no one note is shown, so there is none to open in Obsidian");
    }
  }

  /** A message from the page. What it may do is decided by `handle`; anything it does not allow is dropped. */
  private async receive(message: unknown): Promise<void> {
    const context = this.context(this.project);
    const action = handle(message, context);
    switch (action.do) {
      case "drop": return;
      case "say": this.tell(action.text); break;
      case "show": this.tell(undefined); this.showNote(action.note); break;
      case "list":
        this.tell(undefined);
        this.trail.open({ kind: "places", name: action.name, places: this.listed(action.places) });
        this.latest.asked("shown");
        this.sayWithheld();
        break;
      case "pick":
        this.tell(undefined);
        if (this.duplicates && !this.trail.now && action.note.file) { this.index.choose(action.note); } else { this.showNote(action.note); }
        break;
      case "obsidian": this.tell(await this.openInObsidianNote(action.note)); break;
      case "back":
        // One step back: to the note or list shown before, or to the file. Asked for now, so the late follow of
        // an older selection move leaves it alone.
        this.tell(undefined);
        this.trail.back((name) => this.placesAgain(name, context));
        this.latest.asked("shown");
        this.sayWithheld();
        break;
      case "open":
        this.tell(await this.openAddress(action.href));
        break;
      case "ask": {
        let target: vscode.Uri;
        try { target = vscode.Uri.parse(action.href, true); } catch { this.tell(`this address could not be opened: ${action.href}`); break; }
        const answer = await vscode.window.showWarningMessage("A note asks to open a file on this computer.",
          { modal: true, detail: target.fsPath }, "Open");
        if (answer === "Open") { await vscode.env.openExternal(target); }
        break;
      }
      // A button of the page acts on the file the page shows, also when the person went on to another file and
      // the page has not followed yet.
      case "create":
      case "check": {
        // The click must come from the page that is shown now: a click of a page that was replaced meanwhile
        // was meant for another file, and starts nothing.
        if ((message as { page?: unknown } | null)?.page !== this.pageNo) {
          this.tell("the panel changed before the click arrived; nothing was started. Click again.");
          break;
        }
        const drawn = this.drawn;
        if (!drawn || drawn.isClosed) { this.tell("the file this page showed is closed; nothing was started"); break; }
        await vscode.commands.executeCommand(action.do === "create" ? "argus.create" : "argus.check", drawn);
        return;
      }
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
