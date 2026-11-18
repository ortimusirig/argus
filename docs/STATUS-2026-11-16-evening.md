# Status, 2026-11-16 evening (read after `HANDOFF.md`; newer than its "In progress" row)

Stop line: 80% of the weekly plan usage (owner, 2026-11-16). Usage when this was written: 67%.

## What was agreed and built today

The owner agreed the work in `docs/NEXT-block-updates.md`: a later run of the skill rewrites only changed blocks, git is optional, the model can be chosen, the run diagram is in the notes by default, the graph is kept and linked. Owner rule for all of it: no testing infrastructure and no new test code; prove by running the product; Codex reviews stress the product.

### Skill 2.10.0: branch `skill-2.10`, worktree `C:\dev\argus-skill`. Not merged, not installed.

- New script `skills/argus/scripts/changed_blocks.py`: for each block of a File note: same, moved, changed, ambiguous, undecided; and the unexplained ranges. `--fix-moved` writes new line numbers, in line columns only. `--json`. `--hash <file>` prints the `source_hash` value.
- `source_hash` property (git optional), `retired_blocks` property, "Later runs" in `SKILL.md` rewritten, a Flow note in every run (diagram from the entry to every end state), the graph page kept in `_graph` beside the notes and named in Start Here.
- Codex stress rounds of the skill: 9, 6, 4, 4, 4, 3 findings. Round 6 (commit `75b8db0`): 3 P1, all in `changed_blocks.py` (table state leaking into the next table; a search that stops at its limit reported as changed; a `[[File.md]]` link not normalized). A builder agent was fixing them when this was written. Context files: `context-skill-210-1.md` to `-6.md` in `C:\dev\argus\.git\cross-review\skill-2.10\`; the review results are beside them.
- Open decision for the owner if the next round still finds P1: keep `--fix-moved` (the script writes into notes), or make the script a reporter only and let the agent write the line numbers.

### Extension: branch `vscode-extension`, worktree `C:\dev\argus-ext`, head `54565d0`, 239 tests pass, package rebuilt.

- New: setting `argus.createModel`; command `argus.update` with the panel button "Update explanation (N changed blocks, M unexplained ranges, K moved blocks)"; setting `argus.updateCommand`; an npm launcher (`claude.cmd`) is followed to the program it names; fixes from the first run in VS Code.
- Codex stress rounds of these features: 4, 4, 3, 5, 2, 2 findings; the last two without P0 or P1; stopped there. The owner's trim decision is written into the plan (`docs/plans/2026-11-15-vscode-extension-plan.md`, last section) and Codex accepts it.
- P2 backlog, added: a graph folder that is itself a junction and is pointed elsewhere is not watched (the badge is corrected at the next check or when the window gets the focus).

### Notes written with the skill for a real file

`xreview.sh` of the cross-model-review skill v18 (`C:\Users\aiuser4\.claude\skill-dev\cross-model-review-v18`, another session's work tree: read-only): vault folder `Applexus GPT\09 Process and tooling\Cross-Model Review`, 34 notes, checker PASS. The Flow note there was written by hand and is the model for the new Flow template. A CodeTour file and the graph page are in `C:\Users\aiuser4\.claude\skill-dev\`.

## Still to do, in order

1. Finish the skill review (fix round 6, one more round). P0 and P1 must be zero; P2 may go to the backlog.
2. Merge `skill-2.10` into `main`. Both branches changed `docs/HANDOFF.md` and `docs/NEXT-block-updates.md`: keep the text of `main`.
3. In the extension: `npm run build` (copies the new `check_notes.py` and `_common.py`); bring `withoutInlineCode` in `vscode/src/core/notes.ts` in line with the checker's new code-span rule (an escaped backtick opens no span; a run closes only on a run of the same length); rebuild the package.
4. One real agent run that follows the new "Later runs" on a file that changed. This proof is still missing: only the scripts were proved.
5. Install the skill for the owner: copy `skills/argus` to `C:\Users\aiuser4\.claude\skills\argus`. Then the extension's Create and Update can work (their default command says "Use the argus skill").
6. The owner's hand test of Create and Update in VS Code (`docs/EXTENSION-HAND-TEST.md`), after a window reload.
7. Nothing is pushed: `main`, `vscode-extension` and `skill-2.10` are all ahead of GitHub. The owner pushes.

## Later the same evening: where the skill review ended (usage 74% of the 80% stop line)

Skill 2.10, branch `skill-2.10`, head `06b28f8`. NOT merged, NOT installed. The existing 72 tests pass.

- Thirteen Codex stress rounds. Findings: 9, 6, 4, 4, 4, 3, 4, 4, 5, 3, 2, 5, 5. P1: 5, 4, 2, 3, 2, 3, 1, 1, 1, 2, 2, 2, 2. Rounds 1 to 12 are fixed. Round 13 (review file `code-06b28f8*-focus.md` in `C:\dev\argus\.git\cross-review\skill-2.10\`) is OPEN: 2 P1, 3 P2:
  1. P1 `changed_blocks.py:845`: in a depth-full note a `# Appendix` heading after a block's code fence, followed by a table with the template's line-table heading row, is still taken for the block's line table and written; both guards accept it. Fix direction: both readers end a block at any heading of the same or a higher level.
  2. P1 `SKILL.md:109`: the "go back" after a STALE line repeats the run's own `--scope`, so a stale note of another file is never reached; the agent can cycle. Fix direction: carry the stale note's file into the repeat, or say that it is outside this run and report it.
  3. P2 `changed_blocks.py:968`: a short table row (`| 1 |`) raises `IndexError`. 4. P2 `:966`: the Level 2 table is parsed again for every block (10 s for 3,200 blocks). 5. P2 `:541`: the search for the block before an unexplained range is quadratic.
