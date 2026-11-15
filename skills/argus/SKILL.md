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
| Named files or one flow | File notes for those files only; every Concept note they need; a Mechanism note for each mechanism a named file takes part in; a Library note for each library a named file uses directly; Start Here and Glossary, created or updated | `--scope <file>` once per file |

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

1. **Preflight.** Find the source root, the scope and the target folder (ask if any is unclear). When the target is inside an Obsidian vault, look in the vault's root and index notes for rules about notes (naming, deleting, secrets) and follow them; when there are none, or the target is not in a vault, no extra rules apply. Check the tools: `graphify --help` and `git --version` must both run. The package is named `graphifyy` (two y, intended); the command is `graphify`. If `graphify` is missing: stop and tell the user to install it (`pip install graphifyy`, Python 3.10+). When installing is not allowed where you run, stop all the same and say so; the user decides. Do not continue without the graph, for any scope, however small. Never run `graphify install`: it edits `CLAUDE.md` and adds hooks.
2. **Build the graph.** graphify writes `graphify-out/` inside the folder it is run on, so never run it on the source itself. Copy the code in scope to a temporary folder, keeping the paths relative to the source root and leaving out dependencies and build output; leave out tests too, unless the user asked for tests to be explained. Then run `graphify update <that folder>`. That command reads code only and uses no LLM, so graphify sends nothing anywhere. Do not run `graphify label`, `graphify add` or `/graphify`, which can send content to an LLM service. Then run `python -B <this skill's folder>/scripts/graph_plan.py --graph <that folder>/graphify-out/graph.json --source <that folder> --scope <what is in scope>` (add `--include-tests` when tests are in scope). It prints the leaf-first order, what each file uses and is used by, the functions the graph found, the communities that span files, and the code files the graph has no symbols for. For those files, find callers and callees by text search and name the files in the report.
3. **Read the "why".** Design notes, the README and `CLAUDE.md` nearest to the code in scope, then `git log` and `git blame` for the files in scope (read-only git commands only). This is the source for the lens rows "what was not possible without it" and "issues today". A source that does not exist or says nothing about the code in scope is named as such in the cell.
4. **Plan.** From `graph_plan.py`'s output: the file order (a file with no dependencies comes first), the mechanism candidates (communities that span files; judge each by reading the code, since a community is only a hint), and the callers and callees per file. Files the plan lists as using each other in a circle are explained together, in any order within the group. The plan's order and circles come from confirmed uses only. What the graph merely inferred is listed apart, as "may use", with the line: confirm each in the code before stating it, and treat it as a use only when the code shows it. The graph can miss a file that is loaded inside a function (a `require` or `import` that is not at the top of the file): read each file's own load lines as well. Tell the user the depth, the file count and the size estimate, then carry on; only `full all` waits for a yes.
5. **Write File notes, leaf-first.** Use `note-templates.md`. When a programming term appears for the first time, write its Concept note before going on. Later files link to it.
6. **Write Mechanism and Library notes** from the File notes and the graph clusters. Each Mechanism note has a Mermaid sequence diagram.
7. **Write the End-to-End Flow note** when the depth is `full <flow>` or the user asks. REQUIRED SUB-SKILL when installed: `archify`, for tracing from the real entry point to the real result.
8. **Write Start Here, Map and Glossary last**, from the notes below them. When the `obsidian-bases` skill is installed, use it for a view of all File notes by `status` and `depth`; otherwise keep a table in Start Here. When `obsidian-markdown` or `json-canvas` are installed, use them for syntax and for a canvas map.
9. **Run the check.** `python -B <this skill's folder>/scripts/check_notes.py --notes <folder> --source <root> --scope <what is in scope> --graph <graph JSON>`. The graph is part of the check: `--no-graph` exists only for a run where graphify could not parse any file in scope, and the result line then says `PASS WITHOUT THE GRAPH CHECK`, which you report as such. Add `--include-tests` when the user asked for tests to be explained. Add `--vault <vault root>` whenever the notes folder is inside a vault: without it, links to shared Concept and Library notes elsewhere in the vault are reported as broken. `--help` lists the options. `--scope .` means the whole source root. A WARN about "folders left out" lists the dependency, build, tool and test folders it skipped and how many code files each holds: when the user asked for code in one of them, name it with `--scope` (tests: `--include-tests`). A WARN about files "of a kind this check does not know" names file types it did not count as code: look at them, and when they hold code, explain them too and say so in the report. Fix every FAIL and MISSING and run it again. Do not report success while the last line says NOT PASSED. Do not use `--allow-missing` to get a pass; narrow `--scope` to what the user asked for.
10. **Report.** Notes added, updated, removed; files still without a note; files the graph did not parse; every masked line the check listed; the folders and file kinds the check left out or did not count as code; cells left "not recorded"; the check's last line, word for word.

