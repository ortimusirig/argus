# argus

Argus (after the hundred-eyed watchman of Greek myth; earlier name: code-explainer-sg) is a Claude Code skill that explains a codebase for a reader who has never programmed. The output is a set of linked Obsidian notes. The reader never opens a code editor: every line of code is copied into the notes, next to its explanation.

## What it writes

| Note | One per | Content |
| --- | --- | --- |
| Start Here, Map, Glossary | project | What the system is, how its files connect, the reading order |
| File | source file | Purpose, blocks with their code, and (on request) every line with a real value |
| Concept | programming term | The term explained from zero, with the smallest real example from the code |
| Mechanism | behaviour that spans files | Steps, a sequence diagram, failure paths |
| Library | open-source project or system service | What it is, version, licence, where it is used |
| End-to-End Flow | chosen flow | One real input followed from entry point to result |

Every project, file, mechanism and library answers the same questions: what we gain, what we lose, what was not possible without it, issues today, what it makes possible, open source used, risks.

## Depth

| Setting | Writes |
| --- | --- |
| `map` (default) | Purpose and blocks for every file; each block shows its code |
| `full <file or flow>` | Adds a line-by-line table, a trace and check questions for the named files |
| `full all` | Line by line for every file, after stating the size and getting a yes |

## Requirements

| Item | Needed for |
| --- | --- |
| Python 3.10+ | The check script |
| [graphify](https://github.com/Graphify-Labs/graphify) (`pip install graphifyy`) | Required. The graph gives the file order, the callers and callees, and the mechanism candidates. The skill stops without it. It is run as `graphify update <copy of the code>`, which uses no LLM. Do not run `graphify install` |
| git | The history behind "what was not possible without it" and "issues today"; detecting notes that went stale |
| [obsidian-skills](https://github.com/kepano/obsidian-skills) | Optional: Obsidian syntax, canvas maps, Bases views |

## Install

Copy `skills/argus` into `~/.claude/skills/`, or add this repository as a Claude Code plugin.

## The check

```bash
python -B skills/argus/scripts/check_notes.py --notes <notes folder> --source <source root> --scope <folder or file in scope> --graph <graphify-out/graph.json>
```

It fails when a source file in scope has no note, a non-blank line is in no block, a block's code differs from the source, a line has no row or its row quotes code that is not on that line (depth `full`), a lens row is missing or empty, a function in the graph is never named in its file's note, a Mechanism note has no diagram, a link points nowhere, a note is empty or nothing links to a note. It reports notes whose source changed since they were written as STALE. `--help` lists the options.

## Status

Version 2.6.0. Replaces the DOCX generator of version 1.

| Part | State |
| --- | --- |
| Note format and check script | Tried on three real files (105 lines): the check passes on the notes and fails on deliberately broken copies (11 kinds of defect) |
| The skill text | Followed once by a fresh agent with no other context, on one 19-line file at depth `full`: it produced 30 notes that pass the check. A second fresh agent, without graphify, stopped at preflight as the skill requires. Their 30 reported gaps led to version 2.0.1. Not yet tried on a whole project or at depth `map` |
| graphify step | Run for real with graphify 0.9.103 on a 42-file JavaScript and PowerShell project: 1,329 nodes, 3,529 edges, no LLM used. `scripts/graph_plan.py` turns the graph into the reading order, callers and callees, and mechanism candidates; the callers it gave for one file matched a text search exactly. The check's graph comparison passed on the real graph. Known limits seen: two shell and PowerShell installer scripts gave no symbols, and a `require` inside a function was not in the graph |
| Codex review | Round 1 (2026-11-15): 2 P1 and 7 P2 findings, all confirmed and fixed in 2.3.0, each with a test in `scripts/test_scripts.py` (14 tests). Round 2: 4 P1 and 4 P2, all confirmed and fixed in 2.4.0 with tests (20 tests). Round 3: 3 P1 and 5 P2, all confirmed and fixed in 2.5.0 with tests. After three rounds without fewer findings, a fresh agent probed the scripts adversarially (52 probes it ran itself): 20 findings and 7 minor ones, all confirmed. The check script was rewritten rather than patched (2.6.0); 55 tests. Round 4 pending |
| Bases view, canvas map | Left to obsidian-skills; not yet tried |
