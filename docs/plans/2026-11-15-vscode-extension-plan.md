# Argus for VS Code: implementation plan (version 3.0)

## Status

- 2026-11-15: first version, written after the design stage closed (design note revision 11, ten Codex rounds). Not yet reviewed.
- 2026-11-15: revision 2, after Codex review round 1 (1 P1, 7 P2, 1 P3; all accepted; the carried design finding was confirmed fixed). See "Review round 1" at the end.
- 2026-11-15: revision 3, after Codex review round 2 (no P1; 3 P2, all accepted). See "Review round 2" at the end.
- 2026-11-15: revision 4, after Codex review round 3 (no P1; 2 P2, both accepted). See "Review round 3" at the end.
- 2026-11-15: revision 5, after Codex review round 4 (1 P1, 1 P2, both accepted; the round 3 fixes hold). See "Review round 4" at the end.
- 2026-11-15: revision 6, after Codex review round 5 (no P1; 2 P2, both accepted; the generation fix holds). See "Review round 5" at the end.
- 2026-11-15: revision 7, after Codex review round 6 (no P1; 1 P2, accepted; the range fix holds). The design's "Large files" rule was restated in design revision 13, because a cost linear in the file cannot be promised for a block with many different masked lines. See "Review round 6" at the end.
- 2026-11-15: revision 8, after Codex review round 7 (no P1; 2 P2, both accepted; the search order follows design revision 13). See "Review round 7" at the end.
- 2026-11-15: revision 9, after Codex review round 8 (no P1; 1 P2, accepted; the note-revision fix holds). See "Review round 8" at the end.
- 2026-11-15: revision 10, after Codex review round 9 (no P1; 1 P2, accepted; the round 8 cases now agree with the checker). See "Review round 9" at the end.
- Design: `docs/design/2026-11-15-vscode-extension-design.md`. This plan builds exactly that design; where the two differ, the design wins and the plan is wrong.
- Carried from the design review: P2 FIXED design round 10 #1 (Python runtime in the checker's fingerprint, skill 2.9.1), to be confirmed by the review of this plan.

## Codex review records

