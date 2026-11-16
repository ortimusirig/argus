// Assigns the blocks of a File note to places in a text. No import of "vscode".
// The mask rules are those of skills/argus/scripts/check_notes.py (the code-fence comparison in check_file_note).
// No trim() anywhere in this file: every "white space" below is pyStrip's set, Python's.

import { Block, FileNote, MASK, NoteProps, isMasked, isSpace, pyRStrip, pyStrip } from "./notes";

export { pyStrip } from "./notes";   // defined beside the note reader, which needs it too; this is the plan's `pyStrip`

export type BlockState = "current" | "current-masked" | "changed" | "ambiguous";
export interface Placed { block: Block; state: BlockState; at?: { from: number; to: number };  // lines in the text now
  spacesOnly?: boolean; candidates?: number[]; }
export interface Assignment { placed: Placed[]; unexplained: [number, number][]; }   // ranges of non-blank lines

const STEP = 10000;     // characters of one line compared between two yields
const SLICE_MS = 2;     // work between two yields of `assign`

/** Calls a generator to its end and gives its result. */
export function runToEnd<T>(steps: Generator<unknown, T, void>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) { return step.value; }
  }
}

function withoutEnding(line: string): string {
  if (line.endsWith("\r\n")) { return line.slice(0, -2); }
  return line.endsWith("\n") || line.endsWith("\r") ? line.slice(0, -1) : line;
}

// ---------------------------------------------------------------- one line against one line

/** The line as whole Unicode characters (code points), as Array.from(line) gives them. Yields every STEP characters. */
function* codePoints(line: string): Generator<void, Uint32Array, void> {
  const out = new Uint32Array(line.length);
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.codePointAt(i) ?? 0;
    if (c > 0xffff) { i++; }
    out[n++] = c;
    if (n % STEP === 0) { yield; }
  }
  return out.subarray(0, n);
}

/** A note line cut at each [masked]: the literal pieces p0 … pk, two at least, kept end to end in one array
 *  (`ends[m]` is where piece m ends, for the `count` pieces), so that a line of very many pieces is not very many
 *  objects and no list grows as they are found. `fail` holds, at the same places, the search table of each piece
 *  between the first and the last; only those are searched for. */
interface Pattern { text: Uint32Array; fail: Int32Array; ends: Int32Array; count: number; head: string; tail: string; size: number; }

/** The Knuth-Morris-Pratt table of a sequence: for each place, the longest start of the sequence that ends there.
 *  Yields every STEP places. */
function* failSteps(seq: ArrayLike<number>, from: number, length: number): Generator<void, Int32Array, void> {
  const fail = new Int32Array(length);
  for (let i = 1, k = 0; i < length; i++) {
    while (k > 0 && seq[from + i] !== seq[from + k]) { k = fail[k - 1]; }
    if (seq[from + i] === seq[from + k]) { k++; }
    fail[i] = k;
    if (i % STEP === 0) { yield; }
  }
  return fail;
}

const PIECE_WORK = 32;  // the work of one piece beside the work of one character: a yield every STEP / 32 pieces at least

/** Cuts the note line at each [masked] and prepares each piece. The line is cut piece by piece, not at once, and
 *  the work is counted: every STEP units of it there is a yield, however many pieces there are and however long. */
function* compile(noteLine: string): Generator<void, Pattern, void> {
  const text = new Uint32Array(noteLine.length), fail = new Int32Array(noteLine.length);
  const ends = new Int32Array(Math.floor(noteLine.length / MASK.length) + 1);     // one piece more than there can be masks
  let head = "", tail = "", n = 0, work = 0, count = 0;
  for (let from = 0; ;) {
    const at = noteLine.indexOf(MASK, from);
    const end = at < 0 ? noteLine.length : at, start = n;
    for (let i = from; i < end; i++) {                    // the piece as whole characters, as `codePoints` gives them
      const c = noteLine.codePointAt(i) ?? 0;
      if (c > 0xffff) { i++; }
      text[n++] = c;
      if (++work >= STEP) { work = 0; yield; }
    }
    if (count > 0 && at >= 0) {                           // a piece between two masks: its Knuth-Morris-Pratt table
      for (let i = 1, k = 0; start + i < n; i++) {
        while (k > 0 && text[start + i] !== text[start + k]) { k = fail[start + k - 1]; }
        if (text[start + i] === text[start + k]) { k++; }
        fail[start + i] = k;
        if (++work >= STEP) { work = 0; yield; }
      }
    }
    if (count === 0) { head = noteLine.slice(0, end); }
    ends[count++] = n;
    work += PIECE_WORK;
    if (work >= STEP) { work = 0; yield; }
    if (at < 0) { tail = noteLine.slice(from); break; }
    from = at + MASK.length;
  }
  return { text, fail, ends, count, head, tail, size: noteLine.length };
}

/** Whether the text fits the pattern: it starts with p0, ends with pk, and each piece between is found at the
 *  earliest place that leaves at least one character after the piece before it. The checker's expression
 *  (`mask_pattern`: the pieces joined by "one or more characters", anchored at both ends) without backtracking. */
