// Reads an Argus note: properties, fence-aware sections, blocks, tables. No import of "vscode".
// The authority on the note format is skills/argus/scripts/check_notes.py; the functions here follow it.

export interface NoteProps { writtenBy: string; type: string; project?: string; source?: string;
  commit?: string; depth?: "map" | "full";
  maskedRanges: [number, number][]; }   // as written: "3, 7-9" is [[3,3],[7,9]]; never expanded into single numbers
export interface LineRow { from: number; to: number; code: string; what: string; value: string; }
export interface Block { id: string; purpose: string; from: number; to: number;   // recorded lines, 1-based
  code: string[];            // the lines of the first fence
  rows: LineRow[];           // depth full
  prose: string;             // every other piece of the block's text after its code, as Markdown, in order
  concepts: string[]; }      // [[links]] of the block
export interface FileNote { name: string; path: string; props: NoteProps; lens: [string, string][];
  blocks: Block[]; problems: string[]; }            // problems: why a part could not be read
export interface OtherNote { name: string; path: string; props: NoteProps; body: string; }

export const MASK = "[masked]";

// ---------------------------------------------------------------- Python's string rules

// The characters Python's str.strip() removes and its regular expressions call \s. JavaScript's trim() and \s
// differ (they take U+FEFF and leave U+001C to U+001F and U+0085), so neither is used for a rule of the checker.
const WS = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** True for the code of a character Python's str.strip() removes. */
export function isSpace(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x20) || c === 0x85 || c === 0xa0 || c === 0x1680
    || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

/** Python's str.rstrip(): the same characters, from the end only. */
export function pyRStrip(s: string): string {
  let end = s.length;
  while (end > 0 && isSpace(s.charCodeAt(end - 1))) { end--; }
  return end === s.length ? s : s.slice(0, end);
}

/** Python's str.lstrip(). */
export function pyLStrip(s: string): string {
  let start = 0;
  while (start < s.length && isSpace(s.charCodeAt(start))) { start++; }
  return start === 0 ? s : s.slice(start);
}

/** Python's str.strip(): removes from both ends exactly the characters Python removes. */
export function pyStrip(s: string): string {
  return pyLStrip(pyRStrip(s));
}

/** Python's s.strip(chars). */
function stripChars(s: string, chars: string): string {
  let start = 0, end = s.length;
  while (start < end && chars.includes(s[start])) { start++; }
  while (end > start && chars.includes(s[end - 1])) { end--; }
  return s.slice(start, end);
}

const DECIMAL = /^\p{Nd}$/u;

/** Python's int() on a run of decimal digits. Python's \d takes the digits of every script, so this does too. */
function pyInt(digits: string): number {
  if (/^[0-9]+$/.test(digits)) { return Number(digits); }
  let value = 0;
  for (const ch of digits) {
    // Unicode keeps each script's digits 0 to 9 together and in order, and groups of ten may stand side by side
    // (the mathematical digits are five groups in one run). A run of decimal digits therefore starts at a zero and
    // holds whole groups: the digit's value is its distance from the start of its run, counted in tens.
    const c = ch.codePointAt(0) ?? 0;
    let start = c;
    while (start > 0 && DECIMAL.test(String.fromCodePoint(start - 1))) { start--; }
    value = value * 10 + ((c - start) % 10);
  }
  return value;
}

/** The text as the checker reads it: every line ending a "\n". The file's byte-order mark is dropped where the
 *  bytes are read (readText.ts, as read_text does); a mark still here is a character of the text, as it is to
 *  the checker. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ---------------------------------------------------------------- properties

const RANGE_ITEM = new RegExp(`^[${WS}]*(\\p{Nd}+)(?:[${WS}]*-[${WS}]*(\\p{Nd}+))?[${WS}]*$`, "u");
const PY_LINE_BREAK = new RegExp("\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]");   // where Python's splitlines() cuts

/** `frontmatter` of the checker: the properties as written, or nothing when the note has none. */
function frontmatter(text: string): { props: Map<string, string>; end: number } {
  const props = new Map<string, string>();
  if (!text.startsWith("---")) { return { props, end: -1 }; }
  const end = text.indexOf("\n---", 3);
  if (end < 0) { return { props, end: -1 }; }
  for (const line of text.slice(3, end).split(PY_LINE_BREAK)) {
    const colon = line.indexOf(":");
    if (colon >= 0) { props.set(pyStrip(line.slice(0, colon)), stripChars(pyStrip(line.slice(colon + 1)), "\"'")); }
  }
  return { props, end };
}

