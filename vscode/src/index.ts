// The index inside VS Code: the settings' projects, the watchers on their folders, and which note explains a
// document. The index itself (reading, ids, revisions) is src/core/noteIndex.ts.

import * as path from "node:path";
import * as vscode from "vscode";
import { Choices } from "./core/choices";
import { Entry, NoteIndex } from "./core/noteIndex";
import { Project, projectFor, realRoot, relativeIn } from "./core/projects";
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
  private roots = new Map<string, string | undefined>();   // the real path of each source root, asked once (warm)
  private warming = false;                                    // the roots are being asked of the disk
  private readonly placed = new vscode.EventEmitter<void>();
  /** The source roots are resolved: where each document lies can be asked now. */
  readonly onDidPlace = this.placed.event;
  private readonly changed = new vscode.EventEmitter<Project>();
  private readonly touched = new vscode.EventEmitter<Project>();
  private readonly chosen = new vscode.EventEmitter<void>();
  private readonly choices = new Choices(() => { this.chosen.fire(); });
  /** The notes of a project changed in the index. */
  readonly onDidChange = this.changed.event;
  /** A file under a project's notes folder or vault folder was created, changed or deleted. */
  readonly onDidTouch = this.touched.event;
  /** The person picked one of several notes for a source file: the note to show for that file changed, though no
   *  note and no document did. */
  readonly onDidChoose = this.chosen.event;

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
    this.warm();
    this.notes.setProjects(this.projects);
    this.unwatch();
    for (const project of this.projects) {
      this.watch(project, project.notesFolder);
      if (project.vaultFolder) { this.watch(project, project.vaultFolder); }
      this.watchSource(project);
    }
    void this.refreshAll();
  }

  private watch(project: Project, folder: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), "**/*"));
    const seen = (uri: vscode.Uri): void => { this.event(project, folder, uri.fsPath); };
    this.watchers.push(watcher, watcher.onDidCreate(seen), watcher.onDidChange(seen), watcher.onDidDelete(seen));
  }

  /** A file or a folder under the source root appeared or went (a move is both): which source each File note
   *  names is asked again after 300 ms of quiet, whether or not a check is stored. A changed text moves no file. */
  private watchSource(project: Project): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(project.sourceRoot), "**/*"));
    const git = `${path.sep}.git${path.sep}`;
    const key = projectKey(project) + "\nsource";
    const seen = (uri: vscode.Uri): void => {
      if (uri.fsPath.includes(git)) { return; }
      const waiting = this.timers.get(key);
      if (waiting) { clearTimeout(waiting); }
      this.timers.set(key, setTimeout(() => {
        this.timers.delete(key);
        this.where.clear();
        void this.notes.relocate(project).catch(() => undefined);
      }, QUIET_MS));
    };
    this.watchers.push(watcher, watcher.onDidCreate(seen), watcher.onDidDelete(seen));
  }

  private unwatch(): void {
    for (const watcher of this.watchers) { watcher.dispose(); }
    this.watchers = [];
    for (const timer of this.timers.values()) { clearTimeout(timer); }
    this.timers.clear();
  }

  /** After 300 ms of quiet for the path, the index is told of it; what the path is (a note, a folder, something
   *  else, or gone) and what follows is decided there (NoteIndex.changed), never here from the path's name. */
  private event(project: Project, folder: string, file: string): void {
    // What lies under a folder whose name starts with a dot is neither the index's nor the checker's.
    if (path.relative(folder, file).split(path.sep).slice(0, -1).some((part) => part.startsWith("."))) { return; }
    this.touched.fire(project);
    const key = projectKey(project) + "\n" + file;
    const waiting = this.timers.get(key);
    if (waiting) { clearTimeout(waiting); }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.notes.changed(project, file).catch(() => undefined);
    }, QUIET_MS));
  }

  /** Reads the project's folders from disk at once; resolves when the index is up to date. */
  refreshNow(project: Project): Promise<void> {
    return this.notes.refreshNow(project);
  }

  async refreshAll(): Promise<void> {
    this.where.clear();                  // "Refresh notes" asks the disk again for everything, also where each document lies
    this.warm();
    for (const project of this.projects) {
      try { await this.notes.refreshNow(project); } catch { /* a folder that cannot be read holds no notes */ }
    }
  }

  /** Asks the disk for the real path of every source root, a few at a time (many projects). Until all are
   *  known no document has a place; then `onDidPlace` says that the places can be asked. */
  private warm(): void {
    const roots = new Map<string, string | undefined>();
    this.roots = roots;
    this.warming = true;
    const left = this.projects.map((project) => project.sourceRoot);
    const some = (): void => {
      if (this.roots !== roots) { return; }                       // asked anew meanwhile
      const until = Date.now() + 2;
      while (left.length > 0 && Date.now() < until) { realRoot(left.pop() as string, undefined, roots); }
      if (left.length > 0) { setImmediate(some); return; }
      // Every root is known: the places of the documents can be told now, and what shows them is drawn again.
      this.warming = false;
      this.placed.fire();
    };
    setImmediate(some);
  }

  /** The document's project and its path inside the source root. Asked of the disk once for each document. */
  private place(document: vscode.TextDocument): { project?: Project; sourceRel?: string } {
    if (document.isUntitled || document.uri.scheme !== "file") { return {}; }
    const key = document.uri.toString();
    let at = this.where.get(key);
    if (!at) {
      if (this.warming) { return {}; }               // the roots are being asked of the disk: known in a moment (onDidChange)
      const project = projectFor(document.uri.fsPath, this.projects, undefined, this.roots);
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
    const note = this.choices.of(projectKey(project) + "\n" + sourceRel, notes);
    return { project, sourceRel, notes, note };
  }

  /** The person picked this one of several notes for its source; kept for this session only. */
  choose(entry: Entry): void {
    if (entry.sourceRel !== undefined) { this.choices.choose(projectKey(entry.project) + "\n" + entry.sourceRel, entry.id); }
  }

  dispose(): void {
    this.unwatch();
    this.notes.setProjects([]);          // a reading of the folders that is going stops
    this.changed.dispose();
    this.touched.dispose();
    this.chosen.dispose();
    this.roots = new Map();              // a resolving of the roots that is still under way ends here
    this.placed.dispose();
  }
}
