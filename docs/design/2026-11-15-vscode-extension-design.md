# Argus for VS Code: design (version 3.0)

## Status

- 2026-11-15: first draft, written by the agent under the owner's autonomy instruction (decide, record, carry on).
- 2026-11-15: revision 2, after Codex review round 1 (3 P1, 5 P2; all accepted). Changes: the states are defined; validation is separate from freshness and run by the extension itself; block matching is an ordered, non-overlapping assignment; unexplained lines are a state of their own; masked notes match; unsaved files, several projects and duplicate notes are defined; "create" runs in a visible terminal so the agent can ask.
- 2026-11-15: revision 3, after Codex review round 2 (2 P1, 2 P2; all accepted). Changes: the check's outcome is taken from its exit code and RESULT line, never from per-note lines alone; the checker itself refuses a `source` outside the source root; shared Concept and Library notes in the vault are indexed; masking follows the checker's rule exactly.
- 2026-11-15: revision 4, after Codex review round 3 (2 P1, 2 P2; all accepted). Changes: a stored check result is tied to everything the check read; a file the graph does not cover is never shown as fully checked; a copied line equal to the source needs no mask declaration even when the source itself says `[masked]`; the index accepts exactly the `source` paths the checker accepts. The extension reads the check's result as JSON (`check_notes.py --json`, added in skill version 2.6.1).
- 2026-11-15: revision 5, after Codex review round 4 (1 P1, 1 P2; both accepted). Changes: the extension no longer lists the check's inputs itself; the checker computes one fingerprint of everything it reads (`check_notes.py --fingerprint`, skill version 2.6.2) and the extension compares it; every validation state is defined by the exit code and the JSON fields. New section "Alternatives considered" (CodeTour), after the owner's question.
- 2026-11-15: revision 6, after Codex review round 5 (1 P1, accepted). The defect was in the checker, not in the design's rule: its fingerprint skipped a second note with an existing name. Fixed in skill version 2.7.1 (every note file found goes in by path and content), with a test. The design now names the oldest checker version the extension may ship.
- 2026-11-15: revision 7, after Codex review round 6 (1 P1, 1 P2; both accepted). Rounds 4 to 6 each found another input the fingerprint did not cover. The method was changed in the checker (skill version 2.8.1): the fingerprint is no longer built from a list of inputs; the run adds every file it reads, every folder listing it uses and every answer it gets from git to one hash, as it goes. An input cannot be forgotten, because only what the run uses can change its result.
- 2026-11-15: revision 8, after Codex review round 7 (1 P1, accepted; the two round 6 fixes hold). The checker listed the note files twice, once to check and once for the fingerprint; a note appearing between the two could give a pass and a fail under one fingerprint. Fixed in skill version 2.8.2: each folder listing is made once, is used for everything, and adds itself to the fingerprint.
- 2026-11-15: revision 9, after Codex review round 8 (1 P1, accepted; the round 7 fix holds). The fingerprint joined file names with line breaks, so a file name that itself holds a line break could make two different listings hash alike. Fixed in skill version 2.8.3: every entry is hashed as one JSON array.
- 2026-11-15: revision 10, after Codex review round 9 (no P1; 1 P2, accepted; the round 8 fix holds). A file read that fails was not part of the fingerprint, so "graph missing" and "graph not readable" could share one. Fixed in skill version 2.8.4: a failed read goes into the fingerprint with the kind of failure.
- 2026-11-15: revision 11, after Codex review round 10 (no P1; 1 P2, accepted; the round 9 fix holds). The Python runtime (version, platform, the limit on very long numbers, interpreter flags) now goes into the fingerprint (skill version 2.9.1).
- 2026-11-15: **design stage closed.** Ten review rounds are complete; findings fell 8, 4, 4, 2, 1, 2, 1, 1, 1, 1; rounds 9 and 10 had no P1. Under the review skill's owner rule 7 (after at least ten completed rounds, an open P2 goes to the tracked backlog and no longer blocks), the one P2 of round 10 is recorded below as fixed, to be confirmed by the Codex review of the plan note, which reads this design and the checker as sources. Since round 3 no finding touched the extension's behaviour as designed; all were about the checker's fingerprint, and all were fixed in the skill.
- 2026-11-15: revision 12 (after the plan review): the list of accepted panel messages names the two kinds the Links row and the Settings table already imply (external link, first-use setup). Nothing else changed.
- 2026-11-15: revision 13 (after plan review round 6): the "Large files" rule in "Matching" is restated. It said matching is linear in the file for each block; that cannot be promised for a block with many different masked lines. It now requires that matching never blocks the editor and states the real cost. Nothing else changed.
- Owner's request, in his words: "select the lines of code and explanation comes from the skill (either fetched or created at that time: if I have run the skill once that is fetched, or else created)". VS Code extension first; a localhost page in the next release.

