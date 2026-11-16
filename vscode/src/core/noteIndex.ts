// The notes of each project, kept in memory. No import of "vscode": the watchers that tell it of changes are in
// src/index.ts. Notes are read one at a time, with a pause between two, so a large folder never holds the editor.

import * as fs from "node:fs";
import * as path from "node:path";
import { LinkMap, linkMap } from "./links";
import { FileNote, OtherNote, isArgus, parseFileNote, parseOtherNote, parseProps } from "./notes";
import { PathRules, Project, relativeIn, sourceInRoot, systemRules } from "./projects";
import { decode } from "./readText";
import { projectKey } from "./settings";

export type Place = "notes" | "vault";

/** One indexed note. `id` belongs to its real path in its project for as long as the extension runs; `revision`
 *  is new each time the index reads a new text for it, or finds it under a new name or path: one counter for the
 *  whole index, which only rises, so no
 *  revision is used twice, not by another note and not by a note that went and came back. */
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
interface Held { project: Project; entries: Map<string, Entry>; rejected: Map<string, string>; queue: Promise<void>;
  // Where a .md path led when it was last read: the path as found (`pathKey`), and the key of its target. A
  // note is kept under its target's key, so a link that is pointed elsewhere or deleted says nothing of the note
  // it led to; this says it. Kept for the paths of the notes and for every link, not for a plain file that is no
  // note: nothing follows from where that led.
  from: Map<string, Way>;
  refreshed: number;        // the tick at which the last reading of the folders began
  links?: LinkMap<Entry>; } // the notes by name, for the [[links]]: built when asked for, dropped when `entries` changes

interface Way { file: string; key: string; }

const VAULT_TYPES = new Set(["concept", "library"]);

/** Whether a file name is a note's, as the checker's `rglob("*.md")` takes it: on Windows in any letter case, on
 *  other systems only `.md` as written. A file the checker does not read is no note here either: it could
 *  else show the badge of a check that never read it. */
export function isNoteFile(name: string, windows: boolean): boolean {
  return (windows ? name.toLowerCase() : name).endsWith(".md");
}

/** Every .md file under the folder, folders whose name starts with a dot left out (as `note_files` in the checker).
 *  The listing ends early when `wanted` says that nobody waits for it any more. */
