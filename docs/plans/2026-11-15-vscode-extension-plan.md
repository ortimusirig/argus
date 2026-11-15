# Argus for VS Code: implementation plan (version 3.0)

## Status

- 2026-11-15: first version, written after the design stage closed (design note revision 11, ten Codex rounds). Not yet reviewed.
- 2026-11-15: revision 2, after Codex review round 1 (1 P1, 7 P2, 1 P3; all accepted; the carried design finding was confirmed fixed). See "Review round 1" at the end.
- Design: `docs/design/2026-11-15-vscode-extension-design.md`. This plan builds exactly that design; where the two differ, the design wins and the plan is wrong.
- Carried from the design review: P2 FIXED design round 10 #1 (Python runtime in the checker's fingerprint, skill 2.9.1), to be confirmed by the review of this plan.

## Codex review records

| Round | Outcome | Disposition |
|---|---|---|
| 1 | P0=0 P1=1 P2=7 P3=1, coverage complete. Carried item (design round 10 #1) confirmed fixed | All 9 accepted; revision 2 |

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
  commit?: string; depth?: "map" | "full"; maskedLines: Set<number>; }
export interface LineRow { from: number; to: number; code: string; what: string; value: string; }
export interface Block { id: string; purpose: string; from: number; to: number;   // recorded lines, 1-based
  code: string[];            // the lines of the first fence
  rows: LineRow[];           // depth full
  prose: string;             // depth map: the explanation as Markdown
  concepts: string[]; }      // [[links]] of the block
export interface FileNote { name: string; path: string; props: NoteProps; lens: [string, string][];
  blocks: Block[]; problems: string[]; }            // problems: why a part could not be read