- What the rounds showed: the part that writes into notes (`--fix-moved`) produced a P1 in most rounds, each time a new note shape. It was narrowed three times: line columns only; then two guards (`unhandled()` refuses whole notes with constructs the writer does not handle, `own_check()` compares old and new text); then exactly five template places with exact heading rows.
- The first real agent run of "Later runs" WORKED (a fresh agent on Sonnet, on a copy of the real `xreview.sh` notes after 3 lines were inserted and 1 changed): the script wrote 112 moved blocks, the agent rewrote 1 block and added 1, result CURRENT, 125,910 tokens (first writing of that file: about 275,000). Its main lesson is built in: outside a File note, code is cited by block, not by line.
- OWNER DECISION NEEDED (the agent stopped here, as it had said it would):
  (a) fix round 13 and go on with rounds until P1 is zero (about 1 to 2% usage per round, number of rounds unknown), then merge and install; or
  (b) merge and install 2.10 with `--fix-moved` taken out of the skill's "Later runs" (the script stays a reporter; the agent sets moved line numbers itself, which costs tokens on every update but cannot damage a note), and keep the writer on the branch for later; or
  (c) install 2.10 as it is for the owner's own use only (pilot), knowing the two open P1.
  The review rule (cross-model-review, the gate) allows a merge only with P0 = P1 = 0, so (c) is the owner's exception to make, not the agent's.
- The extension (`vscode-extension`, head `54565d0`) is reviewed and waits for the skill: after a merge run `npm run build` there, align `withoutInlineCode` in `vscode/src/core/notes.ts`, rebuild the package.

## 2026-11-17: owner's words

- "Keep fixing": the skill review goes on until P1 is zero (option (a) above).
- "Bump the usage to 99%": the stop line is now 99% of the weekly plan usage (was 80%). Usage was 74% when this was said.

## 2026-11-17, midday: skill review stopped after round 22 (usage 91% of the 99% stop line)

Skill 2.10: branch `skill-2.10`, worktree `C:/dev/argus-skill`, head `d7e02e5`. NOT merged, NOT installed. The existing 72 tests pass. `SKILL.md` has 5,400 words.

