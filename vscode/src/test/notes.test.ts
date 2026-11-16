import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fenceMask, isArgus, isMasked, parseFileNote, parseOtherNote, parseProps, linkNames, withoutInlineCode } from "../core/notes";

const LENS = ["In one sentence", "What we gain", "What we lose", "What was not possible without it", "Issues today",
  "What it makes possible", "Open source used", "Risks"];

interface SampleBlock { id: string; purpose: string; from: number; to: number; after?: string[]; }

/** A File note, built like `file_note` in the skill's test_scripts.py, with any number of blocks. */
function fileNote(source: string, code: string[], blocks: SampleBlock[], depth: "map" | "full" = "full",
  extraProps = "", codeInNote: string[] = code): string {
  const t = [`---\ntype: file\nwritten_by: argus\nproject: P\nsource: ${source}\ndepth: ${depth}\n${extraProps}---`,
    `# P file - ${source}`, "", "## Level 1: purpose", "", "| Lens | Answer |", "| --- | --- |"];
  for (const label of LENS) { t.push(`| ${label} | an answer |`); }
  t.push("", "## Level 2: blocks", "", "| # | Lines | Purpose | Why this way | Concepts |", "| --- | --- | --- | --- | --- |");
  for (const b of blocks) { t.push(`| ${b.id} | ${b.from}-${b.to} | ${b.purpose} | because | [[Concept - x]] |`); }
  t.push("", "## Code and explanation", "");
  for (const b of blocks) {
    const range = b.from === b.to ? `line ${b.from}` : `lines ${b.from}-${b.to}`;
    t.push(`### Block ${b.id}: ${b.purpose} (${range})`, "", "```py", ...codeInNote.slice(b.from - 1, b.to), "```", "");
    if (depth === "map") { t.push(`This block ${b.purpose}, see [[Concept - x]].`, ""); }
    if (depth === "full") {
      t.push("| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |");
      for (let n = b.from; n <= b.to; n++) {
        const line = code[n - 1];
        if (line.trim()) { t.push(`| ${n} | \`\` ${line.trim().replace(/\|/g, "\\|")} \`\` | it happens, [[Concept - y]] | none |`); }
      }
      t.push("");
    }
    if (b.after) { t.push(...b.after, ""); }
  }
  if (depth === "full") {
    t.push("## Trace: one run", "", "| Step | Line | Variable | Value |", "| --- | --- | --- | --- |", "| 1 | 1 | x | not run |",
      "", "## Check your understanding", "", "| Question | Answer |", "| --- | --- |", "| What? | That. |");
  }
  return t.join("\n") + "\n";
}

const CODE = ["import os", "", "def run(a):", "    return a | 1", "", "x = run(2)"];
const BLOCKS: SampleBlock[] = [
  { id: "1", purpose: "imports", from: 1, to: 1 },
  { id: "2", purpose: "the function", from: 3, to: 4 },
  { id: "2a", purpose: "the call", from: 6, to: 6 },
];

test("a full-depth note: block ids, ranges, code lines and line rows", () => {
  const note = parseFileNote("P file - a.py", "/n/P file - a.py.md", fileNote("a.py", CODE, BLOCKS));
  assert.deepEqual(note.problems, []);
  assert.equal(note.name, "P file - a.py");
  assert.equal(note.path, "/n/P file - a.py.md");
  assert.deepEqual(note.props, { writtenBy: "argus", type: "file", project: "P", source: "a.py", depth: "full", maskedRanges: [] });
  assert.deepEqual(note.lens, LENS.map((label) => [label, "an answer"]));
  assert.deepEqual(note.blocks.map((b) => [b.id, b.purpose, b.from, b.to]),
    [["1", "imports", 1, 1], ["2", "the function", 3, 4], ["2a", "the call", 6, 6]]);
  assert.deepEqual(note.blocks.map((b) => b.code), [["import os"], ["def run(a):", "    return a | 1"], ["x = run(2)"]]);
  assert.deepEqual(note.blocks[1].rows, [
    { from: 3, to: 3, code: "def run(a):", what: "it happens, [[Concept - y]]", value: "none" },
    { from: 4, to: 4, code: "return a | 1", what: "it happens, [[Concept - y]]", value: "none" },
  ]);
  assert.deepEqual(note.blocks.map((b) => b.prose), ["", "", ""]);
  assert.deepEqual(note.blocks[1].concepts, ["Concept - x", "Concept - y"]);
});

