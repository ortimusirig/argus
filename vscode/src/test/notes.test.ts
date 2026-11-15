import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fenceMask, isArgus, isMasked, parseFileNote, parseOtherNote, parseProps } from "../core/notes";

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
