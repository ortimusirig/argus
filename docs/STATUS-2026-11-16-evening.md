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
