---
name: argus
description: Use when the user asks to explain a codebase or part of one for a reader who does not program, to write or update a code walkthrough in an Obsidian vault, or says "explain this code", "update the walkthrough", "explain the new code", "document this for a learner", "argus" or the skill's earlier name "code-explainer-sg".
---

# Argus: learner-level code notes in Obsidian

## Overview

Writes Obsidian notes that let an intelligent adult who has never programmed understand a codebase completely. The reader never opens a code editor: every line of code is copied into the notes, next to its explanation.

Core principle: purpose first, then blocks, then lines; nothing is skipped, and a script proves it.

## The reader (ELI18)

An intelligent adult with zero programming knowledge. Write the full, precise truth in plain words. No simplification that is false. No childish tone. No analogies or metaphors: say directly what happens. Every technical word, down to `function`, `variable` and `=`, links to a Concept note that explains it from zero.

## Depth ladder

| Level | Unit | Where | Answers |
| --- | --- | --- | --- |
| 0 | Project | Start Here note, Map note | What the system is and how its parts connect |
| 1 | File | File note, lens table | Why the file exists |
| 2 | Block | File note, one section per block | What this part does, with its code |
| 3 | Line | Line table under each block | What each line does, with a real value |

Side notes hang off the ladder: Concept (a programming term), Mechanism (a behaviour that spans files), Library (an open-source project or system service), End-to-End Flow (one real input followed from entry point to result).

## Depth setting

| Setting | Writes |
| --- | --- |
| `map` (default) | Levels 0 to 2 for every source file. Every block shows its code. No line tables |
| `full <file or flow>` | Adds level 3 line tables, a trace and check questions for the named files, or for the files one flow touches |
| `full all` | Level 3 for every file. First state the size estimate (source lines, expected note volume) and get the user's yes |

The code is in the notes at every depth. Only the line tables are optional.

## Scope

| The user asks for | Write | Check with |
| --- | --- | --- |
| A whole project | Every note type, for every source file of the project | `--scope <project folder>` |
| Named files or one flow | File notes for those files only; a Flow note for their main path; every Concept note they need; a Mechanism note for each mechanism a named file takes part in; a Library note for each library a named file uses directly; Start Here and Glossary, created or updated | `--scope <file>` once per file |

In a named-file run, files without a note appear in Start Here, Map and Mechanism notes as plain text with "no note yet", never as a `[[link]]`. Reading files outside the scope to state facts about callers and callees is expected.

`<Project>` is the name of the unit being explained, taken from its own manifest (`package.json`, `pyproject.toml`) or folder, not the name of a repository that holds several projects.

## The lens

Every project, file, mechanism and library gets these rows, each as a table row of its own with an answer; the check looks for them in File, Mechanism, Library and Start Here notes. Concept notes use the shorter six-row form in `note-templates.md`.

| Row | Question |
| --- | --- |
| In one sentence | What is it for |
| What we gain | The benefit of it existing |
| What we lose | The cost: speed, complexity, flexibility, money |
| What was not possible without it | The limit that existed before |
| Issues today | Known weak points |
| What it makes possible | What now relies on it |
| Open source used | Libraries involved, or "none" |
| Risks | What can go wrong later |

## Workflow

Do the steps in order. Do not write notes before step 4 is done.

