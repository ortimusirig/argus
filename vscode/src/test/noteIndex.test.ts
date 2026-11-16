import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveLink } from "../core/links";
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

test("a note replaced by a link that leads out of the folders leaves the index on the re-read of that one file", async () => {
  const s = scratch();
  try {
    const outside = s.write("elsewhere/Secret.md", fileNote("a.py", "leaks"));
    const file = path.join(s.root, "vault", "P", "P file - a.py.md");
    // As when the note is replaced by a symbolic link: from then on its real path is a file outside the folders.
    let linked = false;
    const real = systemRules.real(file);
    const rules: PathRules = { ...systemRules, real: (at) => {
      const found = systemRules.real(at);
      return linked && found === real ? systemRules.real(outside) : found;
    } };
    const index = new NoteIndex(rules);
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const [note] = index.fileNotesFor(s.project, "a.py");
    assert.ok(note && index.holds(note));
    let changes = 0;
    index.onChange = () => { changes++; };

    linked = true;
    fs.writeFileSync(file, fileNote("a.py", "leaks"));
    await index.changed(s.project, file);
    assert.deepEqual(index.fileNotesFor(s.project, "a.py"), [], "the old explanation is not shown any more");
    assert.equal(index.noteById(note.id), undefined);
    assert.deepEqual(index.notesByName("P file - a.py"), []);
    assert.match(index.problemsOf(s.project).join("\n"), /P file - a\.py: .*outside.*Secret\.md/);
    assert.equal(changes, 1);
    for (const entry of [...index.notesOf(s.project, "notes"), ...index.notesOf(s.project, "vault")]) { assert.ok(index.holds(entry)); }

    // A plain file again at that path is read again.
    linked = false;
    await index.reread(s.project, file);
    assert.equal(index.fileNotesFor(s.project, "a.py").length, 1);
    assert.equal(index.noteById(note.id)?.file?.blocks[0].purpose, "leaks", "the same path has the same id");
  } finally { s.done(); }
});

test("the link map of a project is built once for a state of the index, and follows every change of its notes", async () => {
  const s = scratch();
  try {
    const index = new NoteIndex();
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const names = ["Concept - x", "Concept - y", "Library - z", "P file - a.py", "Mechanism - m", "concept - x", "Nothing"];
    const same = (): void => {
      for (const name of names) {
        assert.deepEqual(index.linksOf(s.project).resolve(name),
          resolveLink(name, index.notesOf(s.project, "notes"), index.notesOf(s.project, "vault")), `'${name}'`);
      }
    };
    same();
    const first = index.linksOf(s.project);
    const own = first.resolve("Concept - x");
    assert.ok(own.kind === "one" && own.note.place === "notes", "the project's own note before the vault's");
    await index.refreshNow(s.project);
    assert.equal(index.linksOf(s.project), first, "nothing changed: the map is not built again");

    // A second note of a name, a note that goes, a note with a new text: the map follows each.
    s.write("vault/More/Concept - y.md", other("concept"));
    await index.refreshNow(s.project);
    assert.equal(index.linksOf(s.project).resolve("Concept - y").kind, "several");
    same();
    const mine = path.join(s.root, "vault", "P", "Concepts", "Concept - x.md");
    fs.rmSync(mine);
    await index.changed(s.project, mine);
    const left = index.linksOf(s.project).resolve("Concept - x");
    assert.ok(left.kind === "one" && left.note.place === "vault");
    same();
    const changed = s.write("vault/Shared/Library - z.md", other("library") + "More.\n");
    await index.changed(s.project, changed);
    const z = index.linksOf(s.project).resolve("Library - z");
    assert.ok(z.kind === "one" && z.note === index.notesByName("Library - z")[0] && z.note.text.endsWith("More.\n"));
    same();

    index.setProjects([]);
    assert.deepEqual(index.linksOf(s.project).resolve("Concept - y"), { kind: "none" });
  } finally { s.done(); }
});

/** Path rules in which the file at `link` is a symbolic link to whatever `target()` names; no link when it names nothing. */
function linked(link: string, target: () => string | undefined): PathRules {
  const own = systemRules.real(link);
  return { ...systemRules, real: (file) => {
    const at = systemRules.real(file);
    const to = target();
    return at === own && to !== undefined ? systemRules.real(to) : at;
  } };
}

test("a link to a note that is pointed at another target, or deleted, takes the old target's note with it", async () => {
  const s = scratch();
  try {
    // Alias.md is a link to one.txt, then to two.txt, both in the notes folder; the index keys a note by its target.
    const one = s.write("vault/P/one.txt", ""), two = s.write("vault/P/two.txt", "");
    const alias = s.write("vault/P/Alias.md", fileNote("sub/b.py", "first"));
    let target: string | undefined = one;
    const index = new NoteIndex(linked(alias, () => target));
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const [first] = index.fileNotesFor(s.project, "sub/b.py");
    assert.equal(first?.file?.blocks[0].purpose, "first");
    let changes = 0;
    index.onChange = () => { changes++; };

    target = two;
    fs.writeFileSync(alias, fileNote("sub/b.py", "second"));
    await index.changed(s.project, alias);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py").map((e) => e.file?.blocks[0].purpose), ["second"],
      "one note, the new one: no stale explanation and no false duplicate");
    assert.equal(index.noteById(first.id), undefined);
    assert.equal(index.notesByName("Alias").length, 1);
    assert.equal(changes, 1);

    // The link is deleted: its target's note goes too.
    fs.rmSync(alias);
    target = undefined;
    await index.changed(s.project, alias);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py"), []);
    assert.deepEqual(index.notesByName("Alias"), []);
    assert.equal(changes, 2);
    assert.equal(index.linksOf(s.project).resolve("Alias").kind, "none");
  } finally { s.done(); }
});

