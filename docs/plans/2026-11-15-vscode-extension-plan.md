# Argus for VS Code: implementation plan (version 3.0)

## Status

- 2026-11-15: first version, written after the design stage closed (design note revision 11, ten Codex rounds). Not yet reviewed.
- Design: `docs/design/2026-11-15-vscode-extension-design.md`. This plan builds exactly that design; where the two differ, the design wins and the plan is wrong.
- Carried from the design review: P2 FIXED design round 10 #1 (Python runtime in the checker's fingerprint, skill 2.9.1), to be confirmed by the review of this plan.

## Codex review records

| Round | Outcome | Disposition |
|---|---|---|
| | | |

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
| parity | for the sample notes that `skills/argus/scripts/test_scripts.py` builds (written to disk by a small Python call in the test's setup, skipped when Python is missing), block ids and ranges equal the checker's `--json` `explained` and the INFO line "N blocks" |

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
| Candidates | For each block, every start line where all its lines match in order |
| Assignment | Blocks in the order of their recorded `from`. Dynamic programming over (block index, candidate): a block may be placed at a candidate that starts after the end of the previous placed block, or left unplaced. Best = most blocks placed; among those, the smallest sum of distances between placed start and recorded `from` |
| Ambiguous | After the best is found: for each placed block, if another best solution (same count, same sum) places it elsewhere, its state is `ambiguous` and `candidates` lists the places. Found by counting best solutions per (block, candidate) in the same table |
| Changed | A block left unplaced. Its marker place: the first start line where the block matches with spaces at line ends ignored (`spacesOnly: true`), else its recorded lines clipped to the text |
| Masked | A placed block with at least one line matched through a mask is `current-masked` |
| Unexplained | Non-blank text lines outside every placed block of state `current` or `current-masked` |
| Cost | Line strings are compared through a map from line text to the list of line numbers, so candidates for a block are found from the positions of its first line; linear in practice |

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
| `markdown.ts` | `render(text, linkTo)` | HTML for the subset the notes use: headings, paragraphs, tables, fenced code (Mermaid shown as code), bold, italic, inline code, `[[links]]` turned into `<a data-note="...">`, other links into plain text with the address. Every piece of text is HTML-escaped before any tag is added; no raw HTML passes through |

Tests: Windows and POSIX paths, a `..` that stays inside and one that leaves the root, another letter case; a link inside a code span is not a link; `<script>` and `<img onerror>` in a note come out escaped; a table with an escaped `\|`. `core-is-pure.test.ts` reads every file of `src/core` and fails when one imports `vscode`.

## Piece 4: index, commands, panel

| Part | Behaviour |
|---|---|
| Settings (`package.json` `contributes.configuration`) | `argus.projects` (array of `{sourceRoot, notesFolder, vaultFolder?, graph?}`), `argus.createCommand` (array of strings), `argus.createDepth`, `argus.python`. `capabilities.untrustedWorkspaces`: `{"supported": "limited", "restrictedConfigurations": ["argus.createCommand", "argus.python", "argus.projects"], "description": ...}` |
| Reading settings | `argus.createCommand` and `argus.python`: `inspect().globalValue` only. `argus.projects`: the effective value, which in Restricted Mode is the user's own |
| `index.ts` | For each project: read every `.md` under `notesFolder` (folders starting with a dot skipped) with `written_by: argus`; when `vaultFolder` is set, also the Concept and Library notes with that property in the vault. Two `FileSystemWatcher`s per project (notes, vault); a change re-reads the changed file after 300 ms of quiet. Exposes `fileNotesFor(project, sourceRel)` (zero, one or several) and `noteByName` |
| Commands | `argus.explainSelection`, `argus.explainFile`, `argus.create`, `argus.check`, `argus.refresh`, `argus.openInObsidian`; `explainSelection` also in `editor/context` |
| `panel.ts` | A `WebviewViewProvider` in the side bar (view container "Argus"). HTML built in the extension with `markdown.render`; CSP `default-src 'none'; style-src ${cspSource}; img-src ${cspSource}; script-src 'nonce-...'`; `localResourceRoots: [media]`; `enableScripts: true`. `media/panel.js` only sends the five allowed messages and handles folding |
| Messages | `{type: "openNote", name}`, `{type: "obsidian", name}`, `{type: "create"}`, `{type: "check"}`, `{type: "pick", name}`. The handler checks `type` against that list and every `name` against the index; anything else is dropped |
| Selection to blocks | On `explainSelection` and on selection change while the panel is visible (after 200 ms of quiet): `assign` on the editor's text, blocks overlapping the selection (an empty selection is the cursor's line), unexplained ranges inside it |
| States shown | Exactly the table "States" of the design, with a text label for each (never colour alone) |

