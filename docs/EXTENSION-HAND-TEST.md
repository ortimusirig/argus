# Argus VS Code extension: hand test (pieces 4 to 9)

First run inside VS Code: 2026-11-16, by the agent with clicks only (results at the end of this file). Use a scratch copy of a project for Create, never a shared repository.

The package: `C:\dev\argus-ext\vscode\argus-3.0.0.vsix` (rebuild: `npm run package` in `C:\dev\argus-ext\vscode`).

1. Extensions view, `...`, "Install from VSIX...", pick `argus-3.0.0.vsix`. Open the scratch folder and trust it.
2. Open a file with no project set. Argus panel: click "Choose the notes folder", pick the sample notes. One entry appears in the user settings.
3. Open a source file that has a note, select lines inside a block, right-click, "Argus: Explain selection". Expect the block, "current", the selected rows marked.
4. Run "Argus: Explain this file". Expect the purpose table open and every block.
5. Edit one line of a block without saving. Expect "changed" in the panel and a warning-colour bar.
6. Add a new function. Expect a dotted bar and "No explanation for lines ..." with a Create button.
7. Click the grey CodeLens above a block. Expect the panel on that block.
8. Undo the edits. Click "Check notes". Expect "checked" (or the graph variants) and the details block.
9. Break another note of the folder. Expect the badge to drop to "not checked", then "check failed" after a new check, with the other note named.
10. Open a file without a note. Click "Create explanation". Expect the terminal "Argus: create explanation" and the panel line "agent running...", with no Create button.
11. Run Create again from the palette while it runs. Expect "already running", no second terminal.
12. Switch to another file while it runs. Expect no "agent running" line there.
13. Let the agent finish. Expect the note and a badge from the check.
14. Make the file dirty, run Create. Expect the "Save and create" question; Cancel starts nothing.
15. Set `argus.createCommand` to `["no-such-program"]`. Expect "could not start ... argus.createCommand" and no terminal.
16. Set it to a program that exits 1 (for example `["node", "-e", "process.exit(1)"]`). Expect "stopped with an error", terminal left open.
17. Set it to a program that exits 0 and writes nothing. Expect "finished without writing the note".
18. On Windows with npm's `claude.cmd` first on PATH: expect the batch-file refusal.
19. Put `argus.createCommand` in the workspace settings. Expect it to be ignored.
20. Open the folder in Restricted Mode. Expect Create and Check to refuse with "Restricted Mode".
21. Click a concept link in a block. Expect the Concept note with "Back" and "Open note in Obsidian".
22. Click a link inside that note, then Back twice. Expect the first note, then the file.
23. Delete the shown note's file on disk. Expect "no longer there" with a Back button.
24. Click "Open note in Obsidian" on a note inside a vault. Then try a note whose name holds a space and `&`.
25. Run "Argus: Open note in Obsidian" from the palette with a file's note shown.
26. Hide the panel, move the selection, show it again. Expect the file view, not the old note.

Write down for each step: passed, or what was seen instead.

## Results of the first run (2026-11-16, agent, clicks only, VS Code on Windows, package of `db6fb4b`)

Setup used: user settings `argus.projects` with source root `C:\dev\applexus-chat`, notes folder the vault folder `01.01 Helper Build`, vault folder the vault `Obsidian-ai`; file `aura-helper/src/errors.js`.

Passed: step 1 (installed with `code --install-extension`, activates); step 3 and 7 in the CodeLens form (CodeLens above each block, a click opens the panel on that block, the selected rows are marked, "6 blocks current"); the marker bars; step 8 (Check notes ran the real checker: "check failed" with the checker's own sentences about links of another note, because no vault folder was set then; details block shown); step 21 (a concept link opens the Concept note with Back and Open note in Obsidian); step 22 in part (Back returns to the file); step 24 in part (Open note in Obsidian brought Obsidian to the front; which note it showed was not seen).

Defects found and fixed in this run: a CodeLens of a block without a purpose read "Argus 2:"; code and headers in a narrow table were cut at every letter; the panel dropped the file when the text box of a comment (CodeTour) took the focus; after a settings change the panel showed "no note" with a Create button until a large vault was read.

Not done (need typing, settings edits or a scratch project): steps 2, 4, 5, 6, 9 to 20, 23, 25, 26. A window reload is needed first so that the newest package is the one that runs.