1. **Preflight.** Find the source root, the scope and the target folder (ask if any is unclear). When the target is inside an Obsidian vault, look in the vault's root and index notes for rules about notes (naming, deleting, secrets) and follow them. Then set up the tools: run `python -B <this skill's folder>/scripts/setup_tools.py --install`. It reports Python, git, graphify, VS Code and CodeTour (the last three are optional) and installs graphify (into `~/.argus/venv`, unless one is already on the computer) and CodeTour (when VS Code is present). Its last line gives the path of the graphify program: use that path wherever these steps say `graphify`. For a missing Python, git or VS Code it prints the install command: tell the user what is missing and why, and run the command when they agree (it may ask for administrator rights). When its result is "not ready" and you cannot fix it, stop and say so. Do not continue without the graph, for any scope, however small (a later run: see there). Never run `graphify install`: it edits `CLAUDE.md` and adds hooks. Git is optional. Decide once: when `git -C <source root> rev-parse --is-inside-work-tree` prints `true`, use git (the history in step 3, the `commit` property). Otherwise work with hashes only: skip the git parts of step 3 and leave `commit` out. Either way every File, Mechanism and Flow note gets `source_hash`: that hash, not git, says whether the code changed.
2. **Build the graph.** graphify writes `graphify-out/` inside the folder it is run on, so never run it on the source itself. Copy the whole project's code (not only the files in scope: the graph must also hold the files that use them) to a temporary folder, keeping the paths relative to the source root and leaving out dependencies and build output; leave out tests too, unless the user asked for tests to be explained. Then run `<graphify> update <that folder>`. That command reads code only and uses no LLM, so graphify sends nothing anywhere. Ignore its tips about API keys and `/graphify --update` and its warning about a "stat index". Do not run graphify's `label` or `add` commands, or `/graphify`, which can send content to an LLM service. Then run `python -B <this skill's folder>/scripts/graph_plan.py --graph <that folder>/graphify-out/graph.json --source <that folder> --scope <what is in scope>` (add `--include-tests` when tests are in scope). It prints the leaf-first order, what each file uses and is used by, the functions the graph found, the communities that span files, and the code files the graph has no symbols for. For those files, find callers and callees by text search and name the files in the report. Keep the graph: copy `graph.html` and `graph.json` from `<that folder>/graphify-out/` to `<notes folder>/_graph/` as `<Project> graph.html` and `<Project> graph.json`, or to a folder the person names, never into the source. The check reads `.md` files only, so the file does not touch it. The vault's rules win: when they forbid files that are not notes, ask the person where to put it.
3. **Read the "why".** Design notes, the README and `CLAUDE.md` nearest to the code in scope, then, when git is used, `git log` and `git blame` for the files in scope (read-only git commands only). This is the source for the lens rows "what was not possible without it" and "issues today". A source that does not exist or says nothing about the code in scope is named as such in the cell.
4. **Plan.** From `graph_plan.py`'s output: the file order (a file with no dependencies comes first), the mechanism candidates (communities that span files; judge each by reading the code, since a community is only a hint), and the callers and callees per file. Files the plan lists as using each other in a circle are explained together, in any order within the group. The order and circles come from confirmed uses only. What the graph only inferred is listed apart as "may use": state it as a use only when the code shows it. The graph can miss a file loaded inside a function and a file that another file starts as a program: read each file's load lines and its calls that start programs, and search the project for each file's name. Tell the user the depth, the file count and the size estimate, then carry on; only `full all` waits for a yes.
5. **Write File notes, leaf-first.** Use `note-templates.md`. When a programming term appears for the first time, write its Concept note before going on. Later files link to it.
6. **Write Mechanism and Library notes** from the File notes and the graph clusters. Outside a File note, name a place in the code by its block ("block 29 of [[<File note>]]"), never by a line number: line numbers live in the File note only, and go stale elsewhere. Each Mechanism note has a Mermaid sequence diagram.
7. **Write the End-to-End Flow notes.** Every run that writes or rewrites a File note writes or updates at least one: the main path through the code in scope. A program with commands gets one flow per main command, at most three unless the person asks for more. Choose from the entry points the plan and the code show (a `main`, a table of commands, a function that nothing in scope calls); the person's wish wins. Read the code and follow every branch to where an outcome, a status or an error is set. Do not infer a stage from a name. The diagram shows every end state the code can reach: an end state that is missing makes the note wrong. Each node names the block ids it rests on and shows who decides; every block a node names is also in a row of the Steps table, which is what the check reads. REQUIRED SUB-SKILL when installed: `archify`, for tracing from the real entry point to the real result.
8. **Write Start Here, Map and Glossary last**, from the notes below them. Start Here links every Flow note in "How to read these notes" and names the graph file under "The graph", as a path, not a `[[link]]`. When the `obsidian-bases` skill is installed, use it for a view of all File notes by `status` and `depth`; otherwise keep a table in Start Here. When `obsidian-markdown` or `json-canvas` are installed, use them for syntax and for a canvas map.
9. **Run the check.** `python -B <this skill's folder>/scripts/check_notes.py --notes <folder> --source <root> --scope <what is in scope> --graph <graph JSON>`. The graph is part of the check: `--no-graph` exists only for a run where graphify could not parse any file in scope, and the result line then says `PASS WITHOUT THE GRAPH CHECK`, which you report as such. Add `--include-tests` when the user asked for tests to be explained. Add `--vault <vault root>` whenever the notes folder is inside a vault: without it, links to shared Concept and Library notes elsewhere in the vault are reported as broken. `--scope .` means the whole source root. A WARN about "folders left out" lists the skipped dependency, build, tool and test folders: when the user asked for code in one, name it with `--scope` (tests: `--include-tests`). A WARN about files "of a kind this check does not know" names file types it did not count as code: look at them, and when they hold code, explain them too and say so in the report. Fix every FAIL and MISSING and run it again. Do not report success while the last line says NOT PASSED. PASS speaks of coverage and copied code, not of whether an explanation is right. Do not use `--allow-missing` to get a pass; narrow `--scope` to what the user asked for.
10. **Guided walk.** After the check passes, make the tour for the CodeTour extension: `python -B <this skill's folder>/scripts/make_tour.py --notes <folder> --source <root> --in-project --plan <the plan as JSON>`. The plan file comes from `graph_plan.py --out <file>`, run without `--scope` or with one `--scope` for every file that has a note: the tour is one file for the whole project, rebuilt from all File notes at the end of every run, so do not narrow it to this run's scope. Add `--obsidian-vault <the vault's name>` when you know it. It writes `<root>/.tours/<Project>.tour`, which CodeTour lists by itself when the source root is open in VS Code. Blocks that no longer equal the source are left out and listed: report those. When the source may not be written to, or the user wants no file in the project, use `--out <file>.tour` in place of `--in-project`, with a file outside the source (the notes folder, when the vault's rules allow such a file, else a folder the person names). Start Here then says where it is and that the command "CodeTour: Open Tour File..." opens it.
11. **Report.** Notes added, updated, removed; in a later run the blocks rewritten, added and removed, and the moves written (the `RESULT` line's "written"); whether git or hashes only were used; files still without a note; files the graph did not parse; every masked line the check listed; the folders and file kinds the check left out or did not count as code; cells left "not recorded"; the check's last line, word for word.

## Later runs

Notes of this project exist. Do steps 1 to 3, then the steps below in place of steps 4 to 8. Step 2 (the graph) may be left out when no source file was added or removed and no rewritten or new block changes what is called: the check then takes the kept `graph.json`, and the report says so. Rewrite only the blocks whose code changed. A STALE line of the check means: do this.

1. **What was asked, first.** A source file in scope without a note gets its File note (step 5 of the workflow). When the person asked for a depth in this run and a File note's `depth` property differs, that note is rewritten whole at that depth, with `depth` set, also when its code did not change. No depth asked for: every note keeps its depth. Steps 5 and 6 below follow for each.
2. **Find what changed.** Run `python -B <this skill's folder>/scripts/changed_blocks.py --notes <folder> --source <root> --scope <what is in scope> --fix-moved`. It compares each block's code with the source file on disk, without git or a model. `--fix-moved` writes the new line numbers of blocks that only moved (one `WROTE` line each): only in the heading, `masked_lines` and the templates' own tables, found by their exact heading rows. Each `TODO` line names what is still to do for a note (Mechanism and Flow notes too), and its step. Only when the last line says `CURRENT` (no `TODO` line) and step 1 wrote nothing, go to step 9 of the workflow. `CURRENT` speaks of copied code and hashes, not of explanations. A note with more than half of its blocks `changed` (the `NOTE` line's count; `displaced` and `undecided` blocks never count) is rewritten whole, once you are sure that `--source` and the note's `source` name the right folder and file. These and the two cases of step 1 are the only whole rewrites.
3. **Update each other File note the report names.** One report line, one action, in this order:

