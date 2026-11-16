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
      + "or it is no longer an Argus note.", back: true };
  }
  return { kind: "note", id: entry.id, folder: path.dirname(entry.path),
    note: { name: entry.name, body: parseOtherNote(entry.name, entry.path, entry.text).body }, linkTo: notes.linkTo(entry.project) };
}

const STEPS = 100;

function same(a: Shown, b: Shown): boolean {
  return a.kind === "note" ? b.kind === "note" && a.id === b.id : b.kind === "places" && a.name === b.name;
}

/** What the panel shows in place of the file, and the way back: each note or list opened from another is a step.
 *  A step keeps which note it was (its id), never its text. A list of places is built again when the person
 *  comes back to it, since the notes may have changed meanwhile. The panel clears the trail when the selection
 *  moves and when a command opens the panel: nothing of an old trail comes back. */
export class Trail {
  private shown?: Shown;
  private readonly before: Shown[] = [];

  /** What is shown now; undefined when the file's own explanation is. */
  get now(): Shown | undefined { return this.shown; }

  /** The person opened a note or a list. What was shown becomes a step back, unless it is the same thing. */
  open(next: Shown): void {
    if (this.shown && !same(this.shown, next)) {
      this.before.push(this.shown);
      if (this.before.length > STEPS) { this.before.shift(); }
    }
    this.shown = next;
  }

  /** One step back: what is shown then, or undefined for the file. `again` gives a list of places anew by its
   *  name: the list, the one note that is left, or undefined when no note has the name any more; that step is
   *  then left out. */
  back(again: (name: string) => Shown | undefined): Shown | undefined {
    for (;;) {
      const step = this.before.pop();
      this.shown = step?.kind === "places" ? again(step.name) : step;
      if (this.shown || !step) { return this.shown; }
    }
  }

  clear(): void {
    this.shown = undefined;
    this.before.length = 0;
  }
}
