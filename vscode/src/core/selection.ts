// Which blocks and which unexplained lines lie under a selection. No import of "vscode". Lines are 1-based.

import { Assignment, Placed } from "./match";

/** The places of a block in the text: every candidate place of an ambiguous block, else its one place. */
export function placesOf(placed: Placed): { from: number; to: number }[] {
  if (placed.state === "ambiguous" && placed.candidates && placed.candidates.length > 0) {
    const length = placed.at ? placed.at.to - placed.at.from : Math.max(placed.block.code.length - 1, 0);
    return placed.candidates.map((from) => ({ from, to: from + length }));
  }
  return placed.at ? [placed.at] : [];
}

export interface Under { blocks: Placed[]; unexplained: [number, number][]; }

/** The blocks that overlap the lines `from` to `to`, in the note's order, and the unexplained ranges inside them. */
export function underSelection(assignment: Assignment, from: number, to: number): Under {
  const blocks = assignment.placed.filter((placed) => placesOf(placed).some((at) => at.from <= to && at.to >= from));
  const unexplained: [number, number][] = [];
  for (const [a, b] of assignment.unexplained) {
    if (a <= to && b >= from) { unexplained.push([Math.max(a, from), Math.min(b, to)]); }
  }
  return { blocks, unexplained };
}

export interface Summary { current: number; changed: number; ambiguous: number; unexplained: number; }

/** The freshness summary: blocks current (masked ones too), changed, ambiguous; lines unexplained. */
export function summary(assignment: Assignment): Summary {
  const s: Summary = { current: 0, changed: 0, ambiguous: 0, unexplained: 0 };
  for (const placed of assignment.placed) {
    if (placed.state === "changed") { s.changed++; } else if (placed.state === "ambiguous") { s.ambiguous++; } else { s.current++; }
  }
  for (const [a, b] of assignment.unexplained) { s.unexplained += b - a + 1; }
  return s;
}

/** What "Update explanation" would do for a file: how many blocks are changed, and how many ranges of lines have
 *  no explanation. */
export interface Need { changed: number; unexplained: number;
  moved?: number; }       // blocks whose code is the same but lies at other lines than the note records

export function updateNeed(assignment: Assignment): Need {
  let changed = 0, moved = 0;
  for (const placed of assignment.placed) {
    if (placed.state === "changed") { changed++; }
    else if ((placed.state === "current" || placed.state === "current-masked") && placed.at && placed.at.from !== placed.block.from) { moved++; }
  }
  return { changed, unexplained: assignment.unexplained.length, moved };
}

/** Whether there is anything for "Update explanation" to do. */
export function needsUpdate(need: Need): boolean {
  return need.changed > 0 || need.unexplained > 0 || (need.moved ?? 0) > 0;
}