| Report line | Do |
| --- | --- |
| `CHANGED block <id>` ... "its new form may be in lines ..." | Read those lines. Rewrite this block only, from the current code: line range and purpose in the heading, code fence, explanation, Level 2 row, and at depth `full` its line rows. When the line says it differs only in spaces at line ends: check that no explanation or value rests on them, then copy the code again |
| `DISPLACED block <id>` | Its code is unchanged, at the lines named. Never rewrite it. Where `--fix-moved` did not write it, set its line numbers by hand (heading, Level 2 row, line rows), put the note's sections in file order and act on the "order of blocks" line. When another block holds those lines, look at the file: one of the two may be gone |
| `AMBIGUOUS block <id>` | Read the lines it names. Set the block's line numbers to its own place, or remove the block when its code is gone (its id goes to `retired_blocks`) |
| `UNEXPLAINED lines a-b` | "probably the new form of block N": take them into block N. Else take them into the block they belong to, or write a new block at its place in file order, with the id the line gives |
| `CHANGED block <id>` ... "its code is gone" | Look at that place in the file. When the code is gone, remove the block's section and its Level 2 row and add its id to the note's `retired_blocks` property |
| `GONE <note>` | The source file is not there, though other notes' sources are. Say which file is gone. Renamed: correct `source` and run again. Deleted: move its File note as the vault's rules say (no rules: delete it) and remove it from the notes that name it. In doubt, ask the person first |
| `PROBLEM` | Never remove, move or rewrite a note on a `PROBLEM` line (a wrong `source` or `--source`, a note not read or written). Correct the cause or tell the person, then run again. "writes nothing for this note": the note holds something the writer does not handle; set the moved line numbers by hand |
| `UNDECIDED block <id>`, `BOUNDED` | The search stopped at its limit (many equal lines), so no move is written for this note. Not a changed block: look at it in the file, set its line numbers by hand, rewrite it only when its code differs |
| `TODO` ... "the order of blocks changed" | The same code in another order can do another thing. Re-read what rests on these blocks (Trace, "Check your understanding", and in step 6 the Flow and Mechanism notes). Then put the block sections and Level 2 rows in file order |
| `TODO` ... "line numbers the note cites" | "line N" in the note's own sentences that a move touched. Where it means this file, write the new number the line gives |

