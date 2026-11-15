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

## The lens

Every project, file, mechanism and library gets these rows. Concept notes get the rows that apply.

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

1. **Preflight.** Find the source root and the target folder in the vault (ask if either is unclear). Read the vault's own rules note if it has one, and follow it. Check `graphify` and `git` are installed. If `graphify` is missing: stop and tell the user to install it (`pip install graphifyy`, Python 3.10+). Do not continue without the graph. Never run `graphify install`: it edits `CLAUDE.md` and adds hooks.
2. **Build the graph.** Run graphify on the source root (see `graphify --help` for the current command). Write its output outside the source tree when it allows an output path; if it can only write `graphify-out/` inside the source tree, ask the user first. Read the graph JSON. List the source files it did not parse; cover those by text search and name them in the report.
3. **Read the "why".** Design notes, README and `CLAUDE.md`, then `git log` and `git blame` for the files in scope. This is the source for the lens rows "what was not possible without it" and "issues today".
4. **Plan.** From the graph: order the files leaf-first (a file with no dependencies comes first), list mechanism candidates (clusters of functions across files), record callers and callees per file. Tell the user the depth, the file count and the size estimate.
5. **Write File notes, leaf-first.** Use `note-templates.md`. When a programming term appears for the first time, write its Concept note before going on. Later files link to it.
6. **Write Mechanism and Library notes** from the File notes and the graph clusters. Each Mechanism note has a Mermaid sequence diagram.
7. **Write the End-to-End Flow note** when the depth is `full <flow>` or the user asks. REQUIRED SUB-SKILL when installed: `archify`, for tracing from the real entry point to the real result.
8. **Write Start Here, Map and Glossary last**, from the notes below them. When the `obsidian-bases` skill is installed, use it for a view of all File notes by `status` and `depth`; otherwise keep a table in Start Here. When `obsidian-markdown` or `json-canvas` are installed, use them for syntax and for a canvas map.
9. **Run the check.** `python scripts/check_notes.py --notes <folder> --source <root>` (add `--vault`, `--graph` as needed; `--help` lists the options). Fix every FAIL and run it again. Do not report success while it fails.
10. **Report.** Notes added, updated, removed; files still without a note; files the graph did not parse; cells left "not recorded"; the check's last line.

On a later run, rewrite only the notes the check marks STALE and the notes for new files; move notes of deleted files according to the vault's rules.

## Blocks

A block is the lines that together do one thing you can name in a short phrase.

| Rule | Value |
| --- | --- |
| Size | 1 to about 25 lines. One line alone is a block when it does one named thing |
| Boundary | Follows the code: one function, one class, one group of related constants. Never cuts a statement |
| Long function | Split into sub-blocks at its own structure: each branch, loop, `try` section or commented step. Number them 3a, 3b, 3c |
| Comments and blank lines | Belong to the block they describe |
| Coverage | Every non-blank line of the file is in exactly one block |

## Rules

| Rule | Meaning |
| --- | --- |
| Code is copied exactly | Each block's code fence holds exactly the source lines of its range. The check compares them character by character |
| No guessing | When the code, the design notes and the history do not say, write "not recorded" and where you looked |
| Real values | Values in line tables and traces come from the project's real data, or from running the real code with a made-up input. Otherwise write "not run" |
| Running code | Only when the project's rules allow it, never with real credentials, never anything that writes, installs, builds or calls a network |
| No secrets | Never copy a token, key or password value. Skip `.env` and key files. A source line that holds one is copied with the value replaced by `[masked]` |
| Read-only | Never change the source, its git state, or existing notes that this skill did not write |
| Compact | Tables first. A table cell holds at most about 25 words; anything longer goes into a linked note |
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
| Counting lines by hand | Take counts and ranges from the check's output |
| A numbered step table inside the code section | Only line tables may start a row with a number there; put traces in the Trace section |
| `\|` inside code in a table cell | Write `\|` |
| Reporting "done" without running the check | Step 9 is not optional |

## Files in this skill

| File | Use |
| --- | --- |
| `note-templates.md` | The template for each note type. Read it before step 5 |
| `scripts/check_notes.py` | The coverage check. Python 3.10+, no packages |
