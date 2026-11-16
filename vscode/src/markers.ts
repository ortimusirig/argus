// The markers in the editor and the CodeLens above each block. Wiring only: what is marked is decided in
// src/core/marks.ts from the Assignment that the shared Matcher published.

import * as vscode from "vscode";
import { Index } from "./index";
import { Mark, Marks, marksOf } from "./core/marks";
import { Matcher } from "./core/matching";

const QUIET_MS = 300;

function bar(style: string, colour: string, ruler: boolean): vscode.DecorationRenderOptions {
  const color = new vscode.ThemeColor(colour);
  return { isWholeLine: true, borderStyle: style, borderWidth: "0 0 0 2px", borderColor: color,
    ...(ruler ? { overviewRulerColor: color, overviewRulerLane: vscode.OverviewRulerLane.Left } : {}) };
}

export class Markers implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly current = vscode.window.createTextEditorDecorationType(bar("solid", "editorInfo.foreground", false));
  private readonly warning = vscode.window.createTextEditorDecorationType(bar("solid", "editorWarning.foreground", true));
  private readonly unexplained = vscode.window.createTextEditorDecorationType(bar("dotted", "descriptionForeground", false));
  private readonly masked: vscode.TextEditorDecorationType;
  private readonly lensesChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensesChanged.event;
  private quiet?: NodeJS.Timeout;

  constructor(extensionUri: vscode.Uri, private readonly index: Index, private readonly matcher: Matcher) {
    this.masked = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "lock.svg"), gutterIconSize: "contain" });
  }

  /** After an edit: the visible editors are matched again after 300 ms of quiet. */
  later(): void {
    if (this.quiet) { clearTimeout(this.quiet); }
    this.quiet = setTimeout(() => { this.quiet = undefined; this.refresh(); }, QUIET_MS);
  }

  /** Asks for the assignment of every visible editor, and draws what is published. */
  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) { this.draw(editor, true); }
    this.lensesChanged.fire();
  }

  /** A document has a newly published assignment. */
  matched(uri: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri) { this.draw(editor, false); }
    }
    this.lensesChanged.fire();
  }

  /** The marks of a document: those of the run published last, while a newer run is still going. None when the
   *  document has no note to use, or a note that cannot be read. */
  private marksFor(document: vscode.TextDocument, ask: boolean): Marks | undefined {
    const entry = this.index.locate(document).note;
    if (!entry?.file || entry.file.problems.length > 0) { return undefined; }
    const uri = document.uri.toString();
    if (ask) { this.matcher.want({ uri, version: document.version, text: () => document.getText() }, entry.file, entry.revision); }
    const published = this.matcher.published(uri);
    return published ? marksOf(published.assignment) : undefined;
  }

  private draw(editor: vscode.TextEditor, ask: boolean): void {
    const document = editor.document;
    const marks = this.marksFor(document, ask);
    const last = document.lineCount;
    const ranges = (list: Mark[] | undefined): vscode.DecorationOptions[] => (list ?? []).filter((mark) => mark.from <= last)
      .map((mark) => ({ range: new vscode.Range(mark.from - 1, 0, Math.min(mark.to, last) - 1, 0), hoverMessage: mark.say }));
    editor.setDecorations(this.current, ranges(marks?.current));
    editor.setDecorations(this.warning, ranges(marks?.warning));
    editor.setDecorations(this.unexplained, ranges(marks?.unexplained));
    editor.setDecorations(this.masked, ranges(marks?.masked));
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const marks = this.marksFor(document, false);
    if (!marks) { return []; }
    const uri = document.uri.toString(), last = document.lineCount;
    return marks.lenses.filter((lens) => lens.line <= last).map((lens) => new vscode.CodeLens(new vscode.Range(lens.line - 1, 0, lens.line - 1, 0),
      { title: lens.title, command: "argus.explainSelection", arguments: [uri, lens.from, lens.to], tooltip: "Show this block in the Argus panel" }));
  }

  dispose(): void {
    if (this.quiet) { clearTimeout(this.quiet); }
    for (const type of [this.current, this.warning, this.unexplained, this.masked]) { type.dispose(); }
    this.lensesChanged.dispose();
  }
}