After a block is rewritten, re-read the parts of the same File note that rest on it: its Level 2 row, the lens table of Level 1, the Trace, "Check your understanding" with its answers. Correct every statement and value that the changed code makes wrong; leave the rest. No check can see such a statement.

4. **Ids.** An id is a name, not a position. Never change one, and never give the id of a removed block to another block: other notes cite ids. So every removed id is kept in the File note's property `retired_blocks`, also through a whole rewrite; the check fails when a block uses one. A new block takes the id of the block directly above it in the file plus the first lower-case letter that gives an id neither in the note nor in `retired_blocks`: above `7` it is `7a` (`7b` when `7a` is in use or retired), above `45i` it is `45ia`, above the first block `0a`. After `z` come `za`, `zb`. Each `UNEXPLAINED` line prints this id; a second new block in the same range takes the next letter.
5. **Close the File note.** Correct the line count in its `Source:` line and every line number its text still cites wrongly. Set `commit`, `source_hash` and `written` as in `note-templates.md`. Run `changed_blocks.py` again: the note must show every block `same` and nothing unexplained.
6. **Other notes.** Re-read only the Mechanism and Flow notes whose `sources` name the file and the Concept notes whose "Used in" names it, and in them only the statements that rest on a block that was rewritten, added, removed or reordered. Correct what no longer holds. Where such a note still cites the file as "line N", replace each by its block, once. Then set the Mechanism or Flow note's `commit` and `source_hash`. A Flow note's diagram, steps and outcomes change only when a block it names was rewritten, removed or reordered, or a new block lies on its path. A project without a Flow note gets one. So does a File note added in this run that holds an entry point (a main path) which no Flow note's Steps table names: a new Flow note, or a new part of an existing one, at most three Flow notes unless the person asks for more (step 7 of the workflow).
7. **Start Here, Map, Glossary.** Enter every note this run added and take out every note it removed, in the same run, and refresh the line and block counts of the files whose notes changed: only those rows and links.