## Codex review records

| Round | Outcome | Disposition |
|---|---|---|
| 1 | P0=0 P1=3 P2=5 P3=0, coverage complete | All 8 accepted and designed for in revision 2 (see "Review round 1" at the end) |
| 2 | P0=0 P1=2 P2=2 P3=0, coverage complete | All 4 accepted and designed for in revision 3 (see "Review round 2" at the end) |
| 3 | P0=0 P1=2 P2=2 P3=0, coverage complete | All 4 accepted and designed for in revision 4 (see "Review round 3" at the end) |
| 4 | P0=0 P1=1 P2=1 P3=0, coverage complete | Both accepted and designed for in revision 5 (see "Review round 4" at the end) |
| 5 | P0=0 P1=1 P2=0 P3=0; coverage marked incomplete because VS Code's API and CodeTour's capabilities are outside the supplied sources | Accepted; fixed in the checker (skill 2.7.1), see "Review round 5" at the end |
| 6 | P0=0 P1=1 P2=1 P3=0, coverage complete | Both accepted; the fingerprint method was replaced (skill 2.8.1), see "Review round 6" at the end |
| 7 | P0=0 P1=1 P2=0 P3=0, coverage complete | Accepted; fixed in the checker (skill 2.8.2), see "Review round 7" at the end |
| 8 | P0=0 P1=1 P2=0 P3=0, coverage complete | Accepted; fixed in the checker (skill 2.8.3), see "Review round 8" at the end |
| 9 | P0=0 P1=0 P2=1 P3=0, coverage complete | Accepted; fixed in the checker (skill 2.8.4), see "Review round 9" at the end |
| 10 | P0=0 P1=0 P2=1 P3=0, coverage complete | Accepted; fixed in the checker (skill 2.9.1), see "Review round 10" at the end. P2 FIXED, to be confirmed in the plan review (owner rule 7) |

## Goal

In VS Code, a person selects lines of code and sees their Argus explanation beside the code: purpose, the block's code, the line-by-line table, and the concepts with their notes. The explanation is read from the Argus notes when they exist. When they do not exist, or do not cover the selected lines, the person can have them created; they are then saved as notes, so the next look is instant.

Two questions are answered separately, and the panel always shows both:

| Question | Name | Answered by |
|---|---|---|
| Does this explanation describe the code as it is now? | Freshness | The extension, by comparing the note's copied code with the text in the editor |
| Did this note pass the Argus check? | Validation | The extension, by running `check_notes.py` itself and remembering the result |

## What it is not

| Not in 3.0 | Why |
|---|---|
| No LLM call from the extension | The coordinator of the AURA work confirmed there is no supported plain-HTTP route for a custom extension. The LLM work is done by a coding agent that is already set up on the computer |
| No change to the note format | The notes the skill writes today are the data. The extension only reads them |
| No publishing to the VS Code Marketplace | Publishing outside the owner's repositories is his decision. 3.0 ships as a `.vsix` file |
| No localhost page | Version 3.1, reusing the same core |
| No editing of notes from the panel | Notes are edited in Obsidian or by the skill |
| No explanation of untitled (never saved) documents | They have no path, so no note can name them |

## How it works

```mermaid
flowchart LR
    S[Selection in the editor] --> P{File inside an Argus project?}
    P -->|no| X[Panel: not in an Argus project]
    P -->|yes| L[Find the File note for this file]
    L -->|none| C[Offer: create]
    L -->|two or more| D[Panel: duplicate notes, pick one]
    L -->|one| M[Assign the note's blocks to the current text]
    M --> T[Blocks: current, changed or ambiguous. Lines: explained or unexplained]
    T --> V[Show, with the freshness and validation states]
    T -->|selection touches changed, ambiguous or unexplained lines| C
    C --> A[Coding agent runs the argus skill in a terminal]
    A --> K[Extension runs the check on the result]
    K --> L
```