function* fits(p: Pattern, t: Uint32Array): Generator<void, boolean, void> {
  const { text, fail, ends, count } = p, n = t.length;
  const firstLength = ends[0], lastAt = ends[count - 2], lastLength = ends[count - 1] - lastAt;
  let steps = 0;
  if (n < firstLength) { return false; }
  for (let i = 0; i < firstLength; i++) {
    if (t[i] !== text[i]) { return false; }
    if (++steps % STEP === 0) { yield; }
  }
  let pos = firstLength;                    // the end of the piece before
  for (let m = 1; m < count - 1; m++) {
    const at = ends[m - 1], length = ends[m] - at, from = pos + 1;
    if (++steps % STEP === 0) { yield; }    // a piece is a step too, however short: there may be very many
    if (length === 0) {                     // two masks side by side: the first takes one character
      if (from > n) { return false; }
      pos = from;
      continue;
    }
    let found = -1;
    for (let i = from, k = 0; i < n; i++) {
      while (k > 0 && t[i] !== text[at + k]) { k = fail[at + k - 1]; }
      if (t[i] === text[at + k]) { k++; }
      if (k === length) { found = i - length + 1; break; }
      if (++steps % STEP === 0) { yield; }
    }
    if (found < 0) { return false; }
    pos = found + length;
  }
  const start = n - lastLength;
  if (start < pos + 1) { return false; }
  for (let i = 0; i < lastLength; i++) {
    if (t[start + i] !== text[lastAt + i]) { return false; }
    if (++steps % STEP === 0) { yield; }
  }
  return true;
}

function* maskedSteps(noteLine: string, textLine: string): Generator<void, boolean, void> {
  if (!noteLine.includes(MASK)) { return noteLine === textLine; }
  const pattern = yield* compile(noteLine);
  // A text that does not start and end as the pattern does cannot fit it, in UTF-16 units as in characters.
  if (!textLine.startsWith(pattern.head) || !textLine.endsWith(pattern.tail)) { return false; }
  return yield* fits(pattern, yield* codePoints(textLine));
}

/** Whether a text line equals a note line that holds [masked], the text around each mask being equal and each mask
 *  standing for at least one character. Characters are code points. Linear in the line; no regular expression. */
export function maskedMatch(noteLine: string, textLine: string): boolean {
  return runToEnd(maskedSteps(noteLine, textLine));
}

type Kind = "exact" | "any" | "pattern";

// White space is read as the patterns are prepared: STEP characters, then a yield. A line may be a million spaces.

/** One piece of white space read without a yield, upwards from `i` and not past `stop`: where it ends. */
function spacesUp(line: string, i: number, stop: number): number {
  while (i < stop && isSpace(line.charCodeAt(i))) { i++; }
  return i;
}

/** The same downwards: where the white space that ends at `i` begins, not before `stop`. */
function spacesDown(line: string, i: number, stop: number): number {
  while (i > stop && isSpace(line.charCodeAt(i - 1))) { i--; }
  return i;
}

/** Where the white space that begins at `from` ends: the place of the first character that is none, or the line's
 *  length. Yields every STEP characters. */
function* spaceEnd(line: string, from: number): Generator<void, number, void> {
  for (let i = from; ;) {
    const stop = Math.min(i + STEP, line.length);
    i = spacesUp(line, i, stop);
    if (i < stop || stop === line.length) { return i; }
    yield;
  }
}

/** Where the white space at the end of the line begins, not before `from`: pyRStrip(line) is the line up to there.
 *  Yields every STEP characters. */
function* spaceStart(line: string, from: number): Generator<void, number, void> {
  for (let i = line.length; ;) {
    const stop = Math.max(i - STEP, from);
    i = spacesDown(line, i, stop);
    if (i > stop || stop === from) { return i; }
    yield;
  }
}

/** Whether the line holds nothing but masks and white space from `from` on: pyStrip(line with every [masked] taken
 *  out) === "", read from the left without cutting the line up. It stops at the first character that is neither.
 *  Yields every STEP characters. */
function* onlyMasks(line: string, from: number): Generator<void, boolean, void> {
  for (let i = from, work = 0; i < line.length;) {
    const stop = Math.min(i + STEP - work, line.length), next = spacesUp(line, i, stop);
    work += next - i;
    i = next;
    if (i < stop) {                                          // a character that is no white space: a mask, or something else
      if (!line.startsWith(MASK, i)) { return false; }
      i += MASK.length;
      work += MASK.length;
    }
    if (work >= STEP) { work = 0; yield; }
  }
  return true;
}

/** Whether the line may use its masks at all (the checker's steps 2 and 3). A line that holds no mask, or a mask it
 *  may not use ("never"), can match only a text line equal to it, so it is an exact line. Nothing of the line is
 *  read here but in one search for the mask. */
function mayMask(noteLine: string, lineNo: number, props: NoteProps): boolean {
  return noteLine.includes(MASK) && isMasked(props, lineNo);
}

/** What a line that may use its masks matches, from the checker's steps 4 and 5: "any" when pyStrip(line) is one
 *  [masked], "exact" when it holds only masks and white space, else "pattern". The line is not trimmed at once: its
 *  white space is read with a yield every STEP characters. */
function* maskKind(noteLine: string): Generator<void, Kind, void> {
  const start = yield* spaceEnd(noteLine, 0);
  if (noteLine.startsWith(MASK, start)) {
    const after = start + MASK.length;
    if ((yield* spaceStart(noteLine, after)) === after) { return "any"; }
  }
  return (yield* onlyMasks(noteLine, start)) ? "exact" : "pattern";
}

function* sameLineSteps(noteLine: string, textLine: string, lineNo: number, props: NoteProps): Generator<void, boolean, void> {
  const text = withoutEnding(textLine);
  if (noteLine === text) { return true; }                    // (1) equal, whatever the line holds
  // (2) no mask, (3) not declared, (5) only masks: no match
  const kind = mayMask(noteLine, lineNo, props) ? yield* maskKind(noteLine) : "exact";
  if (kind === "exact") { return false; }
  if (kind === "any") { return true; }                       // (4) [masked] alone, with or without white space around
  return yield* maskedSteps(noteLine, text);                 // (6)
}

