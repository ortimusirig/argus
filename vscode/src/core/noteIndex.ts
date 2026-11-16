// The notes of each project, kept in memory. No import of "vscode": the watchers that tell it of changes are in
// src/index.ts. Notes are read one at a time, with a pause between two, so a large folder never holds the editor.

import * as fs from "node:fs";
import * as path from "node:path";
import { FileNote, OtherNote, isArgus, parseFileNote, parseOtherNote, parseProps } from "./notes";
import { PathRules, Project, relativeIn, sourceInRoot, systemRules } from "./projects";
import { projectKey } from "./settings";

export type Place = "notes" | "vault";

/** One indexed note. `id` belongs to its real path in its project for as long as the extension runs; `revision`
 *  rises each time the index reads a new text for it. */
export interface Entry {
  id: number; revision: number; name: string; path: string; project: Project; place: Place;
  file?: FileNote;          // a File note
  other?: OtherNote;        // any other note
  sourceRel?: string;       // a File note: its `source` as a path inside the source root, when it names a file there
  problem?: string;         // a File note whose `source` names nothing inside the root
  text: string;             // as read; the same text is the same note
}

/** `rejected`: the .md files that are not read because their real path lies outside the project's folders (a
 *  symbolic link that leads out), by their path as found, each with the sentence that says so. */
interface Held { project: Project; entries: Map<string, Entry>; rejected: Map<string, string>; queue: Promise<void>; }

const VAULT_TYPES = new Set(["concept", "library"]);

/** Every .md file under the folder, folders whose name starts with a dot left out (as `note_files` in the checker). */
async function mdFiles(folder: string, pause: () => Promise<void>): Promise<string[]> {
  const found: string[] = [];
  const left = [folder];
  while (left.length > 0) {
    const at = left.pop() as string;
    let listed: fs.Dirent[];
    try { listed = await fs.promises.readdir(at, { withFileTypes: true }); } catch { continue; }
    for (const item of listed) {
      if (item.isDirectory()) {
        if (!item.name.startsWith(".")) { left.push(path.join(at, item.name)); }
      } else if (item.name.toLowerCase().endsWith(".md")) {
        found.push(path.join(at, item.name));
      }
    }
    await pause();
  }
  return found.sort();
}

export class NoteIndex {
  private readonly held = new Map<string, Held>();
  private readonly ids = new Map<string, number>();
  private readonly byId = new Map<number, Entry>();
  private nextId = 1;
  /** Called after the notes of a project were found to have changed. */
  onChange?: (project: Project) => void;

  /** `pause` gives way to everything else that waits; it is awaited between two notes. */
  constructor(private readonly rules: PathRules = systemRules,
    private readonly pause: () => Promise<void> = () => new Promise((go) => { setImmediate(go); })) {}

  /** The projects of the settings. A project that is no longer there leaves with its notes. */
  setProjects(projects: readonly Project[]): void {
    const keys = new Set(projects.map(projectKey));
    for (const [key, held] of this.held) {
      if (!keys.has(key)) {
        for (const entry of held.entries.values()) { this.byId.delete(entry.id); }
        this.held.delete(key);
      }
    }
    for (const project of projects) {
      const key = projectKey(project);
      if (!this.held.has(key)) { this.held.set(key, { project, entries: new Map(), rejected: new Map(), queue: Promise.resolve() }); }
    }
  }

  private of(project: Project): Held | undefined {
    return this.held.get(projectKey(project));
  }

  private keyOf(file: string): string {
    const real = this.rules.real(file);
    return this.rules.windows ? real.toLowerCase() : real;
  }

  /** The folder of the project the file's real path lies in, now: the notes folder before the vault folder.
   *  Undefined when it lies in neither; such a file is never read. */
  private placeOf(project: Project, file: string): Place | undefined {
    if (relativeIn(project.notesFolder, file, this.rules) !== undefined) { return "notes"; }
    if (project.vaultFolder !== undefined && relativeIn(project.vaultFolder, file, this.rules) !== undefined) { return "vault"; }
    return undefined;
  }

  /** One thing at a time for each project: a refresh never runs into a re-read. */
  private queued(held: Held, work: () => Promise<boolean>): Promise<void> {
    const next = held.queue.then(work).then((changed) => {
      if (changed && this.held.get(projectKey(held.project)) === held) { this.onChange?.(held.project); }
    });
    held.queue = next.catch(() => undefined);
    return next;
  }

