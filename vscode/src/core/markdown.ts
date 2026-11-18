// The small Markdown renderer for the subset the notes use. No import of "vscode".
// Every piece of text is HTML-escaped before any tag is added: the only tags in the result are the ones written
// here, and the only attributes are data-note, data-href, class and, on <ol>, start (a number). No raw HTML passes
// through.

import { cells, isSpace, linkTarget, pyLStrip, pyStrip } from "./notes";

/** The one HTML escaper: the panel's own texts (src/core/panelHtml.ts) go through it too. */
export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** What a [[link]] carries in its data-note attribute: by default the note's name. Undefined: no such note. */
// Plan: `render(text, linkTo)` does not say what `linkTo` is. Taken as the caller's answer to "which note does this
// name mean" (a name, or the index id of piece 4); a name with no answer is shown as text, not as a link.
export type LinkTo = (name: string) => string | undefined;

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
const WHITE = /\s/;
const SIGNS = /[\\`*[]/;       // without one of these a line holds nothing but text

/** The runs of backticks of the text: for each length, where the runs of that length begin, in order. A run is
 *  all the backticks that stand together. The text is read once. */
function backtickRuns(text: string): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  for (let at = text.indexOf("`"); at >= 0;) {
    let end = at + 1;
    while (text[end] === "`") { end++; }
    const starts = runs.get(end - at);
    if (starts) { starts.push(at); } else { runs.set(end - at, [at]); }
    at = text.indexOf("`", end);
  }
  return runs;
}

/** The first of the ordered positions that is not before `from`; -1 when there is none. A binary search. */
function firstFrom(positions: number[] | undefined, from: number): number {
  if (!positions) { return -1; }
  let low = 0, high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle] < from) { low = middle + 1; } else { high = middle; }
  }
  return low < positions.length ? positions[low] : -1;
}

// What a character of the line is, where it is not simply read as written.
const LITERAL = 1;     // plain text whatever it is: the character after a backslash, a backtick that opens no code
const DROPPED = 2;     // the backslash before such a character: not shown
const CODE = 3;        // the first backtick of a code span; the span is passed over whole

/** One line of text: code spans, [[links]], other links, bold, italic.
 *
 *  The line is read from left to right a fixed number of times, and no part of it is searched again.
 *  When it holds a "](", its parentheses are paired first, as an address reads them.
 *  The first reading settles what never depends on anything else: a backslash before a punctuation character makes
 *  that character plain text; a run of backticks opens a code span when a later run is exactly as long (looked up in
 *  the index of the runs), and nothing inside the span is looked at; a "](" that follows a "[" opens an address when
 *  its parenthesis closes, and nothing inside the address is looked at either. Whichever of the two begins first
 *  holds the other: a code span that begins before the "](" takes it, an address takes the backticks in it. The same
 *  reading lists, in order, where the signs outside code spans, addresses and escapes stand: the asterisks, the
 *  closing brackets, the characters that end a link's name.
 *  The second reading writes the HTML. An opener finds its closer by a binary search in those lists, never by
 *  reading on, and the text between the two is rendered as a part of the same line, with the same lists: an opener
 *  inside it accepts only a closer inside it. The parts lie inside one another a few deep at most (the text of a
 *  link holds no "]", emphasis holds no asterisk), so a line of n characters costs about n log n, whatever it holds. */