| Step | What happens | LLM used |
|---|---|---|
| 1. Index | On start, and whenever a note file changes, the extension reads every note that carries `written_by: argus` in each project's notes folder, and, when the project has a `vaultFolder`, the Concept and Library notes with that property anywhere in the vault (folders whose name starts with a dot are skipped). For each: properties (`type`, `source`, `commit`, `depth`, `masked_lines`), the lens table, and each block (id, purpose, recorded line range, the copied code, the explanation under it). Both folders are watched; a change refreshes the index | No |
| 2. Project | The open file's real path is compared with each project's source root. The file belongs to the project whose root contains it (the longest root wins) | No |
| 3. Look up | The file's path relative to that root is compared with the `source` of the notes of that project only | No |
| 4. Assign | The note's blocks are assigned to places in the editor's current text (see "Matching") | No |
| 5. Show | The blocks that overlap the selection are shown in the Argus panel, with their states and the selected lines highlighted in the line table | No |
| 6. Create | When there is no note, or the selection touches lines that are changed, ambiguous or unexplained, the panel offers "Create explanation" (see "The create step") | Yes, in the agent |
| 7. Validate | After a create, and on the command "Argus: Check notes", the extension runs the Argus check on that file's note and stores the result | No |

## States

| Thing | State | Meaning | Shown as |
|---|---|---|---|
| File | not in a project | The file is under no configured source root | Panel text; no markers |
| File | no note | No File note names it | Panel text and the Create button |
| File | duplicate notes | Two or more notes of one project name it | Panel lists them; the person picks one for this session; nothing is chosen for them |
| Block | current | Its copied code is in the editor text exactly (line endings aside), at one place, in order | Normal marker |
| Block | current (masked) | The same, where the note has `[masked]`: everything around each mask matches; fully masked lines are not compared | Normal marker with a lock sign; the panel shows the note's masked code, never the editor's text for those lines |
| Block | changed | Its code is not in the text exactly. This includes a difference only in spaces at line ends | Warning marker; the explanation is shown under "written for earlier code" |
| Block | ambiguous | Its code occurs at more than one place and the order of the blocks does not decide which | Warning marker at every candidate place; the panel says so and does not call it current |
| Line | unexplained | A non-blank line of the current text that no current block covers | Its own marker; selecting it offers Create |
| Note | checked | The stored result is still valid (see "What a stored result is tied to"); its exit code was 0, its `result` is `PASS`, and this file is in its `graph.covered` | Badge "checked" |
| Note | checked, not in the graph | The same, but this file is in the result's `graph.not_covered`: its functions were not compared with the graph | Badge "checked; this file is not in the graph" |
| Note | checked without graph | A valid stored result with exit code 0 and `result` equal to `PASS WITHOUT THE GRAPH CHECK` | Badge "checked, graph not used" |
| Note | check failed | The run ended with exit code 1 and a well-formed JSON result. The panel shows every entry of `fails` and `missing`, grouped: entries about this note; entries about the graph; entries about other notes of the same folder. Any of them keeps the badge at "check failed" | Badge "check failed" and the grouped entries |
| Note | check error | The check could not be run or did not finish: Python missing, exit code 2 (wrong arguments), any other exit code, output that is not the expected JSON object, or the process was stopped | Badge "check error" and the reason |
| Note | not checked | No stored result, or the stored result is no longer valid, or Python is not available | Badge "not checked" and why (for example "another note changed since the last check") |

Whatever the badge, the panel also shows, from the same result: how many of the folder's explained files the graph covers, the number of warnings with a way to read them, and the masked lines of this note.

## Matching

The note's blocks, in the order of their recorded line ranges, are assigned to the editor's current text.

| Rule | Detail |
|---|---|
| Text compared | Line by line. Line endings (CRLF or LF) are ignored. Everything else must be equal, spaces at line ends included |
| Masked lines | Exactly the checker's order (`check_notes.py`, the code-fence comparison). First: a copied line equal to the text line matches, whatever it contains; source code that itself says `[masked]` therefore needs no declaration. Only when the two differ and the copied line holds `[masked]`: it is accepted when its recorded line number is in `masked_lines` and either the line is `[masked]` alone, or the text around each mask equals the text line. A `masked_lines` entry for a line whose copy holds no mask changes nothing |
| Candidates | Every place in the text where a block's whole code matches |
| Assignment | Blocks keep their order and never overlap: block n+1 is assigned after the end of block n. Among the assignments that satisfy this, the one that assigns the most blocks wins; among those, the one whose places are nearest the recorded lines |
| Ambiguous | When two assignments are equally good and put a block at different places, that block is ambiguous |
| Changed | A block with no candidate, or none that fits the order, is changed. To place its marker, the extension looks for the same code with line-end spaces ignored; found: the marker sits there and the panel says "differs only in spaces at line ends"; not found: the marker sits at the recorded lines, clipped to the file |
| Unexplained | After the assignment, every non-blank line outside all current blocks |
| Large files | Matching never blocks the editor: it runs in short slices, gives way to typing and scrolling between them, and is dropped when the text changes; while it runs the panel says so. Its cost: for a block without masked lines, linear in the file's length. For a block with masked lines, linear in the file's length for its longest run of unmasked lines, plus the remaining candidate places times the block's other lines; in the worst case (no unmasked run, many different masked lines) this reaches the file's lines times the block's masked lines, which the checker's quarter-of-a-file limit on masks bounds. No candidate place is dropped to save time |
| Unsaved changes | Matching always uses the text in the editor, saved or not, so the markers follow what the person sees |

