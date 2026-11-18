# Argus skill: feedback from a real run on a shell script (2026-11-16)

A fresh agent followed `skills/argus/SKILL.md` (2.9.2) on `xreview.sh` of the cross-model-review skill, v18 work tree
(1,396 lines of bash, depth `map`). Result: 33 notes, 115 blocks, checker PASS, in the vault folder
`Applexus GPT\09 Process and tooling\Cross-Model Review`. The extension shows them ("115 blocks current").
These are the places where the skill's instructions were unclear or hard to follow. Input for the next review of the skill.

1. Commit of a dirty work tree: the template defines `commit` as `git log -1` only; nothing says "plus uncommitted
   changes". A note written from a dirty file later looks current when it is not.
2. Concept notes when the shared ones may not be edited: the rules cover "no note", "argus note: add to it" and
   "a person's note". Not covered: an argus note of another project that this run may not change.
3. A second language (Bash after JavaScript): "works the same way keeps its note with an In <language> section"
   needs editing the shared note, and almost nothing works the same way.
4. The `%%` check hits inline code: `${x%% *}` inside backticks failed as "an Obsidian comment". Will recur for
   Bash, printf formats and Windows batch.
5. Mechanism in a one-file run: "a behaviour that spans files" has no candidates with one file in scope.
6. Library for a shell script: whether Bash, the Unix tools and other CLIs are "libraries used directly" is not
   said; "version from the project's dependency file" has no answer without such a file.
7. Guided walk against a read-only source or a notes-only vault: step 10 offers only `--in-project` or
   `--out <notes folder>`.
8. Block size against the comment rule: "about 25 lines" and "a comment belongs to the block it sits directly
   above" conflict for long functions.
9. Lens row matching is loose: labels are matched as substrings in any table, so a missing lens row can pass.
10. "Every technical word links to a Concept note" at depth `map` for 115 blocks is workable only with link
    aliases in prose; the skill forbids aliases in tables and does not say they are meant for prose.
11. Folders: the templates use `Files/`, `Concepts/`, `Mechanisms/`, `Libraries/` and also call Concept and
    Library notes "shared by every project in the vault", without saying where shared ones live.
12. Angle brackets in prose (`<attempt>` outside backticks) are read by Obsidian as HTML and vanish; neither the
    skill nor the checker warns.
13. Size estimate: 25 words per source line predicted 35,000 words for the File note; it came to about 30,000,
    and 51,000 for all 33 notes.

Also from the same day, for the checker: two code fences with no text between them are read as one code block
(`check_notes.py` lines 208 to 213); the extension follows the checker on purpose. Decide in the skill's review
whether the rule should change.

Not yet done for the product: the Argus skill is not installed in the owner's Claude Code, so the extension's
Create button (default command "Use the argus skill ...") would start Claude without it.