/** "3, 7-9" as the ranges [[3,3],[7,9]]: one pair for each item written, never a set of line numbers. */
function maskedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const piece of text.split(",")) {
    const m = RANGE_ITEM.exec(piece);   // anything that is not a number or a range is ignored, as in `line_set`
    if (m) {
      const from = pyInt(m[1]);
      ranges.push([from, m[2] === undefined ? from : pyInt(m[2])]);
    }
  }
  return ranges;
}

function propsOf(raw: Map<string, string>): NoteProps {
  const props: NoteProps = { writtenBy: raw.get("written_by") ?? "", type: raw.get("type") ?? "", maskedRanges: [] };
  const project = raw.get("project"), source = raw.get("source"), commit = raw.get("commit"), depth = raw.get("depth");
  if (project) { props.project = project; }
  if (source) { props.source = source; }
  if (commit) { props.commit = commit; }
  if (depth === "map" || depth === "full") { props.depth = depth; }
  props.maskedRanges = maskedRanges(raw.get("masked_lines") ?? "");
  return props;
}

/** The properties at the top of a note. Line endings CRLF, LF and CR are all accepted. */
export function parseProps(text: string): NoteProps {
  return propsOf(frontmatter(normalize(text)).props);
}

/** True when a range of `masked_lines` holds the line. */
export function isMasked(props: NoteProps, line: number): boolean {
  for (const [from, to] of props.maskedRanges) {
    if (line >= from && line <= to && line >= 1) { return true; }
  }
  return false;
}

/** The checker's ownership rule: only a note with `written_by: argus` is one of the skill's notes. */
// Plan: the test "a note without written_by: argus: not indexed" names no function; this is the rule the index applies.
export function isArgus(props: NoteProps): boolean {
  return props.writtenBy.toLowerCase() === "argus";
}

// ---------------------------------------------------------------- fences, sections, tables

const FENCE = /^(`{3,})/;

function fences(lines: string[]): { mask: boolean[]; open: boolean } {
  const mask: boolean[] = [];
  let fence: number | undefined;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (fence === undefined && m) {
      fence = m[1].length;
      mask.push(true);
    } else if (fence !== undefined) {
      mask.push(true);
      if (m && m[1].length >= fence && pyStrip(stripChars(line, "`")) === "") { fence = undefined; }
    } else {
      mask.push(false);
    }
  }
  return { mask, open: fence !== undefined };
}

/** For each line: true when it is a fence line or inside a fence. A fence closes only on one at least as long.
 *  The same rule as `fence_mask` in check_notes.py. */
export function fenceMask(lines: string[]): boolean[] {
  return fences(lines).mask;
}

/** `section` of the checker: the lines outside fences under a "## <heading...>" line, up to the next "## " line. */
function section(lines: string[], mask: boolean[], heading: string): string[] | undefined {
  let start = -1;
  for (let i = 0; i < lines.length && start < 0; i++) {
    if (!mask[i] && lines[i].startsWith("## " + heading)) { start = i; }
  }
  if (start < 0) { return undefined; }
  const found: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (mask[i]) { continue; }
    if (lines[i].startsWith("## ")) { break; }
    found.push(lines[i]);
  }
  return found;
}

function isRow(line: string): boolean {
  return pyLStrip(line).startsWith("|");
}

