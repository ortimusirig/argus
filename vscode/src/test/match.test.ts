import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Block, FileNote, parseFileNote, parseProps } from "../core/notes";
import { Assignment, MatchRuns, RunKey, assign, candidates, maskedMatch, pyStrip, runToEnd, sameLine } from "../core/match";

const MASK = "[masked]";
const NBSP = String.fromCharCode(0xa0), FEED = String.fromCharCode(0x0c), BOM = String.fromCharCode(0xfeff);
const EMOJI = String.fromCodePoint(0x1f600);

function block(id: string, from: number, code: string[]): Block {
  return { id, purpose: "block " + id, from, to: from + code.length - 1, code, rows: [], prose: "", concepts: [] };
}

function note(blocks: Block[], masked = ""): FileNote {
  return { name: "n", path: "p", props: parseProps(`---\nwritten_by: argus\ntype: file\nmasked_lines: ${masked}\n---\n`),
    lens: [], blocks, problems: [] };
}

function run(n: FileNote, text: string[]): Assignment {
  return runToEnd(assign(n, text));
}

function states(a: Assignment): [string, string, number | undefined, number | undefined][] {
  return a.placed.map((p) => [p.block.id, p.state, p.at?.from, p.at?.to]);
}

/** A file of three functions with blank lines between; block n covers function n. */
const FILE = ["def a():", "    return 1", "", "def b():", "    return 2", "", "def c():", "    return 3"];
const THREE = () => note([block("1", 1, FILE.slice(0, 2)), block("2", 4, FILE.slice(3, 5)), block("3", 7, FILE.slice(6, 8))]);

function numbered(count: number, prefix = "line "): string[] {
  return Array.from({ length: count }, (_, i) => prefix + i);
}

test("unchanged file: every block current at its recorded lines; nothing unexplained", () => {
  const a = run(THREE(), FILE);
  assert.deepEqual(states(a), [["1", "current", 1, 2], ["2", "current", 4, 5], ["3", "current", 7, 8]]);
  assert.deepEqual(a.unexplained, []);
  assert.ok(a.placed.every((p) => p.candidates === undefined && p.spacesOnly === undefined));
});

test("100 lines inserted at the top: every block current, 100 lines lower", () => {
  const a = run(THREE(), [...numbered(100), ...FILE]);
  assert.deepEqual(states(a), [["1", "current", 101, 102], ["2", "current", 104, 105], ["3", "current", 107, 108]]);
  assert.deepEqual(a.unexplained, [[1, 100]]);
});

test("two identical blocks recorded at 10 and 100, 100 lines inserted above: 110 and 200, neither ambiguous", () => {
  const same = ["def twin():", "    return 0"];
  const text = numbered(210);
  text.splice(9, 2, ...same);
  text.splice(99, 2, ...same);
  const n = note([block("1", 10, same), block("2", 100, same)]);
  assert.deepEqual(states(run(n, text)), [["1", "current", 10, 11], ["2", "current", 100, 101]]);
  const moved = run(n, [...numbered(100, "new "), ...text]);
  assert.deepEqual(states(moved), [["1", "current", 110, 111], ["2", "current", 200, 201]]);
  assert.ok(moved.placed.every((p) => p.candidates === undefined));
});

test("a block's code changed: that block changed, the others current", () => {
  const text = [...FILE];
  text[4] = "    return 22";
  const a = run(THREE(), text);
  assert.deepEqual(states(a), [["1", "current", 1, 2], ["2", "changed", 4, 5], ["3", "current", 7, 8]]);
  assert.equal(a.placed[1].spacesOnly, undefined);
  assert.deepEqual(a.unexplained, [[4, 5]]);
});

test("a changed block recorded beyond the end of the text: its marker is clipped to the text", () => {
  const a = run(note([block("1", 1, ["x = 1"]), block("2", 40, ["gone()", "gone()"])]), ["x = 1", "y = 2"]);
  assert.deepEqual(states(a), [["1", "current", 1, 1], ["2", "changed", 2, 2]]);
});

