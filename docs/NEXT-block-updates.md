# Next work, agreed with the owner on 2026-11-16: update only what changed, git optional, model choice

Status: item 1 of "Order" (the skill) is BUILT as version 2.10.0 on branch `skill-2.10` (worktree `C:\dev\argus-skill`), not merged, not pushed. Items 2 and 3 are open. In the extension, run `npm run build` after the merge so that it ships the 2.10 checker.

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

## P2 backlog of skill 2.10

Open after ten Codex stress rounds of branch `skill-2.10`. None blocks the merge; each is one line.

| Item | Where | Planned fix |
| --- | --- | --- |
| The test whether another block could take a displaced block's free place looks at every place of every other unplaced block: it grows with blocks times places (8.8 s for 10,000 reversed blocks) | `skills/argus/scripts/changed_blocks.py`, the loop over `rivals` in `compare` (line 439 at commit `d3efe1c`) | Index the places as intervals once for the note, or give the scan a budget and report the moves it left undecided |
| The TODO lines about cited line numbers and about what rests on a rewritten block are printed by the run that sees the change; a later run no longer knows them | `changed_blocks.py`, `finish` | Keep them in the note (a property) until the note is closed, or in a small state file beside the lock |
| A writer that does not take the lock (an editor, an agent editing by hand) can still save in the instant between the last reading of the note and the replace | `changed_blocks.py`, `write_note` | None known without a lock every writer honours; the help says so |
| `~/.argus/locks` keeps one empty file for each note that was ever written by `--fix-moved` | `changed_blocks.py`, `NoteLock` | Remove a lock file after use when no other run waits for it, or clear old ones in `setup_tools.py` |
| The diagram of a Flow note and its Steps table can name different blocks and no check sees it; only the Steps table is checked | `skills/argus/scripts/check_notes.py`, `check_flow_note`; `note-templates.md` | A written form for block ids in the diagram that can be read without parsing free text, or a table of nodes beside the diagram |
| A line table whose heading is not exactly `Line` or `Lines` (an older note, another language) is not written by `--fix-moved`; its rows become TODO lines | `changed_blocks.py`, `line_column` | A list of accepted headings in one place, or a property of the note that names its line column |
| A second summary table in the Level 2 section, a table inside a block at depth `map`, and a line table that is not at the template's place or has another heading row are never written by `--fix-moved`; the first two get no TODO line, the third one TODO for each block | `changed_blocks.py`, `moved_text` | Decide whether such tables should be named in a TODO line whenever a cell holds a moved block's old lines |
| The exact heading rows of the three template tables exist in three places: `note-templates.md`, the writer (`LEVEL2_HEADER`, `LINE_HEADER`, `TRACE_HEADER`) and `own_check` (its own copy, on purpose) | `skills/argus/note-templates.md`; `changed_blocks.py` | A check at the start of the script that the three copies agree with the templates file, so a reworded template is noticed at once |
