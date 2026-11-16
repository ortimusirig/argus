import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Matcher, splitLines } from "../core/matching";
import { assign, runToEnd } from "../core/match";
import { parseFileNote } from "../core/notes";
import { summary, underSelection } from "../core/selection";

function note(blocks: [number, number][], code: string[]): ReturnType<typeof parseFileNote> {
  const t = ["---", "type: file", "written_by: argus", "source: a.py", "depth: map", "---", "## Code and explanation", ""];
  blocks.forEach(([from, to], n) => {
    t.push(`### Block ${n + 1}: part ${n + 1} (lines ${from}-${to})`, "", "```py", ...code.slice(from - 1, to), "```", "", "It works.", "");
  });
  return parseFileNote("N", "/n/N.md", t.join("\n"));
}

test("splitLines gives the lines of a text, in slices", () => {
  assert.deepEqual(runToEnd(splitLines("a\nb\r\n\nc")), ["a", "b\r", "", "c"]);
  assert.deepEqual(runToEnd(splitLines("")), [""]);
  assert.deepEqual(runToEnd(splitLines("a\n")), ["a", ""]);
  const big = "line\n".repeat(400000);
  const steps = splitLines(big);
  let yields = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) { assert.equal(step.value.length, 400001); break; }
    yields++;
  }
  assert.ok(yields >= 1, "a large text is split in more than one slice");
});

const CODE = ["def a():", "    return 1", "", "def b():", "    return 2"];

function settle(): Promise<void> { return new Promise((go) => setTimeout(go, 30)); }

test("the matcher publishes an assignment for the document's version and the note's revision", async () => {
  const changed: string[] = [];
  const matcher = new Matcher((uri) => { changed.push(uri); });
  const n = note([[1, 2], [4, 5]], CODE);
  const doc = { uri: "file:///a.py", version: 1, text: () => CODE.join("\r\n") };
  matcher.want(doc, n, 1);
  assert.equal(matcher.fresh(doc.uri, 1, 1), undefined);
  assert.notEqual(matcher.progress(doc.uri), undefined, "it says that it is matching");
  await settle();
  const first = matcher.fresh(doc.uri, 1, 1);
  assert.deepEqual(first?.placed.map((p) => p.state), ["current", "current"]);
  assert.equal(matcher.progress(doc.uri), undefined);
  assert.deepEqual(changed, [doc.uri]);
  matcher.want(doc, n, 1);                       // the same run is not started twice
  await settle();
  assert.deepEqual(changed, [doc.uri]);

  // An edit: the last published assignment stays for the markers, and is not given as fresh.
  const edited = { uri: doc.uri, version: 2, text: () => ["def a():", "    return 7", "", "def b():", "    return 2"].join("\n") };
  matcher.want(edited, n, 1);
  assert.equal(matcher.fresh(doc.uri, 2, 1), undefined);
  assert.equal(matcher.published(doc.uri)?.key.version, 1);
  await settle();
  assert.deepEqual(matcher.fresh(doc.uri, 2, 1)?.placed.map((p) => p.state), ["changed", "current"]);
  assert.equal(matcher.fresh(doc.uri, 2, 2), undefined, "another revision of the note is another question");

  matcher.drop(doc.uri);
  assert.equal(matcher.published(doc.uri), undefined);
});

test("an edit while the text is being split or matched: only the newer run is published", async () => {
  const queue: (() => void)[] = [];
  const published: number[] = [];
  const matcher = new Matcher(() => { published.push(matcher.published("u")?.key.version ?? -1); }, (slice) => { queue.push(slice); });
  const n = note([[1, 2]], CODE);
  matcher.want({ uri: "u", version: 1, text: () => CODE.join("\n") }, n, 1);
  matcher.want({ uri: "u", version: 2, text: () => "x\n" + CODE.join("\n") }, n, 1);
  for (let k = 0; queue.length > 0 && k < 100000; k++) { (queue.shift() as () => void)(); }
  assert.deepEqual(published, [2]);
  assert.equal(matcher.fresh("u", 2, 1)?.placed[0].at?.from, 2);
});

test("blocks under a selection, the unexplained ranges inside it, and the summary", () => {
  const text = ["def a():", "    return 1", "def b():", "    return 2", "def b():", "    return 2", "", "new = 1", "more = 2"];
  const n = note([[1, 2], [4, 5]], CODE);
  const a = runToEnd(assign(n, text));
  assert.deepEqual(a.placed.map((p) => p.state), ["current", "ambiguous"]);
  assert.deepEqual(a.placed[1].candidates, [3, 5]);
  assert.deepEqual(summary(a), { current: 1, changed: 0, ambiguous: 1, unexplained: 6 });
  assert.deepEqual(underSelection(a, 2, 2).blocks.map((p) => p.block.id), ["1"]);
  assert.deepEqual(underSelection(a, 2, 2).unexplained, []);
  const wide = underSelection(a, 2, 5);
  assert.deepEqual(wide.blocks.map((p) => p.block.id), ["1", "2"]);
  assert.deepEqual(wide.unexplained, [[3, 5]]);
  // An ambiguous block is under the selection at each of its candidate places.
  assert.deepEqual(underSelection(a, 6, 6).blocks.map((p) => p.block.id), ["2"]);
  assert.deepEqual(underSelection(a, 6, 6).unexplained, [[6, 6]]);
  assert.deepEqual(underSelection(a, 9, 9), { blocks: [], unexplained: [[9, 9]] });
  assert.deepEqual(underSelection(a, 7, 7), { blocks: [], unexplained: [] });
});