test("a map-depth note keeps the sentences in prose and has no rows", () => {
  const note = parseFileNote("n", "p", fileNote("a.py", CODE, BLOCKS, "map"));
  assert.deepEqual(note.problems, []);
  assert.equal(note.props.depth, "map");
  assert.deepEqual(note.blocks.map((b) => b.rows.length), [0, 0, 0]);
  assert.equal(note.blocks[0].prose, "This block imports, see [[Concept - x]].");
  assert.deepEqual(note.blocks[0].concepts, ["Concept - x"]);
});

test("a block with a 'Part of line' table under its line table: numbered rows only; the extra table stays in prose", () => {
  const blocks: SampleBlock[] = [{ id: "1", purpose: "all", from: 1, to: 6, after: [
    "The call is rich:", "", "| Part of line 6 | Meaning |", "| --- | --- |", "| `run(2)` | the call |", "| `x =` | keeps it |",
    "", "```text", "| 9 | not a row |", "```"] }];
  const note = parseFileNote("n", "p", fileNote("a.py", CODE, blocks));
  assert.deepEqual(note.problems, []);
  const block = note.blocks[0];
  assert.deepEqual(block.rows.map((r) => r.from), [1, 3, 4, 6]);
  assert.equal(block.prose, ["The call is rich:", "", "| Part of line 6 | Meaning |", "| --- | --- |", "| `run(2)` | the call |",
    "| `x =` | keeps it |", "", "```text", "| 9 | not a row |", "```"].join("\n"));
});

test("a ## and a ### Block line inside a code fence are code, not headings", () => {
  const code = ["## Configuration", "x = 1", "### Block 9: not a block (lines 1-2)", "y = 2"];
  const note = parseFileNote("n", "p", fileNote("a.py", code, [{ id: "1", purpose: "all", from: 1, to: 4 }]));
  assert.deepEqual(note.problems, []);
  assert.deepEqual(note.blocks.map((b) => b.id), ["1"]);
  assert.deepEqual(note.blocks[0].code, code);
  assert.deepEqual(note.blocks[0].rows.map((r) => r.from), [1, 2, 3, 4]);
});

test("a four-backtick fence holding a three-backtick line is one fence", () => {
  const lines = ["a", "````md", "```", "inside", "```", "````", "b", "```", "c", "```   ", "d"];
  assert.deepEqual(fenceMask(lines), [false, true, true, true, true, true, false, true, true, true, false]);
  // a closing fence must be at least as long as the opening one, and hold nothing but the fence
  assert.deepEqual(fenceMask(["````", "```", "````x", "`````", "out"]), [true, true, true, true, false]);
  const text = ["---", "type: file", "written_by: argus", "source: a.md", "depth: map", "---", "### Block 1: doc (lines 1-3)", "",
    "````md", "```", "inside", "```", "````", "", "It shows a fence."].join("\n");
  const note = parseFileNote("n", "p", text);
  assert.deepEqual(note.problems, []);
  assert.deepEqual(note.blocks[0].code, ["```", "inside", "```"]);
  assert.equal(note.blocks[0].prose, "It shows a fence.");
});

test("tables with other spacing give the same rows", () => {
  const head = "---\ntype: file\nwritten_by: argus\nsource: a.py\ndepth: full\n---\n### Block 1: one (lines 1-2)\n\n```py\na = 1\nb = 2\n```\n\n";
  const spaced = parseFileNote("n", "p", head + "| Line | Code | What happens | Real value |\n| --- | --- | --- | --- |\n| 1 | `a = 1` | sets a | 1 |\n| 2 | `b = 2` | sets b | 2 |\n");
  const tight = parseFileNote("n", "p", head + "|Line|Code|What happens|Real value|\n|---|---|---|---|\n|1|`a = 1`|sets a|1|\n|2|`b = 2`|sets b|2|\n");
  const wide = parseFileNote("n", "p", head + "  |  Line  |  Code  |  What happens  |  Real value  |\n  | :--- | ---: | --- | --- |\n  |  1  |  `a = 1`  |  sets a  |  1  |\n  |  2  |  `b = 2`  |  sets b  |  2  |  \n");
  const rows = [{ from: 1, to: 1, code: "a = 1", what: "sets a", value: "1" }, { from: 2, to: 2, code: "b = 2", what: "sets b", value: "2" }];
  for (const note of [spaced, tight, wide]) {
    assert.deepEqual(note.problems, []);
    assert.deepEqual(note.blocks[0].rows, rows);
    assert.equal(note.blocks[0].prose, "");
  }
  const range = parseFileNote("n", "p", head + "| Line | Code | What happens | Real value |\n| --- | --- | --- | --- |\n| 1 - 2 | `a = 1 …` | sets both | none |\n");
  assert.deepEqual(range.blocks[0].rows, [{ from: 1, to: 2, code: "a = 1 …", what: "sets both", value: "none" }]);
});

