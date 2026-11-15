# Argus: handoff

Read this first. It is kept current after every step, so a new agent with no other context can continue the work.

Last updated: 2026-11-15, version 2.6.1 (`check_notes.py --json`).

## Status

| Item | State |
|---|---|
| Released | 2.7.1 on `main` (`make_tour.py` for CodeTour; fingerprint counts every note file; 64 tests): the skill, its templates, `check_notes.py` (with `--json`), `graph_plan.py`, `_common.py`, `test_scripts.py` (59 tests) |
| In progress | Extension: the design note on branch `vscode-extension` (worktree `C:\dev\argus-ext`, `docs/design/2026-11-15-vscode-extension-design.md`) is at revision 4 and in Codex round 4. Rounds so far: 8, 4, 4 findings, all accepted; the note records each round at its end. Skill: Codex round 4 is still owed (after 2.6.0 and 2.6.1) |
| Answered 2026-11-15 | AURA and the VS Code extension: see "AURA route" below |
| Next step | 1. Handle design round 4; repeat until clean. 2. Codex round 4 on the skill (`xreview.sh plan skills/argus/SKILL.md ... --source C:/dev/argus`), one Codex run at a time. 3. Plan note for the extension (`docs/plans/` on the branch), Codex review. 4. Build on the branch, core first (`vscode/src/core/`), tests next to the code |
| Stop rule | The owner (2026-11-15, latest word): continue until all features are complete or plan usage reaches 30% (weekly, all models; first 40%, then 20%, then 30%). It was 11% at the last look. The loop is driven by `/loop` in the session; a new agent restarts it with the same goal text |
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
| `a2ui` | Interface that an agent generates at run time. Not needed for the 3.0 panel (fixed layout over stored notes); look again for the create step's progress display | github.com/a2ui-project/a2ui |
| caveman | Terse replies to the owner in chat. Files, commits and notes stay in normal English | github.com/JuliusBrussee/caveman |

When the owner's instructions and a skill disagree, the owner's instructions win. The owner asked for autonomy: decide, record the decision and its reason here, and carry on; ask only when a decision is his alone (spending, publishing outside his repositories, anything that cannot be undone).

## Roadmap

| Version | Content | State |
|---|---|---|
| 2.x | The skill: Obsidian notes, three levels, lens, concepts from zero, graphify required, coverage check | Released |
| 3.0 | VS Code extension: select lines, the explanation appears beside them; fetched from the notes when they exist and are current, otherwise created then and saved | Design not started |
| 2.7 | Guided walk: a CodeTour tour file made from the File notes (`make_tour.py`) | Released |
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
| Codex reads what it is given and sends it to OpenAI | Give it this repository only, never client code, the AURA example notes or a graph made from AURA code |
| Do not change this checkout while a Codex run is in progress | The helper voids the run. Work on another branch in a separate worktree meanwhile |
| Commit author | The git identity is set in this clone's local config; do not change it |
| Commits end with the `Co-Authored-By` line of the agent that made them | Attribution |

## Test record

| Date | What | Result |
|---|---|---|
| 2026-11-15 | `check_notes.py` on three explained files (105 source lines, 55 notes) | PASS |
| 2026-11-15 | The same notes broken in 11 ways | Every defect reported, exit code 1 |
| 2026-11-15 | Fresh agent, skill only, graphify absent | Stopped at preflight, wrote nothing |
| 2026-11-15 | Fresh agent, skill only, hand-made graph, one 19-line file, depth `full` | 30 notes, check passed first run; 30 gaps reported, fixed in 2.0.1 |
| 2026-11-15 | Fresh agent probes the scripts adversarially (52 probes) | 20 findings and 7 minor ones; check script rewritten; 55 tests pass; the real example notes still pass with the real graph |
| 2026-11-15 | graphify 0.9.103 on a copy of the helper code (42 files) | 1,329 nodes, 3,529 edges, no LLM; callers of one file match a text search; `install.ps1` gave no symbols; a `require` inside a function is missing from the graph |

Not yet tested: a whole project, depth `map`, the notes rendered in Obsidian, more than one agent run per case.

## Codex review record

Run with `bash ~/.claude/skills/cross-model-review/scripts/xreview.sh plan <SKILL.md> <outdir> --source <this repo> --ctx <context file>`. One Codex run at a time. Do not change the repository while a run is in progress: the helper voids the run.

