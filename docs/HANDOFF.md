# Argus: handoff

Read this first. It is kept current after every step, so a new agent with no other context can continue the work.

Last updated: 2026-11-15, after commit `185533d` (version 2.2.0).

## Status

| Item | State |
|---|---|
| Released | 2.2.0 on `main`: the skill, its templates, `check_notes.py`, `graph_plan.py` |
| In progress | Codex review, round 1, of the skill at commit `dd81c53` (before the rename). Findings not in yet |
| Answered 2026-11-15 | AURA and the VS Code extension: see "AURA route" below |
| Next step | 1. Handle the Codex findings (fix, or rebut with evidence), commit, review again until clean. 2. Write the design note for the VS Code extension and have Codex review it |
| Owner action open | Rename the GitHub repository `ortimusirig/code-explainer` to `argus` (optional; only the owner can) |

## What Argus is

A Claude Code skill. It makes an agent write Obsidian notes that let an intelligent adult who has never programmed understand a codebase: purpose, then blocks, then lines, with every line of code copied into the notes and a script that proves nothing was skipped. Earlier name: `code-explainer-sg` (version 1 produced a DOCX).

## The owner's goal (2026-11-15, his words, shortened)

Autonomous product improvement: plan (with review), build (with review), deploy, test, find bugs and issues, add features (based on research), and repeat the loop autonomously, using the review skill and the superpowers skills. A handoff must always be ready, in case usage runs out or the work moves to another agent without context.

## The loop

One pass, in order. Do not skip a gate.

| # | Stage | How | Gate before the next stage |
|---|---|---|---|
| 1 | Research | Web search and the product's own test results: what is missing, what breaks | A dated entry in "Backlog" below |
| 2 | Design | `superpowers:brainstorming`; a design note in `docs/design/` | Codex review of the note is clean (`xreview.sh plan`) |
| 3 | Plan | `superpowers:writing-plans`; a plan note in `docs/plans/` | Codex review of the note is clean |
| 4 | Build | `superpowers:test-driven-development`: a small failing test next to the code, then the code | Tests for the changed files pass |
| 5 | Review | `xreview.sh code`; findings handled with `superpowers:receiving-code-review` | Codex review of the commit is clean |
| 6 | Deploy | Push to `main`; bump the version in `.claude-plugin/plugin.json` and `README.md` | `superpowers:verification-before-completion`: evidence in this file |
| 7 | Test | A fresh agent follows the skill on real code; the check script runs; for the extension, it is run in VS Code | Results recorded under "Test record" |
| 8 | Update this file | Status, next step, backlog | Then start again at 1 |

Skills to use:

| Skill | For | Source |
|---|---|---|
| `cross-model-review` | The Codex review gate (`~/.claude/skills/cross-model-review`, script `scripts/xreview.sh`) | github.com/ortimusirig/cross-review-dev-skill |
| superpowers | brainstorming, writing-plans, test-driven-development, systematic-debugging, verification-before-completion, receiving-code-review | github.com/obra/superpowers |
| `ui-ux-pro-max` | Any interface work (the VS Code panel, the later localhost page) | github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| caveman | Terse replies to the owner in chat. Files, commits and notes stay in normal English | github.com/JuliusBrussee/caveman |

When the owner's instructions and a skill disagree, the owner's instructions win. The owner asked for autonomy: decide, record the decision and its reason here, and carry on; ask only when a decision is his alone (spending, publishing outside his repositories, anything that cannot be undone).

## Roadmap

| Version | Content | State |
|---|---|---|
| 2.x | The skill: Obsidian notes, three levels, lens, concepts from zero, graphify required, coverage check | Released |
| 3.0 | VS Code extension: select lines, the explanation appears beside them; fetched from the notes when they exist and are current, otherwise created then and saved | Design not started |
| 3.1 | The same as a localhost page (code left, explanation right), reusing the extension's lookup | After 3.0 |

Design points already agreed with the owner for 3.0:

| Point | Decision |
|---|---|
| Lookup | By the File note's `source` property and its block headings `(lines a-b)` |
| Line drift after edits | Match a block by its code text, not its line numbers |
| Stale note (`commit` differs) | Show it marked "code changed since"; offer a refresh |
| No note | Run the skill on that file or block, save the note in the vault, run the check, show it |
| Slow creation | Show the purpose first, the line table when ready |
| LLM route | The extension itself makes no LLM call. It hands the request to a coding agent already in VS Code (Claude Code, Codex or OpenCode), which runs the argus skill. See "AURA route" |

### AURA route (coordinator session's answer, 2026-11-15)