Leave every other note as it is. The run ends with the full check, the guided walk and the report (steps 9 to 11). A STALE line in that check for a note of a file in this run's scope is not a pass: go back, at most once for each file, to step 2 (File note) or step 6 (Mechanism, Flow). A STALE note of a file outside the scope is not repaired in this run: name it in the report as "out of date, outside what was asked" and stop.

## Blocks

A block is the lines that together do one thing you can name in a short phrase.

| Rule | Value |
| --- | --- |
| Size | 1 to about 25 lines. One line alone is a block when it does one named thing |
| Boundary | Follows the code: one function, one class, one group of related constants. A simple statement is never cut. A long function, loop or branch may be cut at its own inner structure (next row) |
| Head of the file | The first lines (a mode line such as `'use strict'`, the comment about the file, the lines that load other files) may be one block, "head of the file", or separate blocks when each needs its own explanation |
| Long function | Split into sub-blocks at its own structure: each branch, loop, `try` section or commented step. Number them 3a, 3b, 3c |
| Comments and blank lines | A comment belongs to the block it sits directly above. A comment at the top of the file that describes the whole file belongs to the head of the file |
| Coverage | Every non-blank line of the file is in exactly one block |
| Empty file | A source file with no non-blank line gets a File note with the lens table, the sentence "The file is empty." under Level 2, and no block |

## Which words get a note

| Kind of word | Example | Where it is explained |
| --- | --- | --- |
| A construct or term of the programming language | `function`, `const`, `async`, `require`, template literal | Its own Concept note |
| A sign of the language | `=`, `===`, `!`, `? :` | One row in `Concept - operators and symbols` |
| A general computing word | file, folder, program, operating system, hexadecimal | One row in `Concept - computing words`, a shared table note: word, meaning |
| A word of this project's domain | device key, token, TPM | The "Words" table of the Mechanism note it belongs to, or of Start Here |

When unsure whether a reader who has never programmed knows a word, explain it.

## Rules

| Rule | Meaning |
| --- | --- |
| Code is copied exactly | Each block's code fence holds exactly the source lines of its range. The check compares them character by character |
| No guessing | When the code, the design notes and the history do not say, write "not recorded" and where you looked. That holds for a block's "Why this way" too: never invent a reason |
| Real values | Each value in a line table or trace says where it comes from. A value from running the real code with a made-up input is given plainly, with the run described in the Trace section. A value written in the source or in a test is given with "from the code" and the place. A value that follows from the language's rules is given with "by reading". Anything else is "not run". A line that produces no value is "none" |
| Running code | Only when the project's rules allow it, never with real credentials, never anything that writes, installs, builds or calls a network |
| No secrets | Never copy a token, key or password value. Skip `.env` and key files; a file that is mostly secrets is left out, not explained. On a source line that holds a secret, replace only the secret value with `[masked]`; a whole secret line (an inner line of a key that spans lines) becomes `[masked]` alone. List every line that holds a mask in the note's `masked_lines` property. The check enforces: every masked line is listed; the text around a mask equals the source; what a mask hides appears nowhere else in the note; at most a quarter of a file's lines are masked (two are always allowed). It prints the masked lines; name them in your report so a person can confirm each hides a secret and nothing else |
| No new destination for the code | You, the agent running this skill, read the code; the person chose you and your provider knowing that. The skill adds no other destination: no upload, no web service, no other model or agent, no graphify command other than `update`. When the code belongs to a client or carries a rule about where it may be processed, ask the user before reading it |
| Read-only | Never change the source or its git state, with one exception the owner decided: the guided-walk file in `<source root>/.tours/`, written by `make_tour.py --in-project`, which also adds one line to `.git/info/exclude` (a file git never commits) so the folder stays out of git. Never change a note that does not carry `written_by: argus` in its properties, whatever its name. The check reads only notes with that property, so a person's own notes in the same folder can neither fail it nor be counted as explanations |
| Compact | Tables first. A table cell holds at most about 25 words; anything longer goes into a linked note. A line too rich for one cell gets a small extra table directly under the block's line table, one row per part of the line; its rows must not start with a number |
| Link at each use | Every block names its concepts as `[[links]]`, in every file, not only at first use: a reader may open any note first |
| Examples from this project | Concept notes use the smallest real example from the code in scope, with file and line |
| Unique names | `[[links]]` resolve by name. Use the prefixes in `note-templates.md`. In a note's name, write `-` for each of `[ ] # ^ \|`, which a link cannot hold |
| Nothing hidden | No Obsidian comments (`%% ... %%`) in a note: the reader would not see what is inside. `%%` inside code is fine. Outside code, write `<word>` in backticks: Obsidian reads it as HTML and hides it (the check warns) |
| Tests | Not explained unless the user asks. Test folders (`test`, `tests`, `__tests__`, `spec`) and files named as tests (`*_test.*`, `test_*.*`, `*.test.*`, `*.spec.*`) are left out, and the check says how many |

