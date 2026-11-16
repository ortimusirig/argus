import { test } from "node:test";
import * as assert from "node:assert/strict";
import { marksOf } from "../core/marks";
import { assign, runToEnd } from "../core/match";
import { parseFileNote } from "../core/notes";

function note(blocks: [number, number, string[]][], masked = ""): ReturnType<typeof parseFileNote> {
  const t = ["---", "type: file", "written_by: argus", "source: a.py", "depth: map", ...(masked ? [`masked_lines: ${masked}`] : []), "---",
    "## Code and explanation", ""];
  blocks.forEach(([from, to, code], n) => {
    t.push(`### Block ${n + 1}: part ${n + 1} (lines ${from}-${to})`, "", "```py", ...code, "```", "", "It works.", "");
  });
  return parseFileNote("N", "/n/N.md", t.join("\n"));
}

test("marks: bars for current blocks, a lock for masked ones, a lens above each block", () => {
  const n = note([[1, 2, ["def a():", "    return 1"]], [4, 5, ["def b():", "    key = \"[masked]\""]]], "5");
  const marks = marksOf(runToEnd(assign(n, ["# new", "def a():", "    return 1", "", "def b():", "    key = \"s3cret\"", "", "x = 1", "y = 2"])));
  assert.deepEqual(marks.current.map((m) => [m.from, m.to]), [[2, 3], [5, 6]]);
  assert.deepEqual(marks.masked.map((m) => m.from), [5]);
  assert.deepEqual(marks.warning, []);
  assert.deepEqual(marks.unexplained.map((m) => [m.from, m.to]), [[1, 1], [8, 9]]);
  assert.deepEqual(marks.lenses, [{ line: 2, from: 2, to: 3, title: "Argus 1: part 1" }, { line: 5, from: 5, to: 6, title: "Argus 2: part 2 (masked)" }]);
  assert.match(marks.current[1].say, /current \(masked\)/);
  assert.match(marks.unexplained[0].say, /no explanation/);
  assert.ok(!JSON.stringify(marks).includes("s3cret"));
});

test("marks: a changed block and every place of an ambiguous block carry the warning, said in words", () => {
  const b = ["def b():", "    return 2"];
  const n = note([[1, 2, ["def a():", "    return 1"]], [5, 6, b]]);
  const marks = marksOf(runToEnd(assign(n, ["def a():", "    return 7", ...b, "", "", ...b])));
  assert.deepEqual(marks.warning.map((m) => [m.from, m.to]), [[1, 2], [3, 4], [7, 8]]);
  assert.match(marks.warning[0].say, /changed/);
  assert.match(marks.warning[1].say, /ambiguous.*lines 3 and 7/);
  assert.deepEqual(marks.current, []);
  // The lines of a warning are not marked a second time as unexplained.
  assert.deepEqual(marks.unexplained, []);
  assert.deepEqual(marks.lenses.map((l) => [l.line, l.title]),
    [[1, "Argus 1: part 1 (changed)"], [3, "Argus 2: part 2 (ambiguous)"], [7, "Argus 2: part 2 (ambiguous)"]]);
});

test("marks: unexplained lines beside a warning keep their own mark", () => {
  const n = note([[1, 2, ["def a():", "    return 1"]]]);
  const marks = marksOf(runToEnd(assign(n, ["zero = 0", "def a():", "    return 7", "tail = 1"])));
  assert.deepEqual(marks.warning.map((m) => [m.from, m.to]), [[1, 2]]);
  assert.deepEqual(marks.unexplained.map((m) => [m.from, m.to]), [[3, 4]]);
});