Example the rules must handle: two identical blocks recorded at lines 10 and 100; 100 lines are inserted above both. Both now have candidates at 110 and 200. Order and no-overlap give 110 to the first and 200 to the second.

## Parts

| Part | Folder | Content | Depends on VS Code |
|---|---|---|---|
| Core | `vscode/src/core/` | `notes.ts`: reads a note (properties, fence-aware sections, blocks, tables). `match.ts`: the assignment above. `links.ts`: finds `[[links]]`. `projects.ts`: path rules. `markdown.ts`: the small renderer | No. Version 3.1 reuses it. A test loads every core file and fails if one imports `vscode` |
| Index | `vscode/src/index.ts` | Keeps the notes of each project in memory; refreshes on file changes | Yes (file watcher) |
| Panel | `vscode/src/panel.ts`, `vscode/media/` | A webview in the side bar that renders the explanation | Yes |
| Commands | `vscode/src/extension.ts` | Registers commands, the context menu entry, the markers in the editor | Yes |
| Create | `vscode/src/create.ts` | Starts the agent in a terminal, follows it, runs the check | Yes |
| Check | `vscode/scripts/` | A copy of the skill's `check_notes.py` and `_common.py`, taken from `skills/argus/scripts/` when the extension is built | No |

Two parsers exist: the Python check (the authority on whether a note is valid) and the TypeScript core (for display and matching). They are kept in step this way: the build copies the Python files, never edits them; the core's tests parse the same sample notes that `test_scripts.py` builds and compare block ids, line ranges and code with what `check_notes.py` reports for them; a note the core cannot parse is shown as "cannot be read", never guessed at.

## Settings