/** The checker's comparison of one copied line with one source line, step for step. `lineNo` is the line's
 *  recorded number, which `masked_lines` speaks of. The text line's line ending is removed first; nothing else. */
export function sameLine(noteLine: string, textLine: string, lineNo: number, props: NoteProps): boolean {
  return runToEnd(sameLineSteps(noteLine, textLine, lineNo, props));
}

// ---------------------------------------------------------------- slices

/** Says when a slice of work has lasted SLICE_MS. Looking at the clock costs more than a comparison, so it is
 *  looked at once in 256 units of work; no unit is longer than one STEP of a line. */
class Slicer {
  done = 0;                 // blocks whose candidates are found: what `assign` yields
  private units = 0;
  private since = performance.now();
  due(units = 1): boolean {
    this.units += units;
    if (this.units < 256) { return false; }
    this.units = 0;
    return performance.now() - this.since >= SLICE_MS;
  }
  resume(): void { this.since = performance.now(); }
}

/** Runs the steps of one long line inside a slice, yielding when the slice is over. */
function* drive<T>(steps: Generator<void, T, void>, slicer: Slicer): Generator<number, T, void> {
  for (;;) {
    const step = steps.next();
    if (step.done) { return step.value; }
    if (slicer.due(256)) { yield slicer.done; slicer.resume(); }
  }
}

/** Runs the steps of one line: at once when the line is short, inside the slice when it is long. */
function* stepped<T>(steps: Generator<void, T, void>, size: number, slicer: Slicer): Generator<number, T, void> {
  return size < STEP ? runToEnd(steps) : yield* drive(steps, slicer);
}

// The two below are for a line of STEP characters or more. A shorter line is trimmed at once by the caller, with
// pyRStrip or pyStrip and without a generator: there is one such call for every line of the text.

/** pyRStrip(line) of a long line: the white space at its end is read inside the slice. */
function* rstripped(line: string, slicer: Slicer): Generator<number, string, void> {
  const end = yield* drive(spaceStart(line, 0), slicer);
  return end === line.length ? line : line.slice(0, end);
}

/** Whether pyStrip(line) is not "" for a long line: it holds a character that is no white space. */
function* notBlank(line: string, slicer: Slicer): Generator<number, boolean, void> {
  return (yield* drive(spaceEnd(line, 0), slicer)) < line.length;
}

/** The work of one native step over a whole line (a comparison, a look in a Map), in units: such a step cannot be
 *  cut up, but a long line counts for more than a short one, so that the clock is looked at after it. */
function whole(line: string): number {
  return line.length >> 10;
}

// ---------------------------------------------------------------- lists and tables of any size

// Nothing below is one native step over a list as long as the text or the note: no sort, map or filter, no list
// that is copied whole when it grows, no Map of millions of entries (a Map that grows writes all its entries again
// in one step: 33 ms for a million). A list is a typed array of a known length, or is kept in pieces; a table is
// many small Maps; an order is merged in runs. Every loop over them counts its work with the slicer.

const PIECE = 4096;       // the entries of one piece of a list, and about those of one Map of a table

/** Values by number, in pieces of PIECE: a list that grows is never copied whole. */
class Pieces<T> {
  private readonly pieces: T[][] = [];
  get(i: number): T | undefined {
    const piece = this.pieces[i >> 12];
    return piece === undefined ? undefined : piece[i & (PIECE - 1)];
  }
  set(i: number, value: T): void {
    (this.pieces[i >> 12] ?? (this.pieces[i >> 12] = []))[i & (PIECE - 1)] = value;
  }
}

/** The characters from `from` up to `to` taken into a hash (FNV-1a over the UTF-16 units). */
function hashed(line: string, h: number, from: number, to: number): number {
  for (let i = from; i < to; i++) { h = Math.imul(h ^ line.charCodeAt(i), 0x01000193); }
  return h;
}

/** The hash's bits stirred, so that each depends on every character (the last step of MurmurHash3). */
function stirred(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The hash of a long line. Yields every STEP characters. */
function* hashSteps(line: string, seed: number): Generator<void, number, void> {
  let h = seed;
  for (let i = 0; i < line.length; i += STEP) {
    h = hashed(line, h, i, Math.min(i + STEP, line.length));
    yield;
  }
  return stirred(h);
}

/** A table from a line to a value, kept as many small Maps, about PIECE entries in each when `expected` lines are
 *  all different. The Map of a line is chosen by a hash of the line that begins at a number drawn for this table,
 *  so that no text can be written to fall into one Map. A table for few lines is one Map and nothing is hashed. */
class Table<V> {
  private readonly maps: (Map<string, V> | undefined)[];
  private readonly seed = (Math.random() * 0x100000000) | 0;
  constructor(expected: number) {
    let count = 1;
    while (count < 65536 && count * PIECE < expected) { count *= 2; }
    this.maps = new Array(count);
  }
  private at(hash: number): Map<string, V> {
    const i = hash & (this.maps.length - 1);
    return this.maps[i] ?? (this.maps[i] = new Map());
  }
  /** The Map of a line shorter than STEP. */
  near(line: string): Map<string, V> {
    return this.maps.length === 1 ? this.at(0) : this.at(stirred(hashed(line, this.seed, 0, line.length)));
  }
  /** The Map of a long line: its hash is read inside the slice. */
  *far(line: string, slicer: Slicer): Generator<number, Map<string, V>, void> {
    return this.maps.length === 1 ? this.at(0) : this.at(yield* drive(hashSteps(line, this.seed), slicer));
  }
}

/** The numbers 0 … count-1 in the order of their keys, those of equal keys in their own order: what a stable sort
 *  by `key(a) - key(b)` gives, merged in runs with the slicer asked at every step. */
function* inOrder(count: number, key: (i: number) => number, slicer: Slicer): Generator<number, Int32Array, void> {
  let from = new Int32Array(count), to = new Int32Array(count);
  const keys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    from[i] = i;
    keys[i] = key(i);
    if (slicer.due()) { yield slicer.done; slicer.resume(); }
  }
  for (let width = 1; width < count; width *= 2) {
    for (let low = 0; low < count; low += 2 * width) {
      const middle = Math.min(low + width, count), high = Math.min(low + 2 * width, count);
      for (let k = low, i = low, j = middle; k < high; k++) {
        to[k] = i < middle && (j >= high || keys[from[i]] <= keys[from[j]]) ? from[i++] : from[j++];
        if (slicer.due()) { yield slicer.done; slicer.resume(); }
      }
    }
    [from, to] = [to, from];
  }
  return from;
}

