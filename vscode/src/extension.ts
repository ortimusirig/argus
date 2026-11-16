// Argus for VS Code: registers the panel, the commands and the events. Wiring only; the logic is in src/core.

import * as vscode from "vscode";
import { Index } from "./index";
import { Panel } from "./panel";
import { Matcher } from "./core/matching";

export function activate(context: vscode.ExtensionContext): void {
  const index = new Index();
  const matched = new vscode.EventEmitter<string>();          // a document (its URI) has a new assignment
  const matcher = new Matcher((uri) => { matched.fire(uri); });
  const panel = new Panel(context.extensionUri, index, matcher);

  const active = (): vscode.TextDocument | undefined => vscode.window.activeTextEditor?.document;

  context.subscriptions.push(index, matched,
    vscode.window.registerWebviewViewProvider(Panel.viewId, panel),

    vscode.commands.registerCommand("argus.explainSelection", (uri?: unknown, from?: unknown, to?: unknown) =>
      // A CodeLens gives the document and the lines of its block; the menu and the palette give nothing.
      panel.explain(false, typeof uri === "string" && typeof from === "number" && typeof to === "number" ? { uri, from, to } : undefined)),
    vscode.commands.registerCommand("argus.explainFile", () => panel.explain(true)),
    vscode.commands.registerCommand("argus.refresh", async () => { await index.refreshAll(); panel.render(); }),
    vscode.commands.registerCommand("argus.create", () => { panel.say("Create explanation is not built yet (piece 7 of the plan)."); }),
    vscode.commands.registerCommand("argus.check", () => { panel.say("Check notes is not built yet (piece 6 of the plan)."); }),
    vscode.commands.registerCommand("argus.openInObsidian", () => { panel.say("Open in Obsidian is not built yet (piece 8 of the plan)."); }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) { panel.follow(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => { panel.follow(); }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === active()) { panel.follow(); }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => { matcher.drop(document.uri.toString()); }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("argus")) { index.configure(); panel.render(); }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { index.configure(); panel.render(); }),
    index.onDidChange(() => { panel.render(); }),
    matched.event((uri) => { if (uri === active()?.uri.toString()) { panel.render(); } }),
  );

  index.configure();
}

export function deactivate(): void { /* everything is in context.subscriptions */ }