## An existing notes folder, a second language, size

| Situation | Rule |
| --- | --- |
| The folder already holds argus notes of this project | Keep their names as they are (a vault may forbid renaming). New notes follow the templates' names. Say in Start Here when the two differ |
| Start Here, Glossary or a Mechanism note exists | Add to it; keep its shape (columns, wording) rather than rebuilding it to the template. Replace "no note yet" for every file that now has a note, in every note that names it |
| The Map note | Written and updated only when the whole project is in scope |
| A second programming language in the project | A concept that works the same way keeps its note, with a section "In <language>". A concept or sign that differs gets its own note named with the language: `Concept - PowerShell function`, `Concept - PowerShell operators and symbols`. The first language keeps the plain names |
| How long a block's explanation is at depth `map` | As many sentences as the block needs for this reader, usually two to seven. Every technical word still links to its Concept note |
| The size estimate of step 4 | About 25 words of File note for each source line at depth `map` (the copied code included), and about three times that at `full`. Concept notes: many for the first files of a language, few afterwards. |
| What `--scope` does in the check | It limits which source files must have a note. Every argus note in the folder is checked, whatever the scope |

## Common mistakes

| Mistake | Fix |
| --- | --- |
| A block table with line ranges but no code | Every block section has a code fence. The reader has no editor |
| Explaining lines before saying what the file is for | Lens table first, block table second |
| "Probably", "likely" in a lens cell | "Not recorded", with where you looked |
| Counting lines by hand | Take line numbers from a numbered read of the file; the check's INFO line confirms the counts afterwards |
| A numbered step table inside the code section | Only line tables may start a row with a number there; put traces in the Trace section |
| `\|` inside code in a table cell | Write `\|` |
| A backtick inside code in a table cell | Wrap the code in double backticks with a space inside each end |
| A link with an alias inside a table (`[[Name\|shown text]]`) | Use the plain `[[Name]]` in tables |
| A line row whose Code cell paraphrases the line, or quotes a piece from its middle | Quote the line whole, or its start followed by `…`. A row for several lines quotes the first of them. The check compares it with the source |

## Files in this skill

| File | Use |
| --- | --- |
| `note-templates.md` | The template for each note type. Read it before step 5 |
| `scripts/setup_tools.py` | Finds the tools argus needs and installs graphify and CodeTour. Run it first |
| `scripts/graph_plan.py` | Turns graphify's `graph.json` into the reading plan for step 4. Python 3.10+, no packages |
| `scripts/check_notes.py` | The coverage check. Python 3.10+, no packages. `--json` and `--fingerprint` are for programs |
| `scripts/changed_blocks.py` | For a later run: the state of each block, the unexplained lines, what is still to do. `--fix-moved`, `--hash`, `--json` |
| `scripts/make_tour.py` | Writes a guided walk for the CodeTour extension from the File notes |
| `scripts/_common.py` | Shared by the scripts: which files count as code, how a scope and a note are read, hashes |
| `scripts/test_scripts.py` | Tests of the scripts: `python scripts/test_scripts.py` |