test("an escaped | inside a code cell stays in the cell and comes out as |", () => {
  const note = parseFileNote("n", "p", fileNote("a.py", CODE, BLOCKS));
  assert.equal(note.blocks[1].rows[1].code, "return a | 1");
  assert.equal(note.blocks[1].rows[1].what, "it happens, [[Concept - y]]");
});

test("CRLF and CR-only text give the same result as LF", () => {
  const lf = fileNote("a.py", CODE, BLOCKS, "full", "masked_lines: 3, 7-9\n");
  const want = parseFileNote("n", "p", lf);
  assert.deepEqual(want.problems, []);
  assert.deepEqual(parseFileNote("n", "p", lf.replace(/\n/g, "\r\n")), want);
  assert.deepEqual(parseFileNote("n", "p", lf.replace(/\n/g, "\r")), want);
  assert.deepEqual(parseProps(lf.replace(/\n/g, "\r\n")), want.props);
  assert.deepEqual(parseProps(lf.replace(/\n/g, "\r")), want.props);
  assert.deepEqual(want.props.maskedRanges, [[3, 3], [7, 9]]);
});

test("a note without written_by: argus is not indexed", () => {
  assert.equal(isArgus(parseProps("---\ntype: file\nwritten_by: argus\n---\n# x\n")), true);
  assert.equal(isArgus(parseProps("---\ntype: file\nwritten_by: \"Argus\"\n---\n# x\n")), true);   // the checker lower-cases it
  assert.equal(isArgus(parseProps("---\ntype: file\n---\n# x\n")), false);
  assert.equal(isArgus(parseProps("---\ntype: file\nwritten_by: someone\n---\n")), false);
  assert.equal(isArgus(parseProps("# no properties\nwritten_by: argus\n")), false);
  assert.equal(isArgus(parseProps("---\nwritten_by: argus\nnever closed\n")), false);
});

test("masked_lines: 1-1000000000 is one range; isMasked answers for any line; memory does not grow", () => {
  if (global.gc) { global.gc(); }
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const props = parseProps("---\nwritten_by: argus\nmasked_lines: 1-1000000000, 3, x, 2000000000 - 2000000005, 9-8, -4\n---\n");
  const took = performance.now() - started;
  assert.deepEqual(props.maskedRanges, [[1, 1000000000], [3, 3], [2000000000, 2000000005], [9, 8]]);
  assert.equal(isMasked(props, 1), true);
  assert.equal(isMasked(props, 999999999), true);
  assert.equal(isMasked(props, 1000000000), true);
  assert.equal(isMasked(props, 1000000001), false);
  assert.equal(isMasked(props, 2000000003), true);
  assert.equal(isMasked(props, 0), false);
  assert.ok(took < 50, `parsing took ${took} ms`);
  assert.ok(process.memoryUsage().heapUsed - before < 5_000_000, "memory grew with the range");
  assert.equal(isMasked(parseProps("---\nmasked_lines: 9-8\n---\n"), 8), false);   // a range written backwards holds no line
});

test("properties: quotes, a colon in the value, an unknown depth", () => {
  const props = parseProps("---\ntype: \"file\"\nwritten_by: 'argus'\nsource: src/a b.py\ncommit: abc1234\ndepth: deep\nnote: a: b\n---\n");
  assert.deepEqual(props, { writtenBy: "argus", type: "file", source: "src/a b.py", commit: "abc1234", maskedRanges: [] });
});