| Round | Outcome | Disposition |
|---|---|---|
| 1 | P0=0 P1=1 P2=7 P3=1, coverage complete. Carried item (design round 10 #1) confirmed fixed | All 9 accepted; revision 2 |
| 2 | P0=0 P1=0 P2=3 P3=0, coverage complete | All 3 accepted; revision 3 |
| 3 | P0=0 P1=0 P2=2 P3=0, coverage complete | Both accepted; revision 4 |
| 4 | P0=0 P1=1 P2=1 P3=0, coverage complete | Both accepted; revision 5 |
| 5 | P0=0 P1=0 P2=2 P3=0, coverage complete | Both accepted; revision 6 |
| 6 | P0=0 P1=0 P2=1 P3=0, coverage complete | Accepted; revision 7 and design revision 13 |
| 7 | P0=0 P1=0 P2=2 P3=0, coverage complete | Both accepted; revision 8 |
| 8 | P0=0 P1=0 P2=1 P3=0, coverage complete | Accepted; revision 9 |
| 9 | P0=0 P1=0 P2=1 P3=0, coverage complete | Accepted; revision 10 |

## What is built

A VS Code extension in `vscode/` of the Argus repository. Nine pieces, in this order; each ends with its tests passing and a commit.

| # | Piece | Files | Depends on |
|---|---|---|---|
| 1 | Read a note | `src/core/notes.ts` | nothing |
| 2 | Assign blocks to text | `src/core/match.ts` | 1 |
| 3 | Paths, links, Markdown | `src/core/projects.ts`, `links.ts`, `markdown.ts` | 1 |
| 4 | Index, commands, panel | `src/index.ts`, `extension.ts`, `panel.ts`, `media/` | 1 to 3 |
| 5 | Markers and CodeLens | `src/markers.ts` | 4 |
| 6 | Check | `src/check.ts`, `scripts/` (copied) | 4 |
| 7 | Create | `src/create.ts` | 6 |
| 8 | Concept notes, Obsidian | `src/panel.ts`, `links.ts` | 4 |
| 9 | Package | `package.json`, `README.md`, `.vscodeignore` | all |

## Tools and layout

| Choice | Value | Reason |
|---|---|---|
| Language | TypeScript, strict mode, compiled with `tsc` to `vscode/out/` | No bundler: no runtime dependency to bundle |
| VS Code engine | `^1.90.0` | Webview views, workspace trust and `shellPath` terminals are all older than that |
| Runtime dependencies | None | Design decision |
| Development dependencies | `typescript`, `@types/vscode`, `@types/node`, `@vscode/vsce` | Compile, types, package |
| Tests | Node's own runner: `node --test out/test/` on the compiled core tests. No VS Code test host | Owner rule: small tests next to the code, no test machinery |
| Checker | `vscode/scripts/check_notes.py` and `_common.py`, copied from `skills/argus/scripts/` by `npm run copy-checker` at build time, never edited | One authority on validity |

```
vscode/
  package.json  tsconfig.json  README.md  .vscodeignore
  src/core/     notes.ts match.ts projects.ts links.ts markdown.ts   (no import of "vscode")
  src/          extension.ts index.ts panel.ts markers.ts check.ts create.ts
  src/test/     notes.test.ts match.test.ts projects.test.ts links.test.ts markdown.test.ts core-is-pure.test.ts
  media/        panel.css panel.js
  scripts/      check_notes.py _common.py        (copied at build)
```

## Shapes (in `src/core/notes.ts`)

```ts
export interface NoteProps { writtenBy: string; type: string; project?: string; source?: string;
  commit?: string; depth?: "map" | "full";
  maskedRanges: [number, number][]; }   // as written: "3, 7-9" is [[3,3],[7,9]]; never expanded into single numbers
export function isMasked(props: NoteProps, line: number): boolean   // true when a range holds the line
export interface LineRow { from: number; to: number; code: string; what: string; value: string; }
export interface Block { id: string; purpose: string; from: number; to: number;   // recorded lines, 1-based
  code: string[];            // the lines of the first fence
  rows: LineRow[];           // depth full
  prose: string;             // every other piece of the block's text after its code, as Markdown, in order:
                             // the sentences (depth map), and any table that is not the line table, such as
                             // the "Part of line n" tables the template allows under a line table
  concepts: string[]; }      // [[links]] of the block
export interface FileNote { name: string; path: string; props: NoteProps; lens: [string, string][];
  blocks: Block[]; problems: string[]; }            // problems: why a part could not be read
export interface OtherNote { name: string; path: string; props: NoteProps; body: string; }
```

## Piece 1: read a note (`notes.ts`)

| Function | Behaviour |
|---|---|
| `parseProps(text)` | The properties between the first two `---` lines. `masked_lines: 3, 7-9` becomes the ranges `[[3,3],[7,9]]`: at most one pair per item written, whatever the numbers, so `1-1000000000` costs one pair. `isMasked(props, line)` looks the line up in the ranges; nothing ever builds a set of all masked line numbers. Line endings CRLF, LF and CR are all accepted |
| `fenceMask(lines)` | True for fence lines and lines inside a fence; a fence closes only on a fence at least as long. Same rule as `fence_mask` in `check_notes.py` |
| `parseFileNote(name, path, text)` | Level 1 lens rows; block headings matched by the same pattern as `BLOCK` in `check_notes.py`, outside fences only; the first fence after a heading is the code; table rows whose first cell is a line number or range are line rows (cells split on `|` not preceded by `\`). Everything else that follows the code inside the block is kept, in order, in `prose`: sentences, further tables (with their header rows) and further fences. Nothing of a block's text is dropped: `rows` plus `prose` hold all of it, and the panel renders the line table first, then `prose`. Anything that cannot be read goes into `problems`, and the note is shown as "cannot be read", never guessed at |
| `parseOtherNote` | Properties and body, for Concept, Library, Mechanism and Start Here notes |

Tests (`notes.test.ts`), each on a note text written in the test:

| Test | Asserts |
|---|---|
| a full-depth note | block ids, ranges, code lines and line rows equal the expected ones |
| a block with a "Part of line 12" table under its line table | the line rows are the numbered rows only; the extra table, with its header, is in `prose` and comes out of `render` as a table |
| a `##` and a `### Block` line inside a code fence | they are code, not headings |
| a four-backtick fence holding a three-backtick line | one fence |
| tables with other spacing (`\|1\|`, `\|  1  \|`) | the same rows |
| `\|` inside a code cell | stays in the cell, comes out as `|` |
| CRLF and CR-only text | the same result as LF |
| a note without `written_by: argus` | not indexed |
| `masked_lines: 1-1000000000` | parsed at once into one range; `isMasked` answers for any line; memory use does not grow with the range |
| agreement with the checker | For sample notes written to disk in the test's setup (skipped when Python is missing): the checker's `--json` result names each note under `explained` for its source, and its INFO line gives the number of blocks; the core finds the same source and the same number of blocks. Block ids, ranges and code are asserted against values written in the test, not against the checker, which does not print them |

## Piece 2: assign blocks to text (`match.ts`)

```ts
export type BlockState = "current" | "current-masked" | "changed" | "ambiguous";
export interface Placed { block: Block; state: BlockState; at?: { from: number; to: number };  // lines in the text now
  spacesOnly?: boolean; candidates?: number[]; }
export interface Assignment { placed: Placed[]; unexplained: [number, number][]; }   // ranges of non-blank lines
export function assign(note: FileNote, textLines: string[]): Assignment
```

| Step | Rule |
|---|---|
| Line equality | `sameLine(noteLine, textLine, lineNo, props)`, the checker's code-fence comparison step for step (`check_notes.py`, the loop over `zip(code, want)`): (1) the two strings are equal: match. (2) The note line holds no `[masked]`: no match. (3) `isMasked(props, lineNo)` is false: no match. (4) `pyStrip(noteLine)` is exactly `[masked]`: match, whatever the text line (so an indented `    [masked]` is a whole-line mask too). (5) `pyStrip` of the note line with every `[masked]` removed is empty (for example ` [masked][masked] `): no match. (6) Otherwise `maskedMatch(noteLine, textLine)` decides. The text line has its line ending removed first; nothing else is changed |
| `pyStrip` | Removes from both ends exactly the characters Python's `str.strip()` removes, because the checker uses that: U+0009 to U+000D, U+001C to U+001F, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000. JavaScript's own `trim()` is not used anywhere in `match.ts`: its set differs (it removes U+FEFF and keeps U+001C to U+001F and U+0085). Every place in the matching rules that says "white space" or "trimmed" means this function |
| `maskedMatch` | No regular expression. The note line is cut at each `[masked]` into literal pieces `p0 … pk`. The text line matches when: it starts with `p0`; it ends with `pk`; and, going left to right, each middle piece is found (with `indexOf`) at the earliest place that leaves at least one character after the end of the piece before it; and `pk`, as the ending, starts at least one character after the end of the piece before it. Taking the earliest place for each piece is enough: if any placement exists, the earliest one does. This is the same language as the checker's expression (`mask_pattern`: the pieces joined by "one or more characters", anchored at both ends), without backtracking: the time is proportional to the line's length. A line longer than 10,000 characters is compared in steps, with a yield between steps |
| Candidates | For each block, every start line where all its lines match in order, the mask permission of each line taken from its recorded line number (`block.from + k`). No candidate is ever dropped and there is no cap. Each line of a block is one of three kinds: **exact** (it must equal the text line), **any** (its line is declared and, trimmed, it is exactly `[masked]`: it matches every line), **pattern** (its line is declared, it holds a mask, and with the masks removed some text other than white space is left), **never** (it holds a mask but is not declared, or only masks and white space are left and it is not a single mask: it can match only a text line equal to it, so it is treated as an exact line). Every distinct line string of text and note is numbered once, so comparing exact lines is comparing numbers. The search for a block goes from cheap to dear and stops narrowing as soon as nothing is left: (1) **the longest run of exact lines** is searched in the text's number sequence with the Knuth-Morris-Pratt method: time (text lines + run length), whatever repeats; its fits give the first set of starts. A block with no exact line starts from all starts that leave room for it, taken directly. (2) **The other exact lines** are compared, as numbers, only at the starts still in the set. (3) **Pattern lines** are tested only at the starts still in the set, each test remembered by (pattern, text line) so that no pair is tested twice in the whole note. (4) **any** lines are never compared |
| Assignment | Blocks in the order of their recorded `from`. Dynamic programming over (block index, candidate): a block may be placed at a candidate that starts after the end of the previous placed block, or left unplaced. Best = most blocks placed; among those, the smallest sum of distances between placed start and recorded `from` |
| Ambiguous | After the best is found: for each placed block, if another best solution (same count, same sum) places it elsewhere, its state is `ambiguous` and `candidates` lists the places. Found by counting best solutions per (block, candidate) in the same table |
| Changed | A block left unplaced. Its marker place: the first start line where the block matches with spaces at line ends ignored (`spacesOnly: true`), else its recorded lines clipped to the text |
| Masked | A placed block with at least one line matched through a mask is `current-masked` |
| Unexplained | Non-blank text lines outside every placed block of state `current` or `current-masked` |
| Cost | A block without masks: (text lines + block lines) for the run search, then nothing more: linear, as the design requires. A block with masks: the run search, plus (starts left) times (its other lines). In ordinary files the run search leaves one or two starts, so the rest is small. The worst case is a block with no exact run, or with a run that fits almost everywhere, and many different pattern lines: then the work can reach (text lines) times (pattern lines), and no method avoids that for arbitrary patterns. The checker's limit (masks on at most a quarter of a file's lines) bounds it but does not make it small. Design revision 13 states this bound instead of "linear" for blocks with masks, and requires what the next row gives |
| Never stalls | `assign` is a generator: it does its work in slices and yields after every 2 milliseconds of work; no single step between two yields can be long, because every comparison is linear in the line (`maskedMatch`) and long lines are stepped. The caller (`markers.ts`, `panel.ts`) runs the slices with `setImmediate` between them, so typing and scrolling stay live however long a match takes. Each run is tied to three things: the document (its URI), the document's version, and the note's revision (a number the index raises whenever it re-reads that note; a replaced or removed note has another revision or none). A new run starts when any of the three changes; the old run stops at its next yield; a finished run's result is published only when all three are still the same. While a file is still being matched, its markers are those of the last published run and the panel says "matching…" with the number of blocks done. The core's tests call the generator to its end |

Tests (`match.test.ts`):

| Test | Asserts |
|---|---|
| unchanged file | every block `current` at its recorded lines; nothing unexplained |
| 100 lines inserted at the top | every block `current`, 100 lines lower |
| two identical blocks recorded at 10 and 100, 100 lines inserted above | first at 110, second at 200, neither ambiguous |
| a block's code changed | that block `changed`; the others `current` |
| a new function between two blocks | both blocks `current`; the new lines `unexplained` |
| a spaces-only difference at a line end | `changed` with `spacesOnly` and the marker at the right place |
| a masked line, declared | `current-masked` |
| a block whose first line is masked (`token = "[masked]"`) | found through a later, unmasked line; `current-masked` |
| a block of masked lines only, declared | found by trying every start line; `current-masked` |
| 20,000 identical lines, a block of 5,000 of them | finishes within one second; the candidates are all 15,001 starts; with a second identical block the order rule places both |
| 20,000 lines, a declared block of 5,000 lines that are all `[masked]` alone | finishes within one second; 15,001 candidates, found without comparing lines |
| a block of 2,000 pattern lines (`key = "[masked]"`) in 20,000 lines | finishes within one second |
| 5,000 different pattern lines in 20,000 lines, no exact line (the worst case) | the generator yields at least every few milliseconds of work (measured between yields); stopping it after the first yield leaves no result and no error; run to its end it gives the right answer |
| an edit during a long match | the first run stops at its next yield; only the second run's result is used |
| the note is replaced during a long match, the document untouched | the run for the old note is not published; a new run uses the new note |
| `sameLine` against the checker, step by step | the same answers as the checker's comparison on a table of cases: equal lines with and without `[masked]` in them; a mask on an undeclared line; `[masked]` alone; `    [masked]` (indented) against any line: match; a non-breaking space or a form feed before `[masked]` (U+00A0, U+000C) against any line: match; U+FEFF before `[masked]`: not a whole-line mask; ` [masked][masked] ` against ` ab `: no match; one mask, several masks, a mask at the start, at the end, pieces that repeat, an empty gap (no match), the piece order reversed (no match). When Python is present the test also runs the checker's own functions on the same table and compares |
| `x[masked]x[masked]x[masked]x[masked]Z` against 400 `x` followed by `Y` | answers "no match" in well under a millisecond (the case that took a regular expression 339 ms) |
| a block with a masked line in the middle and repeated unmasked runs | only the starts where both runs fit are candidates |
| a note line with `[masked]` not declared in `masked_lines`, text differs | `changed` |
| source text that itself says `[masked]`, copied exactly | `current`, not masked |
| a block that appears twice in the text, recorded line half-way between, no neighbour to decide | `ambiguous` with both candidates |
| CRLF text against an LF note | `current` |

## Piece 3: paths, links, Markdown

| File | Function | Behaviour |
|---|---|---|
| `projects.ts` | `projectFor(filePath, projects)` | Real paths; on Windows compared without regard to letter case and with `\` as `/`; the project whose `sourceRoot` contains the file, the longest root first; `undefined` when none |
| | `sourceInRoot(root, source)` | The note's `source` resolved against the root: the path relative to the root when the result is a file inside it, else `undefined`. Same rule as `on_disk` in `_common.py` |
| `links.ts` | `findLinks(text)` | `[[Name]]`, `[[Name\|shown]]` and `[[folder/Name]]` outside code spans; returns names |
| | `resolveLink(name, projectNotes, vaultNotes)` | The project's own note first; else the vault's when exactly one has that name; else the list of places |
| `markdown.ts` | `render(text, linkTo)` | HTML for the subset the notes use: headings, paragraphs, tables, fenced code (Mermaid shown as code), bold, italic, inline code, `[[links]]` turned into `<a data-note="...">`. Any other link becomes its text followed by its address in full, as `<a data-href="...">`: nothing opens by itself; a click sends the address to the extension (piece 4, message `external`). Every piece of text is HTML-escaped before any tag is added; no raw HTML passes through |

Tests: Windows and POSIX paths, a `..` that stays inside and one that leaves the root, another letter case; a link inside a code span is not a link; `<script>` and `<img onerror>` in a note come out escaped; a table with an escaped `\|`. `core-is-pure.test.ts` reads every file of `src/core` and fails when one imports `vscode`.

## Piece 4: index, commands, panel

| Part | Behaviour |
|---|---|
| Settings (`package.json` `contributes.configuration`) | `argus.projects` (array of `{sourceRoot, notesFolder, vaultFolder?, graph?}`), `argus.createCommand` (array of strings), `argus.createDepth`, `argus.python`. `capabilities.untrustedWorkspaces`: `{"supported": "limited", "restrictedConfigurations": ["argus.createCommand", "argus.python", "argus.projects"], "description": ...}` |
| Reading settings | `argus.createCommand` and `argus.python`: `inspect().globalValue`; when the user has set none, the extension's own constants `DEFAULT_CREATE_COMMAND` and `DEFAULT_PYTHON` (the values the design gives). The workspace value and the workspace-folder value are never read for these two. `argus.projects`: the effective value, which in Restricted Mode is the user's own |
| First use | When the open file belongs to no project and `argus.projects` is empty, the panel shows "Choose the notes folder". The button opens a folder picker (`window.showOpenDialog`, folders only) and writes one entry to the user's settings (`ConfigurationTarget.Global`): `sourceRoot` the first workspace folder, `notesFolder` the picked folder. Asked once: after an entry exists, the panel only says "not in an Argus project" for files outside it |
| `index.ts` | For each project: read every `.md` under `notesFolder` (folders starting with a dot skipped) with `written_by: argus`; when `vaultFolder` is set, also the Concept and Library notes with that property in the vault. Every indexed note gets an id: a number given by the index to its real path, stable while the extension runs, and a revision: a number raised each time the index re-reads the note. Two `FileSystemWatcher`s per project (notes, vault); a change re-reads the changed file after 300 ms of quiet. `refreshNow(project)` reads the project's folders from disk at once and resolves when the index is up to date; anything that must not act on an old index awaits it. Exposes `fileNotesFor(project, sourceRel)` (zero, one or several), `notesByName(name)` (zero, one or several) and `noteById(id)` |
| Commands | `argus.explainSelection`, `argus.explainFile`, `argus.create`, `argus.check`, `argus.refresh`, `argus.openInObsidian`; `explainSelection` also in `editor/context` |
| `panel.ts` | A `WebviewViewProvider` in the side bar (view container "Argus"). HTML built in the extension with `markdown.render`; CSP `default-src 'none'; style-src ${cspSource}; img-src ${cspSource}; script-src 'nonce-...'`; `localResourceRoots: [media]`; `enableScripts: true`. `media/panel.js` only sends the five allowed messages and handles folding |
| Messages | `{type: "openNote", name}`, `{type: "pick", id}`, `{type: "obsidian", id}`, `{type: "external", href}`, `{type: "create"}`, `{type: "check"}`, `{type: "setup"}`. The handler checks `type` against that list; anything else is dropped. `openNote` carries a name from a link: one note of that name is shown; several: the panel lists them, each with its folder and its id. `pick` and `obsidian` carry an id from such a list or from the note being shown: the handler looks the id up in the index (an unknown id is dropped) and tests again that the note's real path lies inside the project's notes folder or vault folder before reading or opening it. `external`: the address must be one that appears in the note being shown. Then, by scheme: `http`, `https` and `mailto` go to `env.openExternal`, which shows VS Code's own prompt for a place it does not trust; `obsidian` goes to `env.openExternal` as well; `file` asks first, in a modal that shows the whole path, and opens only on "Open"; every other scheme (`command`, `vscode`, `javascript`, `data` and the rest) is refused, and the panel says "this kind of address is not opened from a note" with the address. A refusal is always shown, never silent |
| Selection to blocks | On `explainSelection` and on selection change while the panel is visible (after 200 ms of quiet): `assign` on the editor's text, blocks overlapping the selection (an empty selection is the cursor's line), unexplained ranges inside it |
| States shown | Exactly the table "States" of the design, with a text label for each (never colour alone) |
| Before a check or a fingerprint call | `await index.refreshNow(project)` as well, so the panel and the checker speak of the same notes |
| Check details | Under the badge, whenever a check result is stored, whatever the badge: "the graph covers N of M explained files" (`graph.covered`, `graph.not_covered`; "graph not used" when `graph.used` is false); the masked lines of this note (`masked_lines[note]`, the line numbers) with the sentence "confirm each hides a secret and nothing else"; the warnings, first those about this note, then those about the graph, then the others, folded when more than three; the stale entries. A success badge is never shown without this block |

Done when, by hand in the Extension Development Host with the notes folder of the two sample files: selecting lines of a file with a note shows the right block and its state; a file with no note says so; an edit that changes a block turns it "changed" without saving.

## Piece 5: markers and CodeLens (`markers.ts`)

Four `TextEditorDecorationType`s (current, changed or ambiguous, unexplained, masked sign in the gutter), set from the `Assignment` of the visible editors, refreshed after 300 ms of quiet on edits. A `CodeLensProvider` puts the block's purpose above the first line of each placed block; its command opens the panel on that block.

## Piece 6: check (`check.ts`)

| Part | Behaviour |
|---|---|
| Trust | Every start of the checker (the check, the fingerprint on activation, the fingerprint after an event) first tests `workspace.isTrusted`. Not trusted: nothing is run and the badge is "not checked: this window is in Restricted Mode". `workspace.onDidGrantWorkspaceTrust` starts the pending fingerprint calls. The same guard covers the `git` calls below |
| Run | `child_process.execFile(python, ["-B", checker, "--json", "--notes", notesFolder, "--source", sourceRoot, "--scope", sourceRel, ...(vault ? ["--vault", vault] : []), ...(graph ? ["--graph", graph] : ["--no-graph"])])`, no shell, 120 s limit, output up to 20 MB |
| Outcome | In the design's order: start failure, signal, exit code other than 0 or 1, or output that does not parse as the expected object: "check error". Exit 1: "check failed", entries grouped by `fails[].note` equal to this note, `fails[].graph`, others, plus `missing`. Exit 0 and `result === "PASS"`: "checked" when the file is in `graph.covered`, "checked, not in the graph" when in `graph.not_covered`. Exit 0 and `result === "PASS WITHOUT THE GRAPH CHECK"`: "checked without graph" |
| Generation | Each project has a counter, its input generation. Every event that can change what the checker reads adds one to it: a note or vault file event, a source file event, a graph file event, a git event, a settings change, a window-focus return, a finished Create. Every check and every fingerprint call notes the generation when it starts |
| Stored | In `workspaceState`, keyed by project and source: the result object and the time. A check's result is stored and shown only when the project's generation is still the one noted at its start. When the generation has moved on, the result is thrown away, the badge stays "not checked", and a new fingerprint call for the current generation is due (after the usual 1500 ms of quiet). The same rule holds for a fingerprint answer: an answer for an older generation neither confirms nor deletes anything; only an answer for the current generation does. So a slow check that started before a change can never bring "checked" back after it |
| Still valid | The same command with `--fingerprint` in place of `--json`. The fingerprint is the authority; events only decide when to ask. Asked: on activation for the files that have a stored result; when the window gets the focus back (`window.onDidChangeWindowState`), which covers changes no watcher saw; and 1500 ms after the last event from the notes watcher, the vault watcher, a watcher on the source root, a watcher on the graph file, the git watchers, or a settings change. Git watchers: the extension asks git where the repository keeps its data (`git -C <sourceRoot> rev-parse --absolute-git-dir` and `--git-common-dir`, run with `execFile`), so a source root that is a subfolder of a repository, or a worktree, is handled; it watches `HEAD`, `refs/**`, `packed-refs` and `shallow` in both folders. No git, or not a repository: no git watchers. While a call is pending or after it failed: "not checked". A value other than the stored `fingerprint`: the stored result is deleted |
| Never | Changing a note |

The generation rule lives in a small class without `vscode` imports (`src/core/validity.ts`: `begin()` returns the generation, `changed()` adds one, `accept(startedAt)` says whether a finished call may be used), tested on these orders of events: check starts, input changes, fingerprint for the new state finishes, the old check finishes last: its pass is not stored; two fingerprint calls finish in the wrong order: only the one for the current generation counts; a change during a check leaves the state "not checked" until a call for the current generation answers. The parsing of the result and the mapping to states live in functions without `vscode` imports (`src/core/checkResult.ts`: `stateOf(exit, stdout, sourceRel)` and `detailsOf(result, noteName)` for the Check details block), tested on recorded JSON: a pass with the file covered, a pass with it not covered, a pass without graph, a pass with warnings and masked lines (the details list them), a failure about this note, a failure only about the graph, a failure only about another note, broken JSON, exit code 2. The trust guard is a single function `mayRun()` through which every `execFile` and task start goes; a search of the source for `execFile(` and `executeTask(` outside that path is part of the safety checklist.

## Piece 7: create (`create.ts`)

| Step | Behaviour |
|---|---|
| Guard | Workspace trusted; the file belongs to a project; the document is not untitled |
| Unsaved | `document.isDirty`: a modal with "Save and create" and "Cancel". On the first: `const saved = await document.save()`; when `saved` is false or the document is still dirty, stop with "the file could not be saved; nothing was started". The hash of the saved text is taken only after a successful save |
| Command | `argus.createCommand` from the user's settings; placeholders replaced inside each argument (never joined into one string): `${file}` (path relative to the source root), `${notesFolder}`, `${sourceRoot}`, `${depth}` |
| Terminal | A VS Code task, not a bare terminal: `tasks.executeTask(new Task({type: "argus"}, TaskScope.Workspace, "Argus: create explanation", "argus", new ProcessExecution(args[0], args.slice(1), {cwd: sourceRoot})))` with `presentationOptions` `{reveal: Always, focus: true, panel: Dedicated, close: false}`. `ProcessExecution` starts the program with its argument list and no shell. The task's terminal takes the person's typing, so the agent can ask. `close: false` keeps the terminal and its text after the program ends. The note file's text hash and the source text hash are recorded before the start. The call is awaited inside `try`: when `executeTask` rejects, the running state is cleared and the panel shows "could not start the agent" with the error's message |
| While it runs | Panel state "agent running in the terminal 'Argus'" |
| End | Two events are followed for that task execution. `tasks.onDidEndTaskProcess` gives the exit code when the program ends; the terminal stays open. `tasks.onDidEndTask` fires when the task is over, with or without a process: when it arrives and no process end was seen, the program never started or the task was stopped: the running state is cleared and the panel says "the agent did not run: the task ended without starting the program". With an exit code: undefined or not 0: "the agent stopped with an error; its output is in the terminal 'Argus: create explanation'". With exit code 0: first `await index.refreshNow(project)`, so the notes the agent wrote in its last moment are in the index, and take the note file's text hash from disk; then, no File note for the file or its hash equal to the one recorded before the start: "the agent finished without writing the note"; else run the check (piece 6) and show its state. The running state is cleared on every one of these paths |
| Program missing | The task ends at once with a failure to start: reported as "could not start <program>; see the setting argus.createCommand". Before starting, the program is looked up on PATH (or as a path) so the usual case is reported without starting anything |

## Piece 8: Concept notes and Obsidian

A click on a `data-note` link sends `openNote`; the handler resolves it with `resolveLink` and renders that note in the panel with a "back" entry (a stack kept in the provider). "Open in Obsidian" builds `obsidian://open?path=<absolute path, URI-encoded>` and opens it with `env.openExternal`. A name found in several places shows the list, each entry with its folder and its index id; choosing one sends `pick` with that id. "Open in Obsidian" sends `obsidian` with the id of the note shown. Nothing outside the notes folder and the vault folder is ever read or opened: the id is resolved by the index and the real path is tested again.

## Piece 9: package

`npm run package`: `tsc`, `copy-checker`, tests, then `vsce package` giving `argus-3.0.0.vsix`. `.vscodeignore` leaves out `src/`, tests and maps. `README.md`: what it does, the settings, how to install the skill for the agent, the three states of freshness and the validation badges. The `.vsix` is attached to the repository's release, not published to the Marketplace.

## Safety checklist, verified before the package step

| Check | How |
|---|---|
| No shell anywhere | Search the source for `exec(`, `shell: true` and a `spawn` with a string command: none |
| Workspace cannot choose a program | Unit test of the settings reader with a fake `inspect()` result: the workspace value of `argus.createCommand` and `argus.python` is ignored |
| No remote content | The CSP string is asserted in a test of the HTML builder; `panel.js` contains no `fetch`, no `XMLHttpRequest`, no `import(` |
| No raw HTML from notes | `markdown.test.ts` |
| Messages | A test of the handler function with unknown types, unknown ids, an id whose path was moved outside the folders, an `external` address that is not in the note, and each scheme group (opened, asked, refused with a visible reason) |
| Trust | `mayRun()` is the only caller of `execFile` and `executeTask` (source search); with `isTrusted` false nothing is started (test of `mayRun` with a fake workspace) |
| Paths | `projects.test.ts` |

## Reviews

Codex code review (`xreview.sh code`) at three points: after piece 3 (the core), after piece 6, and before the package step, each against this plan and the design. Findings are handled as in the review skill: verified, fixed with a test or rebutted with evidence, recorded here.

## Hand test before release (recorded in the handoff)

With the notes of the helper sample (7 files) and `C:\dev\applexus-chat` as workspace: explain a selection in `errors.js`; edit a line and see "changed"; add a function and see "unexplained"; run the check and see "checked"; break another note and see the badge drop to "not checked", then "check failed" with the other note named; create for a file without a note in a scratch copy of the project, never in the shared repository.

## Review round 1: findings and what changed

| # | Sev | Finding | Change in revision 2 |
|---|---|---|---|
| 1 | P1 | The check and the fingerprint calls had no workspace-trust guard | Row "Trust" in piece 6; one function `mayRun()` in front of every program start; safety checklist row |
| 2 | P2 | Git watchers assumed `sourceRoot/.git` | The git folders are asked from git; subfolder roots and worktrees handled; the fingerprint is also asked when the window regains focus |
| 3 | P2 | Finding candidates by a block's first line missed blocks whose first line is masked | Anchor on the first unmasked line; full scan when every line is masked; two new tests |
| 4 | P2 | `globalValue` is undefined when the user set nothing, so the defaults were lost; the once-only notes-folder prompt had no step | Extension-owned defaults; row "First use" in piece 4 |
| 5 | P2 | A failed save did not stop Create | The save is awaited and must succeed |
| 6 | P2 | The error path pointed at a terminal that was already closed | Create runs as a task with `ProcessExecution` and `close: false`; the end is taken from `onDidEndTaskProcess` |
| 7 | P2 | Graph coverage, warnings and masked lines were not rendered | Row "Check details" in piece 4; `detailsOf` tested; the checker's JSON now lists the masked line numbers per note (skill 2.9.2) |
| 8 | P2 | Links other than wikilinks could not be opened at all | `data-href` links, message `external`, schemes limited, VS Code's own prompt |
| 9 | P3 | The parity test asked the checker for data it does not print | The test compares what the checker prints; ids, ranges and code against values in the test |

## Review round 2: findings and what changed

| # | Sev | Finding | Change in revision 3 |
|---|---|---|---|
| 1 | P2 | `pick` carried only a name, so two notes of one name could not be told apart | Every indexed note has an id tied to its real path; `pick` and `obsidian` carry the id; containment is tested again on use |
| 2 | P2 | A task that fails to start had no completion path; the panel could stay at "agent running" | `executeTask` is awaited in `try`; `onDidEndTask` without a process end clears the state and reports it; every path clears the running state |
| 3 | P2 | Links with schemes other than http, https and obsidian were dropped silently | By scheme: opened through VS Code (http, https, mailto, obsidian), asked first (file), refused with a visible reason (all others) |

## Review round 3: findings and what changed

| # | Sev | Finding | Change in revision 4 |
|---|---|---|---|
| 1 | P2 | Tables under a block other than the line table (the template's "Part of line" tables) had no place in the block model | `prose` keeps everything after the code that is not a line row, in order, tables included; the panel renders it after the line table; a test |
| 2 | P2 | The end of Create looked at an index that could be 300 ms old and report "no note written" | `index.refreshNow(project)` is awaited before the completion rules, and before a check or fingerprint call |

## Review round 4: findings and what changed

| # | Sev | Finding | Change in revision 5 |
|---|---|---|---|
| 1 | P1 | Overlapping calls had no order rule: a check that started before a change could finish last and store its outdated pass | A generation counter per project; a result or a fingerprint answer is used only when the generation is still the one at its start (piece 6 rows "Generation" and "Stored"; `validity.ts` with tests of the event orders) |
| 2 | P2 | Comparing the whole block at every occurrence of one line is quadratic on repetitive files; the design asks for linear matching | Lines become numbers; Knuth-Morris-Pratt search for unmasked blocks and for each unmasked run of a masked block; no caps; a timing test |

## Review round 5: findings and what changed

| # | Sev | Finding | Change in revision 6 |
|---|---|---|---|
| 1 | P2 | A block of masked lines only was matched by trying every start against every line: 75 million comparisons for 5,000 lines in 20,000 | Lines are exact, any or pattern; candidates are a bit array narrowed by run searches and by shifted pattern arrays; `any` lines cost nothing; two timing tests |
| 2 | P2 | `masked_lines: 1-1000000000` would have been expanded into a set of a billion numbers | Ranges are kept as written; `isMasked` looks a line up; a test |

## Review round 6: finding and what changed

| # | Sev | Finding | Change in revision 7 |
|---|---|---|---|
| 1 | P2 | One pass over the text for each distinct masked pattern, and one search for each exact run, is not linear in the file for a block: 5,000 different patterns in 20,000 lines is 100 million tests | The search order is changed (longest exact run first, everything else only at the starts left, each pattern test remembered), which makes ordinary cases cheap. For the true worst case no linear method exists, so the design's rule was restated (design revision 13) and matching became a generator that yields every 2 ms and is dropped when the text changes: the editor cannot stall. Tests for the worst case and for an edit during a match |

## Review round 7: findings and what changed

| # | Sev | Finding | Change in revision 8 |
|---|---|---|---|
| 1 | P2 | One masked comparison used a regular expression that can backtrack for hundreds of milliseconds, inside a slice that cannot yield | `maskedMatch`: literal pieces placed left to right with `indexOf`, the same language as the checker's rule, linear in the line; long lines are stepped; tests for parity with the checker's rule and for the slow case |
| 2 | P2 | A long match was tied to the document version only; a note replaced meanwhile could get the old match published | A run is tied to document, document version and note revision; published only when all three are unchanged; a test |

## Review round 8: finding and what changed

| # | Sev | Finding | Change in revision 9 |
|---|---|---|---|
| 1 | P2 | Two mask rules differed from the checker: a line of only masks and white space was accepted (the checker rejects it), and an indented `[masked]` alone was rejected (the checker accepts it for any line) | `sameLine` is written as the checker's six steps in the checker's order; the line kinds follow from them; the test table holds both cases and, with Python present, is checked against the checker's own functions |

## Review round 9: finding and what changed

| # | Sev | Finding | Change in revision 10 |
|---|---|---|---|
| 1 | P2 | The whole-line-mask step trimmed spaces and tabs only; the checker uses Python's `strip()`, which removes more characters (for example a non-breaking space or a form feed) | `pyStrip` removes exactly Python's set and is the only trimming used in the matching rules; the parity table has those characters and U+FEFF, which JavaScript trims and Python does not |