/** `cells` of the checker: the cells of one table row, stripped. A | written as \| stays inside its cell. */
export function cells(row: string): string[] {
  return pyStrip(row).split(/(?<!\\)\|/).slice(1, -1).map(pyStrip);
}

function isSeparator(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-+:?$/.test(cell));
}

function unescapePipes(cell: string): string {
  return cell.replace(/\\\|/g, "|");
}

/** `without_inline_code` of the checker: the line with every `code span` replaced by one space.
 *
 *  The checker's rule is the regular expression (`+)(?:(?!\1).)*?\1, and this is what it means, read by hand in one
 *  pass (the expression itself backtracks: 64,000 backticks took it 1.6 seconds here).
 *  Where backticks stand, the opener is as many of them as can find a closer, the most first. An opener of k
 *  backticks closes at the next place where k backticks stand together: in its own run when twice k fit into what is
 *  left of it (the span is then empty), else at the start of the first later run that is at least k long; no span
 *  runs over a line break. So with `rest` backticks left in the run and `most` the longest later run of the line:
 *  when most >= rest, the opener is all the rest; when not, it is max(most, half the rest, rounded down) backticks;
 *  with one backtick and no later run there is no span, and the backtick stays as text. Reading goes on right after
 *  the closer, in the middle of a run when the closer was the start of a longer one. */
export function withoutInlineCode(line: string): string {
  if (!line.includes("`")) { return line; }
  return line.includes("\n") ? line.split("\n").map(withoutCodeInLine).join("\n") : withoutCodeInLine(line);
}

function withoutCodeInLine(line: string): string {
  const starts: number[] = [], lengths: number[] = [];      // the runs of backticks of the line
  for (let at = line.indexOf("`"); at >= 0;) {
    let end = at + 1;
    while (line[end] === "`") { end++; }
    starts.push(at);
    lengths.push(end - at);
    at = line.indexOf("`", end);
  }
  const count = starts.length;
  if (count === 0) { return line; }
  const later = new Int32Array(count);                      // for each run: the longest of the runs after it
  for (let r = count - 2; r >= 0; r--) { later[r] = Math.max(later[r + 1], lengths[r + 1]); }
  const out: string[] = [];
  let kept = 0;                                             // the text up to here is written
  let r = 0, at = starts[0], rest = lengths[0];             // where reading stands: in run r, with `rest` backticks left
  while (r < count) {
    const most = later[r];
    const opener = most >= rest ? rest : Math.max(most, rest >> 1);
    let end = -1;                                           // where the span ends
    if (opener > 0 && opener < rest && 2 * opener <= rest) {
      end = at + 2 * opener;                                // closed by the backticks right after the opener
      rest -= 2 * opener;
    } else if (opener > 0) {
      // The first later run at least as long as the opener: there is one, as `most` says. The runs passed over
      // lie inside the span and are not read again.
      let closer = r + 1;
      while (lengths[closer] < opener) { closer++; }
      end = starts[closer] + opener;
      r = closer;
      rest = lengths[closer] - opener;
    }
    if (end >= 0) {
      out.push(line.slice(kept, at), " ");
      kept = at = end;
    }
    if (end < 0 || rest === 0) {
      r++;
      if (r < count) { at = starts[r]; rest = lengths[r]; }
    }
  }
  out.push(line.slice(kept));
  return out.join("");
}

