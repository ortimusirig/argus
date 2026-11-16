# Argus VS Code extension: hand test (pieces 4 to 9)

Nothing of the extension has run inside VS Code yet. Use a scratch copy of a project for Create, never a shared repository.

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
