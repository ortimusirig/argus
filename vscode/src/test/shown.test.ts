import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Entry } from "../core/noteIndex";
import { body } from "../core/panelHtml";
import { Project } from "../core/projects";
import { Notes, Shown, shownNote, shownView } from "../core/shown";

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