test("a note reached by its own path and by a link stays when the link goes, and is read by its own path", async () => {
  const s = scratch();
  try {
    const real = s.write("vault/P/Real.md", fileNote("sub/b.py"));
    const alias = s.write("vault/P/Alias.md", fileNote("sub/b.py"));
    let target: string | undefined = real;
    const index = new NoteIndex(linked(alias, () => target));
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.equal(index.fileNotesFor(s.project, "sub/b.py").length, 1, "two paths, one note");

    fs.rmSync(alias);
    target = undefined;
    await index.changed(s.project, alias);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py").map((e) => e.name), ["Real"]);

    // And the other way: the file goes, the link is left hanging. Nothing can be read: no note.
    const again = new NoteIndex(linked(alias, () => target));
    fs.writeFileSync(alias, fileNote("sub/b.py"));
    target = real;
    again.setProjects([s.project]);
    await again.refreshNow(s.project);
    fs.rmSync(alias);
    target = undefined;
    fs.rmSync(real);
    await again.changed(s.project, real);
    await again.changed(s.project, alias);
    assert.deepEqual(again.fileNotesFor(s.project, "sub/b.py"), []);
  } finally { s.done(); }
});

test("a folder that held only links is gone: the notes its links led to leave on the folder's event", async () => {
  const s = scratch();
  try {
    const one = s.write("vault/P/one.txt", "");
    const alias = s.write("vault/P/links/Alias.md", fileNote("sub/b.py"));
    let target: string | undefined = one;
    const index = new NoteIndex(linked(alias, () => target));
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.equal(index.fileNotesFor(s.project, "sub/b.py").length, 1);

    // Only the folder's own deletion is reported, as after a rename or a recursive delete.
    fs.rmSync(path.dirname(alias), { recursive: true });
    target = undefined;
    await index.changed(s.project, path.dirname(alias));
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py"), []);
  } finally { s.done(); }
});

test("a gone folder that held no note and no link costs no reading of the folders", async () => {
  const s = scratch();
  try {
    const plain = s.write("vault/Plain/readme.md", "# Not an Argus note\n");
    let pauses = 0;
    const index = new NoteIndex(undefined, () => { pauses++; return new Promise((go) => setImmediate(go)); });
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    pauses = 0;
    fs.rmSync(path.dirname(plain), { recursive: true });
    await index.changed(s.project, path.dirname(plain));
    assert.equal(pauses, 0, "nothing of the index lay there: nothing is read");
  } finally { s.done(); }
});

test("a project that leaves the settings while its notes are read: the reading stops and leaves no note behind", async () => {
  const s = scratch();
  try {
    let left = false, after = 0;
    const index: NoteIndex = new NoteIndex(undefined, () => {
      if (left) { after++; }
      if (!left && index.noteById(1)) { left = true; index.setProjects([]); }       // after the first note was read
      return new Promise((go) => setImmediate(go));
    });
    let changes = 0;
    index.onChange = () => { changes++; };
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    assert.ok(left);
    for (let id = 1; id <= 20; id++) { assert.equal(index.noteById(id), undefined, `note ${id} of a project that is gone`); }
    assert.ok(after <= 1, `the reading went on for ${after} more steps`);
    assert.equal(changes, 0);

    // The project comes back while the old reading is still going: only the new reading fills the index.
    let back = false;
    const again: NoteIndex = new NoteIndex(undefined, () => {
      if (!back && again.noteById(1)) { back = true; again.setProjects([]); again.setProjects([s.project]); void again.refreshNow(s.project); }
      return new Promise((go) => setImmediate(go));
    });
    again.setProjects([s.project]);
    await again.refreshNow(s.project);
    await again.refreshNow(s.project);
    const held = [...again.notesOf(s.project, "notes"), ...again.notesOf(s.project, "vault")];
    assert.equal(held.length, 5);
    for (const entry of held) { assert.equal(again.noteById(entry.id), entry, "the id leads to the note the index holds"); }
  } finally { s.done(); }
});

test("the file a link leads to is changed or deleted: the note read through the link follows", async () => {
  const s = scratch();
  try {
    // Alias.md is a link to one.txt. The watcher reports one.txt, which is no .md file by its name.
    const one = s.write("vault/P/one.txt", "");
    const alias = s.write("vault/P/Alias.md", fileNote("sub/b.py", "first"));
    let pauses = 0;
    const index = new NoteIndex(linked(alias, () => one), () => { pauses++; return new Promise((go) => setImmediate(go)); });
    index.setProjects([s.project]);
    await index.refreshNow(s.project);
    const [first] = index.fileNotesFor(s.project, "sub/b.py");
    assert.equal(first?.file?.blocks[0].purpose, "first");

    fs.writeFileSync(alias, fileNote("sub/b.py", "second"));       // what is read through the link is new
    await index.changed(s.project, one);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py").map((e) => e.file?.blocks[0].purpose), ["second"]);
    assert.equal(index.noteById(first.id)?.file?.blocks[0].purpose, "second", "the same note, read anew");

    // The target goes: the link hangs, nothing can be read through it.
    // A file that no link leads to costs no reading.
    const picture = s.write("vault/P/picture.png", "");
    pauses = 0;
    await index.changed(s.project, picture);
    assert.equal(pauses, 0);
    assert.equal(index.fileNotesFor(s.project, "sub/b.py").length, 1);

    // The target goes: the link hangs, nothing can be read through it.
    fs.rmSync(one);
    fs.rmSync(alias);
    await index.changed(s.project, one);
    assert.deepEqual(index.fileNotesFor(s.project, "sub/b.py"), []);
  } finally { s.done(); }
});