| Setting | Meaning | Default |
|---|---|---|
| `argus.projects` | A list. Each entry: `sourceRoot` (folder the notes' `source` paths are relative to), `notesFolder` (folder with the Argus notes), `vaultFolder` (optional: root of the Obsidian vault, for shared Concept and Library notes and for opening Obsidian), `graph` (optional: path of a graphify `graph.json` for the check) | Empty; the panel asks for the notes folder once and uses the first workspace folder as the source root |
| `argus.createCommand` | The agent program and its arguments, as a list. Placeholders: `${file}`, `${notesFolder}`, `${sourceRoot}`, `${depth}` | `["claude", "Use the argus skill. Explain ${file}, depth ${depth}. Source root: ${sourceRoot}. Put the notes in ${notesFolder}."]` |
| `argus.createDepth` | Depth asked for on create | `full` |
| `argus.python` | The Python program for the check | `python` |

Path rules (`projects.ts`): every configured folder is turned into its real path; on Windows, comparison ignores letter case and treats `\` and `/` alike; a file belongs to a project only when its real path lies inside the source root; the index treats a note's `source` exactly as the checker does: it is resolved against the source root, and accepted when the result is a file inside the root, whatever its spelling (`sub/../file.py`, another letter case on Windows); a `source` that resolves outside the root or to no file is ignored by the index and listed in the panel's "problems" line (the checker refuses the same notes on its own, see "Validation by the extension"); with several workspace folders, each needs its own entry in `argus.projects`, and a file under no entry is "not in a project".

A file that was renamed or moved has no note under its new path: it shows "no note". (A later version may notice that another note's blocks all match this file and suggest it.)

## Commands and what the person sees

| Command | Where | Result |
|---|---|---|
| Argus: Explain selection | Right-click in the editor; command palette | The panel opens on the blocks under the selection. An empty selection means the line of the cursor |
| Argus: Explain this file | Command palette; the editor title menu | The panel shows the file's purpose table and the list of blocks with their states |
| Argus: Create explanation | Button in the panel | See "The create step" |
| Argus: Check notes | Command palette; button in the panel | Runs the check for this file's note and shows the result |
| Argus: Refresh notes | Command palette | Reads the notes folders again |
| Argus: Open note in Obsidian | Button in the panel | Opens the note through an `obsidian://` link |

A selection that spans several blocks shows each of them in order. A selection that covers both explained and unexplained lines shows the explained blocks, lists the unexplained line ranges, and offers Create.

| Marker in the editor | Meaning |
|---|---|
| A thin bar beside lines | Current block |
| The same bar in a warning colour | Changed or ambiguous block |
| A dotted bar | Unexplained lines |
| A line of grey text above a block's first line | The block's purpose, as a CodeLens; a click opens the panel on it |

The panel, top to bottom: the file's name, the freshness summary (how many blocks current, changed, ambiguous; how many lines unexplained) and the validation badge; the lens table, folded; for each block under the selection, its state, purpose, code, explanation (the line table at `full`, the sentences at `map`); the concepts of that block as links. A click on a concept shows that Concept note in the panel, with a way back.

## The create step

| Point | Decision | Reason |
|---|---|---|
| Who does the LLM work | A coding agent on the computer. Default: Claude Code | It runs the argus skill; with AURA connected to it, the work goes through AURA without the extension knowing AURA at all |
| Where it runs | In a VS Code terminal that the person can see and type into, started with the program and its argument list directly (`shellPath` and `shellArgs`), with the source root as its folder | The skill sometimes asks (for example before reading code that carries a processing rule, or when graphify is missing). A visible terminal lets the person answer. No shell reads the arguments, so a file path cannot become a command |
| Before it starts | The file must be saved. With unsaved changes the panel offers "Save and create" or cancel; it never explains a version the person cannot see on disk. The extension records the hash of the saved text it asked about | The agent reads the file from disk |
| What is created | The whole file's note at the asked depth | The skill's unit is the file; the check works on whole files |
| While it runs | The panel shows "agent running in the terminal 'Argus'; answer it there if it asks". Notes that appear meanwhile are indexed as usual but stay "not checked" | A note on disk is not yet a finished, checked note |
| When it has ended | The terminal closes or its program exits. Then, in order: (1) exit code not 0: "the agent stopped with an error", terminal kept open; (2) no File note for the file, or its text is unchanged since before the start: "the agent finished without writing the note"; (3) otherwise the extension runs the check on that file and shows the result as the validation state | Completion is the process outcome plus the note plus the check, never the note alone |
| Edits during the run | After the run, matching compares the new note with the editor's text as it is then; lines edited meanwhile show as changed or unexplained | The result is tied to what the agent read |
| The agent is not installed | Starting the program fails: the panel says which program was not found and names the setting | No silent failure |
| The skill is not installed in the agent | The agent says so in the terminal; the person sees it. The extension's README says how to install the skill | The extension cannot look inside the agent |
| Python is not installed | Create still works; the validation state is "not checked: Python not found (`argus.python`)" | The check is separate from the display |

## Validation by the extension

| Point | Decision |
|---|---|
| Command | `<argus.python> -B <extension>/scripts/check_notes.py --json --notes <notesFolder> --source <sourceRoot> --scope <file> [--vault <vaultFolder>] (--graph <graph> or --no-graph)`, run as a program with an argument list. `--json` makes the checker print one JSON object: `result`, `exit_code`, `explained`, `missing`, `fails` and `warns` (each with the note it is about, or a `graph` mark), `stale`, `masked_lines`, and `graph` with `used`, `covered` and `not_covered` |
| Result | Decided by the run as a whole, in this order: (1) the process could not start, was stopped, ended with a code other than 0 or 1, or its output is not the expected JSON object: "check error"; (2) exit code 1: "check failed", with every entry of `fails` and `missing` shown, grouped by the note it is about, the graph, or other notes; (3) exit code 0, `result` is `PASS` and this file is in `graph.covered`: "checked"; (4) exit code 0, `result` is `PASS` and this file is in `graph.not_covered`: "checked, not in the graph"; (5) exit code 0 and `result` is `PASS WITHOUT THE GRAPH CHECK`: "checked without graph". Nothing else counts as success. A failure in another note of the same folder, or in the graph, keeps this note from showing "checked": the check certifies the folder's notes together, and the panel says which entries are not about this note |
| What the check reads | Every note with `written_by: argus` in the notes folder, not only this file's; the source file of each File note; the graph. The checker resolves each `source` against the source root and reads it only when the result is a file inside the root (`on_disk` in `_common.py`); anything else is a FAIL and is not read. A spelling such as `sub/../file.py` or another letter case that resolves to a file inside the root is accepted |
| Stored | In the extension's workspace storage: the JSON result (which carries the checker's `fingerprint`), and the time |
| What a stored result is tied to | The checker's own fingerprint, which the checker builds while it runs: every file it reads goes in by content (notes, source files, the graph), every folder listing it uses (the note files, the names a link may point at, the files under the source root), every question it asks git with the answer, the options, and the checker's own files. Nothing is listed in advance; whatever the run used is in the hash, so two runs with the same fingerprint read the same things and give the same result. The value is in every `--json` result. `check_notes.py --fingerprint` prints only that value; it costs one full run of the check, a few seconds. A stored result is valid only while a fresh `--fingerprint` call returns the stored value. The extension makes that call when the notes folder, the vault folder, the source root, the graph file, the repository's git state or the settings report a change (collected over a short quiet period), and once when it starts; while the call is pending, or when it fails, the badge is "not checked". A different value drops the stored result. Each listing is made once per run and that one list is both checked and hashed. Each entry goes into the hash as one JSON array, so no file name or answer, whatever characters it holds, can be read as two. A read that fails goes in too, with the kind of failure. The Python runtime that runs the check is in it as well. The extension ships the checker of skill version 2.9.1 or later |
| Never | The extension does not change a note to make it pass |