/** The lines that `masked_lines` names, for an answer in a few steps however many ranges are written: the ranges
 *  in the order of their first lines, those that meet joined into one. The answer is that of `isMasked`. */
class MaskedLines {
  private constructor(private readonly first: Float64Array, private readonly last: Float64Array, private readonly count: number) {}

  static *of(props: NoteProps, slicer: Slicer): Generator<number, MaskedLines, void> {
    const ranges = props.maskedRanges;
    const order = yield* inOrder(ranges.length, (i) => ranges[i][0], slicer);
    const first = new Float64Array(ranges.length), last = new Float64Array(ranges.length);
    let count = 0;
    for (let k = 0; k < order.length; k++) {
      const [from, to] = ranges[order[k]];
      if (to >= from) {                                  // a range written backwards holds no line
        if (count > 0 && from <= last[count - 1]) {
          if (to > last[count - 1]) { last[count - 1] = to; }
        } else {
          first[count] = from;
          last[count++] = to;
        }
      }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
    return new MaskedLines(first, last, count);
  }

  has(line: number): boolean {
    if (!(line >= 1)) { return false; }
    let low = 0, high = this.count;                      // the ranges that begin at or before the line end before `low`
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.first[middle] <= line) { low = middle + 1; } else { high = middle; }
    }
    return low > 0 && line <= this.last[low - 1];
  }
}

// ---------------------------------------------------------------- candidates

/** A prepared pattern, and which distinct text lines it is known to fit or not to fit. Only pairs that were tested
 *  are kept, so what is kept grows with them and not with patterns times lines: while they are few, in `sparse`, a
 *  table in open addressing of (the line's number + 1) * 2 + (1 when it fits), `used` of them; once the table would
 *  be as large, in `dense`, two bits for each distinct text line (0 not tested yet, 1 no, 2 yes). */
interface Compiled { pattern: Pattern; sparse?: Uint32Array; dense?: Uint8Array; used: number; }

const NONE = new Int32Array(0);

/** A text with every distinct line numbered once, so that comparing exact lines is comparing numbers. */
class NumberedText {
  readonly seq: Int32Array;
  private distinct = 0;                                        // how many different lines the text holds
  private readonly ids: Table<number>;
  private readonly lines = new Pieces<string>();               // each different line, by its number
  private readonly points = new Pieces<Uint32Array>();
  private kept = 0;
  private readonly patterns: Table<Compiled>;
  private readonly seed = (Math.random() * 0x100000000) | 0;   // of the places in the `sparse` tables, drawn as a Table's is
  private looked = 0;                                          // the places `known` and `put` passed over: work the caller counts

  /** `loose`: the text's lines are without the white space at their ends, and the note's lines are read so too. */
  private constructor(private readonly masked: MaskedLines, total: number, noteLines: number, private readonly loose: boolean) {
    this.seq = new Int32Array(total);
    this.ids = new Table<number>(total);
    this.patterns = new Table<Compiled>(noteLines);
  }

  /** The text is read from the caller's lines as they are: no copy of them is made. `noteLines`: how many lines
   *  of code the note holds, for the table of their patterns. */
  static *of(masked: MaskedLines, textLines: string[], noteLines: number, loose: boolean, slicer: Slicer): Generator<number, NumberedText, void> {
    const numbered = new NumberedText(masked, textLines.length, noteLines, loose);
    for (let i = 0; i < textLines.length; i++) {
      let line = withoutEnding(textLines[i]);
      if (loose) { line = line.length < STEP ? pyRStrip(line) : yield* rstripped(line, slicer); }
      const map = line.length < STEP ? numbered.ids.near(line) : yield* numbered.ids.far(line, slicer);
      let id = map.get(line);
      if (id === undefined) {
        id = numbered.distinct++;
        map.set(line, id);
        numbered.lines.set(id, line);
      }
      numbered.seq[i] = id;
      if (slicer.due(4 + (line.length >> 6))) { yield slicer.done; slicer.resume(); }
    }
    return numbered;
  }

  private *compiled(noteLine: string, slicer: Slicer): Generator<number, Compiled, void> {
    const map = noteLine.length < STEP ? this.patterns.near(noteLine) : yield* this.patterns.far(noteLine, slicer);
    let c = map.get(noteLine);
    if (!c) {
      c = { pattern: yield* drive(compile(noteLine), slicer), used: 0 };
      map.set(noteLine, c);
    }
    return c;
  }

