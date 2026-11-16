// Decides what a message from the panel's page may do. No import of "vscode": panel.ts carries the decision out.
// The page shows note content, so a message is never trusted: its kind, its id and its address are all tested here.

import { Resolved } from "./links";

export type Action<N> =
  | { do: "drop" }                                   // not one of the allowed messages, or an id the index does not know
  | { do: "say"; text: string }                      // refused, with the reason shown in the panel
  | { do: "show"; note: N }                          // show this note
  | { do: "list"; name: string; places: N[] }        // several notes of that name: the person picks
  | { do: "pick"; note: N }
  | { do: "obsidian"; note: N }
  | { do: "open"; href: string }                     // through VS Code's own "open external"
  | { do: "ask"; href: string }                      // a file address: ask first, showing the whole path
  | { do: "create" } | { do: "check" } | { do: "setup" };

export interface Context<N> {
  resolve(name: string): Resolved<N>;                // the note a linked name means, in the project being shown
  byId(id: number): N | undefined;                   // the index's note of that id
  holds(note: N): boolean;                           // its real path lies, now, in the notes folder or the vault folder
  hrefs: ReadonlySet<string>;                        // the addresses that appear in what the panel shows
}

const OPENED = new Set(["http", "https", "mailto", "obsidian"]);
const OUTSIDE = "this note is no longer inside the notes folder or the vault folder; it is not opened";

/** The scheme of an address, in small letters; undefined when it has none. */
export function schemeOf(href: string): string | undefined {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href);
  return m ? m[1].toLowerCase() : undefined;
}

export function handle<N>(message: unknown, context: Context<N>): Action<N> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) { return { do: "drop" }; }
  const given = message as Record<string, unknown>;
  switch (given.type) {
    case "create": return { do: "create" };
    case "check": return { do: "check" };
    case "setup": return { do: "setup" };
    case "openNote": {
      if (typeof given.name !== "string") { return { do: "drop" }; }
      const found = context.resolve(given.name);
      if (found.kind === "none") { return { do: "say", text: `no Argus note is named '${given.name}'` }; }
      if (found.kind === "one") { return context.holds(found.note) ? { do: "show", note: found.note } : { do: "say", text: OUTSIDE }; }
      return { do: "list", name: given.name, places: found.places };
    }
    case "pick":
    case "obsidian": {
      if (typeof given.id !== "number" || !Number.isInteger(given.id)) { return { do: "drop" }; }
      const note = context.byId(given.id);
      if (note === undefined) { return { do: "drop" }; }
      if (!context.holds(note)) { return { do: "say", text: OUTSIDE }; }
      return { do: given.type, note };
    }
    case "external": {
      if (typeof given.href !== "string" || !context.hrefs.has(given.href)) { return { do: "drop" }; }
      const scheme = schemeOf(given.href);
      if (scheme !== undefined && OPENED.has(scheme)) { return { do: "open", href: given.href }; }
      if (scheme === "file") { return { do: "ask", href: given.href }; }
      return { do: "say", text: `this kind of address is not opened from a note: ${given.href}` };
    }
    default: return { do: "drop" };
  }
}

/** The addresses of the data-href links of rendered HTML, as the page reads them back from the attribute. */
export function hrefsIn(html: string): Set<string> {
  const hrefs = new Set<string>();
  for (const m of html.matchAll(/<a data-href="([^"]*)">/g)) {
    hrefs.add(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  }
  return hrefs;
}
