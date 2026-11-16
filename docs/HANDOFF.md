# Argus: handoff

Read this first. It is kept current after every step, so a new agent with no other context can continue the work.

Last updated: 2026-11-15, version 2.6.1 (`check_notes.py --json`).

## Status

| Item | State |
|---|---|
| Released | 2.9.2 on `main` (committed locally; see the push problem under Rules) (`setup_tools.py`; tour in the project's `.tours`; fingerprint built from what the run reads; 69 tests): the skill, its templates, `check_notes.py` (with `--json`), `graph_plan.py`, `_common.py`, `test_scripts.py` (59 tests) |
| In progress | Extension build, on branch `vscode-extension` in the worktree `C:\dev\argus-ext` (code in `vscode/`). DONE: pieces 1 to 3 of the plan (the core: `vscode/src/core/notes.ts`, `match.ts`, `projects.ts`, `links.ts`, `markdown.ts`), 108 tests pass (`npm test` in `C:\dev\argus-ext\vscode`). Codex code review round 1 of the core: no P0, no P1, 5 P2, all fixed (commits `d532ba1` to `38608ed`), plus Markdown lists added. Codex code review round 2 on commit `38608ed`: no P0, no P1, 2 P2: (1) markdown.ts about line 74, unmatched backtick runs of many different lengths rescan the rest of the text (1.55 s for runs of length 1 to 1,600): index the runs by length and position once; (2) projects.ts about line 27, `posixReal` does not follow a dangling symbolic link before handling `..` (`/repo/alias -> /outside/missing`, source `alias/../target.py` must be refused as Python's resolve() does): resolve components with lstat and readlink. Both were fixed test-first (commits `b0bd2ac`, `01d04ea`); 79 tests pass. Code review round 3 on `01d04ea`: 1 P1, 3 P2: (P1) projects.ts about line 38: the 40-link limit refuses long chains of links that are not circles, which the checker accepts: detect real circles (remember the links being resolved) instead of counting; (P2) markdown.ts about line 147: an emphasis closer `*` is taken even inside a code span or after a backslash (`*The `a*b` expression*` is broken); (P2) notes.ts about line 205: the regular expression that removes inline code backtracks (1.6 s for 64,000 backticks): replace by one scan with the checker's meaning; (P2) markdown.ts about line 115: every rejected `[[` rescans the rest (`[[#` repeated 32,000 times: 771 ms). The lesson of three rounds: the inline Markdown code is a set of separate scans that each can go quadratic; it should become ONE left-to-right tokenizer (code spans, backslash escapes, emphasis, links, wikilinks) with all lookups precomputed. All four were fixed test-first (commits `b5f35b2`, `20a0580`, `97b960a`): links are followed without a count limit and a real circle is refused; inline Markdown is now one tokenizer (linear or n log n for any line); inline code removal is one scan with exactly the checker's meaning (7,978 lines compared with Python). 92 tests pass. Code review round 4 on `97b960a`: one finding, P1: markdown.ts about lines 88 to 97: the tokenizer reads backticks inside a link address as a code span, so ``[docs](file:///repo/`name`.ts)`` is no longer a link (it was before `20a0580`): a link's address must be taken as literal text before code spans are looked for, still with bounded scanning. The reviewer's 30,000 extra comparisons with the checker all matched; findings per round were 5, 2, 4, 1. That P1 and the two slow spots named below were fixed test-first (commits `aec9fe6`, `cacceb8`, `8675a38`); 96 tests pass. Code review round 5 on `8675a38`: no P0, no P1, 1 P2 (blank lines before a block's explanation were trimmed with repeated `shift()`, 200,000 of them took about 30 seconds), fixed test-first in `ae4f178` (47 ms); 97 tests pass. Code review round 6 on `ae4f178`: 1 P1 (a link circle on POSIX was refused where the checker reads on) and 1 P2 (a long line was trimmed without a yield), both fixed test-first in `a12f87a` and `3f906be`; 99 tests pass. Code review round 7 on `3f906be`: no P0, no P1, 2 P2, coverage complete. P2 one, `projects.ts` line 153: with a normal root and a source that starts with the Windows long-path prefix (backslash backslash question mark backslash), or the reverse, `sourceInRoot` accepts and the checker's `on_disk` gives `None`, because Node's realpath drops the prefix and Python keeps it. P2 two, `match.ts` line 395: the loop that builds candidates for a block without an exact anchor line never checks the slicer; one `[masked]` block against 2,000,000 short lines gave gaps of 39 to 50 ms. Findings per round so far: 5, 2, 4, 1, 1, 2, 2, 2, 1, so not falling; each round found one more case of the same two classes. CHANGE OF APPROACH (2026-11-15): the builder started on round 7 was told to fix the named cases AND audit the whole class: every loop and array step reached from `assign` in `match.ts` listed with its bound and its yield cover; every Windows path form compared with the real `on_disk` on this computer. That builder finished: `942d518` (`projects.ts`: Windows paths resolved, joined and compared as Python 3.13 does; 9,800 root and source pairs compared with the real `on_disk`, 1,047 disagreed before, 0 after) and `c4d0092` (`match.ts`: every step reached from `assign` counts its work and yields; 330,000 random inputs give the same answers as before); 105 tests pass, checked by the lead. Code review round 8 on `c4d0092`: no P0, no P1, 2 P2, both in `match.ts`; the path fixes and the candidate fix hold (path class clean for the first time). P2 one, line 594: each pattern line keeps a memo sized by the number of distinct text lines, so 16,000 pattern lines against 64,000 text lines allocate about 256 MB for 16,000 comparisons; store only tested pairs. P2 two, line 83: the inner fallback loop of the failure-table build is not counted toward the yield budget; `x[masked]` + 16,000,000 times `a` + `b[masked]y` gives a 38 ms slice. A builder was started on both on 2026-11-15 (also told to check every nested loop and every allocation sized by a product). That builder finished: `b120ebe` (memo stores only tested pairs: 240 MB down to about 3 MB on the reviewer's shape) and `951267b` (fallback steps counted in four loops: 36 ms down to under 5 ms); 107 tests pass, checked by the lead; 270,000 random inputs give unchanged answers. Code review round 9 on `951267b`: the matcher fixes hold; 1 P2 (`notes.ts` line 338: 150,000 rows of a table kept in a block's prose were spread into one `push` call, which throws `RangeError`), fixed test-first by the lead in `2134c3f`; 108 tests pass. Code review round 10 on `2134c3f`: CODE REVIEW CLEAN, no finding at any level (result `code-2134c3fbe30b-20261115-214720-dd709e-focus.md`). THE CORE (plan pieces 1 to 3) IS REVIEWED CLEAN after ten rounds; findings per round 5, 2, 4, 1, 1, 2, 2, 2, 1, 0. Still not verified anywhere: POSIX on disk, a computer with `LongPathsEnabled=1`. A builder was started on plan pieces 4 to 6 (index and panel, markers, check) on 2026-11-15 at 35% usage, told to commit after each piece so that a stop leaves whole pieces. When its commits are there: run `npm test` yourself, write a NEW context file for pieces 4 to 6 (the old ones say pieces 4 to 9 are out of scope), start a code review. Usage stop line 40%. After round 10, an open P2 goes to the P2 backlog in the plan note (review skill, owner rule 7) and pieces 4 to 6 are built. Left open by the builder, not this class: a memo per pattern line that can need very much memory (1,000,000 different pattern lines against 1,000,000 different text lines), and one block per text line being quadratic in time (it yields and can be cancelled). For piece 4: splitting the document into lines and parsing the note are synchronous and outside the generator; `sourceInRoot` can return `.` and `./x:s`. After 10 completed rounds an open P2 may go to the P2 backlog (review skill, owner rule 7). Result files: newest `*-focus.md` (the script exits with code 1 when a finding is open; that is not a crash). Known difference to weigh there: the checker's `without_inline_code` treats backticks in a link address as a code span, the renderer now does not, so for a line like ``[a](x`y) [[note]] `z`` the panel shows `[[note]]` as a link while the checker does not count it. The loop was stopped on 2026-11-15 at about 27% usage and RESUMED the same day when the owner raised the stop line to 40%; a builder agent was started on the two open round 6 findings. To go on: check what the builder of pieces 4 to 6 committed, review it, then build pieces 4 to 6 (a new code review round needs a new context file (context file pattern: the scratch files are gone after a restart; write a new one from this section). Two slow spots the builder saw and left alone, to fix next whatever round 4 says: markdown.ts `render`, the fence-close step `m[2].replace(/`+$/, "")` is quadratic (426 ms for a fence line with 50,000 backticks); notes.ts `linkNames`, `names.includes(target)` is quadratic in the number of different links on a line (191 ms for 20,000). Not verifiable on this Windows computer: the POSIX on-disk path code (lstat and readlink); it needs one `npm test` run on Linux or macOS. The review files are in `C:\dev\argus\.git\cross-review\vscode-extension\` (newest `*-focus.md`). NOT STARTED: pieces 4 to 9 (index and panel, markers, check, create, concept notes, package). Skill: Codex round 4 on the skill itself is still owed |
| Answered 2026-11-15 | AURA and the VS Code extension: see "AURA route" below |
| Next step | 1. Read the newest `*-focus.md` of code review round 2; fix each P0, P1, P2 test-first in `C:\dev\argus-ext\vscode` (or rebut with evidence), commit, review again (`bash ~/.claude/skills/cross-model-review/scripts/xreview.sh code C:/dev/argus-ext main --note <design note> --note <plan note> --ctx <context file>`) until clean. 2. Build pieces 4 to 6 as the plan says, review; pieces 7 to 9, review; the plan's hand test; package. 3. Add "lists" to the Markdown subset named in the plan's piece 3 (built already, the plan text does not name it yet). 4. Codex round 4 on the skill. A good way to build: give a fresh agent the design note, the plan note and the piece numbers; it took about 25 minutes for the core |
| Stop rule | The owner (2026-11-15, latest word): continue until all features are complete or plan usage reaches 40% (weekly, all models); raised from 30% the same day. A builder agent run costs about 2%. The loop is driven by `/loop` in the session; a new agent restarts it with the same goal text |
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
| graphify | Version 0.9.103 in its own environment: `C:\Users\aiuser4\.venvs\graphify\Scripts\graphify.exe`. Not on PATH; remembered in `~/.argus/config.json`, and `setup_tools.py` prints it. On a new computer `setup_tools.py --install` puts graphify in `~/.argus/venv` |
| CodeTour | VS Code extension `vsls-contrib.codetour` 0.0.61, installed by the owner on 2026-11-15 |
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
| Pushing to GitHub needs the owner (since 2026-11-15, about 14:20) | git's saved sign-in for github.com stopped working without a prompt: `git push` from an agent fails with "could not read Username". Never enter credentials. Commit locally, tell the owner, and ask him to run `git -C C:\dev\argus push origin main` and `git -C C:\dev\argus-ext push -u origin vscode-extension`. Until then `main` on this computer is ahead of GitHub and the branch `vscode-extension` exists only here |
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
| 2026-11-15 | Extension core built by a fresh agent from the design and plan alone; Codex code review round 1 | 58 tests, then 73 after the five P2 fixes and lists; Codex's own brute-force check of 10,000 small assignments agreed with the matcher; timings: 20,000 identical lines with a 5,000-line block 12 ms, worst case never holds the editor longer than 3 ms |
| 2026-11-15 | Fresh agent runs skill 2.8.1 end to end on the helper's `keystore` folder (5 files, 613 lines, one of them PowerShell), depth `map`, real graphify, into the owner's vault | 30 new notes (27,400 words), 23 existing notes extended, check passed at the first run (55 notes, graph covers 7 of 7), tour rebuilt with 96 steps, source untouched, 15 minutes. 18 gaps reported; fixed in 2.9.0. Not seen: the notes in Obsidian, the tour in VS Code |
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
| 1 | CLOSED by the owner on 2026-11-15: the helper build notes were an example only; do not explain the remaining 35 of 42 helper files unless the owner asks. (For the record: 7 files are done, 2 at `full`, 5 at `map`; the measured estimate for the rest was about 500,000 words and about 10 hours of agent time) |
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
| 2026-11-15 | The tour file was first written outside the source tree. The owner then decided (same day): the tour goes into `<source root>/.tours/` so CodeTour lists it by itself, and it is made again at every run. The script keeps the folder out of git with a line in `.git/info/exclude` | Owner: "make the folder etc also synced so that codetour issue also doesn't come" |
| 2026-11-15 | The skill installs its own add-ons (graphify in `~/.argus/venv`, CodeTour) through `setup_tools.py --install` instead of stopping; Python, git and VS Code are installed by the agent with the printed command when the user agrees | Owner: "these dependencies also need installations from that single skill itself automatically"; "these can be instructions also", since most people will have Claude install the skill |
