// Builds the panel's HTML. No import of "vscode". Every text that comes from a note, a path or a message goes
// through the renderer of markdown.ts or its escaper; the only tags are the ones written here and there.

import { LinkTo, escape, render } from "./markdown";
import { Details } from "./checkResult";
import { Assignment, Placed } from "./match";
import { Block, FileNote } from "./notes";
import { Need, placesOf, summary, underSelection, updateNeed } from "./selection";

/** The page's content security policy: nothing by default; styles and images from the extension's media folder
 *  only; scripts only with the nonce of this render. */
export function csp(cspSource: string, nonce: string): string {
  return `default-src 'none'; style-src ${cspSource}; img-src ${cspSource}; script-src 'nonce-${nonce}'`;
}

export function page(o: { cspSource: string; nonce: string; cssUri: string; jsUri: string; body: string; pageId?: number }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escape(csp(o.cspSource, o.nonce)).replace(/&#39;/g, "'")}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escape(o.cssUri)}">
<title>Argus</title>
</head>
<body${o.pageId === undefined ? "" : ` data-page="${o.pageId}"`}>
${o.body}
<script nonce="${escape(o.nonce)}" src="${escape(o.jsUri)}"></script>
</body>
</html>`;
}

/** The validation badge: its words, why, and the details of the check result it comes from. */
export interface Badge { label: string; why?: string; details?: Details; }
export interface Listed { id: number; name: string; folder: string; }

/** What a run of Create or Update says for the file shown (core/create.ts). While it runs, no Create button and no
 *  Update button is offered. */
export interface Creating { text: string; running: boolean; }

export type View =
  // `problems`, here and below: the notes of the project that the index could not use, each as one sentence.
  // `back`: the message stands in place of a shown note (it is gone), so it has the way back that the note had.
  | { kind: "message"; text: string; button?: "setup" | "create"; problems?: string[]; create?: Creating; back?: boolean }
  | { kind: "duplicates"; file: string; notes: Listed[]; problems?: string[]; create?: Creating }
  | { kind: "places"; name: string; places: Listed[] }
  | { kind: "note"; id: number; folder: string; note: { name: string; body: string }; linkTo: LinkTo }
  | { kind: "file"; file: string; note: FileNote; noteId: number;
      assignment?: Assignment;                 // undefined while the file is being matched
      matching?: number;                       // blocks done so far, while it is being matched
      selection?: { from: number; to: number };   // lines, 1-based
      whole: boolean;                          // "Explain this file": the lens table and every block
      badge: Badge; linkTo: LinkTo;
      create?: Creating;
      problems: string[]; };                   // notes of the project whose source the index could not use

const BUTTONS = { setup: "Choose the notes folder", create: "Create explanation", check: "Check notes", back: "Back" };

function button(msg: keyof typeof BUTTONS): string {
  return `<button data-msg="${msg}">${BUTTONS[msg]}</button>`;
}

function many(n: number, one: string, more: string): string {
  return `${n} ${n === 1 ? one : more}`;
}

/** The words of the Update button: they say what will be done, for example
 *  "Update explanation (2 changed blocks, 1 unexplained range)". */
export function updateLabel(need: Need): string {
  const parts = [...(need.changed > 0 ? [many(need.changed, "changed block", "changed blocks")] : []),
    ...(need.unexplained > 0 ? [many(need.unexplained, "unexplained range", "unexplained ranges")] : [])];
  return parts.length === 0 ? "Update explanation" : `Update explanation (${parts.join(", ")})`;
}

/** The Update button of a file's view; nothing when it is not offered. It is offered for a note that can be read,
 *  when the match is done and shows a changed block or an unexplained range, and no run is going for the file. */
function updateButton(view: Extract<View, { kind: "file" }>): string {
  if (view.note.problems.length > 0 || !view.assignment || view.create?.running) { return ""; }
  const need = updateNeed(view.assignment);
  return need.changed === 0 && need.unexplained === 0 ? "" : ` <button data-msg="update">${escape(updateLabel(need))}</button>`;
}

function listed(items: Listed[]): string {
  return "<ul class=\"places\">" + items.map((item) =>
    `<li><button data-pick="${item.id}">${escape(item.name)}</button> <span class="where">${escape(item.folder)}</span></li>`).join("\n") + "</ul>";
}

function items(list: string[]): string {
  return "<ul>" + list.map((text) => `<li>${escape(text)}</li>`).join("\n") + "</ul>";
}

/** The Problems fold: why notes of the project are not used. Nothing when there are none. The same in every view
 *  of a file: with its note, with no note, with several notes. */
function problemsHtml(problems: string[] | undefined): string[] {
  if (!problems || problems.length === 0) { return []; }
  return [`<details data-fold="problems"><summary>Problems: ${many(problems.length, "note", "notes")} of this project not used</summary><ul>`
    + problems.map((p) => `<li>${escape(p)}</li>`).join("\n") + "</ul></details>"];
}

/** The view of a source file that has no one note to show: no note explains it, or several do. The project's
 *  problems go with it: a note that was refused (its link leads out of the folders) is the likely reason. */
export function withoutNote(file: string, notes: Listed[], problems: string[], create?: Creating): View {
  const creating = create ? { create } : {};
  return notes.length === 0
    ? { kind: "message", text: `No note: no Argus note explains ${file}.`, button: "create", problems, ...creating }
    : { kind: "duplicates", file, notes, problems, ...creating };
}

/** What a run of Create says, as a line of its own. Nothing when there is nothing to say. */
function createHtml(create: Creating | undefined): string[] {
  return create ? [`<p class="create" role="status">${escape(create.text)}</p>`] : [];
}

/** The "Check details" block: under the badge whenever a check result is stored, whatever the badge. */
/** The list of the trimmed blocks, written once for each assignment: it can be long, and the panel is drawn often. */
const TRIMMED_HTML = new WeakMap<object, string>();
function trimmedHtml<T extends object>(all: T[], line: (t: T) => string): string {
  let html = TRIMMED_HTML.get(all);
  if (html === undefined) { html = all.map(line).join("\n"); TRIMMED_HTML.set(all, html); }
  return html;
}

const CHECK_HTML = new WeakMap<Details, string>();
function checkHtml(d: Details): string {
  // Drawn once for each result: the lists can be very long, and the panel is drawn often.
  let html = CHECK_HTML.get(d);
  if (html === undefined) { html = checkHtmlOf(d); CHECK_HTML.set(d, html); }
  return html;
}

function checkHtmlOf(d: Details): string {
  const out: string[] = ['<div class="check">'];
  const groups: [string, string[]][] = [["About this note", d.fails.mine], ["About the graph", d.fails.graph],
    ["About other notes", d.fails.others], ["Files without a note", d.fails.missing]];
  for (const [title, list] of groups) {
    if (list.length > 0) { out.push(`<h3>${title}</h3>`, items(list)); }
  }
  out.push(`<p>Graph: ${escape(d.graph)}.</p>`);
  if (d.masked.length > 0) {
    out.push(`<p>Masked lines of this note: ${d.masked.join(", ")}; confirm each hides a secret and nothing else.</p>`);
  }
  if (d.warnings.length > 3) {
    out.push(`<details data-fold="warnings"><summary>${d.warnings.length} warnings</summary>${items(d.warnings)}</details>`);
  } else if (d.warnings.length > 0) {
    out.push(`<h3>${many(d.warnings.length, "warning", "warnings")}</h3>`, items(d.warnings));
  }
  if (d.stale.length > 0) { out.push("<h3>Stale</h3>", items(d.stale)); }
  out.push("</div>");
  return out.join("\n");
}

function andList(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join("") : numbers.slice(0, -1).join(", ") + " and " + numbers[numbers.length - 1];
}

const STATE = { "current": "current", "current-masked": "current (masked)", "changed": "changed", "ambiguous": "ambiguous" };

function range(from: number, to: number): string {
  return from === to ? `line ${from}` : `lines ${from}-${to}`;
}

/** A cell of a note's table: Markdown, rendered; a paragraph of its own is not needed in a cell. */
function cell(text: string, linkTo: LinkTo): string {
  const html = render(text, linkTo);
  return /^<p>[^]*<\/p>$/.test(html) && html.indexOf("<p>", 1) < 0 ? html.slice(3, -4) : html;
}

function blockHtml(placed: Placed, selection: { from: number; to: number } | undefined, linkTo: LinkTo): string {
  const block: Block = placed.block;
  const exact = placed.state === "current" || placed.state === "current-masked";
  const out: string[] = [`<section class="block state-${placed.state}">`];
  const where = exact && placed.at ? range(placed.at.from, placed.at.to) : `recorded ${range(block.from, block.to)}`;
  out.push(`<h2><span class="state">${STATE[placed.state]}</span> Block ${escape(block.id)}: ${escape(block.purpose)} <span class="where">${where}</span></h2>`);
  if (placed.state === "current-masked") {
    out.push('<p class="say">Some of this code is masked in the note. The code below is the note\'s, never the editor\'s text.</p>');
  } else if (placed.state === "changed") {
    out.push(`<p class="say">This explanation was written for earlier code${placed.spacesOnly && placed.at
      ? `; the code at ${range(placed.at.from, placed.at.to)} differs only in spaces at line ends` : ""}.</p>`);
  } else if (placed.state === "ambiguous") {
    out.push(`<p class="say">This code is at more than one place (lines ${andList(placed.candidates ?? [])}) and the order of the blocks `
      + "does not decide which. It is not called current.</p>");
  }
  out.push(`<pre><code>${escape(block.code.join("\n"))}</code></pre>`);
  if (block.rows.length > 0) {
    out.push('<table class="rows"><thead><tr><th>Line</th><th>Code</th><th>What happens</th><th>Real value</th></tr></thead><tbody>');
    for (const row of block.rows) {
      const shift = exact && placed.at ? placed.at.from - block.from : 0;
      const from = row.from + shift, to = row.to + shift;
      const chosen = exact && selection !== undefined && from <= selection.to && to >= selection.from;
      const label = from === to ? `${from}` : `${from}-${to}`;
      // The Code cell is code, letter for letter (its backticks are off already): never read as Markdown.
      out.push(`<tr${chosen ? ' class="selected"' : ""}><td>${chosen ? "▸ " : ""}${label}</td><td><code>${escape(row.code)}</code></td>`
        + `<td>${cell(row.what, linkTo)}</td><td>${cell(row.value, linkTo)}</td></tr>`);
    }
    out.push("</tbody></table>");
  }
  if (block.prose !== "") { out.push(`<div class="prose">${render(block.prose, linkTo)}</div>`); }
  if (block.concepts.length > 0) {
    out.push('<p class="concepts">Concepts: ' + block.concepts.map((name) => {
      const target = linkTo(name);
      return target === undefined ? escape(name) : `<a data-note="${escape(target)}">${escape(name)}</a>`;
    }).join(", ") + "</p>");
  }
  out.push("</section>");
  return out.join("\n");
}

function fileBody(view: Extract<View, { kind: "file" }>): string {
  const { note, assignment } = view;
  const out: string[] = [`<h1>${escape(view.file)}</h1>`];
  const unreadable = note.problems.length > 0;
  if (unreadable) {
    out.push('<p class="fresh">This note cannot be read; nothing of it is guessed at.</p>');
  } else if (!assignment) {
    out.push(`<p class="fresh" role="status">matching… ${many(view.matching ?? 0, "block", "blocks")} done</p>`);
  } else {
    const s = summary(assignment);
    out.push(`<p class="fresh">${many(s.current, "block", "blocks")} current, ${s.changed} changed, ${s.ambiguous} ambiguous; `
      + `${many(s.unexplained, "line", "lines")} unexplained</p>`);
  }
  out.push(`<p class="badge"><span class="badge-label">${escape(view.badge.label)}</span>${view.badge.why ? ` <span class="why">${escape(view.badge.why)}</span>` : ""}</p>`);
  if (view.badge.details) { out.push(checkHtml(view.badge.details)); }
  out.push(`<p class="actions">${button("check")} <button data-obsidian="${view.noteId}">Open note in Obsidian</button>${updateButton(view)}</p>`);
  out.push(...createHtml(view.create), ...problemsHtml(view.problems));
  if (unreadable) {
    out.push("<ul class=\"problems\">" + note.problems.map((p) => `<li>${escape(p)}</li>`).join("\n") + "</ul>");
    return out.join("\n");
  }
  if (note.lens.length > 0) {
    out.push(`<details data-fold="lens"${view.whole ? " open" : ""}><summary>Purpose of the file</summary><table><tbody>`
      + note.lens.map(([label, answer]) => `<tr><th>${cell(label, view.linkTo)}</th><td>${cell(answer, view.linkTo)}</td></tr>`).join("\n")
      + "</tbody></table></details>");
  }
  if (!assignment) { return out.join("\n"); }
  if (assignment.trimmed) {
    // A bound says what it left out: every block whose code is at more places than were looked at, in a fold.
    const all = assignment.trimmed;
    const line = (t: { id: string; places: number; kept: number }): string =>
      `<li>block ${escape(t.id)}: ${t.places} identical places, the ${t.kept} nearest to its recorded line were looked at</li>`;
    out.push(`<details data-fold="trimmed"><summary>Very many identical places: ${all.length} ${all.length === 1 ? "block" : "blocks"} not looked at in full</summary>`
      + `<p class="say">A block of these that moved far from its recorded line may show as changed.</p><ul>${trimmedHtml(all, line)}</ul></details>`);
  }
  const last = Number.MAX_SAFE_INTEGER;
  const under = view.whole || !view.selection ? underSelection(assignment, 1, last) : underSelection(assignment, view.selection.from, view.selection.to);
  const blocks = view.whole || !view.selection ? assignment.placed : under.blocks;
  for (const placed of blocks) { out.push(blockHtml(placed, view.whole ? undefined : view.selection, view.linkTo)); }
  if (under.unexplained.length > 0) {
    out.push(`<p class="unexplained">No explanation for ${under.unexplained.map(([a, b]) => range(a, b)).join(", ")}.</p>`);
  }
  if (blocks.length === 0 && under.unexplained.length === 0) {
    out.push('<p class="say">Nothing to explain on the selected lines: they are blank.</p>');
  }
  if (under.unexplained.length > 0 || blocks.some((placed) => placed.state === "changed" || placed.state === "ambiguous")) {
    if (!view.create?.running) { out.push(`<p class="actions">${button("create")}</p>`); }
  }
  return out.join("\n");
}

/** The inside of the page's body. `notice` is a sentence shown above everything: a refusal is never silent. */
export function body(view: View, notice?: string): string {
  const out: string[] = [];
  if (notice) { out.push(`<p class="notice" role="status">${escape(notice)}</p>`); }
  switch (view.kind) {
    case "message":
      if (view.back) { out.push(`<p class="actions">${button("back")}</p>`); }
      out.push(`<p class="say">${escape(view.text)}</p>`, ...createHtml(view.create));
      if (view.button && !(view.button === "create" && view.create?.running)) { out.push(`<p class="actions">${button(view.button)}</p>`); }
      out.push(...problemsHtml(view.problems));
      break;
    case "duplicates":
      out.push(`<h1>${escape(view.file)}</h1>`, `<p class="say">Duplicate notes: ${view.notes.length} notes explain this file. `
        + "Pick one for this session; nothing is chosen for you.</p>", ...createHtml(view.create), listed(view.notes), ...problemsHtml(view.problems));
      break;
    case "places":
      // A list of places and a note are shown in place of the file: each has the way back.
      out.push(`<p class="actions">${button("back")}</p>`,
        `<p class="say">${many(view.places.length, "note is", "notes are")} named '${escape(view.name)}'. Pick one:</p>`, listed(view.places));
      break;
    case "note":
      out.push(`<h1>${escape(view.note.name)}</h1>`, `<p class="where">${escape(view.folder)}</p>`,
        `<p class="actions">${button("back")} <button data-obsidian="${view.id}">Open note in Obsidian</button></p>`,
        `<div class="prose">${render(view.note.body, view.linkTo)}</div>`);
      break;
    case "file":
      out.push(fileBody(view));
      break;
  }
  return out.join("\n");
}

// placesOf is part of what a view of a block means; markers.ts uses the same places.
export { placesOf };