| Round | Subject | Outcome | Disposition |
|---|---|---|---|
| 1 | `SKILL.md` and the repository at `dd81c53` | P0=0 P1=2 P2=7 P3=0. The helper marked the run void because the skill folder was renamed while it ran; the findings were read and are valid | All 9 confirmed against the code and fixed in 2.3.0, each with a test |

| 2 | `SKILL.md` and the repository at `649d685` (2.3.0) | P0=0 P1=4 P2=4 P3=0; coverage marked incomplete because no real graph file was supplied | All 8 confirmed and fixed in 2.4.0, each code fix with a test; a made-up graph in graphify's shape is now in `docs/graph-sample.json` |

| 3 | `SKILL.md` and the repository at `633ec6a` (2.4.0) | P0=0 P1=3 P2=5 P3=0; coverage complete | All 8 confirmed and fixed in 2.5.0 with tests |

Trend: 9, 8, 8 findings. The review skill says to step back after three rounds without a downward trend. Change of approach (2026-11-15): before each further Codex round, a fresh agent probes the scripts adversarially with probes it must actually run, and its confirmed findings are fixed first. The Codex rounds had each found a new layer of the same kinds of hole (false pass, false fail, files missing from coverage, paths and letter case, Markdown parsing); a broad own probe is cheaper than one Codex round per layer.