test("a new function between two blocks: both blocks current; the new lines unexplained", () => {
  const text = [...FILE.slice(0, 3), "def new():", "    pass", "", "    more()", "", ...FILE.slice(3)];
  const a = run(THREE(), text);
  assert.deepEqual(states(a), [["1", "current", 1, 2], ["2", "current", 9, 10], ["3", "current", 12, 13]]);
  assert.deepEqual(a.unexplained, [[4, 5], [7, 7]]);
});

test("a spaces-only difference at a line end: changed with spacesOnly and the marker at the right place", () => {
  const text = [...numbered(5), ...FILE];
  text[9] = "    return 2  \t";
  const a = run(THREE(), text);
  assert.deepEqual(states(a), [["1", "current", 6, 7], ["2", "changed", 9, 10], ["3", "current", 12, 13]]);
  assert.equal(a.placed[1].spacesOnly, true);
  assert.deepEqual(a.unexplained, [[1, 5], [9, 10]]);
  // spaces at the start of a line are a real change: no spacesOnly, marker at the recorded lines
  const indent = [...FILE];
  indent[4] = "  return 2";
  const b = run(THREE(), indent);
  assert.deepEqual(states(b)[1], ["2", "changed", 4, 5]);
  assert.equal(b.placed[1].spacesOnly, undefined);
});

test("a masked line, declared: current-masked", () => {
  const n = note([block("1", 1, ["import os", `token = "${MASK}"`, "use(token)"]), block("2", 5, ["done()"])], "2");
  const a = run(n, ["import os", 'token = "abc123"', "use(token)", "", "done()"]);
  assert.deepEqual(states(a), [["1", "current-masked", 1, 3], ["2", "current", 5, 5]]);
  assert.deepEqual(a.unexplained, []);
});

test("a block whose first line is masked is found through a later, unmasked line", () => {
  const n = note([block("1", 1, [`token = "${MASK}"`, "use(token)", "done()"])], "1");
  const text = [...numbered(30), 'token = "abc123"', "use(token)", "done()", "tail()"];
  const a = run(n, text);
  assert.deepEqual(states(a), [["1", "current-masked", 31, 33]]);
  assert.deepEqual(runToEnd(candidates(n, text)), [[31]]);
});

test("a block of masked lines only, declared: found by trying every start line", () => {
  const n = note([block("1", 3, [MASK, "  " + MASK])], "3-4");
  const text = ["a = 1", "b = 2", "key = 1", "other = 2", "c = 3"];
  assert.deepEqual(runToEnd(candidates(n, text)), [[1, 2, 3, 4]]);
  const a = run(n, text);
  assert.deepEqual(states(a), [["1", "current-masked", 3, 4]]);
  assert.deepEqual(a.unexplained, [[1, 2], [5, 5]]);
});

test("20,000 identical lines, a block of 5,000 of them: within one second, all 15,001 starts", () => {
  const text: string[] = new Array(20000).fill("x += 1");
  const code: string[] = new Array(5000).fill("x += 1");
  const one = note([block("1", 1, code)]);
  let started = performance.now();
  const found = runToEnd(candidates(one, text));
  const a = run(one, text);
  let took = performance.now() - started;
  console.log(`timing: 20,000 identical lines, one block of 5,000: ${took.toFixed(1)} ms`);
  assert.ok(took < 1000, `took ${took} ms`);
  assert.equal(found[0].length, 15001);
  assert.equal(found[0][0], 1);
  assert.equal(found[0][15000], 15001);
  assert.deepEqual(states(a), [["1", "current", 1, 5000]]);
  // with a second identical block the order rule places both
  const two = note([block("1", 1, code), block("2", 5001, code)]);
  started = performance.now();
  const b = run(two, text);
  took = performance.now() - started;
  console.log(`timing: 20,000 identical lines, two blocks of 5,000: ${took.toFixed(1)} ms`);
  assert.ok(took < 1000, `took ${took} ms`);
  assert.deepEqual(states(b), [["1", "current", 1, 5000], ["2", "current", 5001, 10000]]);
  assert.deepEqual(b.unexplained, [[10001, 20000]]);
});

