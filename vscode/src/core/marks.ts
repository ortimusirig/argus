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

/** How many places of an ambiguous block a hover names. */
const HOVER_PLACES = 20;

function andList(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join("") : numbers.slice(0, -1).join(", ") + " and " + numbers[numbers.length - 1];
}

// The marks of an assignment are made once: a draw and each request for lenses ask for the same ones again.
const made = new WeakMap<Assignment, Marks>();

/** The marks of an assignment. The work grows with the number of blocks, places and ranges, never with a product
 *  of two of them: what is said of a block is written once for all its places, and the unexplained ranges are
 *  set against the warnings in one sweep over both, in the order of the lines. */
export function marksOf(assignment: Assignment): Marks {
  let marks = made.get(assignment);
  if (!marks) {
    marks = prepare(assignment);
    made.set(assignment, marks);
  }
  return marks;
}

function byFrom(a: { from: number }, b: { from: number }): number {
  return a.from - b.from;
}

function prepare(assignment: Assignment): Marks {
  const marks: Marks = { current: [], warning: [], unexplained: [], masked: [], lenses: [] };
  // The blocks whose places were not all looked at (core/match.ts, PLACES): what is said of them says so.
  const trimmed = new Map<string, string>();
  for (const t of assignment.trimmed ?? []) {
    trimmed.set(t.id, ` This code is at ${t.places} identical places; the ${t.kept} nearest to the block's recorded line were looked at.`);
  }
  for (const placed of assignment.placed) {
    const name = `${placed.block.id}: ${placed.block.purpose}`;
    const few = trimmed.get(placed.block.id) ?? "";
    let say: string, tail = "";
    if (placed.state === "current") {
      say = `Argus: block ${name}. Current.`;
    } else if (placed.state === "current-masked") {
      say = `Argus: block ${name}. State: current (masked). The note hides part of this code.`;
      tail = " (masked)";
    } else if (placed.state === "changed") {
      say = `Argus: block ${name}. State: changed. Its explanation was written for earlier code`
        + (placed.spacesOnly ? "; the code here differs only in spaces at line ends." : ".");
      tail = " (changed)";
    } else {
      // A hover is sent to the editor once for each marked place: it names the first places only and says how
      // many more there are; the panel lists every one.
      const places = placed.candidates ?? [], first = places.slice(0, HOVER_PLACES), more = places.length - first.length;
      say = `Argus: block ${name}. State: ambiguous. This code is at lines ${andList(first)}`
        + (more > 0 ? ` and at ${more} more places (the Argus panel lists all)` : "") + "; the order of the blocks does not decide which.";
      tail = " (ambiguous)";
    }
    say += few;
    const title = `Argus ${name}${tail}${few === "" ? "" : " (not all places looked at)"}`;
    for (const at of placesOf(placed)) {
      if (placed.state === "current" || placed.state === "current-masked") {
        marks.current.push({ ...at, say });
        if (placed.state === "current-masked") { marks.masked.push({ from: at.from, to: at.from, say }); }
      } else {
        marks.warning.push({ ...at, say });
      }
      marks.lenses.push({ line: at.from, from: at.from, to: at.to, title });
    }
  }
  marks.warning.sort(byFrom);
  marks.lenses.sort((a, b) => a.line - b.line);
  // Unexplained lines that carry a warning already are not marked twice. One sweep: both lists are in the order
  // of the lines, and a warning that ends before a range begins is never looked at again. Warnings may overlap
  // one another (the places of an ambiguous block), so `from` only moves forward.
  const say = "Argus: no explanation for these lines.";
  let ranges = assignment.unexplained;
  if (ranges.some((range, n) => n > 0 && range[0] < ranges[n - 1][0])) { ranges = [...ranges].sort((a, b) => a[0] - b[0]); }
  const warnings = marks.warning;
  let next = 0;                                   // the first warning that may still reach a range
  let reach = 0;                                  // the last line covered by the warnings before `next`
  for (const [first, last] of ranges) {
    let from = Math.max(first, reach + 1);
    while (next < warnings.length && warnings[next].from <= last) {
      const warning = warnings[next++];
      if (warning.to > reach) { reach = warning.to; }
      if (warning.to < from) { continue; }
      if (warning.from > from) { marks.unexplained.push({ from, to: warning.from - 1, say }); }
      from = warning.to + 1;
    }
    if (from <= last) { marks.unexplained.push({ from, to: last, say }); }
  }
  return marks;
}
