import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Choices } from "../core/choices";
import { Matcher } from "../core/matching";
import { parseFileNote } from "../core/notes";

const one = { id: 1 }, two = { id: 2 };

test("the note to use: the only one, or the one picked among several", () => {
  const choices = new Choices(() => undefined);
  assert.equal(choices.of("p\na.py", []), undefined);
  assert.equal(choices.of("p\na.py", [one]), one);
  assert.equal(choices.of("p\na.py", [one, two]), undefined, "several, none picked");
  choices.choose("p\na.py", 2);
  assert.equal(choices.of("p\na.py", [one, two]), two);
  assert.equal(choices.of("p\nb.py", [one, two]), undefined, "a pick is for its own source file");
  assert.equal(choices.of("p\na.py", [one]), one, "the picked note went: the one left is used");
});

test("each pick is told, also when the assignment of the picked note is published already", () => {
  // The first note is matched; then a second note for the same file appears and the person picks the first one.
  // The matcher has its assignment and publishes nothing new, so the pick itself must be told to the markers.
  const note = parseFileNote("N", "/n/N.md", "---\ntype: file\nwritten_by: argus\nsource: a.py\ndepth: map\n---\n# N\n\n"
    + "## Code and explanation\n\n### Block 1: adds (lines 1-1)\n\n```py\nx = 1\n```\n\nIt adds.\n");
  const slices: (() => void)[] = [];
  let published = 0, told = 0;
  const matcher = new Matcher(() => { published++; }, (slice) => { slices.push(slice); });
  const doc = { uri: "file:///a.py", version: 1, text: () => "x = 1\n" };
  matcher.want(doc, note, { id: 1, revision: 1 });
  while (slices.length > 0) { (slices.shift() as () => void)(); }
  assert.equal(published, 1);

  const choices = new Choices(() => { told++; });
  choices.choose("p\na.py", 1);
  matcher.want(doc, note, { id: 1, revision: 1 });
  while (slices.length > 0) { (slices.shift() as () => void)(); }
  assert.equal(published, 1, "the matcher has nothing new to say");
  assert.equal(told, 1, "the pick is told");
  choices.choose("p\na.py", 2);
  choices.choose("p\na.py", 2);
  assert.equal(told, 3, "every pick is told: a draw too many costs nothing, a draw too few leaves the editor bare");
});
