// The index inside VS Code: the settings' projects, the watchers on their folders, and which note explains a
// document. The index itself (reading, ids, revisions) is src/core/noteIndex.ts.

import * as path from "node:path";
import * as vscode from "vscode";
import { Entry, NoteIndex } from "./core/noteIndex";
import { Project, projectFor, relativeIn } from "./core/projects";
import { projectKey, projectsFrom } from "./core/settings";

const QUIET_MS = 300;

/** Where a document stands: its project, its path inside the source root, the File notes that explain it, and
 *  the one to use (the only one, or the one the person picked for this session). */
export interface Located { project?: Project; sourceRel?: string; notes: Entry[]; note?: Entry; }

export class Index implements vscode.Disposable {
  readonly notes = new NoteIndex();
  projects: Project[] = [];
  /** The number of entries written in argus.projects, usable or not: the first-use question is asked only at 0. */
  written = 0;
  private watchers: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly where = new Map<string, { project?: Project; sourceRel?: string }>();
  private readonly choices = new Map<string, number>();
  private readonly changed = new vscode.EventEmitter<Project>();
  private readonly touched = new vscode.EventEmitter<Project>();
  /** The notes of a project changed in the index. */
  readonly onDidChange = this.changed.event;
  /** A file under a project's notes folder or vault folder was created, changed or deleted. */
  readonly onDidTouch = this.touched.event;

  constructor() {
    this.notes.onChange = (project) => { this.changed.fire(project); };
  }

  /** Reads argus.projects (the effective value: in Restricted Mode VS Code gives the user's own), watches the
   *  folders and reads the notes. */
  configure(): void {
    const value = vscode.workspace.getConfiguration("argus").get<unknown>("projects");
    this.written = Array.isArray(value) ? value.length : 0;
    this.projects = projectsFrom(value);
    this.where.clear();
    this.notes.setProjects(this.projects);
    this.unwatch();
    for (const project of this.projects) {
      this.watch(project, project.notesFolder);
      if (project.vaultFolder) { this.watch(project, project.vaultFolder); }
    }
    void this.refreshAll();
  }

  private watch(project: Project, folder: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), "**/*"));
    const seen = (uri: vscode.Uri): void => { this.event(project, folder, uri.fsPath); };
    this.watchers.push(watcher, watcher.onDidCreate(seen), watcher.onDidChange(seen), watcher.onDidDelete(seen));
  }

  private unwatch(): void {
    for (const watcher of this.watchers) { watcher.dispose(); }
    this.watchers = [];
    for (const timer of this.timers.values()) { clearTimeout(timer); }
    this.timers.clear();
  }

  /** A changed file is read again after 300 ms of quiet. A changed folder (a rename, a removal) has the project
   *  read again. Folders whose name starts with a dot are not the index's. */
  private event(project: Project, folder: string, file: string): void {
    const parts = path.relative(folder, file).split(path.sep);
    if (parts.slice(0, -1).some((part) => part.startsWith("."))) { return; }
    this.touched.fire(project);
    const isNote = file.toLowerCase().endsWith(".md");
    if (!isNote && path.extname(file) !== "") { return; }
    const key = projectKey(project) + "\n" + (isNote ? file : "");
    const waiting = this.timers.get(key);
    if (waiting) { clearTimeout(waiting); }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void (isNote ? this.notes.reread(project, file) : this.notes.refreshNow(project)).catch(() => undefined);
    }, QUIET_MS));
  }

  /** Reads the project's folders from disk at once; resolves when the index is up to date. */
  refreshNow(project: Project): Promise<void> {
    return this.notes.refreshNow(project);
  }

  async refreshAll(): Promise<void> {
    for (const project of this.projects) {
      try { await this.notes.refreshNow(project); } catch { /* a folder that cannot be read holds no notes */ }
    }
  }

  /** The document's project and its path inside the source root. Asked of the disk once for each document. */
  private place(document: vscode.TextDocument): { project?: Project; sourceRel?: string } {
    if (document.isUntitled || document.uri.scheme !== "file") { return {}; }
    const key = document.uri.toString();
    let at = this.where.get(key);
    if (!at) {
      const project = projectFor(document.uri.fsPath, this.projects);
      at = { project, sourceRel: project ? relativeIn(project.sourceRoot, document.uri.fsPath) : undefined };
      if (at.sourceRel === undefined) { at = {}; }
      if (this.where.size > 500) { this.where.clear(); }
      this.where.set(key, at);
    }
    return at;
  }

  locate(document: vscode.TextDocument): Located {
    const { project, sourceRel } = this.place(document);
    if (!project || sourceRel === undefined) { return { notes: [] }; }
    const notes = this.notes.fileNotesFor(project, sourceRel);
    const picked = this.choices.get(projectKey(project) + "\n" + sourceRel);
    const note = notes.length === 1 ? notes[0] : notes.find((entry) => entry.id === picked);
    return { project, sourceRel, notes, note };
  }

  /** The person picked this one of several notes for its source; kept for this session only. */
  choose(entry: Entry): void {
    if (entry.sourceRel !== undefined) { this.choices.set(projectKey(entry.project) + "\n" + entry.sourceRel, entry.id); }
  }

  dispose(): void {
    this.unwatch();
    this.changed.dispose();
    this.touched.dispose();
  }
}
