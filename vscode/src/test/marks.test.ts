import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Marks, marksOf } from "../core/marks";
import { Assignment, Placed, assign, runToEnd } from "../core/match";
import { placesOf } from "../core/selection";
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

/** An assignment made by hand: `count` changed blocks of two lines, a blank line and one unexplained line after each. */
function changedAndUnexplained(count: number): Assignment {
  const placed: Placed[] = [], unexplained: [number, number][] = [];
  for (let n = 0; n < count; n++) {
    const from = 4 * n + 1;
    placed.push({ block: { id: `${n + 1}`, purpose: "part", from, to: from + 1, code: ["a", "b"], rows: [], prose: "", concepts: [] },
      state: "changed", at: { from, to: from + 1 } });
    unexplained.push([from + 3, from + 3]);
  }
  return { placed, unexplained };
}

test("marks: unexplained lines less the warnings, as the plain rule gives them, for ranges that overlap in every way", () => {
  let seed = 7;
  const next = (below: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % below; };
  for (let round = 0; round < 300; round++) {
    const placed: Placed[] = [], unexplained: [number, number][] = [];
    for (let n = next(8); n > 0; n--) {
      const from = 1 + next(40), to = from + next(6);
      const block = { id: `${n}`, purpose: "p", from, to, code: new Array<string>(to - from + 1).fill("x"), rows: [], prose: "", concepts: [] };
      placed.push(next(2) === 0 ? { block, state: "changed", at: { from, to } }
        : { block, state: "ambiguous", candidates: [from, from + 1 + next(9)].sort((a, b) => a - b) });
    }
    for (let at = 1 + next(5); at < 60; at += 2 + next(6)) { const to = at + next(5); unexplained.push([at, to]); at = to; }
    // The rule, said plainly: every line of an unexplained range that no warning covers, in runs.
    const warned = new Set<number>();
    for (const p of placed) { for (const at of placesOf(p)) { for (let l = at.from; l <= at.to; l++) { warned.add(l); } } }
    const want: [number, number][] = [];
    for (const [a, b] of unexplained) {
      for (let l = a; l <= b; l++) {
        if (warned.has(l)) { continue; }
        const last = want[want.length - 1];
        if (last && last[1] === l - 1 && l > a) { last[1] = l; } else { want.push([l, l]); }
      }
    }
    assert.deepEqual(marksOf({ placed, unexplained }).unexplained.map((m) => [m.from, m.to]), want, `round ${round}`);
  }
});

test("marks: 20,000 changed blocks with unexplained lines between them are prepared in a few milliseconds, and ten times as many in ten times that", () => {
  const time = (assignment: Assignment): [number, Marks] => {
    const started = performance.now();
    const marks = marksOf(assignment);
    return [performance.now() - started, marks];
  };
  time(changedAndUnexplained(2000));                               // the code is warm
  const best = (count: number): number => Math.min(...[1, 2, 3].map(() => time(changedAndUnexplained(count))[0]));
  const [, marks] = time(changedAndUnexplained(20000));
  assert.equal(marks.warning.length, 20000);
  assert.equal(marks.unexplained.length, 20000);
  assert.deepEqual([marks.unexplained[19999].from, marks.unexplained[19999].to], [80000, 80000]);
  const small = best(20000), large = best(200000);
  console.log(`timing: marks of 20,000 changed blocks and 20,000 unexplained ranges in ${small.toFixed(1)} ms; of 200,000 each in ${large.toFixed(1)} ms`);
  assert.ok(small < 30, `20,000 took ${small} ms`);
  assert.ok(large < 400, `200,000 took ${large} ms`);

  // One block at 20,000 places: what is said of it is written once, not once for each place.
  const many: Assignment = { placed: [{ block: { id: "1", purpose: "p", from: 1, to: 1, code: ["x"], rows: [], prose: "", concepts: [] },
    state: "ambiguous", candidates: Array.from({ length: 20000 }, (_, n) => 2 * n + 1) }], unexplained: [] };
  const [took, places] = time(many);
  console.log(`timing: marks of one ambiguous block at 20,000 places in ${took.toFixed(1)} ms`);
  assert.equal(places.warning.length, 20000);
  assert.ok(took < 100, `took ${took} ms`);
});

test("marks: asked again for the same assignment, the same marks are given, not made again", () => {
  const assignment = changedAndUnexplained(3);
  assert.equal(marksOf(assignment), marksOf(assignment));
  assert.notEqual(marksOf(changedAndUnexplained(3)), marksOf(assignment));
});