## Safety

| Risk | Handling |
|---|---|
| A workspace sets `argus.createCommand`, `argus.python` or `argus.projects` to run or read something harmful | `package.json` declares `capabilities.untrustedWorkspaces` as `{"supported": "limited", "restrictedConfigurations": ["argus.createCommand", "argus.python", "argus.projects"]}`: in Restricted Mode VS Code gives the extension only the user's own values. Create and Check are switched off until the workspace is trusted. `argus.createCommand` and `argus.python` are always read from the user's own settings (`inspect().globalValue`), never from the workspace, trusted or not |
| A note contains HTML or script | The webview's content security policy is `default-src 'none'`, styles and images from the extension's own `media` folder only (`webview.cspSource`), scripts only with a nonce made new for each render. `localResourceRoots` is the `media` folder alone. Note text reaches the page through the core's renderer, which escapes HTML first |
| A message from the page to the extension | Only these kinds are accepted: open a note by name, open in Obsidian, open an external link (see "Links in notes"), create, check, pick one of duplicate notes, first-use setup of the notes folder. Each is checked against the index before anything is done; a name that is not in the index is refused. A linked name is looked up first among the project's own notes, then among the shared Concept and Library notes of its vault; found once: shown; found more than once in the vault: the panel lists the places and the person picks; a file outside the notes folder and the vault folder (by real path) is never opened |
| Links in notes | `[[links]]` open notes inside the panel; `obsidian://` links open Obsidian; any other link is shown as text with its address and opened only on a click, through VS Code's own "open external" prompt |
| Secrets | The panel shows the note's code, which is masked where the skill masked it; for a masked block it never shows the editor's text. The extension sends nothing anywhere |
| Source code leaving the computer | Only through the coding agent the person has set up, as in any use of that agent |
| Paths | See "Path rules": real paths and containment in the source root, the same rule in the index and in the checker |

## Lens

| Lens | Answer |
|---|---|
| In one sentence | The Argus notes, shown beside the code they explain, for the lines the person points at, with a plain statement of whether each explanation is current and checked |
| What we gain | The explanation is one click from the code. The markers show which code is explained, which explanation is out of date, and which lines have none |
| What we lose | A second thing to build, test and release besides the skill. The note format is read by two parsers that must agree |
| What was not possible without it | Asking "what does this line do" from inside the editor and getting the stored, checked explanation rather than a fresh, unchecked one |
| Issues today | None; not built |
| What it makes possible | The 3.1 localhost page on the same core; later, an AURA route (an MCP client of the local `aura mcp` server) without changing the panel |
| Open source used | TypeScript, the VS Code extension API, `@vscode/vsce` to package. No runtime library |
| Risks | The assignment can be wrong for heavily repeated code; it then says "ambiguous" rather than guess. A note format change in the skill must reach both parsers; the shared sample tests catch a mismatch |

## Interface work

| Skill the owner named | Use in 3.0 |
|---|---|
| `ui-ux-pro-max` | The panel's layout, type, spacing and colour, following VS Code's theme variables so it fits light and dark themes; accessibility (keyboard reach, contrast, labels; states never shown by colour alone) |
| `a2ui` | Not used in 3.0. A2UI is for interfaces an agent generates at run time; this panel shows stored notes with a fixed layout. To be looked at again when "create" should show its progress as agent-made interface |

## Alternatives considered