test("what cannot be read goes into problems", () => {
  const head = "---\ntype: file\nwritten_by: argus\nsource: a.py\ndepth: full\n---\n";
  const noFence = parseFileNote("n", "p", head + "### Block 1: one (lines 1-2)\n\nNo code here.\n");
  assert.equal(noFence.blocks.length, 1);
  assert.deepEqual(noFence.blocks[0].code, []);
  assert.equal(noFence.problems.length, 1);
  assert.match(noFence.problems[0], /block 1.*no code fence/);
  const twice = parseFileNote("n", "p", head + "### Block 1: one (line 1)\n\n```\na\n```\n\n### Block 1: again (line 2)\n\n```\nb\n```\n");
  assert.ok(twice.problems.some((p) => /two '### Block 1'/.test(p)));
  const backwards = parseFileNote("n", "p", head + "### Block 1: one (lines 5-2)\n\n```\na\n```\n");
  assert.ok(backwards.problems.some((p) => /range 5-2/.test(p)));
  const open = parseFileNote("n", "p", head + "### Block 1: one (line 1)\n\n```\na\n");
  assert.ok(open.problems.some((p) => /never closed/.test(p)));
  const short = parseFileNote("n", "p", head + "### Block 1: one (line 1)\n\n```\na\n```\n\n| Line | Code |\n| --- | --- |\n| 1 | `a` |\n");
  assert.ok(short.problems.some((p) => /row 1.*four cells/.test(p)));
});

test("parseOtherNote gives the properties and the body", () => {
  const note = parseOtherNote("Concept - x", "/v/Concept - x.md", "---\r\ntype: concept\r\nwritten_by: argus\r\n---\r\n# Concept - x\r\nA thing.\r\n");
  assert.deepEqual(note, { name: "Concept - x", path: "/v/Concept - x.md",
    props: { writtenBy: "argus", type: "concept", maskedRanges: [] }, body: "# Concept - x\nA thing.\n" });
  assert.equal(parseOtherNote("n", "p", "just text\n").body, "just text\n");
});

// ---------------------------------------------------------------- agreement with the checker

