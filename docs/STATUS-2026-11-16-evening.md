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