| Alternative | What it is | Why it is not the 3.0 design | What is taken from it |
|---|---|---|---|
| CodeTour (the VS Code extension `vsls-contrib/code-tour`) | Guided walkthroughs: a tour is a JSON file of steps, each tied to a file and a line or a selection, with a Markdown description shown beside the code; markers in the gutter show where steps are | It plays a tour in a fixed order; it does not look up the explanation for whatever lines a person selects. It has no notion of "this explanation no longer matches the code", "these lines have no explanation" or "this note passed the check", and no create step. Those states are the point of the owner's request and of four review rounds | A cheap companion, outside this design: the skill can write a tour file from the File notes (one step per block, in the reading order), so a person with CodeTour installed gets a guided walk through the same explanations with no extension of ours. Recorded in the handoff backlog as its own small feature |
| A custom editor or a tab beside the code | The explanation in an editor tab | A side bar view stays open while the person moves between files | Nothing |
| A hidden agent process for create | `claude -p` without a terminal | It cannot answer the skill's questions (review round 1, finding 7) | Nothing |

## Decisions made by the agent

| Question | Decision | Reason |
|---|---|---|
| Side panel or a tab beside the editor | Side bar view | It stays open while the person moves through files |
| Render Markdown how | A small renderer in the core for the subset the notes use (headings, tables, code, bold, inline code, links, Mermaid shown as code) | No runtime dependency; full control over escaping |
| Create: hidden process or terminal | Terminal | The agent may need an answer |
| Who validates | The extension, with the skill's own check script | "Checked" must mean the check ran, not that a file appeared |
| Tests | Plain Node tests of the core, next to the code; the extension itself is tried by hand in VS Code | Owner rule: small tests next to the code, no test machinery |
| Where the code lives | `vscode/` in the Argus repository | One repository, one handoff |
| Release form | `argus-<version>.vsix`, built with `@vscode/vsce`, attached to the repository; installed with "Install from VSIX" | No Marketplace account needed |

## Build order (for the plan)

| # | Piece | Done when |
|---|---|---|
| 1 | Core: `notes.ts`, with tests on sample notes | Block ids, ranges and code equal what `check_notes.py` reports |
| 2 | Core: `match.ts`, with tests (moved code, changed code, the two-identical-blocks example, new lines between blocks, masked lines, line-end spaces, CRLF) | Tests pass |
| 3 | Core: `projects.ts`, `links.ts`, `markdown.ts`, with tests (Windows paths, `..`, escaping) | Tests pass |
| 4 | Index, commands, panel with the explanation of a selection and the states | Selecting lines in a file with a note shows the right block and state |
| 5 | Markers and CodeLens | Current, changed, ambiguous and unexplained are marked |
| 6 | Check: run the script, store and show the result | A valid note shows "checked"; a broken one shows the failing lines |
| 7 | Create in a terminal, with the completion rules | A file without a note gets one; an agent error, a missing note and a failing check each show their own message |
| 8 | Concept links and "Open in Obsidian" | A click shows the Concept note |
| 9 | Package | A `.vsix` installs in a clean VS Code |

## Open points

| Point | Who decides |
|---|---|
| Publishing to the Marketplace | Owner |
| Publishing argus as an AURA skill, so AURA-connected agents load it by name | Owner, with the AURA coordinator |
| The later AURA route as an MCP client | Needs its own design and a review on the AURA side |

## Review round 1: findings and what changed

| # | Sev | Finding | Change in revision 2 |
|---|---|---|---|
| 1 | P1 | A note appearing is not successful completion; unchecked notes would be shown as "checked" | Validation is its own state, set only by the extension running the check; completion = process outcome + note + check ("States", "The create step", "Validation by the extension") |
| 2 | P1 | Nearest-position matching can give two blocks the same place | Ordered, non-overlapping assignment; "ambiguous" state ("Matching") |
| 3 | P1 | Newly added code had no create path | "Unexplained" lines are a state; selecting them offers Create ("States", "Matching") |
| 4 | P2 | Literal matching rejects correctly masked notes | Matching uses the check's masking rules; state "current (masked)"; the panel never shows the editor's text for masked blocks |
| 5 | P2 | No policy for unsaved content | Matching uses the editor's text; Create needs a saved file ("Save and create"); untitled documents are out |
| 6 | P2 | Source identity underspecified | `argus.projects` with one entry per source root; path rules; "duplicate notes" state; renamed files |
| 7 | P2 | A non-interactive run cannot answer the skill's questions | Create runs in a visible terminal |
| 8 | P2 | Ignoring line-end spaces hides real changes | Exact comparison; a spaces-only difference is "changed", and only used to place the marker |

## Review round 2: findings and what changed

