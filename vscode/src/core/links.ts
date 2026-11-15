// Finds [[links]] in note text and says which note a name means. No import of "vscode".

import { fenceMask, linkNames } from "./notes";

/** The names that the [[Name]], [[Name|shown]] and [[folder/Name]] links of a text point at, in order, each once.
 *  A link inside a code span or a code fence is not a link. Names are read as the checker reads them. */
export function findLinks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const mask = fenceMask(lines);
  return linkNames(lines.filter((_, i) => !mask[i]));
}

export type Resolved<T> = { kind: "one"; note: T } | { kind: "several"; places: T[] } | { kind: "none" };

function named<T extends { name: string; path: string }>(name: string, notes: readonly T[]): T[] {
  const found: T[] = [];
  for (const note of notes) {
    // Names are compared as written, as the checker does; one file listed twice is one place.
    if (note.name === name && !found.some((other) => other.path === note.path)) { found.push(note); }
  }
  return found;
}

/** The note a linked name means: the project's own note first; else the vault's when exactly one has that name;
 *  else the list of places, for the person to pick from. Nothing is ever chosen among several. */
export function resolveLink<T extends { name: string; path: string }>(name: string, projectNotes: readonly T[],
  vaultNotes: readonly T[]): Resolved<T> {
  // Plan: "the project's own note first". Two notes of that name in the project are listed, not chosen from
  // (design, "duplicate notes": nothing is chosen for the person).
  for (const places of [named(name, projectNotes), named(name, vaultNotes)]) {
    if (places.length === 1) { return { kind: "one", note: places[0] }; }
    if (places.length > 1) { return { kind: "several", places }; }
  }
  return { kind: "none" };
}