test("20,000 lines, a declared block of 5,000 lines that are all [masked] alone: within one second, 15,001 candidates", () => {
  const text = numbered(20000, "value = ");
  const n = note([block("1", 101, new Array(5000).fill(MASK))], "101-5100");
  const started = performance.now();
  const found = runToEnd(candidates(n, text));
  const a = run(n, text);
  const took = performance.now() - started;
  console.log(`timing: 20,000 lines, a block of 5,000 whole-line masks: ${took.toFixed(1)} ms`);
  assert.ok(took < 1000, `took ${took} ms`);
  assert.equal(found[0].length, 15001);
  assert.deepEqual(states(a), [["1", "current-masked", 101, 5100]]);
});

test("a block of 2,000 pattern lines in 20,000 lines: within one second", () => {
  const text = Array.from({ length: 20000 }, (_, i) => `key = "secret ${i}"`);
  const n = note([block("1", 501, new Array(2000).fill(`key = "${MASK}"`))], "501-2500");
  const started = performance.now();
  const a = run(n, text);
  const took = performance.now() - started;
  console.log(`timing: 20,000 lines, a block of 2,000 pattern lines: ${took.toFixed(1)} ms`);
  assert.ok(took < 1000, `took ${took} ms`);
  assert.deepEqual(states(a), [["1", "current-masked", 501, 2500]]);
  assert.deepEqual(a.unexplained, [[1, 500], [2501, 20000]]);
});

// The worst case: no exact line, 5,000 different pattern lines, and text lines that fit many of them, so the
// search has no cheap way to narrow the starts and no test can be reused.
const COMMON = Array.from({ length: 110 }, (_, i) => "abcdefghijklmnopqrstuvwxyz0123456789"[(i * 7) % 36]).join("");

function worstCase(): { note: FileNote; text: string[] } {
  const patterns: string[] = [];
  for (let a = 0; a < COMMON.length && patterns.length < 5000; a++) {
    for (let b = a + 1; b <= COMMON.length && patterns.length < 5000; b++) {
      patterns.push(`k = "${COMMON.slice(0, a)}${MASK}${COMMON.slice(b)}${MASK}"`);
    }
  }
  assert.equal(new Set(patterns).size, 5000);
  // Every line fits every pattern, except a line every hundred lines before the block's real place.
  const text = Array.from({ length: 20000 }, (_, i) => (i < 15000 && i % 100 === 99 ? "# break" : `k = "${COMMON}${i}"`));
  return { note: note([block("1", 15001, patterns)], "15001-20000"), text };
}

test("the worst case (5,000 different pattern lines in 20,000, no exact line): yields every few milliseconds; right answer", () => {
  const { note: n, text } = worstCase();
  // stopping it after the first yield leaves no result and no error
  const stopped = assign(n, text);
  assert.equal(stopped.next().done, false);
  assert.deepEqual(stopped.return(undefined as never), { value: undefined, done: true });
  assert.deepEqual(stopped.next(), { value: undefined, done: true });

  const gaps: number[] = [];
  const g = assign(n, text);
  const started = performance.now();
  let last = started, result: Assignment | undefined;
  for (;;) {
    const step = g.next();
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (step.done) { result = step.value; break; }
  }
  const took = last - started;
  gaps.sort((x, y) => x - y);
  const median = gaps[gaps.length >> 1], longest = gaps[gaps.length - 1];
  console.log(`timing: worst case ran ${took.toFixed(0)} ms in ${gaps.length} slices; work between yields: median ${median.toFixed(2)} ms, `
    + `95th ${gaps[Math.floor(gaps.length * 0.95)].toFixed(2)} ms, longest ${longest.toFixed(2)} ms`);
  assert.ok(gaps.length > 20, `only ${gaps.length} slices`);
  assert.ok(median <= 4, `median work between yields ${median} ms`);
  assert.ok(longest <= 50, `longest work between yields ${longest} ms`);
  assert.deepEqual(states(result), [["1", "current-masked", 15001, 20000]]);
  assert.deepEqual(result.unexplained, [[1, 15000]]);
});