Done when, by hand in the Extension Development Host with the notes folder of the two sample files: selecting lines of a file with a note shows the right block and its state; a file with no note says so; an edit that changes a block turns it "changed" without saving.

## Piece 5: markers and CodeLens (`markers.ts`)

Four `TextEditorDecorationType`s (current, changed or ambiguous, unexplained, masked sign in the gutter), set from the `Assignment` of the visible editors, refreshed after 300 ms of quiet on edits. A `CodeLensProvider` puts the block's purpose above the first line of each placed block; its command opens the panel on that block.

## Piece 6: check (`check.ts`)

| Part | Behaviour |
|---|---|
| Run | `child_process.execFile(python, ["-B", checker, "--json", "--notes", notesFolder, "--source", sourceRoot, "--scope", sourceRel, ...(vault ? ["--vault", vault] : []), ...(graph ? ["--graph", graph] : ["--no-graph"])])`, no shell, 120 s limit, output up to 20 MB |
| Outcome | In the design's order: start failure, signal, exit code other than 0 or 1, or output that does not parse as the expected object: "check error". Exit 1: "check failed", entries grouped by `fails[].note` equal to this note, `fails[].graph`, others, plus `missing`. Exit 0 and `result === "PASS"`: "checked" when the file is in `graph.covered`, "checked, not in the graph" when in `graph.not_covered`. Exit 0 and `result === "PASS WITHOUT THE GRAPH CHECK"`: "checked without graph" |
| Stored | `workspaceState`, keyed by project and source: the result object and the time |
| Still valid | The same command with `--fingerprint` in place of `--json`. Asked: on activation for the files that have a stored result, and 1500 ms after the last event from the notes watcher, the vault watcher, a watcher on the source root, a watcher on the graph file, a watcher on `.git/HEAD`, `.git/refs/**`, `.git/packed-refs` and `.git/shallow` of the source root, or a settings change. While a call is pending or after it failed: "not checked". A value other than the stored `fingerprint`: the stored result is deleted |
| Never | Changing a note |

The parsing of the result and the mapping to states live in a function without `vscode` imports (`src/core/checkResult.ts`: `stateOf(exit, stdout, sourceRel)`), tested on recorded JSON: a pass with the file covered, a pass with it not covered, a pass without graph, a failure about this note, a failure only about the graph, a failure only about another note, broken JSON, exit code 2.

## Piece 7: create (`create.ts`)

| Step | Behaviour |
|---|---|
| Guard | Workspace trusted; the file belongs to a project; the document is not untitled |
| Unsaved | `document.isDirty`: a modal with "Save and create" and "Cancel"; on the first, `document.save()` |
| Command | `argus.createCommand` from the user's settings; placeholders replaced inside each argument (never joined into one string): `${file}` (path relative to the source root), `${notesFolder}`, `${sourceRoot}`, `${depth}` |
| Terminal | `window.createTerminal({ name: "Argus", shellPath: args[0], shellArgs: args.slice(1), cwd: sourceRoot })`, shown. The note file's text hash and the source text hash are recorded before the start |
| While it runs | Panel state "agent running in the terminal 'Argus'" |
| End | `window.onDidCloseTerminal` for that terminal: `exitStatus.code` undefined or not 0: "the agent stopped with an error" (the terminal's own text stays in its scrollback until closed; the message names it). Else, no File note for the file or its text hash unchanged: "the agent finished without writing the note". Else run the check (piece 6) and show its state |
| Program missing | `createTerminal` with a `shellPath` that does not exist closes at once with an exit code: reported as "could not start <program>; see the setting argus.createCommand" |

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
| Messages | A test of the handler function with unknown types and unknown names |
| Paths | `projects.test.ts` |

## Reviews

Codex code review (`xreview.sh code`) at three points: after piece 3 (the core), after piece 6, and before the package step, each against this plan and the design. Findings are handled as in the review skill: verified, fixed with a test or rebutted with evidence, recorded here.

## Hand test before release (recorded in the handoff)

With the notes of the helper sample (7 files) and `C:\dev\applexus-chat` as workspace: explain a selection in `errors.js`; edit a line and see "changed"; add a function and see "unexplained"; run the check and see "checked"; break another note and see the badge drop to "not checked", then "check failed" with the other note named; create for a file without a note in a scratch copy of the project, never in the shared repository.