## Later runs

| Situation | Do |
| --- | --- |
| The check marks a File note STALE (its source has a newer commit) | Rewrite that File note from the current code |
| A source file in scope has no note | Write its File note |
| The user asks for `full` and the note is `map` (or the reverse) | Rewrite the File note at the requested depth and set its `depth` property |
| A File note was rewritten | Re-read every Mechanism and Flow note whose `sources` property names that file, and every Concept note whose "Used in" names it; correct what no longer holds, then set the Mechanism or Flow note's `commit` to the source's current commit |
| The check marks a Mechanism or Flow note STALE | One of its `sources` changed: check it against the code and update it as above |
| A source file was deleted | Move its File note according to the vault's rules (no vault rules: delete it) and remove it from the notes that name it |
| Nothing above applies to a note | Leave it as it is |

## Blocks

A block is the lines that together do one thing you can name in a short phrase.

| Rule | Value |
| --- | --- |
| Size | 1 to about 25 lines. One line alone is a block when it does one named thing |
| Boundary | Follows the code: one function, one class, one group of related constants. Never cuts a statement |
| Long function | Split into sub-blocks at its own structure: each branch, loop, `try` section or commented step. Number them 3a, 3b, 3c |
| Comments and blank lines | A comment belongs to the block it sits directly above. A comment at the top of the file that describes the whole file, or something further down, is a block of its own |
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
| No guessing | When the code, the design notes and the history do not say, write "not recorded" and where you looked |
| Real values | Each value in a line table or trace says where it comes from. A value from running the real code with a made-up input is given plainly, with the run described in the Trace section. A value written in the source or in a test is given with "from the code" and the place. A value that follows from the language's rules is given with "by reading". Anything else is "not run". A line that produces no value is "none" |
| Running code | Only when the project's rules allow it, never with real credentials, never anything that writes, installs, builds or calls a network |
| No secrets | Never copy a token, key or password value. Skip `.env` and key files; a file that is mostly secrets is left out, not explained. On a source line that holds a secret, replace only the secret value with `[masked]`; a whole secret line (an inner line of a key that spans lines) becomes `[masked]` alone. List every line that holds a mask in the note's `masked_lines` property. The check enforces: every masked line is listed; the text around a mask equals the source; what a mask hides appears nowhere else in the note; at most a quarter of a file's lines are masked (two are always allowed). It prints the masked lines; name them in your report so a person can confirm each hides a secret and nothing else |
| No new destination for the code | You, the agent running this skill, read the code; the person chose you and your provider knowing that. The skill adds no other destination: no upload, no web service, no other model or agent, no graphify command other than `update`. When the code belongs to a client or carries a rule about where it may be processed, ask the user before reading it |
| Read-only | Never change the source or its git state. Never change a note that does not carry `written_by: argus` in its properties, whatever its name. The check reads only notes with that property, so a person's own notes in the same folder can neither fail it nor be counted as explanations |
| Compact | Tables first. A table cell holds at most about 25 words; anything longer goes into a linked note. A line too rich for one cell gets a small extra table directly under the block's line table, one row per part of the line; its rows must not start with a number |
| Link at each use | Every block names its concepts as `[[links]]`, in every file, not only at first use: a reader may open any note first |
| Examples from this project | Concept notes use the smallest real example from the code in scope, with file and line |
| Unique names | `[[links]]` resolve by name. Use the prefixes in `note-templates.md`. In a note's name, write `-` for each of `[ ] # ^ \|`, which a link cannot hold |
| Nothing hidden | No Obsidian comments (`%% ... %%`) in a note: the reader would not see what is inside |
| Tests | Not explained unless the user asks. Test folders (`test`, `tests`, `__tests__`, `spec`) and files named as tests (`*_test.*`, `test_*.*`, `*.test.*`, `*.spec.*`) are left out, and the check says how many |

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
| Passing the check with `--allow-missing` | Narrow `--scope` to what was asked for |
| Reporting "done" without running the check | Step 9 is not optional |

## Files in this skill

| File | Use |
| --- | --- |
| `note-templates.md` | The template for each note type. Read it before step 5 |
| `scripts/graph_plan.py` | Turns graphify's `graph.json` into the reading plan for step 4. Python 3.10+, no packages |
| `scripts/check_notes.py` | The coverage check. Python 3.10+, no packages |
| `scripts/_common.py` | Shared by the two scripts: which files count as code, how a scope is read |
| `scripts/test_scripts.py` | Tests of the two scripts: `python scripts/test_scripts.py` |