const python = spawnSync("python", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "Python ('python') was not found; the parity test with check_notes.py did not run" : false;

test("agreement with the checker: the same source and the same number of blocks", { skip: noPython }, () => {
  const checker = path.resolve(__dirname, "../../../skills/argus/scripts/check_notes.py");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-notes-"));
  try {
    const src = path.join(tmp, "src"), notes = path.join(tmp, "notes");
    fs.mkdirSync(path.join(src, "sub"), { recursive: true });
    fs.mkdirSync(notes);
    const headings = ["## Configuration", "x = 1", "### Block 9: not a block (lines 1-2)", "y = 2"];
    const secret = ['token = "abc123"', "", "use(token)"];
    const samples: { name: string; source: string; code: string[]; text: string; blocks: [string, number, number, string[]][] }[] = [
      { name: "P file - a.py", source: "a.py", code: CODE, text: fileNote("a.py", CODE, BLOCKS),
        blocks: [["1", 1, 1, ["import os"]], ["2", 3, 4, ["def run(a):", "    return a | 1"]], ["2a", 6, 6, ["x = run(2)"]]] },
      { name: "P file - b.py", source: "sub/b.py", code: headings, text: fileNote("sub/b.py", headings, [{ id: "1", purpose: "all", from: 1, to: 4 }]),
        blocks: [["1", 1, 4, headings]] },
      { name: "P file - c.py", source: "c.py", code: CODE, text: fileNote("c.py", CODE, BLOCKS, "map").replace(/\n/g, "\r\n"),
        blocks: [["1", 1, 1, ["import os"]], ["2", 3, 4, ["def run(a):", "    return a | 1"]], ["2a", 6, 6, ["x = run(2)"]]] },
      { name: "P file - d.py", source: "d.py", code: secret,
        text: fileNote("d.py", secret, [{ id: "1", purpose: "the token", from: 1, to: 1 }, { id: "2", purpose: "its use", from: 3, to: 3 }],
          "map", "masked_lines: 1\n", ['token = "[masked]"', "", "use(token)"]),
        blocks: [["1", 1, 1, ['token = "[masked]"']], ["2", 3, 3, ["use(token)"]]] },
    ];
    for (const s of samples) {
      fs.writeFileSync(path.join(src, s.source), s.code.join("\n") + "\n", "utf8");
      fs.writeFileSync(path.join(notes, s.name + ".md"), s.text, "utf8");
    }
    const links = samples.map((s) => `[[${s.name}]]`).join(" ");
    fs.writeFileSync(path.join(notes, "P - Start Here.md"), "---\ntype: start\nwritten_by: argus\n---\n| Lens | Answer |\n| --- | --- |\n"
      + LENS.map((label) => `| ${label} | a |`).join("\n") + `\n\n# P\n${links} [[Concept - x]] [[Concept - y]]\n`, "utf8");
    for (const concept of ["Concept - x", "Concept - y"]) {
      fs.writeFileSync(path.join(notes, concept + ".md"), `---\ntype: concept\nwritten_by: argus\n---\n# ${concept}\nA thing.\n`, "utf8");
    }
    fs.writeFileSync(path.join(notes, "Mine.md"), "# my own note\n### Block 1: not argus (line 1)\n", "utf8");

    const run = spawnSync("python", ["-B", checker, "--json", "--notes", notes, "--source", src, "--no-graph"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout) as { explained: Record<string, string>; infos: string[]; notes_not_checked: string[] };
    assert.deepEqual(result.notes_not_checked, ["Mine"]);
    assert.equal(isArgus(parseProps(fs.readFileSync(path.join(notes, "Mine.md"), "utf8"))), false);
    assert.equal(Object.keys(result.explained).length, samples.length);
    for (const s of samples) {
      const note = parseFileNote(s.name, path.join(notes, s.name + ".md"), fs.readFileSync(path.join(notes, s.name + ".md"), "utf8"));
      assert.deepEqual(note.problems, [], s.name);
      assert.equal(isArgus(note.props), true);
      // the checker names this note under `explained` for the same source
      assert.equal(result.explained[note.props.source ?? ""], s.name);
      // the checker's INFO line gives the number of blocks
      const info = result.infos.find((line) => line.startsWith(s.source + ": "));
      const counted = /, (\d+) blocks,/.exec(info ?? "");
      assert.ok(counted, `no INFO line for ${s.source}`);
      assert.equal(note.blocks.length, Number(counted[1]), s.name);
      // ids, ranges and code against values written here: the checker does not print them
      assert.deepEqual(note.blocks.map((b) => [b.id, b.from, b.to, b.code]), s.blocks, s.name);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- decimal digits of other scripts

const cp = (...points: number[]) => String.fromCodePoint(...points);

test("decimal digits of other scripts are read as Python's int() reads them, also where two groups of ten are neighbours", () => {
  const ranges = (written: string) => parseProps(`---\nwritten_by: argus\nmasked_lines: ${written}\n---\n`).maskedRanges;
  // Mathematical digits: five groups of ten with nothing between them, U+1D7CE to U+1D7FF.
  assert.deepEqual(ranges(`${cp(0x1d7d9)}, ${cp(0x1d7db)}`), [[1, 1], [3, 3]]);                      // double-struck 1 and 3
  assert.deepEqual(ranges(cp(0x1d7d9, 0x1d7d8)), [[10, 10]]);                                         // double-struck 10
  for (let group = 0; group < 5; group++) {
    const zero = 0x1d7ce + 10 * group;
    const all = Array.from({ length: 10 }, (_, digit) => cp(zero + digit));
    assert.deepEqual(ranges(all.join(", ")), all.map((_, digit) => [digit, digit]), `the group at U+${zero.toString(16)}`);
    assert.deepEqual(ranges(all.join("")), [[123456789, 123456789]]);
  }
  assert.deepEqual(ranges(`${cp(0x1d7ff)}-${cp(0x1d7cf, 0x1d7ce)}`), [[9, 10]]);                      // monospace 9 to bold 10
  // Groups that stand alone, and digits of several scripts in one number.
  assert.deepEqual(ranges(`${cp(0x663)}, ${cp(0x967, 0x968)}, ${cp(0xff17)}-${cp(0xff19)}`), [[3, 3], [12, 12], [7, 9]]);
  assert.deepEqual(ranges(`1${cp(0x1d7da)}${cp(0x669)}`), [[129, 129]]);
  assert.deepEqual(ranges("0, 7, 10-12, 007"), [[0, 0], [7, 7], [10, 12], [7, 7]]);
  // The same digits in a block's range and in the Line cell of its rows.
  const two = cp(0x1d7da), four = cp(0x1d7dc), one = cp(0x1d7d9);
  const text = ["---", "type: file", "written_by: argus", "source: a.py", "depth: full", "---",
    `### Block 1: the lines (lines ${one}${two}-${one}${four})`, "", "```py", "a", "b", "c", "```", "",
    "| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |",
    `| ${one}${two} | \`a\` | it happens | none |`, `| ${one}${cp(0x1d7db)}-${one}${four} | \`b\` | it happens | none |`, ""].join("\n");
  const note = parseFileNote("n", "p", text);
  assert.deepEqual(note.problems, []);
  assert.deepEqual([note.blocks[0].from, note.blocks[0].to], [12, 14]);
  assert.deepEqual(note.blocks[0].rows.map((row) => [row.from, row.to]), [[12, 12], [13, 14]]);
});

test("every decimal digit of Unicode has the value Python's int() gives it", { skip: noPython }, (t) => {
  const program = ["import json, sys, unicodedata",
    "print(json.dumps([[c, int(chr(c))] for c in range(sys.maxunicode + 1) if unicodedata.category(chr(c)) == 'Nd']))"].join("\n");
  const out = spawnSync("python", ["-B", "-c", program], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const digits = JSON.parse(out.stdout) as [number, number][];
  assert.ok(digits.length >= 650, `Python named ${digits.length} decimal digits`);
  // Node and Python may know different versions of Unicode: a digit only one of them knows is counted, not compared.
  const known = digits.filter(([c]) => /^\p{Nd}$/u.test(cp(c)));
  const props = parseProps(`---\nmasked_lines: ${known.map(([c]) => cp(c)).join(", ")}\n---\n`);
  assert.equal(props.maskedRanges.length, known.length);
  known.forEach(([c, value], i) => assert.deepEqual(props.maskedRanges[i], [value, value], `U+${c.toString(16).toUpperCase()}`));
  // Two digits together: each digit after a 1 of its own group, and after an ASCII 1.
  const pairs = known.map(([c, value]) => `${cp(c - value + 1, c)}-1${cp(c)}`);
  const paired = parseProps(`---\nmasked_lines: ${pairs.join(", ")}\n---\n`).maskedRanges;
  known.forEach(([c, value], i) => assert.deepEqual(paired[i], [10 + value, 10 + value], `1 and U+${c.toString(16).toUpperCase()}`));
  const python = new Set(digits.map(([c]) => c));
  let onlyNode = 0;
  for (let c = 0; c <= 0x10ffff; c++) {
    if ((c < 0xd800 || c > 0xdfff) && !python.has(c) && /^\p{Nd}$/u.test(cp(c))) { onlyNode++; }
  }
  t.diagnostic(`${known.length} decimal digits compared; ${digits.length - known.length} known to Python only, ${onlyNode} to Node only`);
});

// ---------------------------------------------------------------- inline code spans, as the checker removes them

test("withoutInlineCode: each code span becomes one space, as the checker's regular expression reads it", () => {
  const cases: [string, string][] = [
    ["a `b` c", "a   c"], ["``a ` b``", " "], ["`[[x]]` [[y]]", "  [[y]]"], ["| `a \\| b` | [[c]] |", "|   | [[c]] |"],
    ["`a` ``b`` ```c``` `d", "      `d"],
    ["", ""], ["no code", "no code"], ["a ` b", "a ` b"], ["`", "`"],                // a run that never closes stays as text
    // A run closes at the next place where as many backticks stand together, also at the start of a longer run.
    ["`a`` b` c", "   c"], ["`a``b```c", "   c"],
    // A run with no such place opens with fewer of its backticks; its own second half may be what closes it.
    ["```x``", " "], ["```a``b`c", " b`c"], ["``a`", " a`"], ["a `` b ` c", "a   b ` c"], ["``", " "], ["```", " `"], ["````", " "],
    ["`````a``", "  `"], ["x`` `` ``y", "x   y"], ["``[[x]]` [[y]]", " [[x]]` [[y]]"], ["`\\`[[x]]`", " [[x]]`"],
    // A span does not run over a line break.
    ["`a\nb`", "`a\nb`"], ["`a` \n `b`", "  \n  "],
  ];
  for (const [line, expected] of cases) { assert.equal(withoutInlineCode(line), expected, JSON.stringify(line)); }
  assert.deepEqual(linkNames(["`[[a]]` [[b]] ``[[c]]`` [[d]] `[[e]]", "```[[f]]`` [[g]]"]), ["b", "d", "e", "g"]);
});

/** Lines of backticks, letters and line breaks: every one up to a length, and long ones made by a fixed rule. */
function backtickLines(): string[] {
  const lines: string[] = ["", "`", "[[a]] `[[b]]` ``[[c]]", "| `a \\| b` | `` c ` d `` |", "é` `😀``x``"];
  const all = (alphabet: string, longest: number) => {
    let level = [""];
    for (let n = 1; n <= longest; n++) {
      level = level.flatMap((s) => [...alphabet].map((c) => s + c));
      lines.push(...level);
    }
  };
  all("`a", 11);
  all("`a\n", 7);
  let seed = 20261115;
  const next = (n: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  for (let n = 0; n < 600; n++) {
    let line = "";
    for (let k = 2 + next(40); k > 0; k--) { line += next(3) === 0 ? "a [\n".charAt(next(4)) : "`".repeat(1 + next(n % 2 === 0 ? 4 : 9)); }
    lines.push(line);
  }
  return lines;
}

test("withoutInlineCode gives what without_inline_code in check_notes.py gives", { skip: noPython }, (t) => {
  const lines = backtickLines();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-code-"));
  try {
    const list = path.join(tmp, "lines.json");
    fs.writeFileSync(list, JSON.stringify(lines), "utf8");
    const program = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from check_notes import without_inline_code",
      "print(json.dumps([without_inline_code(line) for line in json.load(open(sys.argv[2], encoding='utf-8'))]))"].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, path.resolve(__dirname, "../../../skills/argus/scripts"), list],
      { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as string[];
    assert.equal(answers.length, lines.length);
    let changed = 0;
    lines.forEach((line, i) => {
      assert.equal(withoutInlineCode(line), answers[i], JSON.stringify(line));
      if (answers[i] !== line) { changed++; }
    });
    assert.ok(changed > 5000, `only ${changed} lines held a code span`);
    t.diagnostic(`${lines.length} lines compared with the checker; ${changed} of them held a code span`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("withoutInlineCode: backticks cost time in proportion to their number", () => {
  const upTo = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
  const runs = (lengths: number[], between = "x") => lengths.map((n) => "`".repeat(n)).join(between);
  const shapes: [string, string, string?][] = [
    ["64,000 backticks", "`".repeat(64000), " "],
    ["64,001 backticks", "`".repeat(64001), " `"],
    ["x and 64,000 backticks", "x" + "`".repeat(64000) + "y", "x y"],
    ["runs of every length from 1 to 350", runs(upTo(350))],
    ["runs of every length from 350 down to 1", runs(upTo(350).reverse())],
    ["runs of 1 to 200 and of 201 to 400, by turns", runs(upTo(200).flatMap((n) => [n, n + 200]))],
    ["32,000 single backticks, a letter after each", "`a".repeat(32000), " a".repeat(16000)],
    ["32,001 single backticks, a letter after each", "`a".repeat(32001), " a".repeat(16000) + "`a"],
    ["20,000 runs of 1 and of 2 by turns", "` a `` b ".repeat(20000)],
    ["20,000 runs of 3 and of 2 by turns, then one of 1", "``` a `` b ".repeat(20000) + "`"],
    ["a run of 30,000, then 30,000 single backticks", "`".repeat(30000) + " ` x".repeat(30000)],
    ["30,000 single backticks, then a run of 30,000", "x ` ".repeat(30000) + "`".repeat(30000)],
    ["32,000 lines of one backtick", "`\n".repeat(32000), "`\n".repeat(32000)],
    ["64,000 backticks in linkNames", "[[a]] " + "`".repeat(64000) + " [[b]]"],
  ];
  for (const [name, text, expected] of shapes) {
    const started = performance.now();
    const result = name.endsWith("linkNames") ? linkNames([text]).join(",") : withoutInlineCode(text);
    const took = performance.now() - started;
    console.log(`timing: ${name} (${text.length} characters) read in ${took.toFixed(1)} ms`);
    assert.ok(took < 100, `${name}: took ${took} ms`);
    if (expected !== undefined) { assert.equal(result, expected, name); }
  }
  assert.deepEqual(linkNames(["[[a]] " + "`".repeat(64000) + " [[b]]"]), ["a", "b"]);
});
