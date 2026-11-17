# Argus for VS Code

Argus for VS Code shows the Argus notes beside the code they explain. You select lines of code. The Argus panel shows the explanation of those lines from the notes: the purpose, the code of the block, the line-by-line table, and the concepts with their notes. The panel also says two things about each explanation: whether it still describes the code as it is now, and whether the note passed the Argus check.

The notes are written by the argus skill (see "The skill" below). The extension only reads them. It never changes a note, and it sends nothing anywhere.

## Install

1. Build the package, or take the built file `argus-3.0.0.vsix`.
2. In VS Code open the Extensions view, open the `...` menu, and choose "Install from VSIX...".
3. Pick the `.vsix` file.

The extension is not on the Marketplace. It needs VS Code 1.90 or later. The check needs Python 3.10 or later.

To build the package yourself, in the folder `vscode/`:

```
npm install
npm run package
```

This compiles the code, copies the checker from `skills/argus/scripts`, runs the tests, and writes `argus-3.0.0.vsix`.

## First use

Open a source file. The Argus panel is in the activity bar. When no project is set, the panel offers "Choose the notes folder". Pick the folder that holds the Argus notes. The first workspace folder becomes the source root. One entry is written to your user settings.

## Settings

| Setting | Meaning | Default |
| --- | --- | --- |
| `argus.projects` | A list. Each entry has `sourceRoot` (the folder the notes' `source` paths are relative to) and `notesFolder` (the folder with the Argus notes). Optional: `vaultFolder` (the root of the Obsidian vault, for shared Concept and Library notes) and `graph` (the path of a graphify `graph.json` for the check) | Empty |
| `argus.createCommand` | The agent program and its arguments, as a list. The placeholders `${file}`, `${notesFolder}`, `${sourceRoot}` and `${depth}` are filled in each argument | `["claude", "Use the argus skill. Explain ${file}, depth ${depth}. Source root: ${sourceRoot}. Put the notes in ${notesFolder}."]` |
| `argus.updateCommand` | The same for "Update explanation". Here `${depth}` is the depth of the file's note | `["claude", "Use the argus skill, version 2.10 or later. Update the explanation of ${file} as the section Later runs of the skill says: correct the line numbers of moved blocks, rewrite only the changed blocks, add blocks for unexplained lines. Depth ${depth}. Source root: ${sourceRoot}. Notes folder: ${notesFolder}."]` |
| `argus.createModel` | The model the agent uses, for Create and for Update. When it is not empty, the two arguments `--model` and this value are placed right after the program, before the other arguments of the command | Empty |
| `argus.createDepth` | The depth asked for on create: `map` or `full` | `full` |
| `argus.python` | The Python program for the check | `python` |

`argus.createCommand`, `argus.updateCommand`, `argus.createModel` and `argus.python` are read from your user settings only. A workspace cannot set them.

`argus.createModel` is the `--model` option of the Claude Code program, for example `sonnet` or `opus`. For another agent leave it empty and write that agent's own option into the command. Leave it empty too when the command names `node` and a script: the option would come before the script. The value may hold letters, digits and `. - _ : /` only, at most 100 characters, and must not begin with `-`. With any other value nothing is started, and the panel says so. With several workspace folders, each needs its own entry in `argus.projects`.

## Commands

| Command | What it does |
| --- | --- |
| Argus: Explain selection | Shows the blocks under the selection. An empty selection means the line of the cursor. Also in the editor's right-click menu |
| Argus: Explain this file | Shows the file's purpose table and every block |
| Argus: Create explanation | Has the coding agent write the note for the file (see "Create") |
| Argus: Update explanation | Has the coding agent bring the file's note up to the code (see "Update") |
| Argus: Check notes | Runs the Argus check for the file's note and shows the result |
| Argus: Refresh notes | Reads the notes folders again |
| Argus: Open note in Obsidian | Opens the note that is shown in Obsidian |

A click on a concept shows that Concept note in the panel. "Back" goes one step back, and from the first note to the file.

## Freshness: does the explanation describe the code as it is now?

The extension compares the code copied into the note with the text in the editor, saved or not.

| State | Meaning | Marker in the editor |
| --- | --- | --- |
| current | The block's code is in the file exactly, at one place | A thin bar |
| current (masked) | The same, where the note hides a secret behind `[masked]`. The panel shows the note's masked code, never the editor's text | A thin bar and a lock sign |
| changed | The block's code is not in the file exactly. The explanation was written for earlier code | A bar in the warning colour |
| ambiguous | The block's code is at more than one place and the order of the blocks does not decide which | A bar in the warning colour at each place |

A non-blank line that no current block covers is unexplained. It has a dotted bar. Selecting changed, ambiguous or unexplained lines offers "Create explanation".

## Validation: did the note pass the Argus check?

The extension runs the skill's own check script. A result is kept only while everything the check read is unchanged.

| Badge | Meaning |
| --- | --- |
| checked | The check passed and the graph covers this file |
| checked; this file is not in the graph | The check passed. The functions of this file were not compared with the graph |
| checked, graph not used | The check passed without a graph |
| check failed | The check found faults. The panel lists them: about this note, about the graph, about other notes |
| check error | The check could not run or did not finish. The panel says why |
| not checked | No result, or something the check reads has changed since, or the window is in Restricted Mode |

A fault in another note of the same folder keeps this note from showing "checked": the check certifies the folder's notes together.

## Create

"Create explanation" starts the coding agent in a terminal named "Argus: create explanation". The agent runs the argus skill for the whole file. Answer the agent in that terminal if it asks something.

- The file must be saved. With unsaved changes the extension asks "Save and create" first.
- One agent runs at a time.
- When the agent ends without an error and has written the note, the extension runs the check and shows the badge.
- When the agent stops with an error, its output stays in the terminal.
- The program is started directly with its list of arguments. No command shell reads them. On Windows a batch file (`.cmd` or `.bat`) is refused for that reason: name an `.exe` in the command, or `node` with the path of the agent's script as the first argument.

## Update

"Update explanation" is for a file that has a note whose blocks no longer all fit the code. The panel shows the button when the note has at least one changed block or the file has at least one range of unexplained lines. The button says what will be done, for example "Update explanation (2 changed blocks, 1 unexplained range)".

- It starts the coding agent as Create does, in a terminal named "Argus: update explanation", with the command of `argus.updateCommand`. Every rule of Create holds here too.
- The agent is asked to rewrite only the changed blocks and to add blocks for the unexplained lines. The depth is the depth of the note, not `argus.createDepth`.
- The file must be saved. With unsaved changes the extension asks "Save and update" first.
- One agent runs at a time, for Create and Update together.
- When the agent ends without an error and has changed the note, the panel says "the note was updated", and the extension runs the check and shows the badge. When the note is the same as before, the panel says "the agent ended without changing the note".

Update needs the Argus skill 2.10 or later. Create works with an older skill too.

- The main branch of the Argus repository holds the skill 2.9.2 for now. Until 2.10 is on the main branch, it is on the branch `skill-2.10` of the same repository, in the folder `skills/argus`. Install the skill from that branch (see "The skill").
- With an older skill, use Create. Or set `argus.updateCommand` to a prompt of your own that your skill can follow.

## The skill

The agent needs the argus skill. Copy `skills/argus` from the Argus repository into `~/.claude/skills/`, or add the repository as a Claude Code plugin. The main branch gives the skill 2.9.2, which is enough for Create. Update needs 2.10 or later: until 2.10 is on the main branch, take `skills/argus` from the branch `skill-2.10`. Then run once:

```
python -B skills/argus/scripts/setup_tools.py --install
```

Another agent works too: put its program and its arguments into `argus.createCommand` and `argus.updateCommand`.

## Obsidian

"Open note in Obsidian" opens the note through an `obsidian://` address. Obsidian must be installed, and the note must lie inside one of its vaults. Only a note inside the notes folder or the vault folder of the project is opened.

## Safety

- In Restricted Mode (a workspace you have not trusted) the extension shows notes with your own settings only. Create, Update and Check stay off.
- Text from a note is shown as text. A note cannot run script in the panel.
- A link in a note that is not a note opens only on a click, through VS Code's own prompt.
- Source code leaves the computer only through the coding agent you set up yourself.