  /** Reads the project's folders from disk at once; resolves when the index is up to date. */
  refreshNow(project: Project): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    return this.queued(held, async () => {
      let changed = false;
      const rejectedBefore = held.rejected;
      held.rejected = new Map();
      const seen = new Set<string>();
      const folders: [Place, string][] = [["notes", project.notesFolder]];
      if (project.vaultFolder) { folders.push(["vault", project.vaultFolder]); }
      for (const [, folder] of folders) {
        for (const file of await mdFiles(folder, this.pause)) {
          let key: string;
          try { key = this.keyOf(file); } catch { continue; }
          if (seen.has(key)) { continue; }           // a notes folder inside the vault: its notes are the project's own
          seen.add(key);
          if (await this.read(held, file, key)) { changed = true; }
          await this.pause();
        }
      }
      for (const [key, entry] of held.entries) {
        if (!seen.has(key)) { held.entries.delete(key); this.byId.delete(entry.id); changed = true; }
      }
      if (rejectedBefore.size !== held.rejected.size
        || [...held.rejected].some(([file, why]) => rejectedBefore.get(file) !== why)) { changed = true; }
      return changed;
    });
  }

  /** Reads one file again after it changed, appeared or went. */
  reread(project: Project, file: string): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    return this.queued(held, async () => {
      const was = held.rejected.get(file);
      held.rejected.delete(file);
      let key: string;
      try { key = this.keyOf(file); } catch { return was !== undefined; }
      const inNotes = relativeIn(project.notesFolder, file, this.rules);
      const rel = inNotes ?? (project.vaultFolder ? relativeIn(project.vaultFolder, file, this.rules) : undefined);
      if (rel !== undefined && rel.split("/").slice(0, -1).some((part) => part.startsWith("."))) { return was !== undefined; }
      const changed = await this.read(held, file, key);
      return changed || was !== held.rejected.get(file);
    });
  }

  /** Reads and parses one note; the only way into the index. Whether the file's real path lies inside the
   *  project's folders is asked first: a file that leads out of them is not read, and is listed as a problem.
   *  True when the notes of the index changed. */
  private async read(held: Held, file: string, key: string): Promise<boolean> {
    const had = held.entries.get(key);
    const drop = (): boolean => {
      if (had) { held.entries.delete(key); this.byId.delete(had.id); }
      return had !== undefined;
    };
    const project = held.project;
    const place = this.placeOf(project, file);
    if (place === undefined) {
      let there = true;
      try { await fs.promises.lstat(file); } catch { there = false; }
      if (there) {
        let real = file;
        try { real = this.rules.real(file); } catch { /* said with the path as found */ }
        held.rejected.set(file, `${path.basename(file).replace(/\.md$/i, "")}: its real path lies outside the notes folder `
          + `and the vault folder, so it is not read: '${real}'`);
      }
      return drop();
    }
    let text: string;
    try { text = await fs.promises.readFile(file, "utf8"); } catch { return drop(); }
    if (had && had.text === text && had.place === place) {
      if (!had.file) { return false; }
      // The same note; whether its source is a file inside the root is asked again, as the disk may have changed.
      const before = had.sourceRel;
      this.locate(had, project);
      return before !== had.sourceRel;
    }
    const props = parseProps(text);
    const type = props.type.toLowerCase();
    if (!isArgus(props) || (place === "vault" && !VAULT_TYPES.has(type))) { return drop(); }
    const name = path.basename(file).replace(/\.md$/i, "");
    const real = this.rules.real(file);
    const idKey = projectKey(project) + "\n" + key;
    let id = this.ids.get(idKey);
    if (id === undefined) { id = this.nextId++; this.ids.set(idKey, id); }
    const entry: Entry = { id, revision: (had?.revision ?? 0) + 1, name, path: real, project, place, text };
    if (type === "file") {
      entry.file = parseFileNote(name, real, text);
      this.locate(entry, project);
    } else {
      entry.other = parseOtherNote(name, real, text);
    }
    held.entries.set(key, entry);
    this.byId.set(id, entry);
    return true;
  }

  private locate(entry: Entry, project: Project): void {
    const source = entry.file?.props.source ?? "";
    const rel = sourceInRoot(project.sourceRoot, source, this.rules);
    // "." is the root itself to the checker; no file an editor shows is the root.
    entry.sourceRel = rel === undefined || rel === "." || rel.startsWith("./") ? undefined : rel;
    entry.problem = entry.sourceRel === undefined
      ? `${entry.name}: its source names no file under the source root: '${source}'` : undefined;
  }

  /** The File notes of the project that explain the file at this path inside the source root: zero, one or several. */
  fileNotesFor(project: Project, sourceRel: string): Entry[] {
    const want = this.rules.windows ? sourceRel.toLowerCase() : sourceRel;
    return this.all(project).filter((entry) => entry.file !== undefined && entry.sourceRel !== undefined
      && (this.rules.windows ? entry.sourceRel.toLowerCase() : entry.sourceRel) === want);
  }

  private all(project: Project): Entry[] {
    return [...(this.of(project)?.entries.values() ?? [])];
  }

  /** The notes of the project in its notes folder, or in its vault outside the notes folder. */
  notesOf(project: Project, place: Place): Entry[] {
    return this.all(project).filter((entry) => entry.place === place);
  }

  /** The File notes of the project whose `source` the index could not use, and the files it did not read because
   *  they lead out of the project's folders, each as one sentence. */
  problemsOf(project: Project): string[] {
    return [...this.all(project).filter((entry) => entry.problem !== undefined).map((entry) => entry.problem as string),
      ...(this.of(project)?.rejected.values() ?? [])].sort();
  }

  /** Every indexed note of that name, in any project: zero, one or several. */
  notesByName(name: string): Entry[] {
    const found: Entry[] = [];
    for (const held of this.held.values()) {
      for (const entry of held.entries.values()) { if (entry.name === name) { found.push(entry); } }
    }
    return found;
  }

  noteById(id: number): Entry | undefined {
    return this.byId.get(id);
  }

  /** Whether the note's real path lies, now, inside its project's notes folder or vault folder. Asked again before
   *  a note is read or opened on a message from the page. */
  holds(entry: Entry): boolean {
    if (!this.of(entry.project)) { return false; }
    const { notesFolder, vaultFolder } = entry.project;
    return relativeIn(notesFolder, entry.path, this.rules) !== undefined
      || (vaultFolder !== undefined && relativeIn(vaultFolder, entry.path, this.rules) !== undefined);
  }
}