  /** One pattern against one distinct text line; the caller remembers the answer. */
  private *test(p: Pattern, id: number, slicer: Slicer): Generator<number, boolean, void> {
    const line = this.lines.get(id) as string;
    if (!line.startsWith(p.head) || !line.endsWith(p.tail)) { return false; }
    let t = this.points.get(id);
    if (!t) {
      t = line.length < STEP ? runToEnd(codePoints(line)) : yield* drive(codePoints(line), slicer);
      if (this.kept + t.length <= 4_000_000) { this.points.set(id, t); this.kept += t.length; }   // kept while they are few
    }
    return p.size + t.length < STEP ? runToEnd(fits(p, t)) : yield* drive(fits(p, t), slicer);
  }

  /** What is known of a pattern against a distinct text line: 0 not tested yet, 1 no, 2 yes. */
  private known(c: Compiled, id: number): number {
    if (c.dense) { return (c.dense[id >> 2] >> ((id & 3) << 1)) & 3; }
    const table = c.sparse;
    if (!table) { return 0; }
    const mask = table.length - 1;
    for (let i = stirred(id ^ this.seed) & mask; ; i = (i + 1) & mask) {
      const entry = table[i];
      if (entry === 0) { return 0; }
      if (entry >>> 1 === id + 1) { return 1 + (entry & 1); }
      this.looked++;
    }
  }

  /** Writes an entry into a `sparse` table that has room for it. */
  private put(table: Uint32Array, entry: number): void {
    const mask = table.length - 1;
    let i = stirred(((entry >>> 1) - 1) ^ this.seed) & mask;
    while (table[i] !== 0) { i = (i + 1) & mask; this.looked++; }
    table[i] = entry;
  }

