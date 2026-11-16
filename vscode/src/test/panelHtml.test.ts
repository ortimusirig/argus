import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { View, body, csp, page, withoutNote } from "../core/panelHtml";
import { assign, runToEnd } from "../core/match";
import { parseFileNote, parseOtherNote } from "../core/notes";

const EVIL = "<img src=x onerror=alert(1)>";

function fileNote(): ReturnType<typeof parseFileNote> {
  return parseFileNote(`N ${EVIL}`, "/n/N.md", ["---", "type: file", "written_by: argus", "source: a.py", "depth: full", "masked_lines: 5", "---",
    "## Level 1: purpose", "", "| Lens | Answer |", "| --- | --- |", `| In one sentence | adds ${EVIL} |`, "",
    "## Level 2: blocks", "", "| # | Lines | Purpose | Why | Concepts |", "| --- | --- | --- | --- | --- |", "| 1 | 1-2 | adds | so | [[Concept - x]] |",
    "| 2 | 4-5 | keeps | so | [[Concept - gone]] |", "", "## Code and explanation", "",
    `### Block 1: adds ${EVIL} (lines 1-2)`, "", "```py", "def a():", "    return '<script>alert(1)</script>'", "```", "",
    "| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |", "| 1 | `def a():` | it starts <b>bold</b> | none |",
    "| 2 | `` return '<script>alert(1)</script>' `` | gives, see [[Concept - x]] | none |", "", "Read [more](https://example.com/x).", "",
    "### Block 2: keeps a key (lines 4-5)", "", "```py", "def b():", "    key = \"[masked]\"", "```", "",
    "| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |", "| 4 | `def b():` | it starts | none |",
    "| 5 | `key = \"[masked]\"` | holds the key | not run |", ""].join("\n"));
}
const TEXT = ["def a():", "    return '<script>alert(1)</script>'", "", "def b():", "    key = \"hunter2-secret\"", "extra = 1"];
const linkTo = (name: string): string | undefined => name === "Concept - x" ? name : undefined;

function fileView(over: Partial<Extract<View, { kind: "file" }>> = {}): View {
  const note = fileNote();
  return { kind: "file", file: `a${EVIL}.py`, note, noteId: 4, assignment: runToEnd(assign(note, TEXT)), selection: { from: 1, to: 6 },
    whole: false, badge: { label: "not checked", why: "no check has been run" }, linkTo, problems: [], ...over };
}

test("the page's content security policy: nothing by default, own styles and images, scripts by nonce only", () => {
  assert.equal(csp("vscode-webview://abc", "N0nce"),
    "default-src 'none'; style-src vscode-webview://abc; img-src vscode-webview://abc; script-src 'nonce-N0nce'");
  const html = page({ cspSource: "vscode-webview://abc", nonce: "N0nce", cssUri: "vscode-webview://abc/panel.css", jsUri: "vscode-webview://abc/panel.js", body: "<p>x</p>" });
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src vscode-webview://abc; img-src vscode-webview://abc; script-src 'nonce-N0nce'">`));
  assert.ok(html.includes(`<script nonce="N0nce" src="vscode-webview://abc/panel.js"></script>`));
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handlers");
  assert.doesNotMatch(html, /style=/, "no inline styles: the policy would refuse them");
});

