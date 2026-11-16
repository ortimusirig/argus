// What the editor marks for an assignment: bars, the masked sign and the lenses. No import of "vscode".
// Lines are 1-based. A state is always said in words too (`say`, the lens title), never by colour alone.

import { Assignment } from "./match";
import { placesOf } from "./selection";

export interface Mark { from: number; to: number; say: string; }
export interface Lens { line: number; from: number; to: number; title: string; }
export interface Marks {
  current: Mark[];        // a thin bar beside the lines of a current block
  warning: Mark[];        // the same bar in the warning colour: a changed block, every place of an ambiguous one
  unexplained: Mark[];    // a dotted bar
  masked: Mark[];         // the masked sign in the gutter, at the first line of a block that is current (masked)
  lenses: Lens[];         // the block's purpose above its first line; a click opens the panel on its lines
}

function andList(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join("") : numbers.slice(0, -1).join(", ") + " and " + numbers[numbers.length - 1];
}

export function marksOf(assignment: Assignment): Marks {
  const marks: Marks = { current: [], warning: [], unexplained: [], masked: [], lenses: [] };
  for (const placed of assignment.placed) {
    const name = `${placed.block.id}: ${placed.block.purpose}`;
    for (const at of placesOf(placed)) {
      let say: string, tail = "";
      if (placed.state === "current") {
        say = `Argus: block ${name}. Current.`;
        marks.current.push({ ...at, say });
      } else if (placed.state === "current-masked") {
        say = `Argus: block ${name}. State: current (masked). The note hides part of this code.`;
        tail = " (masked)";
        marks.current.push({ ...at, say });
        marks.masked.push({ from: at.from, to: at.from, say });
      } else if (placed.state === "changed") {
        say = `Argus: block ${name}. State: changed. Its explanation was written for earlier code`
          + (placed.spacesOnly ? "; the code here differs only in spaces at line ends." : ".");
        tail = " (changed)";
        marks.warning.push({ ...at, say });
      } else {
        say = `Argus: block ${name}. State: ambiguous. This code is at lines ${andList(placed.candidates ?? [])}; `
          + "the order of the blocks does not decide which.";
        tail = " (ambiguous)";
        marks.warning.push({ ...at, say });
      }
      marks.lenses.push({ line: at.from, from: at.from, to: at.to, title: `Argus ${name}${tail}` });
    }
  }
  marks.warning.sort((a, b) => a.from - b.from);
  marks.lenses.sort((a, b) => a.line - b.line);
  // Unexplained lines that carry a warning already are not marked twice.
  const say = "Argus: no explanation for these lines.";
  for (const [first, last] of assignment.unexplained) {
    let from = first;
    for (const warning of marks.warning) {
      if (warning.to < from || warning.from > last) { continue; }
      if (warning.from > from) { marks.unexplained.push({ from, to: warning.from - 1, say }); }
      from = Math.max(from, warning.to + 1);
    }
    if (from <= last) { marks.unexplained.push({ from, to: last, say }); }
  }
  return marks;
}