function inline(text: string, linkTo: LinkTo): string {
  if (!SIGNS.test(text)) { return escape(text); }
  const length = text.length;
  const kind = new Uint8Array(length);
  const codeEnd = new Int32Array(length);                  // for the first backtick of a code span: where the span ends
  const parenClose = new Int32Array(length).fill(-1);      // for each "(": the ")" that closes it; -1 when none does
  const stars: number[] = [], twoStars: number[] = [];     // each asterisk; each that has another one right after it
  const closers: number[] = [], twoClosers: number[] = []; // each "]"; each that has another one right after it
  const stops: number[] = [], bars: number[] = [];         // each "]", "|" or "#", where a link's name ends; each "|"
  let runs: Map<number, number[]> | undefined;             // the runs of backticks of the line, listed once, when one is met

  // The parentheses are paired first, as an address reads them: every character is itself, but a backslash before
  // a punctuation character makes that character plain, and white space ends every address still open. A backslash
  // stands at the same places here as in the reading below: a code span ends on a backtick, never on a backslash.
  if (text.includes("](")) {
    const open: number[] = [];                             // the "(" that may still close
    for (let i = 0; i < length; i++) {
      const c = text[i];
      if (c === "\\") {
        if (i + 1 < length && PUNCTUATION.test(text[i + 1])) { i++; }
      } else if (c === "(") {
        open.push(i);
      } else if (c === ")") {
        const from = open.pop();
        if (from !== undefined) { parenClose[from] = i; }
      } else if (WHITE.test(c)) {
        open.length = 0;
      }
    }
  }
  let bracket = false;                                     // a "[" stands before here with no "]" after it

  for (let i = 0; i < length;) {
    const c = text[i];
    if (c === "\\" && i + 1 < length && PUNCTUATION.test(text[i + 1])) {      // \| and \* are the sign itself
      kind[i] = DROPPED;
      kind[i + 1] = LITERAL;
      // The checker reads a link's name in the text as written: it ends at "]", "|" and "#" also after a backslash.
      const escaped = text[i + 1];
      if (escaped === "]" || escaped === "|" || escaped === "#") { stops.push(i + 1); }
      if (escaped === "|") { bars.push(i + 1); }
      i += 2;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") { run++; }
      if (!runs) { runs = backtickRuns(text); }
      const close = firstFrom(runs.get(run), i + run);     // the next run of exactly as many backticks
      if (close >= 0) {
        kind[i] = CODE;
        codeEnd[i] = close + run;
        i = close + run;
      } else {
        kind.fill(LITERAL, i, i + run);
        i += run;
      }
      continue;
    }
    if (c === "*") {
      if (stars.length > 0 && stars[stars.length - 1] === i - 1) { twoStars.push(i - 1); }
      stars.push(i);
    } else if (c === "]") {
      if (closers.length > 0 && closers[closers.length - 1] === i - 1) { twoClosers.push(i - 1); }
      closers.push(i);
      stops.push(i);
      // "](" after a link's text: the address, up to the ")" that closes it, is plain text. It is passed over here,
      // so no backtick, asterisk or bracket in it is a sign.
      const end = bracket && text[i + 1] === "(" ? parenClose[i + 1] : -1;
      bracket = false;
      if (end > i + 2) {
        for (let j = i + 2; j < end; j++) {
          if (text[j] === "\\" && PUNCTUATION.test(text[j + 1])) { kind[j++] = DROPPED; }
          kind[j] = LITERAL;
        }
        i = end + 1;
        continue;
      }
    } else if (c === "[") {
      bracket = true;
    } else if (c === "|" || c === "#") {
      stops.push(i);
      if (c === "|") { bars.push(i); }
    }
    i++;
  }

  // A "[[" whose name was read and found empty: every later "[[" whose name ends at the same place has an empty
  // name too (its name is the end of this one), so it is not read again.
  let noName = -1;

  /** The note named between `from` and `to`, as `linkNames` reads it: a code span counts as one space. */
  const nameIn = (from: number, to: number): string => {
    let written = "", kept = from;
    for (let i = from; i < to;) {
      if (kind[i] === CODE) {
        written += text.slice(kept, i) + " ";
        i = kept = codeEnd[i];
      } else {
        i++;
      }
    }
    return linkTarget(written + text.slice(kept, to));
  };

  /** The HTML of the line from `from` up to `to`. An opener in it takes only a closer in it. */
  const part = (from: number, to: number): string => {
    let out = "", plain = "";
    const flush = () => { out += escape(plain); plain = ""; };
    let i = from;
    while (i < to) {
      const c = text[i], what = kind[i];
      if (what === DROPPED) { i++; continue; }
      if (what === LITERAL) { plain += c; i++; continue; }
      if (what === CODE) {
        let run = 1;
        while (text[i + run] === "`") { run++; }
        let code = text.slice(i + run, codeEnd[i] - run);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) { code = code.slice(1, -1); }
        flush();
        out += `<code>${escape(code)}</code>`;
        i = codeEnd[i];
        continue;
      }
      if (c === "[" && i + 1 < to && text[i + 1] === "[") {
        const close = firstFrom(twoClosers, i + 2);
        if (close >= 0 && close + 2 <= to) {
          const stop = firstFrom(stops, i + 2);            // not after `close`, which is a "]"
          const name = stop === noName ? "" : nameIn(i + 2, stop);
          if (name === "") {
            noName = stop;
          } else {
            const bar = firstFrom(bars, i + 2);
            let first = bar >= 0 && bar < close ? bar + 1 : i + 2, last = close;
            while (first < last && isSpace(text.charCodeAt(first))) { first++; }
            while (last > first && isSpace(text.charCodeAt(last - 1))) { last--; }
            const shown = first < last ? part(first, last) : inline(name, linkTo);
            const target = linkTo(name);
            flush();
            out += target === undefined ? `<span class="no-note">${shown}</span>` : `<a data-note="${escape(target)}">${shown}</a>`;
            i = close + 2;
            continue;
          }
        }
      }
      if (c === "[") {
        // Any other link: [text](address). The address runs to the ")" that closes its "(", so it may hold
        // parentheses that pair off, and ones written \( and \); it holds no white space and is not empty.
        const close = firstFrom(closers, i + 1);
        if (close >= 0 && close + 1 < to && text[close + 1] === "(") {
          const end = parenClose[close + 1];
          if (end > close + 2 && end < to) {
            // Its text, then its address in full. Nothing opens by itself; a click sends the address.
            flush();
            const address = escape(text.slice(close + 2, end).replace(ESCAPED, "$1"));
            out += `${close > i + 1 ? part(i + 1, close) + " " : ""}<a data-href="${address}">${address}</a>`;
            i = end + 1;
            continue;
          }
        }
      }
      if (c === "*") {
        const mark = i + 1 < to && text[i + 1] === "*" ? 2 : 1;
        const close = firstFrom(mark === 2 ? twoStars : stars, i + mark);
        // The marks sit against the words: what they hold is not empty and neither begins nor ends with a space.
        if (close > i + mark && close + mark <= to && !isSpace(text.charCodeAt(i + mark)) && !isSpace(text.charCodeAt(close - 1))) {
          const tag = mark === 2 ? "strong" : "em";
          flush();
          out += `<${tag}>${part(i + mark, close)}</${tag}>`;
          i = close + mark;
          continue;
        }
        plain += text.slice(i, i + mark);
        i += mark;
        continue;
      }
      plain += c;
      i++;
    }
    flush();
    return out;
  };

  return part(0, length);
}