test("media/panel.js sends messages only: no fetch, no XMLHttpRequest, no import(", () => {
  const js = fs.readFileSync(path.resolve(__dirname, "../../media/panel.js"), "utf8");
  for (const word of ["fetch", "XMLHttpRequest", "import(", "eval(", "innerHTML", "WebSocket", "http:", "https:"]) {
    assert.ok(!js.includes(word), `panel.js holds ${word}`);
  }
  const types = [...js.matchAll(/type: "([A-Za-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(types)], ["check", "create", "external", "obsidian", "openNote", "pick", "setup"].sort()
    .filter((t) => types.includes(t)));
  assert.ok(types.length > 0);
  const css = fs.readFileSync(path.resolve(__dirname, "../../media/panel.css"), "utf8");
  assert.doesNotMatch(css, /url\(|@import/);
});

test("nothing of a note reaches the page unescaped", () => {
  const html = body(fileView());
  assert.doesNotMatch(html, /<img|<script|<b>/);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const other = body({ kind: "note", id: 9, folder: `C:/v/${EVIL}`, linkTo,
    note: parseOtherNote(`Concept ${EVIL}`, "/v/c.md", `---\ntype: concept\nwritten_by: argus\n---\n# T ${EVIL}\n\n<script>x</script> [[Concept - x]]`) });
  assert.doesNotMatch(other, /<img|<script/);
  assert.ok(other.includes('<a data-note="Concept - x">'));
  assert.ok(other.includes('data-obsidian="9"'));
  for (const view of [{ kind: "message", text: EVIL, button: "create" }, { kind: "duplicates", file: EVIL, notes: [{ id: 1, name: EVIL, folder: EVIL }] },
    { kind: "places", name: EVIL, places: [{ id: 2, name: EVIL, folder: EVIL }] }] as View[]) {
    const out = body(view, EVIL);
    assert.doesNotMatch(out, /<img/);
    assert.ok(out.includes("&lt;img"));
  }
});

test("a file view: summary, badge, each block with its state in words, the selected rows, links, unexplained lines", () => {
  const html = body(fileView());
  assert.ok(html.includes("2 blocks current"));
  assert.ok(html.includes("1 line unexplained"));
  assert.ok(html.includes("not checked"));
  assert.ok(html.includes("no check has been run"));
  assert.ok(html.includes('<span class="state">current</span>'));
  assert.ok(html.includes('<span class="state">current (masked)</span>'));
  assert.ok(html.includes('<a data-note="Concept - x">'));
  assert.ok(!html.includes('data-note="Concept - gone"'), "a name the index does not know is text, not a link");
  assert.ok(html.includes('<a data-href="https://example.com/x">'));
  assert.ok(html.includes("line 6"), "the unexplained line inside the selection is named");
  assert.ok(html.includes('data-msg="create"'));
  assert.ok(html.includes('data-msg="check"'));
  assert.ok(html.includes('data-obsidian="4"'));
  assert.ok(!html.includes("hunter2-secret"), "the editor's text is never shown");
  assert.ok(html.includes("[masked]"));
  assert.equal((html.match(/class="selected"/g) ?? []).length, 4);

  const one = body(fileView({ selection: { from: 2, to: 2 } }));
  assert.equal((one.match(/class="selected"/g) ?? []).length, 1);
  assert.ok(!one.includes("keeps a key"), "a block outside the selection is not shown");
  assert.ok(!one.includes('data-msg="create"'), "nothing to create for lines that are explained and current");

  const whole = body(fileView({ whole: true, selection: undefined }));
  assert.ok(whole.includes("In one sentence"));
  assert.ok(whole.includes("keeps a key") && whole.includes("adds"));
});

test("changed, spaces-only, ambiguous, matching, cannot be read, problems: each is said in words", () => {
  const note = fileNote();
  const changed = body(fileView({ note, assignment: runToEnd(assign(note, ["def a():", "    return 2", "", "def b():", "    key = \"k\"   "])) }));
  assert.ok(changed.includes('<span class="state">changed</span>'));
  assert.ok(changed.includes("written for earlier code"));
  const spaces = body(fileView({ note, assignment: runToEnd(assign(note, ["def a():  ", "    return '<script>alert(1)</script>'"])), selection: { from: 1, to: 1 } }));
  assert.ok(spaces.includes("differs only in spaces at line ends"));
  const twice = [...TEXT.slice(0, 2), "", "", ...TEXT.slice(0, 2)];
  const lone = parseFileNote("N", "/n/N.md", ["---", "type: file", "written_by: argus", "source: a.py", "depth: map", "---", "## Code and explanation", "",
    "### Block 1: adds (lines 3-4)", "", "```py", ...TEXT.slice(0, 2), "```", "", "It adds."].join("\n"));
  const ambiguous = body(fileView({ note: lone, assignment: runToEnd(assign(lone, twice)), selection: { from: 1, to: 1 } }));
  assert.ok(ambiguous.includes('<span class="state">ambiguous</span>'));
  assert.ok(ambiguous.includes("lines 1 and 5"));
  const matching = body(fileView({ assignment: undefined, matching: 3 }));
  assert.ok(matching.includes("matching… 3 blocks done"));
  const broken = body(fileView({ note: { ...note, problems: ["block 2 has no code fence"] } }));
  assert.ok(broken.includes("cannot be read"));
  assert.ok(broken.includes("block 2 has no code fence"));
  assert.ok(!broken.includes('<span class="state">'));
  assert.ok(body(fileView({ problems: ["Out: its source names no file under the source root: '../x.py'"] })).includes("../x.py"));
});

test("the first-use view, the duplicate notes and the places of a name", () => {
  const setup = body({ kind: "message", text: "Choose the notes folder", button: "setup" });
  assert.ok(setup.includes('data-msg="setup"') && setup.includes("Choose the notes folder"));
  const twice = body({ kind: "duplicates", file: "a.py", notes: [{ id: 1, name: "A", folder: "C:/v/P" }, { id: 2, name: "B", folder: "C:/v/Q" }] });
  assert.ok(twice.includes('data-pick="1"') && twice.includes('data-pick="2"') && twice.includes("C:/v/Q"));
  const places = body({ kind: "places", name: "Concept - x", places: [{ id: 5, name: "Concept - x", folder: "C:/v/A" }] });
  assert.ok(places.includes('data-pick="5"') && places.includes("C:/v/A"));
  assert.ok(body({ kind: "message", text: "x" }, "this kind of address is not opened from a note: command:x").includes("not opened from a note"));
});

test("the Code column of the line table is the code, letter for letter: Markdown in it is not read", () => {
  const note = parseFileNote("N", "/n/N.md", ["---", "type: file", "written_by: argus", "source: a.py", "depth: full", "---",
    "## Code and explanation", "", "### Block 1: labels (lines 1-3)", "", "```py", 'label = "**bold**"', "see = '[[Concept - x]] _a_ <b>'", "p = a + b", "```", "",
    "| Line | Code | What happens | Real value |", "| --- | --- | --- | --- |",
    '| 1 | `label = "**bold**"` | sets a **strong** word | `"**bold**"` |',
    "| 2 | `` see = '[[Concept - x]] _a_ <b>' `` | names [[Concept - x]] | *none* |",
    "| 3 | p = a + b **c** | written without backticks | none |", ""].join("\n"));
  const html = body({ kind: "file", file: "a.py", note, noteId: 1, selection: undefined, whole: true,
    assignment: runToEnd(assign(note, ['label = "**bold**"', "see = '[[Concept - x]] _a_ <b>'", "p = a + b"])),
    badge: { label: "not checked" }, linkTo, problems: [] });
  assert.ok(html.includes('<td><code>label = &quot;**bold**&quot;</code></td>'), html);
  assert.ok(html.includes("<td><code>see = &#39;[[Concept - x]] _a_ &lt;b&gt;&#39;</code></td>"), html);
  assert.ok(html.includes("<td><code>p = a + b **c**</code></td>"), "a cell that is not one code span is shown as written");
  // The other columns are prose: Markdown, as before.
  assert.ok(html.includes("<strong>strong</strong>"));
  assert.ok(html.includes('<a data-note="Concept - x">'));
  assert.ok(html.includes("<em>none</em>"));
  assert.ok(html.includes('<pre><code>label = &quot;**bold**&quot;\n'));
});

test("no note and duplicate notes: the Problems fold says why a note of the project is not used, escaped", () => {
  const why = `Link: its real path is outside the notes folder and the vault folder: 'C:/else/${EVIL}.md'`;
  const fold = '<details data-fold="problems"><summary>Problems: 1 note of this project not used</summary>';
  const none = body({ kind: "message", text: "No note: no Argus note explains a.py.", button: "create", problems: [why] });
  assert.ok(none.includes("No note") && none.includes('data-msg="create"'));
  const twice = body({ kind: "duplicates", file: "a.py", notes: [{ id: 1, name: "A", folder: "C:/v/P" }, { id: 2, name: "B", folder: "C:/v/Q" }],
    problems: [why, "Other: its source names no file under the source root: '../x.py'"] });
  assert.ok(twice.includes('data-pick="1"') && twice.includes('data-pick="2"'));
  assert.ok(twice.includes("Problems: 2 notes of this project not used") && twice.includes("../x.py"));
  for (const html of [none, twice]) {
    assert.ok(html.includes("is outside the notes folder and the vault folder"), "the reason is shown");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && !html.includes("<img"), "escaped");
  }
  assert.ok(none.includes(fold));
  // The same fold as in the view of a file's note.
  assert.ok(body(fileView({ problems: [why] })).includes(fold));
  // No problems: no fold.
  assert.ok(!body({ kind: "message", text: "x", button: "create", problems: [] }).includes("<details"));
  assert.ok(!body({ kind: "duplicates", file: "a.py", notes: [] }).includes("<details"));
});

test("a file without one note to show: no note with Create, or the duplicates to pick from, each with the project's problems", () => {
  const problems = ["Link: its real path is outside the notes folder and the vault folder"];
  const none = withoutNote("src/a.py", [], problems);
  assert.deepEqual(none, { kind: "message", text: "No note: no Argus note explains src/a.py.", button: "create", problems });
  assert.ok(body(none).includes("outside the notes folder"));
  const notes = [{ id: 1, name: "A", folder: "C:/v/P" }, { id: 2, name: "B", folder: "C:/v/Q" }];
  const twice = withoutNote("src/a.py", notes, problems);
  assert.deepEqual(twice, { kind: "duplicates", file: "src/a.py", notes, problems });
  assert.ok(body(twice).includes("outside the notes folder") && body(twice).includes("Duplicate notes: 2 notes"));
});
