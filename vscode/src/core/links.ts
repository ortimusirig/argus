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

/** The answers of `resolveLink` for one set of notes, asked by name. */
export interface LinkMap<T> { resolve(name: string): Resolved<T>; }

/** The notes under each name, in the order given. A Map, so a note named `constructor` is a name like any other. */
function byName<T extends { name: string }>(notes: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    const group = groups.get(note.name);
    if (group) { group.push(note); } else { groups.set(note.name, [note]); }
  }
  return groups;
}

/** `resolveLink` for many links: the notes are put under their names once, and each link is then one lookup, not a
 *  walk over all notes. The answers are those of `resolveLink`: names as written, the project's own notes before
 *  the vault's, one file listed twice is one place, several places in the order of the notes. Build it again when
 *  the notes change. */
export function linkMap<T extends { name: string; path: string }>(projectNotes: readonly T[], vaultNotes: readonly T[]): LinkMap<T> {
  const groups = [byName(projectNotes), byName(vaultNotes)];
  const kept = new Map<string, Resolved<T>>();       // the answers for names that more than one note has
  return {
    resolve(name: string): Resolved<T> {
      const known = kept.get(name);
      if (known) { return known; }
      for (const group of groups) {
        const notes = group.get(name);
        if (!notes) { continue; }
        if (notes.length === 1) { return { kind: "one", note: notes[0] }; }
        const paths = new Set<string>(), places: T[] = [];
        for (const note of notes) {
          if (!paths.has(note.path)) { paths.add(note.path); places.push(note); }
        }
        const answer: Resolved<T> = places.length === 1 ? { kind: "one", note: places[0] } : { kind: "several", places };
        kept.set(name, answer);
        return answer;
      }
      return { kind: "none" };
    },
  };
}

/** The address that opens a note in Obsidian: `obsidian://open?path=` and the note's full path. Every character
 *  of the path that is not a letter, a digit or one of `-._~` is percent-encoded, so nothing in a file's name
 *  (`&`, `#`, `=`, `+`, `%`, a space) can end the path or add a second value to the address. Undefined when the
 *  path is not a full path of this system, or cannot be written as an address (a NUL, half a character pair).
 *  The caller has asked first that the note lies in the notes folder or the vault folder, and opens the address
 *  through VS Code's own "open external" only. */
export function obsidianAddress(file: string, windows: boolean): string | undefined {
  const full = windows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(file) : file.startsWith("/");
  if (!full || file.includes("\0")) { return undefined; }
  let encoded: string;
  try { encoded = encodeURIComponent(file); } catch { return undefined; }
  return "obsidian://open?path=" + encoded.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Whether the address of this path must be opened exactly as `obsidianAddress` wrote it. VS Code writes an
 *  address again when it is given as a Uri: decoded, then encoded by rules that leave `& # + = ;` as they are.
 *  A path with one of these would be cut short or changed on the way; a path without them arrives the same. */
export function needsExactAddress(file: string): boolean {
  return /[&#+=;]/.test(file);
}
