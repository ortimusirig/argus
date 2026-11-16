import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Entry } from "../core/noteIndex";
import { body } from "../core/panelHtml";
import { Project } from "../core/projects";
import { Notes, Shown, Trail, shownNote, shownView } from "../core/shown";

const EVIL = "<img src=x onerror=alert(1)>";
const project: Project = { sourceRoot: "/s", notesFolder: "/v/P" };

function entry(revision: number, text: string, name = `Concept - x ${EVIL}`): Entry {
  return { id: 7, revision, name, path: `/v/P/Concepts/${name}.md`, project, place: "notes",
    text: `---\ntype: concept\nwritten_by: argus\n---\n# A note\n\n${text}\n` };
}

/** An index of one note at most, as the panel asks it. */
function index(): { notes: Notes; put(e: Entry | undefined): void; held: boolean; asked: Project[] } {
  let now: Entry | undefined;
  const at = { held: true, asked: [] as Project[], put(e: Entry | undefined): void { now = e; },
    notes: {
      byId: (id: number) => now && now.id === id ? now : undefined,
      holds: () => at.held,
      linkTo: (of: Project) => { at.asked.push(of); return (name: string) => name === "Concept - y" ? name : undefined; },
    } };
  return at;
}

test("a shown note is drawn from the index as it is now: a new text is shown, a note that is gone is said to be gone", () => {
  const i = index();
  const first = entry(1, "The old text, see [[Concept - y]].");
  i.put(first);
  const shown: Shown = shownNote(first);
  assert.deepEqual(shown, { kind: "note", id: 7, name: first.name }, "the id and the name only: no text is kept");

  let html = body(shownView(shown, i.notes));
  assert.match(html, /The old text, see <a data-note="Concept - y">/);
  assert.match(html, /data-obsidian="7"/);
  assert.deepEqual(i.asked, [project], "the links are those of the note's project");

  // The note is read again with a new text: the same id, a new entry.
  i.put(entry(2, "The new text."));
  html = body(shownView(shown, i.notes));
  assert.match(html, /The new text\./);
  assert.doesNotMatch(html, /The old text/);

  // The note is deleted, or the index was read again without it.
  i.put(undefined);
  const gone = shownView(shown, i.notes);
  assert.equal(gone.kind, "message");
  html = body(gone);
  assert.match(html, /No note: .*Concept - x .*is no longer/);
  assert.doesNotMatch(html, /The new text|The old text|data-obsidian/);
  assert.doesNotMatch(html, /<img/, "the name of the note is escaped");

  // The note is there again: it is shown again.
  i.put(entry(3, "Back again."));
  assert.match(body(shownView(shown, i.notes)), /Back again\./);

  // Its path no longer lies in the folders: its text is not shown.
  i.held = false;
  const outside = shownView(shown, i.notes);
  assert.equal(outside.kind, "message");
  assert.doesNotMatch(body(outside), /Back again/);
});

test("the places of a name are shown as they are", () => {
  const places: Shown = { kind: "places", name: "Library - z", places: [{ id: 1, name: "Library - z", folder: "/v/A" }] };
  assert.equal(shownView(places, index().notes), places);
});

test("a shown note, the places of a name, and the sentence that a note is gone all have a way back", () => {
  const i = index();
  const first = entry(1, "Text.");
  i.put(first);
  const back = '<button data-msg="back">Back</button>';
  assert.ok(body(shownView(shownNote(first), i.notes)).includes(back));
  assert.ok(body(shownView({ kind: "places", name: "Library - z", places: [{ id: 1, name: "Library - z", folder: "/v/A" }] }, i.notes)).includes(back));
  i.put(undefined);
  assert.ok(body(shownView(shownNote(first), i.notes)).includes(back), "a note that is gone does not trap the person");
  // The views of a file have none: there is nothing to go back to.
  assert.ok(!body({ kind: "message", text: "No note: no Argus note explains a.py.", button: "create" }).includes(back));
});

const note = (id: number): Shown => ({ kind: "note", id, name: `N${id}` });
const places = (name: string): Shown => ({ kind: "places", name, places: [{ id: 90, name, folder: "/v/A" }, { id: 91, name, folder: "/v/B" }] });
const never = (): undefined => undefined;

test("Trail: each note opened from a note is a step; back goes one step, and from the first note to the file", () => {
  const trail = new Trail();
  assert.equal(trail.now, undefined);
  assert.equal(trail.back(never), undefined, "nothing is shown: back changes nothing");
  trail.open(note(1)); trail.open(note(2)); trail.open(note(3));
  assert.deepEqual(trail.now, note(3));
  assert.deepEqual(trail.back(never), note(2));
  assert.deepEqual(trail.back(never), note(1));
  assert.equal(trail.back(never), undefined, "back from the first note: the file is shown again");
  assert.equal(trail.now, undefined);
  assert.equal(trail.back(never), undefined);
});

test("Trail: a link to the note that is shown is no step; clearing forgets every step", () => {
  const trail = new Trail();
  trail.open(note(1)); trail.open(note(1)); trail.open(places("X")); trail.open(places("X")); trail.open(note(1));
  assert.deepEqual(trail.back(() => places("X")), places("X"));
  assert.deepEqual(trail.back(never), note(1));
  assert.equal(trail.back(never), undefined);
  trail.open(note(1)); trail.open(note(2));
  trail.clear();
  assert.equal(trail.now, undefined);
  assert.equal(trail.back(never), undefined, "the selection moved: nothing of the old trail comes back");
});

test("Trail: a list of places is built again when the person comes back to it, as the notes are then", () => {
  const trail = new Trail();
  trail.open(note(1)); trail.open(places("X")); trail.open(note(90)); trail.open(places("Y")); trail.open(note(5));
  const asked: string[] = [];
  // 'Y' has no note any more: that step is left out. 'X' has one note left: it is shown, not a list of one.
  assert.deepEqual(trail.back((name) => { asked.push(name); return undefined; }), note(90));
  assert.deepEqual(asked, ["Y"]);
  assert.deepEqual(trail.back((name) => { asked.push(name); return note(91); }), note(91));
  assert.deepEqual(asked, ["Y", "X"]);
  assert.deepEqual(trail.now, note(91));
  assert.deepEqual(trail.back(never), note(1), "a note is kept by its id only; its text is asked of the index when it is drawn");
  assert.equal(trail.back(never), undefined);
  // A list that is what is shown is built again too, when a list below it went.
  trail.open(places("A")); trail.open(places("B")); trail.open(note(7));
  const fresh: Shown = { kind: "places", name: "B", places: [{ id: 1, name: "B", folder: "/new" }, { id: 2, name: "B", folder: "/newer" }] };
  assert.equal(trail.back(() => fresh), fresh);
  assert.equal(trail.back(never), undefined, "'A' has no note any more and nothing is below it: the file");
});

test("Trail: the steps kept are bounded, however long the person follows links", () => {
  const trail = new Trail();
  for (let id = 1; id <= 5000; id++) { trail.open(note(id)); }
  let steps = 0;
  while (trail.back(never)) { steps++; }
  assert.ok(steps >= 50 && steps <= 200, `${steps} steps back`);
  assert.equal(trail.now, undefined);
});