export interface OtherNote { name: string; path: string; props: NoteProps; body: string; }
```

## Piece 1: read a note (`notes.ts`)

| Function | Behaviour |
|---|---|
| `parseProps(text)` | The properties between the first two `---` lines. `masked_lines: 3, 7-9` becomes a set. Line endings CRLF, LF and CR are all accepted |
| `fenceMask(lines)` | True for fence lines and lines inside a fence; a fence closes only on a fence at least as long. Same rule as `fence_mask` in `check_notes.py` |
| `parseFileNote(name, path, text)` | Level 1 lens rows; block headings matched by the same pattern as `BLOCK` in `check_notes.py`, outside fences only; the first fence after a heading is the code; rows whose first cell is a line number or range are line rows (cells split on `|` not preceded by `\`); other non-table text after the fence is the prose. Anything that cannot be read goes into `problems`, and the note is shown as "cannot be read", never guessed at |
| `parseOtherNote` | Properties and body, for Concept, Library, Mechanism and Start Here notes |

Tests (`notes.test.ts`), each on a note text written in the test:

| Test | Asserts |
|---|---|
| a full-depth note | block ids, ranges, code lines and line rows equal the expected ones |
| a `##` and a `### Block` line inside a code fence | they are code, not headings |
| a four-backtick fence holding a three-backtick line | one fence |
| tables with other spacing (`\|1\|`, `\|  1  \|`) | the same rows |
| `\|` inside a code cell | stays in the cell, comes out as `|` |
| CRLF and CR-only text | the same result as LF |
| a note without `written_by: argus` | not indexed |
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
| Line equality | `sameLine(noteLine, textLine, lineNo, masked)`: equal strings match. Otherwise, only when the note line holds `[masked]` and `lineNo` is in `maskedLines`: a line that is `[masked]` alone matches any line; else the text around each mask must match (the regular expression of `mask_pattern` in the checker, anchored at both ends). The text line has its line ending removed first; nothing else is changed |
| Candidates | For each block, every start line where all its lines match in order, the mask permission of each line taken from its recorded line number (`block.from + k`). To find them quickly: pick as anchor the first line of the block that holds no `[masked]`, take every place that exact line occurs in the text, and try the block at (place minus the anchor's offset). A block in which every line holds a mask has no anchor: every start line of the text is tried |
| Assignment | Blocks in the order of their recorded `from`. Dynamic programming over (block index, candidate): a block may be placed at a candidate that starts after the end of the previous placed block, or left unplaced. Best = most blocks placed; among those, the smallest sum of distances between placed start and recorded `from` |
| Ambiguous | After the best is found: for each placed block, if another best solution (same count, same sum) places it elsewhere, its state is `ambiguous` and `candidates` lists the places. Found by counting best solutions per (block, candidate) in the same table |
| Changed | A block left unplaced. Its marker place: the first start line where the block matches with spaces at line ends ignored (`spacesOnly: true`), else its recorded lines clipped to the text |
| Masked | A placed block with at least one line matched through a mask is `current-masked` |
| Unexplained | Non-blank text lines outside every placed block of state `current` or `current-masked` |
| Cost | A map from line text to line numbers gives the anchor's places, so a block costs (places of its anchor) times (its length). The no-anchor case costs (text lines) times (block length) and can only arise for a block made of masked lines alone |

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
| `index.ts` | For each project: read every `.md` under `notesFolder` (folders starting with a dot skipped) with `written_by: argus`; when `vaultFolder` is set, also the Concept and Library notes with that property in the vault. Two `FileSystemWatcher`s per project (notes, vault); a change re-reads the changed file after 300 ms of quiet. Exposes `fileNotesFor(project, sourceRel)` (zero, one or several) and `noteByName` |
| Commands | `argus.explainSelection`, `argus.explainFile`, `argus.create`, `argus.check`, `argus.refresh`, `argus.openInObsidian`; `explainSelection` also in `editor/context` |
| `panel.ts` | A `WebviewViewProvider` in the side bar (view container "Argus"). HTML built in the extension with `markdown.render`; CSP `default-src 'none'; style-src ${cspSource}; img-src ${cspSource}; script-src 'nonce-...'`; `localResourceRoots: [media]`; `enableScripts: true`. `media/panel.js` only sends the five allowed messages and handles folding |
| Messages | `{type: "openNote", name}`, `{type: "obsidian", name}`, `{type: "external", href}`, `{type: "create"}`, `{type: "check"}`, `{type: "pick", name}`, `{type: "setup"}`. The handler checks `type` against that list and every `name` against the index; anything else is dropped. `external`: only `http:`, `https:` and `obsidian:` addresses that appear in the note being shown are passed to `env.openExternal`, which shows VS Code's own prompt for an address it does not trust; any other address is dropped. (The design's list of message kinds gains "open an external link" and "first-use setup"; both are named in the design's Links row and Settings table.) |
| Selection to blocks | On `explainSelection` and on selection change while the panel is visible (after 200 ms of quiet): `assign` on the editor's text, blocks overlapping the selection (an empty selection is the cursor's line), unexplained ranges inside it |
| States shown | Exactly the table "States" of the design, with a text label for each (never colour alone) |
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
| Stored | `workspaceState`, keyed by project and source: the result object and the time |
| Still valid | The same command with `--fingerprint` in place of `--json`. The fingerprint is the authority; events only decide when to ask. Asked: on activation for the files that have a stored result; when the window gets the focus back (`window.onDidChangeWindowState`), which covers changes no watcher saw; and 1500 ms after the last event from the notes watcher, the vault watcher, a watcher on the source root, a watcher on the graph file, the git watchers, or a settings change. Git watchers: the extension asks git where the repository keeps its data (`git -C <sourceRoot> rev-parse --absolute-git-dir` and `--git-common-dir`, run with `execFile`), so a source root that is a subfolder of a repository, or a worktree, is handled; it watches `HEAD`, `refs/**`, `packed-refs` and `shallow` in both folders. No git, or not a repository: no git watchers. While a call is pending or after it failed: "not checked". A value other than the stored `fingerprint`: the stored result is deleted |
| Never | Changing a note |

