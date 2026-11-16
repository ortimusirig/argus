// What the panel shows in place of the file's explanation: a linked note, or the places of a name. No import of
// "vscode". The panel remembers which note it shows, never the note's text: the text is asked of the index each
// time the panel is drawn, so a note that was changed, deleted or read again is shown as it is now.

import * as path from "node:path";
import { LinkTo } from "./markdown";
import { Entry } from "./noteIndex";
import { parseOtherNote } from "./notes";
import { View } from "./panelHtml";
import { Project } from "./projects";

/** A note the panel shows: its id in the index, and its name for the sentence that says it is gone. */
export interface ShownNote { kind: "note"; id: number; name: string; }
export type Shown = ShownNote | Extract<View, { kind: "places" }>;

/** What the index is asked when a shown note is drawn. */
export interface Notes {
  byId(id: number): Entry | undefined;          // the index's note of that id, as it is now
  holds(entry: Entry): boolean;                 // its real path lies, now, in the notes folder or the vault folder
  linkTo(project: Project): LinkTo;             // which [[links]] of a note of that project are notes
}

export function shownNote(entry: Entry): ShownNote {
  return { kind: "note", id: entry.id, name: entry.name };
}

/** The view of what is shown, from the index as it is now. */
export function shownView(shown: Shown, notes: Notes): View {
  if (shown.kind !== "note") { return shown; }
  const entry = notes.byId(shown.id);
  if (!entry || !notes.holds(entry)) {
    return { kind: "message", text: `No note: the Argus note '${shown.name}' is no longer there. It was deleted, moved or renamed, `
      + "or it is no longer an Argus note." };
  }
  return { kind: "note", id: entry.id, folder: path.dirname(entry.path),
    note: { name: entry.name, body: parseOtherNote(entry.name, entry.path, entry.text).body }, linkTo: notes.linkTo(entry.project) };
}