test("an edit during a long match: the first run stops at its next yield; only the second run's result is used", () => {
  const { note: n, text } = worstCase();
  const queue: (() => void)[] = [];
  const runs = new MatchRuns((step) => { queue.push(step); });
  const published: [RunKey, Assignment][] = [];
  const progress: RunKey[] = [];
  const first: RunKey = { uri: "file:///a.py", version: 1, revision: 1 };
  const second: RunKey = { uri: "file:///a.py", version: 2, revision: 1 };
  runs.start(first, n, text, (a, key) => published.push([key, a]), (_, key) => progress.push(key));
  queue.shift()?.();                       // one slice of the first run
  assert.deepEqual(progress, [first]);
  assert.equal(published.length, 0);
  assert.deepEqual(runs.active("file:///a.py"), first);
  // the person types: a new version of the document
  const edited = ["k = 1"];
  runs.start(second, note([block("1", 1, ["k = 1"])]), edited, (a, key) => published.push([key, a]), (_, key) => progress.push(key));
  assert.deepEqual(runs.active("file:///a.py"), second);
  let steps = 0;
  while (queue.length > 0) { queue.shift()?.(); steps++; }
  assert.ok(steps <= 3, `the first run went on for ${steps} steps`);
  assert.deepEqual(progress.filter((key) => key === first), [first]);   // no slice of the first run after the edit
  assert.equal(published.length, 1);
  assert.equal(published[0][0], second);
  assert.deepEqual(states(published[0][1]), [["1", "current", 1, 1]]);
  assert.equal(runs.active("file:///a.py"), undefined);
});

