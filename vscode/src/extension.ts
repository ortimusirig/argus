// Argus for VS Code: registers the panel, the markers, the check, the commands and the events. Wiring only; the
// logic is in src/core.

import * as vscode from "vscode";
import { Check } from "./check";
import { Index } from "./index";
import { Markers } from "./markers";
import { Panel } from "./panel";
import { Matcher } from "./core/matching";

export function activate(context: vscode.ExtensionContext): void {
  const index = new Index();
  const matched = new vscode.EventEmitter<string>();          // a document (its URI) has a new assignment
  const matcher = new Matcher((uri) => { matched.fire(uri); });
  const panel = new Panel(context.extensionUri, index, matcher);
  const markers = new Markers(context.extensionUri, index, matcher);
  const check = new Check(context, index, () => { panel.render(); });
  panel.validation = (project, sourceRel, note) => check.badge(project, sourceRel, note);

  const active = (): vscode.TextDocument | undefined => vscode.window.activeTextEditor?.document;
  const redraw = (): void => { panel.render(); markers.refresh(); };
  const forget = (): void => { matcher.keep((id) => index.notes.noteById(id) !== undefined); };
  const configure = (): void => { index.configure(); forget(); check.configure(); redraw(); };

  context.subscriptions.push(index, matched, markers, check,
    vscode.window.registerWebviewViewProvider(Panel.viewId, panel),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, markers),

    vscode.commands.registerCommand("argus.explainSelection", (uri?: unknown, from?: unknown, to?: unknown) =>
      // A CodeLens gives the document and the lines of its block; the menu and the palette give nothing.
      panel.explain(false, typeof uri === "string" && typeof from === "number" && typeof to === "number" ? { uri, from, to } : undefined)),
    vscode.commands.registerCommand("argus.explainFile", () => panel.explain(true)),
    vscode.commands.registerCommand("argus.refresh", async () => { await index.refreshAll(); redraw(); }),
    vscode.commands.registerCommand("argus.check", async () => {
      const say = await check.check(panel.document());
      if (say) { panel.say(say); } else { panel.render(); }
    }),
    vscode.commands.registerCommand("argus.create", () => { panel.say("Create explanation is not built yet (piece 7 of the plan)."); }),
    vscode.commands.registerCommand("argus.openInObsidian", () => { panel.say("Open in Obsidian is not built yet (piece 8 of the plan)."); }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) { panel.follow(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => { panel.follow(); }),
    vscode.window.onDidChangeVisibleTextEditors(() => { markers.refresh(); }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === active()) { panel.follow(); }
      if (vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) { markers.later(); }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => { matcher.drop(document.uri.toString()); }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("argus")) { configure(); }
    }),
    // Trusted now: VS Code gives the workspace's own argus.projects too. The check starts its pending calls itself.
    vscode.workspace.onDidGrantWorkspaceTrust(configure),
    // A note that left the index takes what was matched against it with it.
    index.onDidChange(() => { forget(); redraw(); }),
    // A picked note may be matched already: then no match is published, and the pick alone draws the markers.
    index.onDidChoose(() => { markers.refresh(); }),
    matched.event((uri) => {
      markers.matched(uri);
      if (uri === active()?.uri.toString()) { panel.render(); }
    }),
  );

  configure();
}

export function deactivate(): void { /* everything is in context.subscriptions */ }