const FENCE = /^(`{3,})(.*)$/s;
const HEADING = /^(#{1,6})[ \t]+(.*)$/s;

/** True when the text is white space, then backticks, and nothing else: what may follow a closing fence. Read once,
 *  from its end. */
function onlySpaceThenBackticks(text: string): boolean {
  let end = text.length;
  while (end > 0 && text[end - 1] === "`") { end--; }
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) { end--; }
  return end === 0;
}

function isRow(line: string): boolean {
  return pyLStrip(line).startsWith("|");
}

function isSeparator(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell));
}

function table(rows: string[], linkTo: LinkTo): string {
  const parsed = rows.map((row) => cells(row).map((cell) => cell.replace(/\\\|/g, "|")));
  const cellsOf = (row: string[], tag: string) => row.map((cell) => `<${tag}>${inline(cell, linkTo)}</${tag}>`).join("");
  const out = ["<table>"];
  let body = parsed;
  if (parsed.length >= 2 && isSeparator(parsed[1]) && !isSeparator(parsed[0])) {
    out.push(`<thead><tr>${cellsOf(parsed[0], "th")}</tr></thead>`);
    body = parsed.slice(2);
  }
  out.push("<tbody>");
  for (const row of body) { out.push(`<tr>${cellsOf(row, "td")}</tr>`); }
  out.push("</tbody>", "</table>");
  return out.join("\n");
}

interface Item { indent: number; ordered: boolean; number: number; text: string; }

/** The line as a list item: "- ", "* " or a number and ". " at its start, after any indentation, then its text.
 *  Undefined for every other line, also for a marker with nothing after it. Read by hand, character by character. */