async function mdFiles(folder: string, windows: boolean, pause: () => Promise<void>, wanted: () => boolean): Promise<string[]> {
  const found: string[] = [];
  const left = [folder];
  while (left.length > 0 && wanted()) {
    const at = left.pop() as string;
    let listed: fs.Dirent[];
    try { listed = await fs.promises.readdir(at, { withFileTypes: true }); } catch { continue; }
    for (const item of listed) {
      if (item.isDirectory()) {
        if (!item.name.startsWith(".")) { left.push(path.join(at, item.name)); }
      } else if (isNoteFile(item.name, windows)) {
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
  private nextRevision = 1;
  private tick = 0;           // rises with each event and each reading of the folders: which came first
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
      if (!this.held.has(key)) { this.held.set(key, { project, entries: new Map(), rejected: new Map(), from: new Map(), queue: Promise.resolve(), refreshed: 0 }); }
    }
  }

  private of(project: Project): Held | undefined {
    return this.held.get(projectKey(project));
  }

  private keyOf(file: string): string {
    const real = this.rules.real(file);
    return this.rules.windows ? real.toLowerCase() : real;
  }

  /** The key the file has when it is a plain file: the real path of its folder, and its own name. It is another
   *  key than `keyOf` gives when the file itself is a link. Undefined when the folder cannot be read. */
  private ownKey(file: string, folders?: Map<string, string>): string | undefined {
    try {
      const parent = path.dirname(file);
      let folder = folders?.get(parent);
      if (folder === undefined) {
        folder = this.rules.real(parent);
        folders?.set(parent, folder);
      }
      const sep = this.rules.windows ? "\\" : "/";
      const own = folder + (folder.endsWith(sep) ? "" : sep) + path.basename(file);
      return this.rules.windows ? own.toLowerCase() : own;
    } catch {
      return undefined;
    }
  }

  /** The path as found, as a key: links in its folders followed, the file itself not. `folders` keeps the real
   *  path of each folder asked for, for a reading of many files. */
  private pathKey(file: string, folders?: Map<string, string>): string {
    return this.ownKey(file, folders) ?? (this.rules.windows ? file.toLowerCase() : file);
  }

  /** The folder of the project the file's real path lies in, now: the notes folder before the vault folder.
   *  Undefined when it lies in neither; such a file is never read. */
  private placeOf(project: Project, file: string): Place | undefined {
    if (relativeIn(project.notesFolder, file, this.rules) !== undefined) { return "notes"; }
    if (project.vaultFolder !== undefined && relativeIn(project.vaultFolder, file, this.rules) !== undefined) { return "vault"; }
    return undefined;
  }

  /** Whether these are still the notes of a project of the settings. When the project left (or left and came
   *  back, with new notes), work that was going for it stops: it must not put a note back that left with it. */
  private live(held: Held): boolean {
    return this.held.get(projectKey(held.project)) === held;
  }

  /** One thing at a time for each project: a refresh never runs into a re-read. */
  private queued(held: Held, work: () => Promise<boolean>): Promise<void> {
    const next = held.queue.then(() => this.live(held) ? work() : false).then((changed) => {
      if (changed && this.held.get(projectKey(held.project)) === held) { this.onChange?.(held.project); }
    });
    held.queue = next.catch(() => undefined);
    return next;
  }

  /** Reads the project's folders from disk at once; resolves when the index is up to date. */
  refreshNow(project: Project): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    return this.queued(held, () => this.refreshWork(held));
  }

  private async refreshWork(held: Held): Promise<boolean> {
    const project = held.project;
    {
      held.refreshed = ++this.tick;
      let changed = false;
      const rejectedBefore = held.rejected;
      held.rejected = new Map();
      const seen = new Set<string>();
      const from = new Map<string, Way>(), real = new Map<string, string>();
      const folders: [Place, string][] = [["notes", project.notesFolder]];
      if (project.vaultFolder) { folders.push(["vault", project.vaultFolder]); }
      for (const [, folder] of folders) {
        for (const file of await mdFiles(folder, this.rules.windows, this.pause, () => this.live(held))) {
          if (!this.live(held)) { return false; }
          let key: string;
          try { key = this.keyOf(file); } catch { continue; }
          from.set(this.pathKey(file, real), { file, key });
          if (seen.has(key)) { continue; }           // a notes folder inside the vault: its notes are the project's own
          seen.add(key);
          if (await this.read(held, file, key)) { changed = true; }
          await this.pause();
        }
      }
      if (!this.live(held)) { return false; }
      for (const [key, entry] of held.entries) {
        if (!seen.has(key)) { held.entries.delete(key); held.links = undefined; this.byId.delete(entry.id); changed = true; }
      }
      for (const [found, way] of from) {
        if (way.key === found && !held.entries.has(way.key)) { from.delete(found); }
      }
      held.from = from;
      if (rejectedBefore.size !== held.rejected.size
        || [...held.rejected].some(([file, why]) => rejectedBefore.get(file) !== why)) { changed = true; }
      return changed;
    }
  }

  /** A watcher's event for a path under the project's notes folder or vault folder: created, changed or deleted.
   *  What the path is is asked of the disk, never read from its name: a folder (whatever its name, `v1.0` or
   *  `archive.md`) has the project's folders read again; a .md file is read again; any other file is nothing,
   *  unless a link `Name.md` leads to it (`throughLink`).
   *  A path that is gone cannot be asked: when notes are indexed under it, it was a folder, and the folders are
   *  read again (so a rename that reports only the old path leaves no note at a path that is gone); else it is
   *  read again as a note, which drops the note that was there (a folder of links to notes is known by the paths
   *  the notes were found at). Paths under a folder whose name starts with a dot
   *  are not the index's. Folder events that arrive together are answered by one reading. */
  changed(project: Project, file: string): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    const asked = ++this.tick;
    return this.queued(held, async () => {
      const inNotes = relativeIn(project.notesFolder, file, this.rules);
      const rel = inNotes ?? (project.vaultFolder ? relativeIn(project.vaultFolder, file, this.rules) : undefined);
      const parts = rel === undefined ? [] : rel.split("/");
      if (parts.slice(0, -1).some((part) => part.startsWith("."))) { return false; }
      let folder: boolean | undefined;                       // undefined: gone
      try { folder = (await fs.promises.stat(file)).isDirectory(); } catch { folder = undefined; }
      if (folder === undefined) {
        // The keys are real paths: only a note whose key begins with the path's can lie under it, and only those
        // are asked of the path rules.
        let at = "";
        try { at = this.keyOf(file); } catch { return false; }
        folder = [...held.entries].some(([key, entry]) => key.length > at.length && key.startsWith(at)
          && relativeIn(file, entry.path, this.rules) !== undefined);
        // A note read through a link lies under its target, not under the link's folder: the links as found are
        // asked too, so a folder that held only links has the folders read again when it goes.
        if (!folder) {
          const under = at + (this.rules.windows ? "\\" : "/");
          for (const [found, way] of held.from) { if (way.key !== found && found.startsWith(under)) { folder = true; break; } }
        }
      } else if (folder && parts.length > 0 && parts[parts.length - 1].startsWith(".")) {
        return false;
      }
      if (folder) { return held.refreshed > asked ? false : this.refreshWork(held); }
      return isNoteFile(path.basename(file), this.rules.windows) ? this.rereadWork(held, this.wayOf(held, file)) : this.throughLink(held, file);
    });
  }

  /** The path a note is read through. A note that two paths reach (its own, and a link to it) has the name of
   *  the path a reading of the folders found first. An event for the other path reads the note again through
   *  that first path, while it still leads there: so the note keeps its name. */
  private wayOf(held: Held, file: string): string {
    let key: string;
    try { key = this.keyOf(file); } catch { return file; }
    const entry = held.entries.get(key);
    if (!entry) { return file; }
    const named = (way: string): boolean => path.basename(way).slice(0, -3) === entry.name;   // without ".md"
    if (named(file)) { return file; }
    for (const way of held.from.values()) {
      if (way.key === key && way.file !== file && named(way.file)) { return way.file; }
    }
    return file;
  }

  /** An event for a file that is no .md by its name: it may be what a link `Name.md` leads to, changed, made or
   *  deleted. Then the link is read again. Any other file is nothing to the index, and nothing is read. */
  private throughLink(held: Held, file: string): Promise<boolean> | boolean {
    let key: string;
    try { key = this.keyOf(file); } catch { return false; }
    for (const [found, way] of held.from) {
      if (way.key === key && found !== key) { return this.rereadWork(held, way.file); }
    }
    return false;
  }

  /** Reads one file again after it changed, appeared or went. */
  reread(project: Project, file: string): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    return this.queued(held, () => this.rereadWork(held, file));
  }

  private async rereadWork(held: Held, file: string): Promise<boolean> {
    const project = held.project;
    {
      const was = held.rejected.get(file);
      held.rejected.delete(file);
      let key: string | undefined;
      try { key = this.keyOf(file); } catch { key = undefined; }
      // The note that was read from this path while it was a plain file. When the path now leads somewhere else
      // (the file was replaced by a link) or cannot be read, that note is no longer what the path holds: it
      // leaves, whatever becomes of the new target. A full reading of the folders drops it in the same way.
      const own = this.ownKey(file);
      const old = own !== undefined && own !== key ? held.entries.get(own) : undefined;
      if (old && own !== undefined) { held.entries.delete(own); held.links = undefined; this.byId.delete(old.id); }
      // The note this path led to when it was last read, when it leads somewhere else now: a link that was pointed
      // at another target, or deleted.
      const at = this.pathKey(file);
      const before = held.from.get(at);
      held.from.delete(at);
      const left = before !== undefined && before.key !== key && await this.leave(held, before.key);
      const gone = old !== undefined || was !== undefined || left;
      if (key === undefined) { return gone; }
      const inNotes = relativeIn(project.notesFolder, file, this.rules);
      const rel = inNotes ?? (project.vaultFolder ? relativeIn(project.vaultFolder, file, this.rules) : undefined);
      if (rel !== undefined && rel.split("/").slice(0, -1).some((part) => part.startsWith("."))) { return gone; }
      const changed = await this.read(held, file, key);
      let there = true;
      try { await fs.promises.lstat(file); } catch { there = false; }
      if (there && (key !== at || held.entries.has(key))) { held.from.set(at, { file, key }); }
      return changed || old !== undefined || left || was !== held.rejected.get(file);
    }
  }

  /** A path does not lead to the note of this key any more. The note stays when another path still leads to it,
   *  and is read again by that path, as its name is the path's; else it leaves. True when the index changed. */
  private async leave(held: Held, key: string): Promise<boolean> {
    const had = held.entries.get(key);
    if (!had) { return false; }
    for (const [at, way] of [...held.from]) {
      if (way.key !== key) { continue; }
      let now: string | undefined;
      try { now = this.keyOf(way.file); } catch { now = undefined; }
      if (now === key) { return this.read(held, way.file, key); }
      held.from.delete(at);                        // that path leads elsewhere by now; its own event says where
    }
    held.entries.delete(key);
    held.links = undefined;
    this.byId.delete(had.id);
    return true;
  }

  /** Reads and parses one note; the only way into the index. Whether the file's real path lies inside the
   *  project's folders is asked first: a file that leads out of them is not read, and is listed as a problem.
   *  True when the notes of the index changed. */
  private async read(held: Held, file: string, key: string): Promise<boolean> {
    const had = held.entries.get(key);
    const drop = (): boolean => {
      if (had) { held.entries.delete(key); held.links = undefined; this.byId.delete(had.id); }
      return had !== undefined;
    };
    const project = held.project;
    const place = this.placeOf(project, file);
    if (place === undefined) {
      let there = true;
      try { await fs.promises.lstat(file); } catch { there = false; }
      if (!this.live(held)) { return false; }
      if (there) {
        let real = file;
        try { real = this.rules.real(file); } catch { /* said with the path as found */ }
        held.rejected.set(file, `${path.basename(file).replace(/\.md$/i, "")}: its real path lies outside the notes folder `
          + `and the vault folder, so it is not read: '${real}'`);
      }
      return drop();
    }
    // The file that was found to lie inside the folders must be the file that was read: where the path leads is
    // asked before the reading and after it, and both answers must be the same real path, inside the folders.
    // A link that was pointed elsewhere while the file was read gives a text that is not used.
    let checked: string;
    try { checked = this.rules.real(file); } catch { return drop(); }
    // The file is opened once, and what is read comes from that open file. Afterwards the open file must be the
    // file that the system finds at the path's own real path, and that real path must lie inside the folders:
    // so the text is the text of a file inside the folders, whatever a link did while it was read.
    let text: string;
    let bound = false;
    try {
      const handle = await fs.promises.open(file, "r");
      try {
        const opened = await handle.stat({ bigint: true });
        text = decode(await handle.readFile()).text;                    // as the checker reads it
        const canonical = systemRules.real(file);
        const there = await fs.promises.lstat(canonical, { bigint: true });
        bound = !there.isSymbolicLink() && there.dev === opened.dev && there.ino === opened.ino
          && systemRules.real(canonical) === canonical && this.placeOf(project, canonical) === place;
      } finally { await handle.close(); }
    } catch { return this.live(held) && drop(); }
    if (!this.live(held)) { return false; }
    if (!bound) {
      held.rejected.set(file, `${path.basename(file).replace(/\.md$/i, "")}: the file changed where it leads while it was read, `
        + "so it is not used; it is read again at the next change or refresh");
      return drop();
    }
    // The name and the path are asked of the file as it is now: the key is the same for `Original.md` and
    // `original.md` on Windows, so a note renamed in letter case only is found under the key of the old one.
    let real: string;
    try { real = this.rules.real(file); } catch { return drop(); }
    let still: string | undefined;
    try { still = this.rules.real(checked); } catch { still = undefined; }
    if (real !== checked || still !== checked || this.placeOf(project, file) !== place) {
      held.rejected.set(file, `${path.basename(file).replace(/\.md$/i, "")}: the file changed where it leads while it was read, `
        + "so it is not used; it is read again at the next change or refresh");
      return drop();
    }
    const name = this.nameOf(file, real);
    if (had && had.text === text && had.place === place && had.name === name && had.path === real) {
      if (!had.file) { return false; }
      // The same note; whether its source is a file inside the root is asked again, as the disk may have changed.
      const before = had.sourceRel;
      this.locate(had, project);
      return before !== had.sourceRel;
    }
    const props = parseProps(text);
    const type = props.type.toLowerCase();
    if (!isArgus(props) || (place === "vault" && !VAULT_TYPES.has(type))) { return drop(); }
    const idKey = projectKey(project) + "\n" + key;
    let id = this.ids.get(idKey);
    if (id === undefined) { id = this.nextId++; this.ids.set(idKey, id); }
    const entry: Entry = { id, revision: this.nextRevision++, name, path: real, project, place, text };
    if (type === "file") {
      entry.file = parseFileNote(name, real, text);
      this.locate(entry, project);
    } else {
      entry.other = parseOtherNote(name, real, text);
    }
    held.entries.set(key, entry);
    held.links = undefined;
    this.byId.set(id, entry);
    return true;
  }

  /** The note's name: the file's name without `.md`. On Windows the path as given may be spelled in another
   *  letter case than the file on disk (an event for the old name after a rename in case only); the spelling on
   *  disk is the name then, as links are compared with names letter for letter. */
  private nameOf(file: string, real: string): string {
    const given = path.basename(file).replace(/\.md$/i, "");
    if (!this.rules.windows) { return given; }
    const onDisk = real.slice(Math.max(real.lastIndexOf("\\"), real.lastIndexOf("/")) + 1).replace(/\.md$/i, "");
    return onDisk.toLowerCase() === given.toLowerCase() ? onDisk : given;
  }

  /** Asks again, for every File note of the project, which file under the source root its `source` names: called
   *  after a file or a folder under the source root appeared, went or moved. A note read before its source was
   *  there is found for it from now on; a note whose source went is listed as a problem. No note is read. */
  relocate(project: Project): Promise<void> {
    const held = this.of(project);
    if (!held) { return Promise.resolve(); }
    return this.queued(held, async () => {
      let changed = false;
      for (const entry of [...held.entries.values()]) {
        if (!entry.file) { continue; }
        const before = entry.sourceRel;
        this.locate(entry, project);
        if (before !== entry.sourceRel) { changed = true; }
        await this.pause();
        if (!this.live(held)) { return false; }
      }
      return changed;
    });
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

  /** The note each linked name means in this project, as `resolveLink` over `notesOf` says it: one lookup for a
   *  link. */
  linksOf(project: Project): LinkMap<Entry> {
    const held = this.of(project);
    if (!held) { return linkMap<Entry>([], []); }
    if (!held.links) {
      const own: Entry[] = [], vault: Entry[] = [];
      for (const entry of held.entries.values()) { (entry.place === "notes" ? own : vault).push(entry); }
      held.links = linkMap(own, vault);
    }
    return held.links;
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
