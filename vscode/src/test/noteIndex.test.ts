import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NoteIndex } from "../core/noteIndex";
import { PathRules, Project, systemRules } from "../core/projects";

function fileNote(source: string, purpose = "adds"): string {
  return `---\ntype: file\nwritten_by: argus\nsource: ${source}\ndepth: map\n---\n# note\n\n## Code and explanation\n\n`
    + `### Block 1: ${purpose} (lines 1-1)\n\n\`\`\`py\nx = 1\n\`\`\`\n\nIt ${purpose}, see [[Concept - x]].\n`;
}
function other(type: string, by = "argus"): string {
  return `---\ntype: ${type}\nwritten_by: ${by}\n---\n# A note\n\nText.\n`;
}

/** A scratch project on disk: src/a.py, a notes folder inside a vault, and shared notes in the vault. */
function scratch(): { root: string; project: Project; write(rel: string, text: string): string; done(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-index-"));
  const write = (rel: string, text: string): string => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  write("src/a.py", "x = 1\n");
  write("src/sub/b.py", "x = 1\n");
  write("vault/P/P file - a.py.md", fileNote("a.py"));
  write("vault/P/Concepts/Concept - x.md", other("concept"));
  write("vault/P/not ours.md", other("concept", "someone"));
  write("vault/P/.trash/Concept - gone.md", other("concept"));
  write("vault/Shared/Concept - y.md", other("concept"));
  write("vault/Shared/Library - z.md", other("library"));
  write("vault/Shared/Mechanism - m.md", other("mechanism"));
  write("vault/Other/Concept - x.md", other("concept"));
  write("vault/.obsidian/Concept - hidden.md", other("concept"));
  const project: Project = { sourceRoot: path.join(root, "src"), notesFolder: path.join(root, "vault", "P"), vaultFolder: path.join(root, "vault") };
  return { root, project, write, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("the index reads the notes of the notes folder, and the Concept and Library notes of the vault", async () => {
  const s = scratch();
  try {
    let pauses = 0;
    const index = new NoteIndex(undefined, () => { pauses++; return new Promise((go) => setImmediate(go)); });
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.deepEqual(index.notesOf(s.project, "notes").map((e) => e.name).sort(), ["Concept - x", "P file - a.py"]);
    assert.deepEqual(index.notesOf(s.project, "vault").map((e) => e.name).sort(), ["Concept - x", "Concept - y", "Library - z"]);
    assert.ok(pauses >= 5, "the index gives way between two notes");
    const [note] = index.fileNotesFor(s.project, "a.py");
    assert.equal(note.file?.blocks[0].purpose, "adds");
    assert.ok(note.revision >= 1);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py"), []);
    assert.equal(index.notesByName("Concept - x").length, 2);
    assert.equal(index.noteById(note.id), note);
    assert.equal(index.noteById(9999), undefined);
    assert.ok(index.holds(note));
  } finally { s.done(); }
});

test("ids stay, revisions rise only when a note's text is read anew, removed notes leave", async () => {
  const s = scratch();
  try {
    const changes: Project[] = [];
    const index = new NoteIndex();
    index.onChange = (project) => { changes.push(project); };
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.equal(changes.length, 1);
    const before = index.fileNotesFor(s.project, "a.py")[0];
    await index.refreshNow(s.project);
    assert.equal(index.fileNotesFor(s.project, "a.py")[0].revision, before.revision, "the same text is the same note");
    assert.equal(changes.length, 1);

    const file = s.write("vault/P/P file - a.py.md", fileNote("a.py", "counts"));
    await index.reread(s.project, file);
    const after = index.fileNotesFor(s.project, "a.py")[0];
    assert.equal(after.id, before.id);
    assert.ok(after.revision > before.revision);
    assert.equal(after.file?.blocks[0].purpose, "counts");
    assert.equal(changes.length, 2);

    // A second note for the same source: both are given, nothing is chosen.
    s.write("vault/P/Another.md", fileNote("./sub/../a.py"));
    await index.refreshNow(s.project);
    assert.equal(index.fileNotesFor(s.project, "a.py").length, 2);

    fs.rmSync(file);
    await index.reread(s.project, file);
    assert.deepEqual(index.fileNotesFor(s.project, "a.py").map((e) => e.name), ["Another"]);
    assert.equal(index.noteById(before.id), undefined);
    fs.rmSync(path.join(s.root, "vault", "P", "Another.md"));
    await index.refreshNow(s.project);
    assert.deepEqual(index.fileNotesFor(s.project, "a.py"), []);
  } finally { s.done(); }
});

test("a source outside the root or naming no file is not looked up, and is listed as a problem", async () => {
  const s = scratch();
  try {
    s.write("outside.py", "x = 1\n");
    s.write("vault/P/Out.md", fileNote("../outside.py"));
    s.write("vault/P/Nowhere.md", fileNote("nowhere.py"));
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.equal(index.fileNotesFor(s.project, "../outside.py").length, 0);
    const problems = index.problemsOf(s.project);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /Out: .*\.\.\/outside\.py/);
    assert.match(problems.join("\n"), /Nowhere: .*nowhere\.py/);
  } finally { s.done(); }
});

test("a note whose path no longer lies in the folders is not held", async () => {
  const s = scratch();
  try {
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const note = index.notesByName("Concept - y")[0];
    assert.ok(index.holds(note));
    assert.equal(index.holds({ ...note, path: path.join(s.root, "outside.md") }), false);
    index.setProjects([]);
    assert.equal(index.noteById(note.id), undefined);
  } finally { s.done(); }
});

test("a note whose real path lies outside the folders is not read, on a refresh or a re-read, and is listed as a problem", async () => {
  const s = scratch();
  try {
    // As a symbolic link would be: a .md in the notes folder whose real path is a file outside the folders.
    const outside = s.write("elsewhere/Secret.md", fileNote("a.py", "leaks"));
    const link = s.write("vault/P/Link.md", fileNote("a.py", "leaks"));
    const real = systemRules.real(link);
    const rules: PathRules = { ...systemRules, real: (file) => {
      const at = systemRules.real(file);
      return at === real ? systemRules.real(outside) : at;
    } };
    const index = new NoteIndex(rules);
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.deepEqual(index.notesByName("Link"), []);
    assert.deepEqual(index.fileNotesFor(s.project, "a.py").map((e) => e.name), ["P file - a.py"]);
    for (const entry of [...index.notesOf(s.project, "notes"), ...index.notesOf(s.project, "vault")]) { assert.ok(index.holds(entry)); }
    assert.match(index.problemsOf(s.project).join("\n"), /Link: .*outside.*Secret\.md/);

    const again = new NoteIndex(rules);
    again.setProjects([s.project]);
    let changes = 0;
    again.onChange = () => { changes++; };
    await again.reread(s.project, link);
    assert.deepEqual(again.notesByName("Link"), []);
    assert.match(again.problemsOf(s.project).join("\n"), /Link: .*outside.*Secret\.md/);
    assert.equal(changes, 1, "a new problem is a change the panel shows");

    // The link goes: so does its problem.
    fs.rmSync(link);
    await again.reread(s.project, link);
    assert.deepEqual(again.problemsOf(s.project), []);
    await index.refreshNow(s.project);
    assert.deepEqual(index.problemsOf(s.project), []);
  } finally { s.done(); }
});

test("a revision is never used twice: not by two notes, not by a note that went and came back", async () => {
  const s = scratch();
  try {
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const all = [...index.notesOf(s.project, "notes"), ...index.notesOf(s.project, "vault")].map((e) => e.revision);
    assert.equal(new Set(all).size, all.length);
    const file = path.join(s.root, "vault", "P", "P file - a.py.md");
    const before = index.fileNotesFor(s.project, "a.py")[0];
    fs.rmSync(file);
    await index.reread(s.project, file);
    s.write("vault/P/P file - a.py.md", fileNote("a.py", "counts"));
    await index.reread(s.project, file);
    const after = index.fileNotesFor(s.project, "a.py")[0];
    assert.equal(after.id, before.id);
    assert.ok(after.revision > Math.max(...all), "the note that came back is not taken for the one that went");
  } finally { s.done(); }
});

test("a source that appears, goes or moves after its note was read: the note is found for it, or not, without a refresh", async () => {
  const s = scratch();
  try {
    s.write("vault/P/Later.md", fileNote("later/new.py"));
    const index = new NoteIndex();
    let changes = 0;
    index.onChange = () => { changes++; };
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.deepEqual(index.fileNotesFor(s.project, "later/new.py"), []);
    assert.match(index.problemsOf(s.project).join("\n"), /Later: /);
    changes = 0;

    s.write("src/later/new.py", "x = 1\n");                       // the source is created
    await index.relocate(s.project);
    assert.deepEqual(index.fileNotesFor(s.project, "later/new.py").map((e) => e.name), ["Later"]);
    assert.deepEqual(index.problemsOf(s.project), []);
    assert.equal(changes, 1);
    const revision = index.fileNotesFor(s.project, "later/new.py")[0].revision;

    await index.relocate(s.project);                               // nothing moved: nothing changed
    assert.equal(changes, 1);

    fs.renameSync(path.join(s.root, "src", "later"), path.join(s.root, "src", "moved"));      // its folder is renamed
    await index.relocate(s.project);
    assert.deepEqual(index.fileNotesFor(s.project, "later/new.py"), []);
    assert.match(index.problemsOf(s.project).join("\n"), /Later: /);
    assert.equal(changes, 2);

    fs.renameSync(path.join(s.root, "src", "moved"), path.join(s.root, "src", "later"));      // and restored
    await index.relocate(s.project);
    const back = index.fileNotesFor(s.project, "later/new.py");
    assert.equal(back.length, 1);
    assert.equal(back[0].revision, revision, "the note's text is the same: so is its revision");
    assert.equal(changes, 3);
  } finally { s.done(); }
});

test("an event for a folder is a folder's event whatever its name, also when the folder is gone", async () => {
  const s = scratch();
  try {
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const names = (): string[] => index.notesOf(s.project, "notes").map((e) => e.name).sort();
    assert.deepEqual(names(), ["Concept - x", "P file - a.py"]);

    // A folder whose name has an extension appears with a note in it; only the folder's event is given.
    s.write("vault/P/v1.0/Concept - one.md", other("concept"));
    await index.changed(s.project, path.join(s.root, "vault", "P", "v1.0"));
    assert.deepEqual(names(), ["Concept - one", "Concept - x", "P file - a.py"]);

    // A folder named as a note is a folder.
    s.write("vault/P/archive.md/Concept - two.md", other("concept"));
    await index.changed(s.project, path.join(s.root, "vault", "P", "archive.md"));
    assert.deepEqual(names(), ["Concept - one", "Concept - two", "Concept - x", "P file - a.py"]);
    assert.deepEqual(index.notesByName("archive"), []);

    // A folder is renamed, and only its old path is reported: the notes are not kept at paths that are gone.
    fs.renameSync(path.join(s.root, "vault", "P", "v1.0"), path.join(s.root, "vault", "P", "v2.0"));
    await index.changed(s.project, path.join(s.root, "vault", "P", "v1.0"));
    assert.deepEqual(names(), ["Concept - one", "Concept - two", "Concept - x", "P file - a.py"]);
    assert.equal(index.notesByName("Concept - one")[0].path, systemRules.real(path.join(s.root, "vault", "P", "v2.0", "Concept - one.md")));

    // Folders are deleted; their type can no longer be asked.
    fs.rmSync(path.join(s.root, "vault", "P", "archive.md"), { recursive: true });
    await index.changed(s.project, path.join(s.root, "vault", "P", "archive.md"));
    fs.rmSync(path.join(s.root, "vault", "P", "v2.0"), { recursive: true });
    await index.changed(s.project, path.join(s.root, "vault", "P", "v2.0"));
    assert.deepEqual(names(), ["Concept - x", "P file - a.py"]);

    // A file that is no note changes nothing and reads nothing; a note is read again; a deleted note leaves.
    let changes = 0;
    index.onChange = () => { changes++; };
    s.write("vault/P/picture.png", "x");
    await index.changed(s.project, path.join(s.root, "vault", "P", "picture.png"));
    s.write("vault/P/LICENSE", "x");
    await index.changed(s.project, path.join(s.root, "vault", "P", "LICENSE"));
    assert.equal(changes, 0);
    const file = s.write("vault/P/Concepts/Concept - x.md", other("concept") + "More.\n");
    await index.changed(s.project, file);
    assert.equal(changes, 1);
    fs.rmSync(file);
    await index.changed(s.project, file);
    assert.deepEqual(names(), ["P file - a.py"]);
    // What lies under a folder whose name starts with a dot is not the index's.
    await index.changed(s.project, s.write("vault/P/.trash/Concept - three.md", other("concept")));
    assert.deepEqual(names(), ["P file - a.py"]);
  } finally { s.done(); }
});

test("many folder events at once are answered by one reading of the folders", async () => {
  const s = scratch();
  try {
    let lists = 0;
    const index = new NoteIndex(undefined, () => { lists++; return new Promise((go) => setImmediate(go)); });
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const one = lists;
    lists = 0;
    const folders = ["a.b", "c.d", "e.f", "g.h"].map((name) => path.dirname(s.write(`vault/P/${name}/Concept - ${name}.md`, other("concept"))));
    await Promise.all(folders.map((folder) => index.changed(s.project, folder)));
    assert.equal(index.notesOf(s.project, "notes").length, 6);
    assert.ok(lists < 2 * (one + 8), `one reading, not four: ${lists} pauses, ${one} for the first reading`);
  } finally { s.done(); }
});

test("a note renamed in letter case only takes its new name and path, on the file's events and on a refresh", async () => {
  const s = scratch();
  try {
    const folder = path.join(s.root, "vault", "P", "Concepts");
    const old = s.write("vault/P/Concepts/Original.md", other("concept"));
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.equal(index.notesByName("Original").length, 1);
    const late = new NoteIndex();          // hears of no event: it reads the folders again
    late.setProjects([s.project]);
    await late.refreshNow(s.project);

    const now = path.join(folder, "original.md");
    fs.renameSync(old, now);
    assert.ok(fs.readdirSync(folder).includes("original.md"));
    // The watcher tells of the old path and of the new one.
    await index.changed(s.project, old);
    await index.changed(s.project, now);
    await late.refreshNow(s.project);
    for (const [which, notes] of [["events", index], ["refresh", late]] as const) {
      assert.deepEqual(notes.notesByName("Original"), [], which);
      const [entry] = notes.notesByName("original");
      assert.ok(entry, `${which}: [[original]] finds the note`);
      assert.equal(path.basename(entry.path), "original.md", which);
      assert.equal(entry.other?.name, "original", which);
      assert.equal(notes.noteById(entry.id), entry, which);
      assert.ok(notes.holds(entry), which);
    }
  } finally { s.done(); }
});
