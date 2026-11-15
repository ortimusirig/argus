# code-explainer-sg

A Claude Code skill that explains a codebase for a reader who has never programmed. The output is a set of linked Obsidian notes. The reader never opens a code editor: every line of code is copied into the notes, next to its explanation.

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
| [graphify](https://github.com/safishamsi/graphify) (`pip install graphifyy`) | Required. The graph gives the file order, the callers and callees, and the mechanism candidates. The skill stops without it. Do not run `graphify install` |
| git | The history behind "what was not possible without it" and "issues today"; detecting notes that went stale |
| [obsidian-skills](https://github.com/kepano/obsidian-skills) | Optional: Obsidian syntax, canvas maps, Bases views |

## Install

Copy `skills/code-explainer-sg` into `~/.claude/skills/`, or add this repository as a Claude Code plugin.

## The check

```bash
python skills/code-explainer-sg/scripts/check_notes.py --notes <notes folder> --source <source root>
```

It fails when a source file has no note, a non-blank line is in no block, a block's code differs from the source, a line has no row (depth `full`), a lens row is missing, a link points nowhere, a note is empty or nothing links to a note. It reports notes whose source changed since they were written as STALE. `--help` lists the options.

## Status

Version 2.0.0. Replaces the DOCX generator of version 1.

| Part | State |
| --- | --- |
| Note format and check script | Tried on two real files (86 lines): the check passes on the notes and fails on deliberately broken copies |
| graphify step | Written from graphify's documentation; not yet run. The graph comparison in the check reads the graph loosely and may need adjusting after the first real run |
| Bases view, canvas map | Left to obsidian-skills; not yet tried |
| The skill text itself | Not yet tested by having a fresh agent follow it on a new codebase |