The parsing of the result and the mapping to states live in functions without `vscode` imports (`src/core/checkResult.ts`: `stateOf(exit, stdout, sourceRel)` and `detailsOf(result, noteName)` for the Check details block), tested on recorded JSON: a pass with the file covered, a pass with it not covered, a pass without graph, a pass with warnings and masked lines (the details list them), a failure about this note, a failure only about the graph, a failure only about another note, broken JSON, exit code 2. The trust guard is a single function `mayRun()` through which every `execFile` and task start goes; a search of the source for `execFile(` and `executeTask(` outside that path is part of the safety checklist.

## Piece 7: create (`create.ts`)

| Step | Behaviour |
|---|---|
| Guard | Workspace trusted; the file belongs to a project; the document is not untitled |
| Unsaved | `document.isDirty`: a modal with "Save and create" and "Cancel". On the first: `const saved = await document.save()`; when `saved` is false or the document is still dirty, stop with "the file could not be saved; nothing was started". The hash of the saved text is taken only after a successful save |
| Command | `argus.createCommand` from the user's settings; placeholders replaced inside each argument (never joined into one string): `${file}` (path relative to the source root), `${notesFolder}`, `${sourceRoot}`, `${depth}` |
| Terminal | A VS Code task, not a bare terminal: `tasks.executeTask(new Task({type: "argus"}, TaskScope.Workspace, "Argus: create explanation", "argus", new ProcessExecution(args[0], args.slice(1), {cwd: sourceRoot})))` with `presentationOptions` `{reveal: Always, focus: true, panel: Dedicated, close: false}`. `ProcessExecution` starts the program with its argument list and no shell. The task's terminal takes the person's typing, so the agent can ask. `close: false` keeps the terminal and its text after the program ends. The note file's text hash and the source text hash are recorded before the start |
| While it runs | Panel state "agent running in the terminal 'Argus'" |
| End | `tasks.onDidEndTaskProcess` for that task execution gives the exit code when the program ends; the terminal stays open. Exit code undefined or not 0: "the agent stopped with an error; its output is in the terminal 'Argus: create explanation'". Else, no File note for the file or its text hash unchanged: "the agent finished without writing the note". Else run the check (piece 6) and show its state |
| Program missing | The task ends at once with a failure to start: reported as "could not start <program>; see the setting argus.createCommand". Before starting, the program is looked up on PATH (or as a path) so the usual case is reported without starting anything |

## Piece 8: Concept notes and Obsidian

A click on a `data-note` link sends `openNote`; the handler resolves it with `resolveLink` and renders that note in the panel with a "back" entry (a stack kept in the provider). "Open in Obsidian" builds `obsidian://open?path=<absolute path, URI-encoded>` and opens it with `env.openExternal`. A name found in several places shows the list; nothing outside the notes folder and the vault folder is ever read.

## Piece 9: package

`npm run package`: `tsc`, `copy-checker`, tests, then `vsce package` giving `argus-3.0.0.vsix`. `.vscodeignore` leaves out `src/`, tests and maps. `README.md`: what it does, the settings, how to install the skill for the agent, the three states of freshness and the validation badges. The `.vsix` is attached to the repository's release, not published to the Marketplace.

## Safety checklist, verified before the package step

| Check | How |
|---|---|
| No shell anywhere | Search the source for `exec(`, `shell: true` and a `spawn` with a string command: none |
| Workspace cannot choose a program | Unit test of the settings reader with a fake `inspect()` result: the workspace value of `argus.createCommand` and `argus.python` is ignored |
| No remote content | The CSP string is asserted in a test of the HTML builder; `panel.js` contains no `fetch`, no `XMLHttpRequest`, no `import(` |
| No raw HTML from notes | `markdown.test.ts` |
| Messages | A test of the handler function with unknown types, unknown names, and an `external` address that is not in the note or has another scheme |
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
