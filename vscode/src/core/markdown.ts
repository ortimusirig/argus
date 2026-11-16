// The small Markdown renderer for the subset the notes use. No import of "vscode".
// Every piece of text is HTML-escaped before any tag is added: the only tags in the result are the ones written
// here, and the only attributes are data-note, data-href and class. No raw HTML passes through.

import { cells, linkNames, pyLStrip, pyStrip } from "./notes";

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** What a [[link]] carries in its data-note attribute: by default the note's name. Undefined: no such note. */
// Plan: `render(text, linkTo)` does not say what `linkTo` is. Taken as the caller's answer to "which note does this
// name mean" (a name, or the index id of piece 4); a name with no answer is shown as text, not as a link.
export type LinkTo = (name: string) => string | undefined;

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
const WHITE = /\s/;

/** For each "(" of the text, where the ")" that closes it stands; -1 when it never closes or white space comes
 *  first. Parentheses pair off as they nest; one written \( or \) is no parenthesis. The text is read once. */
function parenCloses(text: string): Int32Array {
  const closes = new Int32Array(text.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) { i++; continue; }
    if (c === "(") {
      open.push(i);
    } else if (c === ")") {
      const from = open.pop();
      if (from !== undefined) { closes[from] = i; }
    } else if (WHITE.test(c)) {
      open.length = 0;                              // an address holds no white space: nothing open closes beyond it
    }
  }
  return closes;
}

/** One line of text: code spans, [[links]], other links, bold, italic. */
function inline(text: string, linkTo: LinkTo): string {
  let out = "", plain = "";
  // An opener whose closer was looked for once and not found is not looked for again: the line is read once.
  const noCloser = new Set<string>();
  const closer = (mark: string, from: number): number => {
    if (noCloser.has(mark)) { return -1; }
    const at = text.indexOf(mark, from);
    if (at < 0) { noCloser.add(mark); }
    return at;
  };
  const flush = () => { out += escape(plain); plain = ""; };
  // The next "]" is looked for from where the last one was found, and the parentheses of the line are paired once:
  // a line of openers that are no links is read once, not once for each opener.
  let bracket = -2;                           // the "]" found last; -1 when none is left
  const nextBracket = (from: number): number => {
    if (bracket !== -1 && bracket < from) { bracket = text.indexOf("]", from); }
    return bracket;
  };
  let closes: Int32Array | undefined;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {      // \| and \* are the sign itself
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") { run++; }
      const mark = "`".repeat(run);
      let close = -1;
      for (let at = i + run; !noCloser.has(mark);) {     // the next run of exactly as many backticks
        at = text.indexOf("`", at);
        if (at < 0) { noCloser.add(mark); break; }
        let length = 1;
        while (text[at + length] === "`") { length++; }
        if (length === run) { close = at; break; }
        at += length;
      }
      if (close >= 0) {
        let code = text.slice(i + run, close);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) { code = code.slice(1, -1); }
        flush();
        out += `<code>${escape(code)}</code>`;
        i = close + run;
      } else {
        plain += mark;
        i += run;
      }
      continue;
    }
    if (c === "[" && text[i + 1] === "[") {
      const close = closer("]]", i + 2);
      const inner = close < 0 ? "" : text.slice(i + 2, close);
      const name = inner ? linkNames([`[[${inner}]]`])[0] : undefined;
      if (name !== undefined) {
        const bar = inner.indexOf("|");
        const shown = pyStrip(bar < 0 ? inner : inner.slice(bar + 1)) || name;
        const target = linkTo(name);
        flush();
        out += target === undefined ? `<span class="no-note">${inline(shown, linkTo)}</span>`
          : `<a data-note="${escape(target)}">${inline(shown, linkTo)}</a>`;
        i = close + 2;
        continue;
      }
    }
    if (c === "[") {
      // Any other link: [text](address). The address runs to the ")" that closes its "(", so it may hold
      // parentheses that pair off, and ones written \( and \); it holds no white space and is not empty.
      const close = nextBracket(i + 1);
      if (close >= 0 && text[close + 1] === "(") {
        if (!closes) { closes = parenCloses(text); }
        const end = closes[close + 1];
        if (end > close + 2) {
          // Its text, then its address in full. Nothing opens by itself; a click sends the address.
          flush();
          const shown = text.slice(i + 1, close);
          const address = escape(text.slice(close + 2, end).replace(ESCAPED, "$1"));
          out += `${shown ? inline(shown, linkTo) + " " : ""}<a data-href="${address}">${address}</a>`;
          i = end + 1;
          continue;
        }
      }
    }
    if (c === "*") {
      const mark = text[i + 1] === "*" ? "**" : "*";
      const close = closer(mark, i + mark.length);
      const inner = close < 0 ? "" : text.slice(i + mark.length, close);
      if (inner && pyStrip(inner[0]) && pyStrip(inner[inner.length - 1])) {     // the marks sit against the words
        const tag = mark === "**" ? "strong" : "em";
        flush();
        out += `<${tag}>${inline(inner, linkTo)}</${tag}>`;
        i = close + mark.length;
        continue;
      }
      plain += mark;
      i += mark.length;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^(`{3,})(.*)$/s;
const HEADING = /^(#{1,6})[ \t]+(.*)$/s;

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

/**
 * HTML for the subset of Markdown the notes use: headings, paragraphs, tables, fenced code (Mermaid shown as
 * code), bold, italic, inline code, [[links]] as <a data-note="...">, and any other link as its text followed by
 * its address in full, as <a data-href="...">.
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
        if (m && m[1].length >= fence[1].length && pyStrip(m[2].replace(/`+$/, "")) === "") { i++; break; }
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
    // A paragraph: its lines stay on lines of their own, so a list written with "- " still reads as a list.
    const paragraph: string[] = [];
    while (i < lines.length && pyStrip(lines[i]) !== "" && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !isRow(lines[i])) {
      paragraph.push(inline(pyStrip(lines[i++]), linkTo));
    }
    out.push(`<p>${paragraph.join("<br>\n")}</p>`);
  }
  return out.join("\n");
}
