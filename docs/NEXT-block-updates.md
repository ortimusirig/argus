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

## Added on 2026-11-16 (owner's question: "it didn't ask for the location of Obsidian?")

6. First-run setup asks once for the vault and the notes folder, checks that the folder exists and lies inside a
   vault (a `.obsidian` folder above it), and warns when it does not. Today the skill asks only "if unclear", does
   not check that Obsidian is there, and the extension's "Choose the notes folder" asks for the notes folder only.
7. The guided walk when the source may not be written to: `make_tour.py` gets a place outside the project, and the
   notes say how to open it (`CodeTour: Open Tour File...`).

## Added on 2026-11-16 (owner: "I don't see the graphify link, also the archify diagram")

8. The graph is shown, not only used: after a run the skill keeps graphify's `graph.html` at a place that lasts
   (beside the notes or in a folder the owner names) and the Start Here note links to it. Today it stays in a
   temporary folder and no note names it.
9. A diagram of how the code runs, per project or per main flow, as part of the notes: the owner expects the
   "archify" kind (entry to result, every end state, who decides, what each part cannot do). Today the skill writes
   a Mermaid sequence diagram in Mechanism notes only. First one made by hand on 2026-11-16 for `xreview.sh code`
   (artifact https://claude.ai/artifact/3bNRQqb7rp5wMTvVYPfYKa); decide whether the skill makes such a page or a
   Mermaid flowchart inside the File note.
