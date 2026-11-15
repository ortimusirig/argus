---
name: code-explainer-sg
description: Use when the user asks to explain a codebase or part of one for a reader who does not program, to write or update a code walkthrough in an Obsidian vault, or says "explain this code", "update the walkthrough", "explain the new code", "document this for a learner" or "code-explainer-sg".
---

# Code Explainer: learner-level notes in Obsidian

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

Every project, file, mechanism and library gets these rows. Concept notes use the shorter six-row form in `note-templates.md`.

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
2. **Build the graph.** Run graphify on the source root (see `graphify --help` for the current command). Its output must land outside the source tree: use its output option when it has one; otherwise copy the source to a temporary folder and run it there. Read the graph JSON. List the source files it did not parse; find their callers and callees by text search and name those files in the report.
3. **Read the "why".** Design notes, the README and `CLAUDE.md` nearest to the code in scope, then `git log` and `git blame` for the files in scope (read-only git commands only). This is the source for the lens rows "what was not possible without it" and "issues today". A source that does not exist or says nothing about the code in scope is named as such in the cell.
4. **Plan.** From the graph: order the files leaf-first (a file with no dependencies comes first), list mechanism candidates (clusters of functions across files), record callers and callees per file. Tell the user the depth, the file count and the size estimate, then carry on; only `full all` waits for a yes.
5. **Write File notes, leaf-first.** Use `note-templates.md`. When a programming term appears for the first time, write its Concept note before going on. Later files link to it.
6. **Write Mechanism and Library notes** from the File notes and the graph clusters. Each Mechanism note has a Mermaid sequence diagram.
7. **Write the End-to-End Flow note** when the depth is `full <flow>` or the user asks. REQUIRED SUB-SKILL when installed: `archify`, for tracing from the real entry point to the real result.
8. **Write Start Here, Map and Glossary last**, from the notes below them. When the `obsidian-bases` skill is installed, use it for a view of all File notes by `status` and `depth`; otherwise keep a table in Start Here. When `obsidian-markdown` or `json-canvas` are installed, use them for syntax and for a canvas map.
9. **Run the check.** `python <this skill's folder>/scripts/check_notes.py --notes <folder> --source <root> --scope <what is in scope> --graph <graph JSON>`. Add `--vault <vault root>` whenever the notes folder is inside a vault: without it, links to shared Concept and Library notes elsewhere in the vault are reported as broken. `--help` lists the options. Fix every FAIL and MISSING and run it again. Do not report success while the last line says NOT PASSED. Do not use `--allow-missing` to get a pass; narrow `--scope` to what the user asked for.
10. **Report.** Notes added, updated, removed; files still without a note; files the graph did not parse; cells left "not recorded"; the check's last line.

On a later run, rewrite only the notes the check marks STALE and the notes for new files; move notes of deleted files according to the vault's rules.

## Blocks

A block is the lines that together do one thing you can name in a short phrase.

| Rule | Value |
| --- | --- |
| Size | 1 to about 25 lines. One line alone is a block when it does one named thing |
| Boundary | Follows the code: one function, one class, one group of related constants. Never cuts a statement |
| Long function | Split into sub-blocks at its own structure: each branch, loop, `try` section or commented step. Number them 3a, 3b, 3c |
| Comments and blank lines | A comment belongs to the block it sits directly above. A comment at the top of the file that describes the whole file, or something further down, is a block of its own |
| Coverage | Every non-blank line of the file is in exactly one block |

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
| No secrets | Never copy a token, key or password value. Skip `.env` and key files. A source line that holds one is copied with the value replaced by `[masked]` |
| Read-only | Never change the source, its git state, or existing notes that this skill did not write |
| Compact | Tables first. A table cell holds at most about 25 words; anything longer goes into a linked note. A line too rich for one cell gets a small extra table directly under the block's line table, one row per part of the line; its rows must not start with a number |
| Link at each use | Every block names its concepts as `[[links]]`, in every file, not only at first use: a reader may open any note first |
| Examples from this project | Concept notes use the smallest real example from the code in scope, with file and line |
| Unique names | `[[links]]` resolve by name. Use the prefixes in `note-templates.md` |
| Tests | Not explained unless the user asks |

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
| A line row whose Code cell paraphrases the line | Quote the line, or its start followed by `…`; the check compares it with the source |
| Passing the check with `--allow-missing` | Narrow `--scope` to what was asked for |
| Reporting "done" without running the check | Step 9 is not optional |

## Files in this skill

| File | Use |
| --- | --- |
| `note-templates.md` | The template for each note type. Read it before step 5 |
| `scripts/check_notes.py` | The coverage check. Python 3.10+, no packages |