  /** Makes room in a pattern's memory for one answer more: the first table, a table twice as large, or, when that
   *  table would be no smaller, the two bits for each line. What is known is written again with the slicer asked
   *  at every place, so that growing is no longer a step than any other. Nothing is as large as the text before
   *  the pattern was tested against one in 64 of its lines. */
  private *grow(c: Compiled, slicer: Slicer): Generator<number, void, void> {
    const old = c.sparse, size = old ? 2 * old.length : 8, bytes = (this.distinct + 3) >> 2;
    const dense = 4 * size >= bytes ? new Uint8Array(bytes) : undefined, sparse = dense ? undefined : new Uint32Array(size);
    for (let i = 0; old && i < old.length; i++) {
      const entry = old[i];
      if (entry !== 0 && dense) {
        const id = (entry >>> 1) - 1;
        dense[id >> 2] |= (1 + (entry & 1)) << ((id & 3) << 1);
      } else if (entry !== 0) { this.put(sparse as Uint32Array, entry); }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
    c.sparse = sparse;
    c.dense = dense;
  }

  /** Every start (0-based) where all lines of the block match in order. None is dropped; there is no cap. */
  *starts(block: Block, slicer: Slicer): Generator<number, Int32Array, void> {
    const length = block.code.length, total = this.seq.length, seq = this.seq;
    if (length === 0 || length > total) { return NONE; }
    const exact = new Int32Array(length);             // the number of each exact line; -1 for the other kinds
    const patterns = new Pieces<Compiled>(), patternAt = new Int32Array(length);   // the pattern lines, and where each is
    let patternCount = 0;
    for (let k = 0; k < length; k++) {
      const code = block.code[k];
      const line = !this.loose ? code : code.length < STEP ? pyRStrip(code) : yield* rstripped(code, slicer);
      let kind: Kind = "exact", units = 4 + (line.length >> 6);
      if (line.includes(MASK) && this.masked.has(block.from + k)) {   // the mask permission of a line is that of its recorded number
        kind = yield* stepped(maskKind(line), line.length, slicer);
        units += line.length >> 2;
      }
      if (slicer.due(units)) { yield slicer.done; slicer.resume(); }    // counted before the line can end the search
      exact[k] = -1;
      if (kind === "exact") {
        const map = line.length < STEP ? this.ids.near(line) : yield* this.ids.far(line, slicer);
        const id = map.get(line);
        if (id === undefined) { return NONE; }         // a line the text does not hold at all
        exact[k] = id;
      } else if (kind === "pattern") {
        patterns.set(patternCount, yield* this.compiled(line, slicer));
        patternAt[patternCount++] = k;
      }
    }
    // (1) The longest run of exact lines, searched in the text's numbers with Knuth-Morris-Pratt.
    let runAt = 0, runLength = 0, others = 0;
    for (let k = 0, begun = -1; k <= length; k++) {    // one line at a time: a run may be as long as the block
      if (k < length && exact[k] >= 0) {
        if (begun < 0) { begun = k; }
        others++;
      } else if (begun >= 0) {
        if (k - begun > runLength) { runAt = begun; runLength = k - begun; }     // the first of the longest
        begun = -1;
      }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
    others -= runLength;                               // the exact lines outside the longest run
    const at = new Int32Array(others);                 // where they are in the block
    for (let k = 0, n = 0; others > 0 && k < length; k++) {
      if (exact[k] >= 0 && (k < runAt || k >= runAt + runLength)) { at[n++] = k; }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
    const fail = runLength === 0 ? NONE
      : runLength < STEP ? runToEnd(failSteps(exact, runAt, runLength)) : yield* drive(failSteps(exact, runAt, runLength), slicer);
    // Each start the run is found at (every start that leaves room, when no line is exact) is tried at once against
    // the block's other lines, and only the starts that stay are kept: in pieces, written into one list of their
    // number at the end. So no list here is as long as the text unless the block's candidates are as many.
    const pieces: number[][] = [];
    let piece: number[] = [], count = 0;
    const last = total - length, stop = runLength > 0 ? total : last + 1;
    for (let i = 0, k = 0; i < stop; i++) {
      let start = i;
      if (runLength > 0) {
        while (k > 0 && seq[i] !== exact[runAt + k]) { k = fail[k - 1]; }
        if (seq[i] === exact[runAt + k]) { k++; }
        start = -1;
        if (k === runLength) {
          start = i - runLength + 1 - runAt;
          k = fail[k - 1];
        }
      }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
      if (start < 0 || start > last) { continue; }
      let ok = true;
      // (2) The other exact lines, as numbers.
      for (let n = 0; n < others && ok; n++) {
        if (seq[start + at[n]] !== exact[at[n]]) { ok = false; }
        if (slicer.due()) { yield slicer.done; slicer.resume(); }   // at every comparison, the one that fails too
      }
      // (3) Pattern lines; each (pattern, text line) pair is tested once in the note.
      // (4) "any" lines are never compared.
      for (let n = 0; n < patternCount && ok; n++) {
        const c = patterns.get(n) as Compiled, id = seq[start + patternAt[n]];
        this.looked = 0;
        let answer = this.known(c, id);
        if (answer === 0) {
          answer = (yield* this.test(c.pattern, id, slicer)) ? 2 : 1;
          if (!c.dense && (!c.sparse || 2 * c.used >= c.sparse.length)) { yield* this.grow(c, slicer); }   // half empty at least
          if (c.dense) {
            c.dense[id >> 2] |= answer << ((id & 3) << 1);
          } else {
            this.put(c.sparse as Uint32Array, (((id + 1) << 1) | (answer - 1)) >>> 0);
            c.used++;
          }
          if (slicer.due(16 + this.looked + ((this.lines.get(id) as string).length >> 2))) { yield slicer.done; slicer.resume(); }
        } else if (slicer.due(1 + this.looked)) { yield slicer.done; slicer.resume(); }
        if (answer !== 2) { ok = false; }
      }
      if (ok) {
        if (piece.length === PIECE) { pieces.push(piece); piece = []; }
        piece.push(start);
        count++;
      }
    }
    pieces.push(piece);
    const starts = new Int32Array(count);
    for (let p = 0; p < pieces.length; p++) {
      starts.set(pieces[p], p * PIECE);
      if (slicer.due(64)) { yield slicer.done; slicer.resume(); }
    }
    return starts;
  }
}

/** What a run prepares once: the masked lines, the numbered text, and for each block its starts. */
interface Found { masked: MaskedLines; noteLines: number; found: Int32Array[]; }

function* allStarts(note: FileNote, textLines: string[], slicer: Slicer): Generator<number, Found, void> {
  const masked = yield* MaskedLines.of(note.props, slicer);
  let noteLines = 0;
  for (const block of note.blocks) {
    noteLines += block.code.length;
    if (slicer.due()) { yield slicer.done; slicer.resume(); }
  }
  const numbered = yield* NumberedText.of(masked, textLines, noteLines, false, slicer);
  const found: Int32Array[] = new Array(note.blocks.length);
  for (let b = 0; b < note.blocks.length; b++) {
    found[b] = yield* numbered.starts(note.blocks[b], slicer);
    slicer.done++;
    if (slicer.due(4)) { yield slicer.done; slicer.resume(); }       // a block is a step, though its search may end at once
  }
  return { masked, noteLines, found };
}

/** For each block of the note, in the note's order: every start line (1-based) where its whole code matches. */
export function* candidates(note: FileNote, textLines: string[]): Generator<number, number[][], void> {
  const slicer = new Slicer();
  const { found } = yield* allStarts(note, textLines, slicer);
  const lines: number[][] = new Array(found.length);
  for (let b = 0; b < found.length; b++) {
    const starts = found[b], list: number[] = new Array(starts.length);
    for (let j = 0; j < starts.length; j++) {
      list[j] = starts[j] + 1;
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
    lines[b] = list;
    if (slicer.due()) { yield slicer.done; slicer.resume(); }
  }
  return lines;
}

// ---------------------------------------------------------------- assignment

/** The best (most blocks, then smallest sum of distances) among the entries at or below a position. */
class Best {
  private readonly count: Int32Array;
  private readonly cost: Float64Array;
  foundCount = 0;
  foundCost = 0;
  constructor(private readonly size: number) {
    this.count = new Int32Array(size + 1);
    this.cost = new Float64Array(size + 1);
  }
  add(at: number, count: number, cost: number): void {
    for (let i = at; i <= this.size; i += i & -i) {
      if (count > this.count[i] || (count === this.count[i] && cost < this.cost[i])) { this.count[i] = count; this.cost[i] = cost; }
    }
  }
  /** Sets foundCount and foundCost; "nothing placed" (0, 0) when no entry is at or below `at`. */
  find(at: number): void {
    let count = 0, cost = 0;
    for (let i = at; i > 0; i -= i & -i) {
      if (this.count[i] > count || (this.count[i] === count && this.cost[i] < cost)) { count = this.count[i]; cost = this.cost[i]; }
    }
    this.foundCount = count;
    this.foundCost = cost;
  }
}

/**
 * Assigns the note's blocks to places in the text. A generator: it works in slices of 2 ms and yields between
 * them (the number of blocks whose candidates are found so far); the caller decides when the next slice runs, and
 * drops the generator when the text or the note changes. Its return value is the assignment.
 */
// Plan: the signature line says `assign(...): Assignment`, the row "Never stalls" says it is a generator. The row is
// the later and stricter rule (design revision 13: matching never blocks the editor), so this is the generator.
export function* assign(note: FileNote, textLines: string[]): Generator<number, Assignment, void> {
  const slicer = new Slicer();
  const total = textLines.length;
  const { masked, noteLines, found } = yield* allStarts(note, textLines, slicer);

  // Blocks in the order of their recorded `from`. Forward: the best way to place blocks up to this one with this
  // block at this candidate. A block may sit at a candidate that starts after the end of the block placed before.
  const count = note.blocks.length;
  const order = yield* inOrder(count, (i) => note.blocks[i].from, slicer);
  const far = (o: number, start: number) => Math.abs(start + 1 - note.blocks[order[o]].from);
  const forward = new Best(total + 1);
  const upCount: Int32Array[] = new Array(count), upCost: Float64Array[] = new Array(count);
  for (let o = 0; o < count; o++) {
    const starts = found[order[o]], length = note.blocks[order[o]].code.length;
    const c = new Int32Array(starts.length), k = new Float64Array(starts.length);
    for (let j = 0; j < starts.length; j++) {
      forward.find(starts[j]);                           // entries are kept at (end line + 1): those that end before this start
      c[j] = forward.foundCount + 1;
      k[j] = forward.foundCost + far(o, starts[j]);
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    for (let j = 0; j < starts.length; j++) {
      forward.add(starts[j] + length, c[j], k[j]);
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    upCount[o] = c;
    upCost[o] = k;
    if (slicer.due(4)) { yield slicer.done; slicer.resume(); }       // a block without a candidate is a step too
  }
  forward.find(total + 1);
  const bestCount = forward.foundCount, bestCost = forward.foundCost;

  // Backward: the best way to place this block at this candidate and the blocks after it. A candidate is part of a
  // best solution when the two halves together give the best count and sum.
  const backward = new Best(total + 1);
  const downCount: Int32Array[] = new Array(count), downCost: Float64Array[] = new Array(count);
  const inBest: Int32Array[] = new Array(count);        // for each block, which of its candidates are in a best solution
  let withBest = 0;                                      // the blocks that have a place in some best solution
  for (let o = count - 1; o >= 0; o--) {
    const starts = found[order[o]], length = note.blocks[order[o]].code.length;
    const c = new Int32Array(starts.length), k = new Float64Array(starts.length);
    const best = new Int32Array(starts.length);
    let bests = 0;
    for (let j = 0; j < starts.length; j++) {
      backward.find(total - starts[j] - length + 1);     // entries are kept at (total - start + 1): those that start after this end
      c[j] = backward.foundCount + 1;
      k[j] = backward.foundCost + far(o, starts[j]);
      if (upCount[o][j] + backward.foundCount === bestCount && upCost[o][j] + backward.foundCost === bestCost) { best[bests++] = j; }
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    for (let j = 0; j < starts.length; j++) {
      backward.add(total - starts[j] + 1, c[j], k[j]);
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    downCount[o] = c;
    downCost[o] = k;
    inBest[o] = bests === best.length ? best : best.subarray(0, bests);
    if (bests > 0) { withBest++; }
    if (slicer.due(4)) { yield slicer.done; slicer.resume(); }
  }

  // Plan: "if another best solution places it elsewhere, its state is ambiguous". The plan is silent on a block that
  // one best solution places and another, equally good, leaves out (two blocks that cannot both keep their order).
  // Neither is called current here: both are ambiguous. This can happen only when more blocks have a place in some
  // best solution than one solution holds.
  const leftOut = new Uint8Array(count);
  if (withBest > bestCount) {
    const after = new Best(total + 1);                   // the blocks after block o
    for (let o = count - 1; o >= 0; o--) {
      const starts = found[order[o]];
      if (inBest[o].length > 0) {
        after.find(total + 1);
        let skipped = after.foundCount === bestCount && after.foundCost === bestCost;   // nothing placed before it either
        for (let before = 0; before < o && !skipped; before++) {
          const length = note.blocks[order[before]].code.length, places = found[order[before]], best = inBest[before];
          for (let b = 0; b < best.length; b++) {
            const j = best[b];
            after.find(total - places[j] - length + 1);
            if (upCount[before][j] + after.foundCount === bestCount && upCost[before][j] + after.foundCost === bestCost) { skipped = true; break; }
            if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
          }
          if (slicer.due()) { yield slicer.done; slicer.resume(); }   // a block before it that has no place is a step too
        }
        leftOut[o] = skipped ? 1 : 0;
      }
      for (let j = 0; j < starts.length; j++) {
        after.add(total - starts[j] + 1, downCount[o][j], downCost[o][j]);
        if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
      }
      if (slicer.due()) { yield slicer.done; slicer.resume(); }
    }
  }

  const placed: Placed[] = new Array(count);
  const covered = new Uint8Array(total);                  // 1: a line of a block that is current or current-masked
  let loose: NumberedText | undefined;                    // the text with white space at line ends ignored
  for (let o = 0; o < count; o++) {
    const block = note.blocks[order[o]], starts = found[order[o]], length = block.code.length, best = inBest[o];
    if (best.length === 1 && leftOut[o] === 0) {
      const start = starts[best[0]];
      let different = false;                              // exact lines are equal here; any other line that differs matched through a mask
      for (let k = 0; k < length; k++) {
        if (block.code[k] !== withoutEnding(textLines[start + k])) { different = true; }
        covered[start + k] = 1;
        if (slicer.due(1 + whole(block.code[k]))) { yield slicer.done; slicer.resume(); }
      }
      placed[order[o]] = { block, state: different ? "current-masked" : "current", at: { from: start + 1, to: start + length } };
    } else if (best.length > 0) {
      const places: number[] = new Array(best.length);    // a list of its final length: every best place, none dropped
      let near = starts[best[0]] + 1;
      for (let b = 0; b < best.length; b++) {
        const place = starts[best[b]] + 1;
        places[b] = place;
        if (Math.abs(place - block.from) < Math.abs(near - block.from)) { near = place; }
        if (slicer.due()) { yield slicer.done; slicer.resume(); }
      }
      placed[order[o]] = { block, state: "ambiguous", at: { from: near, to: near + length - 1 }, candidates: places };
    } else {
      // Changed. Its marker: where the code is with white space at line ends ignored, else the recorded lines clipped.
      const last = Math.max(total, 1);
      const from = Math.min(Math.max(block.from, 1), last);
      const changed: Placed = { block, state: "changed", at: { from, to: Math.min(Math.max(block.to, from), last) } };
      // Design: "differs only in spaces at line ends" is said of code that is nowhere exactly. A block whose exact
      // code is in the text but fits the order nowhere keeps its recorded lines and is not called spaces-only.
      if (starts.length === 0 && length > 0) {
        if (!loose) { loose = yield* NumberedText.of(masked, textLines, noteLines, true, slicer); }
        const nearly = yield* loose.starts(block, slicer);
        if (nearly.length > 0) {
          changed.at = { from: nearly[0] + 1, to: nearly[0] + length };
          changed.spacesOnly = true;
        }
      }
      placed[order[o]] = changed;
    }
    if (slicer.due(4)) { yield slicer.done; slicer.resume(); }
  }

  // Unexplained: non-blank lines outside every block that is current or current-masked. First each such line is
  // marked and the ranges are counted; then the list of ranges is made at its final length.
  let ranges = 0;
  for (let i = 0, inRange = false; i < total; i++) {
    let bare = false;
    if (covered[i] === 0) {
      const line = withoutEnding(textLines[i]);
      bare = line.length < STEP ? pyStrip(line) !== "" : yield* notBlank(line, slicer);
      if (slicer.due(2 + (line.length >> 6))) { yield slicer.done; slicer.resume(); }
    } else if (slicer.due()) { yield slicer.done; slicer.resume(); }
    if (bare) { covered[i] = 2; }
    if (bare && !inRange) { ranges++; }
    inRange = bare;
  }
  const unexplained: [number, number][] = new Array(ranges);
  let open = 0;                                           // the first line of the range being collected, or 0
  for (let i = 0, n = 0; i <= total; i++) {
    const bare = i < total && covered[i] === 2;
    if (bare && open === 0) { open = i + 1; }
    if (!bare && open > 0) { unexplained[n++] = [open, i]; open = 0; }
    if (slicer.due()) { yield slicer.done; slicer.resume(); }
  }
  return { placed, unexplained };
}

// ---------------------------------------------------------------- runs

/** What a run is tied to: the document, the document's version, and the note's revision in the index. */
export interface RunKey { uri: string; version: number; revision: number; }

interface Run { key: RunKey; steps: Generator<number, Assignment, void>; }

/**
 * Runs `assign` in slices, one run for each document. A new run starts when the document's version or the note's
 * revision changes; the run before it stops at its next yield and is never published. A finished run is published
 * only when it is still the document's run.
 */
// Plan: the row "Never stalls" gives this rule to the callers (markers.ts, panel.ts) and its tests to match.test.ts.
// The rule is kept here, without "vscode", so that the tests can reach it and both callers share one copy.
export class MatchRuns {
  private readonly runs = new Map<string, Run>();

  /** `later` runs the next slice after giving way to everything else that waits; in Node that is setImmediate. */
  constructor(private readonly later: (slice: () => void) => void = (slice) => { setImmediate(slice); }) {}

  /** Starts a run unless the same run is already going. Returns whether a run was started. */
  start(key: RunKey, note: FileNote, textLines: string[], publish: (result: Assignment, key: RunKey) => void,
    progress?: (blocksDone: number, key: RunKey) => void): boolean {
    const going = this.runs.get(key.uri);
    if (going && going.key.version === key.version && going.key.revision === key.revision) { return false; }
    const run: Run = { key, steps: assign(note, textLines) };
    this.runs.set(key.uri, run);            // the run before, if any, sees this at its next slice and stops
    const slice = (): void => {
      if (this.runs.get(key.uri) !== run) { run.steps.return(undefined as never); return; }
      let step: IteratorResult<number, Assignment>;
      try {
        step = run.steps.next();
      } catch (error) {
        this.runs.delete(key.uri);          // a run that fails is over: the document is not left "matching"
        throw error;
      }
      if (step.done) {
        this.runs.delete(key.uri);
        publish(step.value, key);
      } else {
        progress?.(step.value, key);
        this.later(slice);
      }
    };
    this.later(slice);
    return true;
  }

  /** Drops the document's run: its note is gone, or the document is closed. Nothing is published. */
  stop(uri: string): void {
    this.runs.delete(uri);
  }

  /** The run that is going for the document, if any. */
  active(uri: string): RunKey | undefined {
    return this.runs.get(uri)?.key;
  }
}