| # | Sev | Finding | Change in revision 3 |
|---|---|---|---|
| 1 | P1 | The checker read any `source`, also outside the root, whatever the extension's index left out | The checker refuses such a source itself (done in the skill, version 2.6.0: `on_disk`); the design states that containment is the checker's own duty ("Validation by the extension") |
| 2 | P1 | Graph and global failures had no defined outcome; a note could show "checked" while the run said NOT PASSED | The outcome comes from the exit code and the RESULT line; new state "check error"; failures are grouped but any of them prevents "checked" |
| 3 | P2 | Shared Concept notes outside the notes folder had no lookup path | The index covers Concept and Library notes of the vault; lookup order, duplicates and containment are defined |
| 4 | P2 | `masked_lines` let any declared line match anything | Parity with the checker: only a copied line that holds `[masked]` is treated as masked, and only when its line is listed |

## Review round 3: findings and what changed

| # | Sev | Finding | Change in revision 4 |
|---|---|---|---|
| 1 | P1 | The stored result was tied to one note and one source, though the check reads the whole folder and the graph | The result is tied to a fingerprint of everything the check read; any change drops it ("Validation by the extension") |
| 2 | P1 | A file the graph does not cover could show "checked" | New state "checked, not in the graph", from the result's `graph.not_covered`; coverage and warnings are always shown |
| 3 | P2 | Requiring a declaration for every copied line that contains `[masked]` rejects source that says `[masked]` itself | Literal equality first, as in the checker ("Matching") |
| 4 | P2 | The index refused `..` and absolute paths that the checker accepts when they resolve inside the root | One rule for both: resolve, then containment ("Path rules") |

## Review round 4: findings and what changed

| # | Sev | Finding | Change in revision 5 |
|---|---|---|---|
| 1 | P1 | The fingerprint still missed inputs: names of linked notes in the vault, the list of source files used for graph paths, the git history | The checker computes the fingerprint of its own inputs (`--fingerprint`, also in the `--json` result); the extension only compares values ("What a stored result is tied to") |
| 2 | P2 | The state table still asked for a textual RESULT line, which a `--json` run does not print | Every validation state is defined by the exit code and the JSON fields ("States") |

## Review round 5: finding and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P1 | The checker's fingerprint was built after notes with the same name had been collapsed to one, so adding a second note with an existing name (which makes the check fail) left the fingerprint unchanged | Fixed in the checker, skill 2.7.1: the fingerprint takes every note file found, by path and content. Test `test_fingerprint_follows_every_input` covers it. The design requires that checker version or later |

## Review round 6: findings and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P1 | A note with CR-only line endings was parsed differently by the fingerprint code and by the check, so its source was not hashed | The separate fingerprint code is gone. The check itself adds what it reads to the hash (skill 2.8.1, `witness` in `_common.py`), so there is one reading path. Test: a CR-only note, a source change of the same size and time |
| 2 | P2 | Only git's HEAD was hashed, though the stale check also depends on history | Every git question and its answer are hashed as they are asked. Test: a file changed and changed back in two commits (same content, newer commit) makes the note stale and changes the fingerprint; an empty commit changes neither |

## Review round 7: finding and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P1 | The note files were listed twice in one run (for the check, and for the fingerprint); a note appearing between the two listings could make one run pass and the next fail with the same fingerprint | Skill 2.8.2: `note_files()` and `link_targets()` each list once, return the list that is then used for everything, and add that same list to the fingerprint themselves |

## Review round 8: finding and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P1 | The list of files was joined with line breaks before hashing; on systems where a file name may hold a line break, two different lists could give one hash | Skill 2.8.3: every fingerprint entry is one JSON array on its own line (`witness` in `_common.py`); the file list goes in as separate values. Test `test_values_with_line_breaks_do_not_collide` |

## Review round 9: finding and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P2 | A failed read was not witnessed: a missing graph file and an unreadable one gave different failure texts under one fingerprint | Skill 2.8.4: `read_text` adds a failed read to the fingerprint with the path and the kind of failure, then raises as before. Test `test_missing_graph_and_unreadable_graph_differ` |

## Review round 10: finding and what changed

| # | Sev | Finding | Change |
|---|---|---|---|
| 1 | P2 | Python runtime settings that can change parsing (for example the limit on the length of numbers) were not in the fingerprint | Skill 2.9.1: the fingerprint includes the Python version, the platform, the default encoding, the number-length limit and the interpreter flags |

P2 FIXED: design round 10 #1 - "The fingerprint omits Python runtime settings that affect the result" - fixed in skill 2.9.1, to be confirmed by the plan review.