| Question | Answer |
|---|---|
| Can the extension call AURA over plain HTTP? | No. `<origin>/ai/v1` is the model endpoint the AURA helper sets up for OpenCode, tied to the helper's sign-in and device key. It is not a public API; a new client would need its own design and review |
| Supported today (a) | Run argus as an AURA skill inside an AURA-connected agent in VS Code: the Claude Code, Codex or OpenCode extensions the helper already connects. Recommended now |
| Later (b) | A VS Code extension that speaks MCP to the local `aura mcp` server as a registered client. Needs a design note and a Codex review on the AURA side first |
| Wait for helper 0.6.13? | No. It adds nothing argus needs |
| argus as an AURA skill or agent | Fits: AURA skills are listed and loaded in coding agents (`list_skills`, `load_skill`) and usable in chat |
| Rules | Explaining code needs no approval card. The owner's own Applexus code may go through AURA. Client code only when that engagement allows it; otherwise ask the owner. No secret values in notes or prompts |
| AURA notes to read | Vault `Applexus GPT\config`: "AURA platform consolidation design 2026-11-15" (parts 2-3); in `config\GitHub Halo EULR OpenCode`: "AURA parity 1 machine track 0.6.0 refresh 2026-11-11", "AURA helper 0.6.12 plan 2026-11-15" |

Consequence for the 3.0 design: the extension does lookup and display on its own (no LLM, no AURA). For "create", it passes the file and line range to the coding agent in VS Code, which follows the skill; with AURA connected to that agent, the work runs through AURA. Publishing argus as an AURA skill is a separate, small step.

## Where things are

| Thing | Place |
|---|---|
| This repository | `C:\dev\argus`, remote `https://github.com/ortimusirig/code-explainer.git`, branch `main`, private |
| The skill | `skills/argus/` (`SKILL.md`, `note-templates.md`, `scripts/`) |
| graphify | Version 0.9.103 in its own environment: `C:\Users\aiuser4\.venvs\graphify\Scripts\graphify.exe`. Not on PATH |
| Example notes written by hand | Obsidian vault, `Applexus GPT\01.01 Helper Build` (25 notes on the AURA helper's `errors.js` and `secretbox.js`). They describe AURA internals: never push them to this repository |
| Code the examples explain | `C:\dev\applexus-chat\aura-helper` and `aura-setup` (the "helper build", version 0.6.12 on `master`) |
| Review helper | `~/.claude/skills/cross-model-review/scripts/xreview.sh` (`detect`, `plan`, `code`, `gate`) |

## Rules that hold

| Rule | Why |
|---|---|
| `C:\dev\applexus-chat` is read-only for this work: no writes, no git command that changes anything, no builds, installs or tests there | Other sessions build there; the coordinator session set this rule |
| Run graphify only on a copy of the code, only as `graphify update <folder>`; never `graphify install`, `label`, `add` | `update` uses no LLM and sends nothing out; `install` edits `CLAUDE.md` and adds hooks |
| No secret values in any note, commit or prompt | Owner rule in the vault and in the review skill |
| Codex reads what it is given and sends it to OpenAI | Give it this repository only, never client code or the AURA example notes |
| Commit author | The git identity is set in this clone's local config; do not change it |
| Commits end with the `Co-Authored-By` line of the agent that made them | Attribution |

## Test record

| Date | What | Result |
|---|---|---|
| 2026-11-15 | `check_notes.py` on three explained files (105 source lines, 55 notes) | PASS |
| 2026-11-15 | The same notes broken in 11 ways | Every defect reported, exit code 1 |
| 2026-11-15 | Fresh agent, skill only, graphify absent | Stopped at preflight, wrote nothing |
| 2026-11-15 | Fresh agent, skill only, hand-made graph, one 19-line file, depth `full` | 30 notes, check passed first run; 30 gaps reported, fixed in 2.0.1 |
| 2026-11-15 | graphify 0.9.103 on a copy of the helper code (42 files) | 1,329 nodes, 3,529 edges, no LLM; callers of one file match a text search; `install.ps1` gave no symbols; a `require` inside a function is missing from the graph |

Not yet tested: a whole project, depth `map`, the notes rendered in Obsidian, more than one agent run per case.

## Backlog

| # | Item | Source |
|---|---|---|
| 1 | Run the skill on the whole helper build at depth `map` (42 files, about 20,900 lines) and record what breaks | Untested scale |
| 2 | Open the example notes in Obsidian: tables, Mermaid diagrams, links | Never viewed rendered |
| 3 | `SKILL.md` is about 2,400 words; the skill-writing guidance aims for far less. Move detail into `note-templates.md` or a rules file | Size |
| 4 | Bases view and canvas map through obsidian-skills | Not tried |
| 5 | A second fresh-agent run per case, to see variance | One run each so far |
| 6 | VS Code extension (3.0) | Owner request |
| 7 | Localhost page (3.1) | Owner request |

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-15 | Obsidian notes replace the DOCX of version 1 | Owner: links, backlinks, one note per file |
| 2026-11-15 | graphify is required; the skill stops without it | Owner: "enforce it" |
| 2026-11-15 | Default depth `map`; line tables only for named files or flows | 20,900 lines at full depth is about 7 MB of notes |
| 2026-11-15 | A graphify release at least 10 days old was installed, in its own environment | The newest release was hours old; caution with new packages |
| 2026-11-15 | Name: argus | Owner's choice |
| 2026-11-15 | VS Code extension first, localhost page in the next release | Owner's choice |