function listItem(line: string): Item | undefined {
  let i = 0, indent = 0;
  for (; i < line.length; i++) {
    if (line[i] === " ") { indent++; } else if (line[i] === "\t") { indent += 4; } else { break; }
  }
  let ordered = false, number = 1;
  if (line[i] === "-" || line[i] === "*") {
    i++;
  } else {
    const from = i;
    while (i - from < 9 && line[i] >= "0" && line[i] <= "9") { i++; }      // nine digits at most: a number, never a long text
    if (i === from || line[i] !== ".") { return undefined; }
    ordered = true;
    number = Number(line.slice(from, i));
    i++;
  }
  if (line[i] !== " " && line[i] !== "\t") { return undefined; }
  const text = pyStrip(line.slice(i));
  return text === "" ? undefined : { indent, ordered, number, text };
}

/** A run of list items as <ul> or <ol>. An item indented by two or more spaces beyond the first item belongs to
 *  the item above it, in a list of its own: one level of nesting, however deep the indentation. An item of the
 *  other kind (a number after "- ", or the reverse) begins a new list. An ordered list that does not begin at 1
 *  says where it begins (start="..."), the one attribute a list gets: digits only. */
function list(items: Item[], linkTo: LinkTo): string {
  const out: string[] = [];
  const base = items[0].indent;
  const opening = (item: Item) => (!item.ordered ? "<ul>" : item.number === 1 ? "<ol>" : `<ol start="${item.number}">`);
  const closing = (ordered: boolean) => (ordered ? "</ol>" : "</ul>");
  let outer: boolean | undefined, inner: boolean | undefined;     // the kind of the list that is open at each level
  let itemOpen = false;                                            // an outer <li> waits for its </li>
  const closeItem = () => {
    if (inner !== undefined) { out.push(closing(inner), "</li>"); inner = undefined; }
    else if (itemOpen) { out[out.length - 1] += "</li>"; }
    itemOpen = false;
  };
  for (const item of items) {
    if (itemOpen && item.indent >= base + 2) {
      if (inner !== undefined && inner !== item.ordered) { out.push(closing(inner)); inner = undefined; }
      if (inner === undefined) { out.push(opening(item)); inner = item.ordered; }
      out.push(`<li>${inline(item.text, linkTo)}</li>`);
      continue;
    }
    closeItem();
    if (outer !== undefined && outer !== item.ordered) { out.push(closing(outer)); outer = undefined; }
    if (outer === undefined) { out.push(opening(item)); outer = item.ordered; }
    out.push(`<li>${inline(item.text, linkTo)}`);
    itemOpen = true;
  }
  closeItem();
  if (outer !== undefined) { out.push(closing(outer)); }
  return out.join("\n");
}

/**
 * HTML for the subset of Markdown the notes use: headings, paragraphs, lists (one level of nesting), tables,
 * fenced code (Mermaid shown as code), bold, italic, inline code, [[links]] as <a data-note="...">, and any other
 * link as its text followed by its address in full, as <a data-href="...">.
 */
export function render(text: string, linkTo: LinkTo = (name) => name): string {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      // The same rule as `fence_mask`: the fence closes on a fence at least as long that holds nothing else.
      const code: string[] = [];
      for (i++; i < lines.length; i++) {
        const m = FENCE.exec(lines[i]);
        if (m && m[1].length >= fence[1].length && onlySpaceThenBackticks(m[2])) { i++; break; }
        code.push(lines[i]);
      }
      const language = pyStrip(fence[2]);
      const named = /^[A-Za-z0-9_+#.-]+$/.test(language) ? ` class="language-${language}"` : "";
      out.push(`<pre><code${named}>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (pyStrip(line) === "") { i++; continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(pyStrip(heading[2]), linkTo)}</h${level}>`);
      i++;
      continue;
    }
    if (isRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(lines[i++]); }
      out.push(table(rows, linkTo));
      continue;
    }
    if (listItem(line)) {
      const items: Item[] = [];
      for (let item = listItem(lines[i]); item; item = i < lines.length ? listItem(lines[i]) : undefined) { items.push(item); i++; }
      out.push(list(items, linkTo));
      continue;
    }
    // A paragraph: its lines stay on lines of their own. A list item ends it, as a table row does.
    const paragraph: string[] = [];
    while (i < lines.length && pyStrip(lines[i]) !== "" && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !isRow(lines[i])
      && !listItem(lines[i])) {
      paragraph.push(inline(pyStrip(lines[i++]), linkTo));
    }
    out.push(`<p>${paragraph.join("<br>\n")}</p>`);
  }
  return out.join("\n");
}