Own adversarial probe (2026-11-15, on 2.5.0): a fresh agent with no other context wrote and ran 52 probes (scripts kept in the session's scratch folder, not in the repository). 20 findings and 7 minor ones, all confirmed. Instead of 27 more patches, `check_notes.py` was rewritten around a clearer model, and `_common.py` and `graph_plan.py` were reworked (2.6.0). What changed:

| Area | Before | Now |
|---|---|---|
| Masks | Any line could be masked; a note with no real code could pass | Every masked line must be listed in `masked_lines`; at most a quarter of a file; what a mask hides may not appear elsewhere in the note; masked lines are printed for a person to confirm |
| Code cell of a line row | Any piece of any line in the range | The row's first non-blank line, whole or its start followed by `…` |
| Source encodings | UTF-8 only: a UTF-16, BOM or Windows-1252 file could never pass | Read as an editor shows them; notes with a BOM too |
| Graph paths | A leading folder in graph paths could skip files silently | The leading folders are dropped once for the whole graph, then exact match; a graph that covers no explained file fails; the result line says how many it covers |
| Tables | Only `\| 1 \|` with single spaces | Any spacing |
| Links | `[[` inside code read as a link; canvas links failed | Code spans are ignored; links to other file kinds and with folders resolve; a note linking only to itself is an orphan |
| Tests and dependencies | Exact lower-case folder names only | Any letter case; test files by name; all reported |
| Unenforced rules | Lens on Mechanism, Library, Start Here; Trace and questions at `full`; empty diagram | Checked |
| Output on Windows | A non-Latin character in a message stopped the script | UTF-8 output |
| Scope without code | PASS | FAIL |
| Plan script | Missed `re_exports`, `inherits` and similar; ambiguous edges counted as certain; a scope matching nothing was silent | Fixed |

Round 3 findings, in short:

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P1 | Running the scripts could leave `__pycache__` in the tree being explained | `sys.dont_write_bytecode`; commands use `python -B` |
| 2 | P1 | An inner line of a secret that spans lines could not be masked and pass | A line that is `[masked]` alone is accepted when the note's `masked_lines` names it; the count is printed |
| 3 | P1 | `--scope build/compile.py` found nothing: skipped folder names applied before the scope | A scope into such a folder is honoured; left-out folders and their code file counts are reported |
| 4 | P2 | A graph function in `pkg/a.py` (no note) was charged to `a.py` | Graph paths resolve against every code file, then only explained files are compared |
| 5 | P2 | The plan showed inferred edges as certain and built a circle from one | Order and circles from confirmed uses; inferred uses listed apart with lines |
| 6 | P2 | Constants in the graph had to be named like functions | Only functions, methods and classes |
| 7 | P2 | A person's own empty note in the folder failed the check | Only notes with `written_by: argus` are read; such a File note is also the only kind that counts as an explanation |
| 8 | P2 | An empty source file had no valid note form | Lens and no block |

Round 2 findings, in short:

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P1 | On Windows, `--scope SKILLS` (other letter case) passed with no notes | The scope is turned into its spelling on disk |
| 2 | P1 | `Makefile`, `Dockerfile` and scripts without an extension were not counted | Known build-file names and files starting with `#!` count as code; other files without an extension are reported |
| 3 | P1 | "Code never leaves the computer" cannot hold when a hosted agent reads the code | Rule reworded: the skill adds no new destination beyond the agent the person chose; client code needs the user's yes first |
| 4 | P1 | Step 2 always left tests out, though tests can be asked for | Tests are left out only when not asked for; `--include-tests` in both scripts and in the steps |
| 5 | P2 | `a.py` and `pkg/a.py` could be confused in the graph check | Exact path match; a looser match only when exactly one file fits |
| 6 | P2 | Without `--graph` the check passed and said nothing | One of `--graph` and `--no-graph` is required; the result says `PASS WITHOUT THE GRAPH CHECK` |
| 7 | P2 | An empty or mask-only Code cell in a line row passed | The cell must quote code; text around a mask must be on the line |
| 8 | P2 | "Add to an existing Concept note" clashed with "never change notes the skill did not write" | Notes the skill writes carry `written_by: argus`; only those may be changed; otherwise a separate `(argus)` note is written |

Round 1 findings, in short:

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P1 | `--scope .` or an absolute path made the check pass with no notes | Scopes are made relative to the source root; `.` is the whole root; outside paths are refused |
| 2 | P1 | `.vue`, `.html`, `.css`, `.dart` and others were not counted as source | Much wider list; files of an unknown kind are reported in a WARN |
| 3 | P2 | A `map` note with code but no explanation passed | Every block needs its Level 2 row and, at `map`, an explanation after its code |
| 4 | P2 | A `## ` comment inside copied code ended the block | Headings are read outside code fences only |
| 5 | P2 | Any line with `[masked]` skipped the comparison | Everything around the mask must equal the source line |
| 6 | P2 | A file outside a cycle could come before the cycle it uses | Strongly connected components, ordered dependency-first; cycles are listed |
| 7 | P2 | A graph function could be checked against the wrong file (`data.py` vs `a.py`) | Paths match on whole path components |
| 8 | P2 | An unusable graph gave a warning and PASS | It fails |
| 9 | P2 | The update rule left Mechanism and Concept notes stale and blocked depth changes | "Later runs" table in the skill; Mechanism and Flow notes carry `sources` and `commit` and are checked for staleness |

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
| 8 | CodeTour export: DONE in 2.7.0 (`scripts/make_tour.py`, 4 tests). Open: try the tour in VS Code with the CodeTour extension (not installed on this computer on 2026-11-15; install: `code --install-extension vsls-contrib.codetour`); CodeTour's README does not say whether tables render in step text, so the script writes lists | Owner: "for guided walk add codetour" (2026-11-15) |
| 9 | Localhost page ideas given to the owner (2026-11-15): reading path with progress and gates, depth dial, review mode with a "review prompts" row per block, Quartz over the notes folder as a first cheap step, own page on the extension's core for code beside explanation. Not decided | Owner asked for ideas |

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-11-15 | Obsidian notes replace the DOCX of version 1 | Owner: links, backlinks, one note per file |
| 2026-11-15 | graphify is required; the skill stops without it | Owner: "enforce it" |
| 2026-11-15 | Default depth `map`; line tables only for named files or flows | 20,900 lines at full depth is about 7 MB of notes |
| 2026-11-15 | A graphify release at least 10 days old was installed, in its own environment | The newest release was hours old; caution with new packages |
| 2026-11-15 | Name: argus | Owner's choice |
| 2026-11-15 | VS Code extension first, localhost page in the next release | Owner's choice |
| 2026-11-15 | Guided walk through CodeTour, by exporting a tour file; the custom extension stays for select-and-explain with states | Owner: "for guided walk add codetour". CodeTour plays steps in order and knows nothing of stale, unexplained or checked; the two serve different needs |
| 2026-11-15 | The tour file is written outside the source tree; the person opens it with "CodeTour: Open Tour File..." | The skill never writes into the code it explains |
