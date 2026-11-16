# Next work, agreed with the owner on 2026-11-16: update only what changed, git optional, model choice

Status: AGREED, NOT STARTED (usage was at 58% of the 60% stop line when it was agreed).

## Why

Today a File note whose source has a newer commit is rewritten whole ("Later runs" table in `skills/argus/SKILL.md`).
One changed line in a 1,400-line script rewrites a 30,000-word note (about 275,000 tokens for the first writing of
`xreview.sh`). The owner's words: "worried about this".

## What was agreed

1. Later runs rewrite changed blocks only.
   - What changed is found by comparing each block's copied code with the source file (the checker and the
     extension's matcher already do this), not by git. A script does the finding, with no model.
   - Per block: code changed: rewrite that block; new lines without a block: add a block; code the same but moved:
     correct the line numbers with no model; code gone: remove the block.
   - Then the checker proves the whole file as today.
2. Git is optional.
   - With git: the note keeps `commit` (information, the STALE hint, `git log` and `git blame` for the "why" rows).
   - Without git, or for a work tree with uncommitted changes: the note keeps a hash of the source file, and the
     block comparison decides. Setup detects git by itself; the owner can say yes or no.
   - This also closes the hole that a note written from a dirty work tree looks current.
3. The model can be chosen.
   - Extension: a setting `argus.createModel` (today the owner can already put `--model <id>` into
     `argus.createCommand`).
   - Recommendation given to the owner: Sonnet for a first full writing and for block updates, Haiku for small
     edits, the strongest model only for Start Here, Mechanism notes and hard files.
4. The extension gets an "Update changed blocks" action (the panel already knows which blocks are changed and which
   lines are unexplained).
5. The Argus skill is installed in the owner's Claude Code, so that Create works (default command: "Use the argus
   skill ...").

## Order

1. Skill: a script that lists changed, moved, new and deleted blocks for a note; the "Later runs" rules; the
   source hash property; checker support for it. New skill version.
2. Extension: `argus.createModel`; "Update changed blocks".
3. Install the skill for the owner.

## Rules that still hold

No testing infrastructure and no new test code (owner, 2026-11-16): prove changes by running the product itself.
Codex reviews stress the product. The 13 points of `docs/SKILL-FEEDBACK-2026-11-16.md` belong to the same skill
revision where they touch the same text (dirty work tree, `%%` in inline code, a second language).