const LINK = /\[\[([^\]|#]+)/g;

/** The note that the text after "[[" names, up to its first "]", "|" or "#": as the checker reads it, no backslash
 *  at its end (the one of \| in a table), no folder and no ".md". Empty when it names none. Read by hand. */
export function linkTarget(written: string): string {
  let end = written.length;
  while (end > 0 && written[end - 1] === "\\") { end--; }
  let target = pyStrip(written.slice(0, end));
  target = target.slice(target.lastIndexOf("/") + 1);
  return target.toLowerCase().endsWith(".md") ? target.slice(0, -3) : target;
}

/** The names the [[links]] of these lines point at, in order, each once. Code spans hold no links.
 *  Names are read as the checker reads them: no folder, no ".md", no "|shown" and no "#heading" part. */
export function linkNames(lines: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();                           // the names already listed
  for (const line of lines) {
    for (const m of withoutInlineCode(line).matchAll(LINK)) {
      const target = linkTarget(m[1]);
      if (target && !seen.has(target)) { seen.add(target); names.push(target); }
    }
  }
  return names;
}

// ---------------------------------------------------------------- a File note

const WORD = "[\\p{L}\\p{N}_]";   // Python's \w
// The same pattern as BLOCK in check_notes.py, with the purpose captured. (?!WORD) stands for Python's \b after \w+.
const BLOCK = new RegExp(`^### Block (${WORD}+)(?!${WORD})(.*)\\(lines? (\\p{Nd}+)(?:[${WS}]*-[${WS}]*(\\p{Nd}+))?\\)[${WS}]*$`, "su");
const LINE_CELL = new RegExp(`^(\\p{Nd}+)(?:[${WS}]*-[${WS}]*(\\p{Nd}+))?$`, "u");
const LEVEL2_ID = new RegExp(`^\\p{Nd}${WORD}*$`, "u");

/** The code a Code cell quotes, without its backticks; the cell as written when it is not one code span. */
function codeOfCell(cell: string): string {
  const m = /^``\s?(.*?)\s?``$/s.exec(cell) ?? /^`([^`]*)`$/.exec(cell);
  return unescapePipes(m ? m[1] : cell);
}

/** Reads the tables and text that follow a block's code. Line rows (depth full) go to `rows`; all else is kept. */
function afterCode(lines: string[], mask: boolean[], from: number, to: number, full: boolean, id: string,
  rows: LineRow[], problems: string[]): string {
  const kept: string[] = [];
  let i = from;
  while (i < to) {
    if (mask[i] || !isRow(lines[i])) { kept.push(lines[i++]); continue; }
    let end = i;
    while (end < to && !mask[end] && isRow(lines[end])) { end++; }
    const table = lines.slice(i, end), parsed = table.map(cells);
    // One run of rows may hold several tables: each starts at the row above a separator row.
    const starts = [0];
    for (let r = 2; r < table.length; r++) {
      if (isSeparator(parsed[r]) && !isSeparator(parsed[r - 1])) { starts.push(r - 1); }
    }
    starts.forEach((start, n) => {
      const stop = n + 1 < starts.length ? starts[n + 1] : table.length;
      const head = start + 1 < stop && isSeparator(parsed[start + 1]) ? 2 : 0;
      const others: string[] = [];
      let numbered = 0;
      for (let r = start + head; r < stop; r++) {
        const c = parsed[r];
        const m = full && c.length > 0 ? LINE_CELL.exec(c[0]) : null;
        if (!m) { others.push(table[r]); continue; }
        numbered++;
        const first = pyInt(m[1]), last = m[2] === undefined ? first : pyInt(m[2]);
        const label = first === last ? `${first}` : `${first}-${last}`;
        if (first > last) { problems.push(`block ${id}: row ${label} runs backwards`); }
        if (c.length !== 4) { problems.push(`block ${id}: row ${label} has ${c.length} cells; a line row has four cells: Line, Code, What happens, Real value`); }
        rows.push({ from: first, to: last, code: codeOfCell(c[1] ?? ""), what: unescapePipes(c[2] ?? ""),
          value: unescapePipes(c.slice(3).join(" | ")) });
      }
      // The header of a table whose rows are all line rows is the line table's own header: the panel draws it.
      // One row at a time: a spread hands every row over as an argument, and a call takes only so many.
      if (others.length > 0 || numbered === 0) {
        for (let r = start; r < start + head; r++) { kept.push(table[r]); }
        for (const other of others) { kept.push(other); }
      }
    });
    i = end;
  }
  // One cut at each end: shift() on a long array moves every remaining line each time.
  let first = 0, last = kept.length;
  while (first < last && pyStrip(kept[first]) === "") { first++; }
  while (last > first && pyStrip(kept[last - 1]) === "") { last--; }
  return kept.slice(first, last).join("\n");
}

/** Reads a File note. What cannot be read is named in `problems`; nothing is guessed. */
export function parseFileNote(name: string, path: string, text: string): FileNote {
  const body = normalize(text);
  const props = propsOf(frontmatter(body).props);
  const lines = body.split("\n");
  const { mask, open } = fences(lines);
  const problems: string[] = [];
  if (open) { problems.push("a code fence is never closed: everything after it reads as code"); }

  // Level 1: the lens rows, below the table's separator row.
  const lens: [string, string][] = [];
  const level1 = (section(lines, mask, "Level 1") ?? []).filter(isRow).map(cells);
  const separator = level1.findIndex(isSeparator);
  for (const row of level1.slice(separator + 1)) {
    if (row.length >= 2 && !isSeparator(row)) { lens.push([unescapePipes(row[0]), unescapePipes(row[1])]); }
  }

  // Level 2: one row per block; its last cell names the block's concepts.
  const level2 = new Map<string, string[]>();
  for (const row of section(lines, mask, "Level 2") ?? []) {
    const c = isRow(row) ? cells(row) : [];
    if (c.length > 0 && LEVEL2_ID.test(c[0])) { level2.set(c[0], c); }
  }

  const starts: number[] = [];
  lines.forEach((line, i) => { if (!mask[i] && BLOCK.test(line)) { starts.push(i); } });
  const blocks: Block[] = [];
  const seen = new Set<string>(), twice = new Set<string>();
  starts.forEach((start, n) => {
    const m = BLOCK.exec(lines[start]);
    if (!m) { return; }
    const id = m[1], from = pyInt(m[3]), to = m[4] === undefined ? from : pyInt(m[4]);
    if (seen.has(id) && !twice.has(id)) { twice.add(id); problems.push(`two '### Block ${id}' sections`); }
    seen.add(id);
    if (from < 1 || from > to) { problems.push(`block ${id}: range ${from}-${to} is not a range of lines`); }
    let end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    for (let i = start + 1; i < end; i++) {
      if (!mask[i] && lines[i].startsWith("## ")) { end = i; break; }
    }
    // The first code fence of the block is its code.
    let first = -1;
    for (let i = start + 1; i < end && first < 0; i++) { if (mask[i]) { first = i; } }
    let code: string[] = [], after = start + 1;
    if (first < 0) {
      problems.push(`block ${id} has no code fence`);
    } else {
      let last = end;
      for (let i = first; i < end; i++) { if (!mask[i]) { last = i; break; } }
      code = lines.slice(first + 1, last - 1);
      after = last;
    }
    const rows: LineRow[] = [];
    // Line rows are read at depth full only, as the checker does; at any other depth such a table stays in `prose`.
    const prose = afterCode(lines, mask, after, end, props.depth === "full", id, rows, problems);
    const own = lines.slice(start, end).filter((_, i) => !mask[start + i]);
    // Plan: "[[links]] of the block". Taken as the block's row in the Level 2 table, then the block's own text.
    const concepts = linkNames([(level2.get(id) ?? []).slice(-1)[0] ?? "", ...own]);
    const purpose = pyStrip(pyStrip(m[2]).replace(/^:/, ""));
    blocks.push({ id, purpose, from, to, code, rows, prose, concepts });
  });
  return { name, path, props, lens, blocks, problems };
}

/** Properties and body, for Concept, Library, Mechanism and Start Here notes. */
export function parseOtherNote(name: string, path: string, text: string): OtherNote {
  const whole = normalize(text);
  const { props, end } = frontmatter(whole);
  let body = whole;
  if (end >= 0) {
    const next = whole.indexOf("\n", end + 1);
    body = next < 0 ? "" : whole.slice(next + 1);
  }
  return { name, path, props: propsOf(props), body };
}