- Twenty-two Codex stress rounds. P1 per round: 5, 4, 2, 3, 2, 3, 1, 1, 1, 2, 2, 2, 2, 1, 0, 1, 3, 1, 1, 1, 1, 1. Rounds 1 to 21 are fixed.
- Round 22 is OPEN (review file `code-d7e02e59dbe8-20261117-112900-2fe382-focus.md` in `C:/dev/argus/.git/cross-review/skill-2.10/`; the context file for the next round is made from `context-skill-210-22.md` beside it):
  1. P1 `changed_blocks.py:949`: a heading line (`## Appendix`) directly followed by `---` is taken for an underlined heading, so every block of a valid note is "not compared". Fix direction: an underline counts only under a line of paragraph text, not under a heading line, a table row, a list item or a fence line.
  2. P2 `_common.py:194`: `plain_relative` strips the value before it tests it, so `source: "missing.py "` (trailing space or tab) is reported GONE. Fix direction: test for trailing white space and control characters before any strip.
  3. P2 `changed_blocks.py:461`: a block whose code fence is empty counts as changed. Fix direction: "not compared", with a PROBLEM line, not counted towards a whole rewrite.
- How the script changed during the rounds (read this before the code):
  - The script claims three things only: this block's code is at these lines; this block's code as copied is not in the file; these lines are in no block. It never says code is gone, lines are new, or an explanation is right.
  - `--fix-moved` writes four places only: the block heading, `masked_lines`, the Lines cell of the Level 2 table (template's exact heading row, directly under its section heading), and at depth full the Line cell of the block's own line table (template's exact heading row, directly after the block's code fence). The Trace table is not written.
  - Two readings must agree before anything is trusted: the checker's `fence_mask` and `commonmark_fences`; the shared block reader and the strict section boundary; the writer and `own_check()`.
  - The guard has two kinds (`STOPS_COMPARING`: what is code or a heading is in doubt, every block "not compared"; `STOPS_WRITING`: compared as usual, moved numbers set by hand).
  - The last rounds each found one case where the guard was too strict or not strict enough about one Markdown shape. No case of a damaged real note was found; the real case (`xreview.sh` notes, 3 lines inserted, 1 changed) gives "112 written, 1 changed" in every round.
- One real agent run of "Later runs" worked (Sonnet, 125,910 tokens). A second run on the final text is still owed.
- Cost lesson for the next agent: do not resume a long-running builder agent again and again (its history grew to 850,000 tokens and each resume paid for it); give each fix round to a fresh agent with a short brief, as was done for rounds 20 and 21 (about 125,000 to 155,000 tokens each).
- Next steps, unchanged: fix round 22 (three small fixes), run the review again; when a round shows no P0 and no P1: merge `skill-2.10` into `main` (keep `main`'s text of `docs/HANDOFF.md`; take the branch's "P2 backlog of skill 2.10" section of `docs/NEXT-block-updates.md`), then in the extension `npm run build`, align `withoutInlineCode` in `vscode/src/core/notes.ts` with the checker, rebuild the package, install the skill (copy `skills/argus` to the owner's `.claude/skills/argus`), a second real agent run, the owner's hand test of Create and Update.

## 2026-11-17, after round 23 (the last round of this session; usage about 93% of the 99% stop line)

Skill 2.10: head `d0bf101` on `skill-2.10`. NOT merged, NOT installed. Round 22's three findings are fixed in `d0bf101`.

Round 23 is OPEN (review file `code-d0bf101dc6cd-20261117-120450-834ed0-focus.md`; next context: start from `context-skill-210-23.md` in the same folder):
1. P1 `changed_blocks.py:1420`: with two `masked_lines` properties in a note the writer changes the first, the reader (`frontmatter()`) uses the last; after a move the effective mask is at the old line and the block turns from moved to changed. Fix direction: a note with a repeated property is not written (kind `STOPS_WRITING`, or `STOPS_COMPARING` if the reader's choice can change what is compared); after the text is built, compare it once more and require that every block the run moved is `same` in the result, else write nothing.
2. P1 `changed_blocks.py:817`: only "the note itself is a link" is checked; a note that lies under a folder junction inside `--notes` resolves outside the notes folder and is written there. Fix direction: resolve every note path and require that it lies under the resolved notes folder, in the listing and again under the lock before the replace (the VS Code extension has the same rule: `placeOf` in `vscode/src/core/noteIndex.ts`).
3. P2 `_common.py:183`: the device names `CONIN$`, `CONOUT$` and names with superscript digits (`COM¹`, `LPT²`) are not refused by `plain_relative`.
Also on the P2 backlog since round 22 (told to Codex): the source lines of a "not compared" block are offered a new block id; a source value with a trailing space or dot whose file exists is accepted on Windows; "expected at" names old lines after a write; a quoted underlined heading is named by no test.

P1 per round, all 23 rounds: 5, 4, 2, 3, 2, 3, 1, 1, 1, 2, 2, 2, 2, 1, 0, 1, 3, 1, 1, 1, 1, 1, 2.
The idea "after the text is built, run the comparison again on the result and require the moved blocks to be `same`" (fix direction 1) is a general last check that the writer still lacks; it would have caught several earlier findings. Build it first.

## 2026-11-17, afternoon: owner's rule and state after round 25 (usage 94% of the 99% stop line)

OWNER'S RULE (2026-11-17, his words: "then continue till 2 consecutive review shows no P1"): go on with fix and review rounds until two consecutive Codex reviews show no P1, for the skill and for the extension; then release (merge to `main`, rebuild the extension, install the skill). All three branches were pushed by the owner at `87272b2` (main), `54565d0` (vscode-extension), `d0bf101` (skill-2.10); later commits are local only.

SKILL 2.10: branch `skill-2.10`, head `66fcc97`, 72 existing tests pass. Rounds 23 and 24 are fixed (`46560a2`, `44216f6`, `a6bc285`, `66fcc97`). New in the writer: a general last check (`move_check`): after the new text is built, the comparison runs again on it and every moved block must be `same`, else nothing is written. Also: a properties key written twice stops the comparison; a note that resolves outside the notes folder is not read; a Flow may name blocks of a File note elsewhere in the vault.
Round 25 (review file `code-66fcc9764546-20261117-133636-7afb5c-focus.md`, context for the next round from `context-skill-210-25.md`) is OPEN, one finding:
- P1 `changed_blocks.py:1494`: a resumed update (the line table of a block was already corrected, its heading not) shifts the rows again; the writer adds the heading's shift to every row without looking at the row's quoted code; `own_check` and `move_check` both accept. Fix direction: at depth full, a line row is written only when, after the shift, the row's Code cell is the start of the source line it then names (the checker's own rule for line rows); a row that is already right stays; rows that fit neither way become a TODO; `move_check` runs the checker's line-row test on the result.
P1 per round, 25 rounds: 5, 4, 2, 3, 2, 3, 1, 1, 1, 2, 2, 2, 2, 1, 0, 1, 3, 1, 1, 1, 1, 1, 2, 1, 1. Consecutive rounds without P1 so far: 0.

EXTENSION: branch `vscode-extension`, head `3e0932c`, 239 tests pass, package rebuilt. The confirming round on `54565d0` (review file `code-54565d04bd30-20261117-130004-b0ba60-focus.md`) found 1 P1 and 3 P2. The 3 P2 are fixed (`67e71f7`, `ba43be4`, `3b0dea4`, `3e0932c`). The P1 WAITS FOR THE OWNER: Update is refused for a file with two or more notes; Codex calls that a narrowing without approval. The owner was asked: A = approve the refusal (then write it into the plan's "Owner decisions" section and tell Codex), B = build Update for the picked note (pass the note's path to the agent, track that note to the end). No answer yet. The next extension round is to be run after the answer, with a context made from `context-ext-update-7.md` in `C:/dev/argus/.git/cross-review/vscode-extension/`.

The owner declined for now: dead-code hints (Vulture, graph "no caller"). Do not build.
This session's context is nearly full; a fresh session should take over from this file. Cost rule: one fresh small agent per fix round (about 110,000 to 200,000 tokens each), never a long-lived builder.

## State on 2026-11-17 (after the owner's rule "two consecutive reviews with no P0 and no P1")

Owner decisions of 2026-11-17: "A" (Update refuses a source file that two or more notes explain; written into the
extension plan, section "Owner decisions after the plan"); "do nothing now": no new work (the diagram link from
File notes to Flow notes waits until after the release); Vulture stays out.

**Extension (branch `vscode-extension`, head `b96766a`): passes the rule.** Confirming rounds 4 (`3011c8a`) and 5
(`b96766a`): no P0, no P1; round 5: no open finding for the owner's pilot. Four P2 wait in the plan's section
"P2 backlog of the extension (owner pilot)"; they are fixed and reviewed before anything goes beyond the pilot.
Commits since the owner's last push: `67e71f7` to `b96766a`. Not yet done: `npm run build`, the package, a window
reload in the owner's VS Code, the owner's hand test of Create and Update.

**Skill (branch `skill-2.10`): does not pass yet.** Rounds 26 to 29 each found one or two P1, all but one in the
handling of masked lines (`[masked]`, property `masked_lines`) in `changed_blocks.py`; each fix opened the next
hole (`232bb39`, `7165e2d` (checker, Flow rows), `58877de`). After round 29 (two P1 on `58877de`) the approach
changed: the script no longer writes blocks with masked lines and never changes `masked_lines`; such a block gets a
TODO for the agent, and when it matches nowhere it is "not compared", never "changed". A fresh agent builds this on
top of `58877de`. Next: round 30 with a context file made from
`.git/cross-review/skill-2.10/context-skill-210-29.md` plus the dispositions of round 29; two clean rounds are
still owed.

Known and not fixed: the extension's matcher (`vscode/src/core/match.ts`) asks for a mask at the recorded line, so
an unchanged masked block shows as changed after lines are inserted above it. Align it with the skill's final rule
at the merge.

After the skill passes: merge `skill-2.10` into `main` (keep `main`'s `docs/HANDOFF.md`), merge `main` into
`vscode-extension`, build the package, copy `skills/argus` to the owner's skills folder, second real agent run.
The owner pushes; this session cannot.

Cost rule that held: one fresh agent per fix round (110,000 to 200,000 tokens each); never resume a long agent.

## Release state on 2026-11-17, 17:10

Both parts pass the owner's rule (two consecutive Codex reviews with no P0 and no P1):
- Skill: rounds 31 (`24134c0`) and 32 (`132021b`): P0=0, P1=0. Six P2 of rounds 30 to 32 are in
  `docs/NEXT-block-updates.md`, section "P2 backlog of skill 2.10" (14 rows in all).
- Extension: confirming rounds 4 (`3011c8a`) and 5 (`b96766a`): P0=0, P1=0; four P2 in the plan's backlog.

Done after that:
- `skill-2.10` merged into `main` (`3b2ed38`; `docs/HANDOFF.md` is main's; 72 tests pass). Skill version 2.10.0.
- `main` merged into `vscode-extension` (`730cd50`), then `f2dca33`: the extension reads inline code as the
  checker of 2.10 does (the only test that failed after the merge; 239 tests pass). This commit and the two merges
  were NOT reviewed by Codex.
- Package built: `C:\dev\argus-ext\vscode\argus-3.0.0.vsix` (17:04) and installed in the owner's VS Code
  (a window reload is needed).
- Skill copied to `C:\Users\aiuser4\.claude\skills\argus` (first install there).

Not done: the owner's push of `main`, `skill-2.10` and `vscode-extension`; the owner's hand test of Create and
Update in VS Code; a second real agent run of "Later runs" with the installed skill; the extension's matcher still
asks for a mask at the recorded line (an unchanged block with masked lines shows as changed after lines are
inserted above it; display only); the P2 backlogs; the diagram link from File notes to Flow notes (owner: after
the release); cleanup of scratch folders and `~/.argus/locks`.

How masked lines work since `62a27d3`: `changed_blocks.py` never writes a block that has masked lines and never
writes `masked_lines`; such a block gets a TODO for the agent, and "not compared" when it matches nowhere.

Confirming round 6 of the extension after the merge (commit f2dca33, 2026-11-17 evening): P0=0, P1=0, P2=2; no
finding on the inline-code alignment (21,186 inputs compared by Codex). The two P2 (watchers for a linked note
outside the roots; a retargeted notes-folder junction) are in the plan's backlog (extension head 3ed05b3, plan text
only; the installed package is built from f2dca33, same code). The extension's backlog holds six P2 now.