test("the note is replaced during a long match, the document untouched: the old run is not published", async () => {
  const { note: old, text } = worstCase();
  const runs = new MatchRuns();            // the default: slices run with setImmediate between them
  const published: [RunKey, Assignment][] = [];
  const first: RunKey = { uri: "file:///a.py", version: 7, revision: 1 };
  const second: RunKey = { uri: "file:///a.py", version: 7, revision: 2 };
  const replaced = note([block("1", 1, [text[0]])]);
  await new Promise<void>((resolve) => {
    let sliced = false;
    runs.start(first, old, text, (a, key) => { published.push([key, a]); resolve(); }, () => {
      if (sliced) { return; }
      sliced = true;                       // the index re-read the note: same document, same version, a new revision
      runs.start(second, replaced, text, (a, key) => { published.push([key, a]); resolve(); });
    });
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(published.length, 1);
  assert.equal(published[0][0], second);
  assert.deepEqual(states(published[0][1]), [["1", "current", 1, 1]]);
  // the same key again starts nothing; a removed note (no revision) stops the run and publishes nothing
  assert.equal(runs.start(first, old, text, () => published.push([first, { placed: [], unexplained: [] }])), true);
  assert.equal(runs.start(first, old, text, () => assert.fail("started twice")), false);
  runs.stop("file:///a.py");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(published.length, 1);
});

// ---------------------------------------------------------------- sameLine against the checker

interface Case { name: string; note: string; text: string; line: number; masked: string; want: boolean; }
const CASES: Case[] = [
  { name: "equal lines", note: "x = 1", text: "x = 1", line: 1, masked: "", want: true },
  { name: "different lines, no mask", note: "x = 1", text: "x = 2", line: 1, masked: "1", want: false },
  { name: "equal lines that hold [masked], not declared", note: `t = "${MASK}"`, text: `t = "${MASK}"`, line: 1, masked: "", want: true },
  { name: "equal lines that hold [masked], declared", note: `t = "${MASK}"`, text: `t = "${MASK}"`, line: 1, masked: "1", want: true },
  { name: "a mask on an undeclared line", note: `t = "${MASK}"`, text: 't = "abc"', line: 1, masked: "", want: false },
  { name: "a mask declared for another line", note: `t = "${MASK}"`, text: 't = "abc"', line: 1, masked: "2-9", want: false },
  { name: "[masked] alone", note: MASK, text: "anything at all", line: 1, masked: "1", want: true },
  { name: "[masked] alone, not declared", note: MASK, text: "anything at all", line: 1, masked: "", want: false },
  { name: "indented [masked] alone against any line", note: "    " + MASK, text: "x", line: 1, masked: "1", want: true },
  { name: "[masked] with spaces after", note: MASK + "  \t", text: "  y = 2", line: 1, masked: "1", want: true },
  { name: "a non-breaking space before [masked]", note: NBSP + MASK, text: "whatever", line: 1, masked: "1", want: true },
  { name: "a form feed before [masked]", note: FEED + MASK, text: "whatever", line: 1, masked: "1", want: true },
  { name: "U+FEFF before [masked] is not a whole-line mask", note: BOM + MASK, text: "whatever", line: 1, masked: "1", want: false },
  { name: "U+FEFF before [masked], the text has it too", note: "=" + BOM + MASK, text: "=" + BOM + "secret", line: 1, masked: "1", want: true },
  { name: "only masks and spaces", note: ` ${MASK}${MASK} `, text: " ab ", line: 1, masked: "1", want: false },
  { name: "two masks alone", note: MASK + MASK, text: "ab", line: 1, masked: "1", want: false },
  { name: "one mask", note: `t = "${MASK}"`, text: 't = "abc"', line: 1, masked: "1", want: true },
  { name: "one mask, the text around it differs", note: `t = "${MASK}"`, text: 'u = "abc"', line: 1, masked: "1", want: false },
  { name: "one mask, the end differs", note: `t = "${MASK}"`, text: "t = \"abc'", line: 1, masked: "1", want: false },
  { name: "several masks", note: `a(${MASK}, b, ${MASK})`, text: "a(1, b, 22)", line: 1, masked: "1", want: true },
  { name: "a mask at the start", note: `${MASK} = 1`, text: "secret = 1", line: 1, masked: "1", want: true },
  { name: "a mask at the end", note: `key = ${MASK}`, text: "key = 12345", line: 1, masked: "1", want: true },
  { name: "pieces that repeat", note: `ab${MASK}ab${MASK}ab`, text: "abXabYab", line: 1, masked: "1", want: true },
  { name: "pieces that repeat, one too few", note: `ab${MASK}ab${MASK}ab`, text: "abXab", line: 1, masked: "1", want: false },
  { name: "pieces that repeat and overlap", note: `aa${MASK}aa`, text: "aaa", line: 1, masked: "1", want: false },
  { name: "pieces that repeat, the earliest place is taken", note: `x${MASK}ab${MASK}ab`, text: "x-ab-ab-ab", line: 1, masked: "1", want: true },
  { name: "an empty gap", note: `t = "${MASK}"`, text: 't = ""', line: 1, masked: "1", want: false },
  { name: "an empty gap between two pieces", note: `a${MASK}b${MASK}c`, text: "aXbc", line: 1, masked: "1", want: false },
  { name: "the piece order reversed", note: `a${MASK}b${MASK}c`, text: "c1b2a", line: 1, masked: "1", want: false },
  { name: "the piece order reversed inside", note: `x${MASK}one${MASK}two${MASK}y`, text: "x two one y", line: 1, masked: "1", want: false },
  { name: "two masks need two characters: one emoji", note: `x${MASK}${MASK}y`, text: `x${EMOJI}y`, line: 1, masked: "1", want: false },
  { name: "two masks, two emoji", note: `x${MASK}${MASK}y`, text: `x${EMOJI}${EMOJI}y`, line: 1, masked: "1", want: true },
  { name: "one mask, one emoji", note: `x${MASK}y`, text: `x${EMOJI}y`, line: 1, masked: "1", want: true },
  { name: "a mask and a regular-expression sign", note: `re.match(".+?", ${MASK})`, text: 're.match(".+?", s)', line: 1, masked: "1", want: true },
  { name: "the text is the pattern's own letters", note: `a.c${MASK}`, text: "abcd", line: 1, masked: "1", want: false },
  { name: "the line is declared by a range", note: `t = ${MASK}`, text: "t = 5", line: 8, masked: "3, 7-9", want: true },
];

test("sameLine: the checker's comparison, step by step", () => {
  for (const c of CASES) {
    const props = parseProps(`---\nmasked_lines: ${c.masked}\n---\n`);
    assert.equal(sameLine(c.note, c.text, c.line, props), c.want, c.name);
  }
  const props = parseProps("---\nmasked_lines: 1\n---\n");
  // the text line has its line ending removed first; nothing else is changed
  assert.equal(sameLine("x = 1", "x = 1\r\n", 1, props), true);
  assert.equal(sameLine("x = 1", "x = 1\n", 1, props), true);
  assert.equal(sameLine("x = 1", "x = 1 ", 1, props), false);
  assert.equal(sameLine(`t = ${MASK}`, "t = 5\r", 1, props), true);
  assert.equal(pyStrip(`${NBSP}\t${FEED}\x1c\x1f\x85 a b \r\n`), "a b");
  assert.equal(pyStrip(BOM + "a" + BOM), BOM + "a" + BOM);
});

const python = spawnSync("python", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "Python ('python') was not found; the parity test with check_notes.py did not run" : false;
const scripts = path.resolve(__dirname, "../../../skills/argus/scripts");

test("sameLine against the checker's own functions on the same table", { skip: noPython }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-match-"));
  try {
    fs.writeFileSync(path.join(tmp, "cases.json"), JSON.stringify(CASES), "utf8");
    // The comparison is a loop inside check_file_note, not a function: these are its steps, in its order, made of
    // the checker's own MASK, line_set and mask_pattern.
    const program = [
      "import json, re, sys",
      "sys.path.insert(0, sys.argv[1])",
      "import check_notes as c",
      "answers = []",
      "for case in json.load(open(sys.argv[2], encoding='utf-8')):",
      "    got, real, ln = case['note'], case['text'], case['line']",
      "    declared = c.line_set(case['masked'], 100)",
      "    if got == real: answers.append(True)",
      "    elif c.MASK not in got: answers.append(False)",
      "    elif ln not in declared: answers.append(False)",
      "    elif got.strip() == c.MASK: answers.append(True)",
      "    else:",
      "        found = re.fullmatch(c.mask_pattern(got, groups=True), real)",
      "        answers.append(bool(found and got.replace(c.MASK, '').strip()))",
      "print(json.dumps(answers))",
    ].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, scripts, path.join(tmp, "cases.json")], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as boolean[];
    assert.equal(answers.length, CASES.length);
    CASES.forEach((c, i) => {
      assert.equal(answers[i], c.want, `the checker's rule on: ${c.name}`);
      assert.equal(sameLine(c.note, c.text, c.line, parseProps(`---\nmasked_lines: ${c.masked}\n---\n`)), answers[i], c.name);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sameLine and assign against a run of the checker itself", { skip: noPython }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-match-"));
  try {
    const src = path.join(tmp, "src"), notes = path.join(tmp, "notes");
    fs.mkdirSync(src);
    fs.mkdirSync(notes);
    // One source file and one note for each case: line 1 is the case, line 2 an ordinary line.
    const usable = CASES.filter((c) => c.line === 1);
    usable.forEach((c, i) => {
      fs.writeFileSync(path.join(src, `c${i}.py`), `${c.text}\ntail = 1\n`, "utf8");
      fs.writeFileSync(path.join(notes, `P file - c${i}.py.md`), `---\ntype: file\nwritten_by: argus\nsource: c${i}.py\ndepth: map\n`
        + `masked_lines: ${c.masked}\n---\n# c${i}\n\n### Block 1: the case (lines 1-2)\n\n\`\`\`py\n${c.note}\ntail = 1\n\`\`\`\n\nIt is a case.\n`, "utf8");
    });
    const out = spawnSync("python", ["-B", path.join(scripts, "check_notes.py"), "--json", "--notes", notes, "--source", src, "--no-graph"],
      { encoding: "utf8" });
    assert.equal(out.status, 1, out.stderr);   // the sample notes have no lens rows; only the code comparison is read
    const result = JSON.parse(out.stdout) as { fails: { note: string | null; text: string }[] };
    usable.forEach((c, i) => {
      const name = `P file - c${i}.py`;
      const refused = result.fails.some((f) => f.note === name
        && (f.text.includes("code differs from the source at line 1") || f.text.includes("line 1 holds [masked] but is not listed")));
      assert.equal(!refused, c.want, `the checker on: ${c.name}`);
      const parsed = parseFileNote(name, "p", fs.readFileSync(path.join(notes, name + ".md"), "utf8"));
      const state = run(parsed, [c.text, "tail = 1"]).placed[0].state;
      assert.equal(state === "current" || state === "current-masked", c.want, `assign on: ${c.name}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the case that took a regular expression 339 ms answers 'no match' in well under a millisecond", () => {
  const noteLine = `x${MASK}x${MASK}x${MASK}x${MASK}Z`, textLine = "x".repeat(400) + "Y";
  let started = performance.now();
  assert.equal(maskedMatch(noteLine, textLine), false);
  const cold = performance.now() - started;
  started = performance.now();
  for (let i = 0; i < 200; i++) { maskedMatch(noteLine, textLine); }
  const each = (performance.now() - started) / 200;
  console.log(`timing: the backtracking case: first call ${cold.toFixed(3)} ms, then ${each.toFixed(4)} ms a call`);
  assert.ok(cold < 1, `first call took ${cold} ms`);
  assert.ok(each < 0.1, `a call took ${each} ms`);
  assert.equal(maskedMatch(noteLine, "x".repeat(400) + "Z"), true);
  // a line longer than 10,000 characters is compared in steps and gives the same answer
  const long = "a".repeat(30000);
  assert.equal(maskedMatch(`${MASK}b${MASK}`, long), false);
  assert.equal(maskedMatch(`a${MASK}a${MASK}a`, long), true);
  assert.equal(maskedMatch(`${long}${MASK}`, long + "!"), true);
});

test("a block with a masked line in the middle and repeated unmasked runs: only the starts where both runs fit", () => {
  const code = ["open()", "read()", `key = "${MASK}"`, "close()"];
  const n = note([block("1", 21, code)], "23");
  const text = numbered(40);
  text.splice(4, 3, "open()", "read()", 'key = "a"');              // the first run fits at 5, the last line does not
  text.splice(13, 1, "close()");                                   // the last run alone
  text.splice(20, 4, "open()", "read()", 'key = "b"', "close()");  // both fit at 21
  text.splice(30, 4, "open()", "read()", "other()", "close()");    // both runs fit at 31, the masked line does not
  assert.deepEqual(runToEnd(candidates(n, text)), [[21]]);
  assert.deepEqual(states(run(n, text)), [["1", "current-masked", 21, 24]]);
});

test("a note line with [masked] that is not declared in masked_lines, text differs: changed", () => {
  const n = note([block("1", 1, ["import os", `token = "${MASK}"`])], "");
  const a = run(n, ["import os", 'token = "abc123"']);
  assert.deepEqual(states(a), [["1", "changed", 1, 2]]);
  assert.equal(a.placed[0].spacesOnly, undefined);
  // declared for the place the block was recorded at, whatever line it is on now
  const moved = run(note([block("1", 1, ["import os", `token = "${MASK}"`])], "2"), ["", "", "", "import os", 'token = "abc123"']);
  assert.deepEqual(states(moved), [["1", "current-masked", 4, 5]]);
});

test("source text that itself says [masked], copied exactly: current, not masked", () => {
  const code = ["def hide(s):", `    return "${MASK}"`];
  assert.deepEqual(states(run(note([block("1", 1, code)], ""), code)), [["1", "current", 1, 2]]);
  assert.deepEqual(states(run(note([block("1", 1, code)], "2"), code)), [["1", "current", 1, 2]]);
});

test("a block that appears twice, recorded half-way between, no neighbour to decide: ambiguous with both candidates", () => {
  const code = ["def twin():", "    return 0"];
  const text = numbered(30);
  text.splice(4, 2, ...code);     // at line 5
  text.splice(14, 2, ...code);    // at line 15
  const a = run(note([block("1", 10, code)]), text);
  assert.equal(a.placed[0].state, "ambiguous");
  assert.deepEqual(a.placed[0].candidates, [5, 15]);
  assert.deepEqual(a.unexplained, [[1, 30]]);      // an ambiguous block explains no line
  // nearer one place: that place, not ambiguous
  assert.deepEqual(states(run(note([block("1", 9, code)]), text)), [["1", "current", 5, 6]]);
  // a neighbour decides: the block after it sits between the two places
  const neighbour = run(note([block("1", 10, code), block("2", 12, ["line 9"])]), text);
  assert.deepEqual(states(neighbour), [["1", "current", 5, 6], ["2", "current", 10, 10]]);
});

test("two blocks that cannot both keep their order, equally near: neither is called current", () => {
  // Recorded a at 2 and b at 4; the text has them the other way round, each two lines from its recorded place.
  const a = run(note([block("1", 2, ["a()"]), block("2", 4, ["b()"])]), ["", "b()", "", "a()"]);
  assert.deepEqual(a.placed.map((p) => [p.block.id, p.state, p.candidates]), [["1", "ambiguous", [4]], ["2", "ambiguous", [2]]]);
  assert.deepEqual(a.unexplained, [[2, 2], [4, 4]]);
});

test("CRLF text against an LF note: current", () => {
  const a = run(THREE(), FILE.join("\r\n").split("\n"));
  assert.deepEqual(states(a), [["1", "current", 1, 2], ["2", "current", 4, 5], ["3", "current", 7, 8]]);
  assert.deepEqual(a.unexplained, []);
});

/** Runs `assign` to its end and gives its result with the time of work before each yield, in order. */
function gapsOf(n: FileNote, text: string[]): { result: Assignment; gaps: number[]; took: number } {
  const gaps: number[] = [];
  const g = assign(n, text);
  const started = performance.now();
  let last = started;
  for (;;) {
    const step = g.next();
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (step.done) { return { result: step.value, gaps, took: last - started }; }
  }
}

test("a declared line of 250,000 [masked] side by side: preparing the pattern yields every few milliseconds; right answer", () => {
  // Three shapes of a costly pattern: very many empty pieces, very many short pieces, one very long piece.
  const shapes: { name: string; line: string; fitting: string; short: string }[] = [
    { name: "x, 250,000 [masked], y", line: "x" + MASK.repeat(250000) + "y",
      fitting: "x" + "ab".repeat(150000) + "y", short: "x" + "a".repeat(249999) + "y" },          // one character too few
    { name: "x and 100,000 times [masked]a", line: "x" + (MASK + "a").repeat(100000),
      fitting: "x" + "ba".repeat(100000), short: "x" + "ba".repeat(99999) + "a" },
    { name: "x[masked], 2,000,000 characters, [masked]y", line: "x" + MASK + "ab".repeat(1000000) + MASK + "y",
      fitting: "xQ" + "ab".repeat(1000000) + "Qy", short: "xQ" + "ab".repeat(1000000) + "y" },
  ];
  for (const { name, line, fitting, short } of shapes) {
    const text = ["before", short, fitting, "after"];
    const n = note([block("1", 3, [line])], "3");
    const { result, gaps, took } = gapsOf(n, text);
    const first = gaps[0], sorted = [...gaps].sort((x, y) => x - y);
    const median = sorted[sorted.length >> 1], longest = sorted[sorted.length - 1];
    console.log(`timing: ${name}: first yield after ${first.toFixed(2)} ms; ran ${took.toFixed(0)} ms in ${gaps.length} slices; `
      + `work between yields: median ${median.toFixed(2)} ms, longest ${longest.toFixed(2)} ms`);
    assert.deepEqual(states(result), [["1", "current-masked", 3, 3]], name);
    assert.deepEqual(result.unexplained, [[1, 2], [4, 4]], name);
    assert.ok(gaps.length > 1, `${name}: it never yielded`);
    assert.ok(median <= 4, `${name}: median work between yields ${median} ms`);
    assert.ok(longest <= 25, `${name}: longest work between yields ${longest} ms`);
    // The same answers from the calls that do not yield.
    assert.deepEqual(runToEnd(candidates(n, text)), [[3]], name);
    assert.equal(sameLine(line, fitting, 3, n.props), true, name);
    assert.equal(sameLine(line, short, 3, n.props), false, name);
    assert.equal(maskedMatch(line, fitting), true, name);
  }
  // A line of masks and white space only, declared: it matches only a line equal to it (the checker's step 5).
  const only = " " + MASK.repeat(250000) + " ";
  const masks = note([block("1", 1, [only])], "1");
  assert.equal(sameLine(only, "x".repeat(250002), 1, masks.props), false);
  assert.deepEqual(states(run(masks, [only, "y"])), [["1", "current", 1, 1]]);
  assert.equal(run(masks, ["x".repeat(250002), "y"]).placed[0].state, "changed");
});
