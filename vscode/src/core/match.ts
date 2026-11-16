// Assigns the blocks of a File note to places in a text. No import of "vscode".
// The mask rules are those of skills/argus/scripts/check_notes.py (the code-fence comparison in check_file_note).
// No trim() anywhere in this file: every "white space" below is pyStrip's set, Python's.

import { Block, FileNote, MASK, NoteProps, isMasked, pyRStrip, pyStrip } from "./notes";

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
 *  (`ends[m]` is where piece m ends), so that a line of very many pieces is not very many objects. `fail` holds,
 *  at the same places, the search table of each piece between the first and the last; only those are searched for. */
interface Pattern { text: Uint32Array; fail: Int32Array; ends: number[]; head: string; tail: string; size: number; }

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
  const ends: number[] = [];
  let head = "", tail = "", n = 0, work = 0;
  for (let from = 0; ;) {
    const at = noteLine.indexOf(MASK, from);
    const end = at < 0 ? noteLine.length : at, start = n;
    for (let i = from; i < end; i++) {                    // the piece as whole characters, as `codePoints` gives them
      const c = noteLine.codePointAt(i) ?? 0;
      if (c > 0xffff) { i++; }
      text[n++] = c;
      if (++work >= STEP) { work = 0; yield; }
    }
    if (ends.length > 0 && at >= 0) {                     // a piece between two masks: its Knuth-Morris-Pratt table
      for (let i = 1, k = 0; start + i < n; i++) {
        while (k > 0 && text[start + i] !== text[start + k]) { k = fail[start + k - 1]; }
        if (text[start + i] === text[start + k]) { k++; }
        fail[start + i] = k;
        if (++work >= STEP) { work = 0; yield; }
      }
    }
    if (ends.length === 0) { head = noteLine.slice(0, end); }
    ends.push(n);
    work += PIECE_WORK;
    if (work >= STEP) { work = 0; yield; }
    if (at < 0) { tail = noteLine.slice(from); break; }
    from = at + MASK.length;
  }
  return { text, fail, ends, head, tail, size: noteLine.length };
}

/** Whether the text fits the pattern: it starts with p0, ends with pk, and each piece between is found at the
 *  earliest place that leaves at least one character after the piece before it. The checker's expression
 *  (`mask_pattern`: the pieces joined by "one or more characters", anchored at both ends) without backtracking. */
function* fits(p: Pattern, t: Uint32Array): Generator<void, boolean, void> {
  const { text, fail, ends } = p, n = t.length, count = ends.length;
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

/** Whether the line holds nothing but masks and white space: pyStrip(line with every [masked] taken out) === "",
 *  read from the left without cutting the line up. It stops at the first character that is neither. */
function onlyMasks(line: string): boolean {
  for (let i = 0; i < line.length;) {
    if (line.startsWith(MASK, i)) { i += MASK.length; continue; }
    if (pyStrip(line[i]) !== "") { return false; }
    i++;
  }
  return true;
}

/** What a note line may match, from the checker's steps 2 to 5. A line that holds a mask it may not use ("never")
 *  can match only a text line equal to it, so it is an exact line. */
function kindOf(noteLine: string, lineNo: number, props: NoteProps): Kind {
  if (!noteLine.includes(MASK)) { return "exact"; }
  if (!isMasked(props, lineNo)) { return "exact"; }
  if (pyStrip(noteLine) === MASK) { return "any"; }
  return onlyMasks(noteLine) ? "exact" : "pattern";
}

function* sameLineSteps(noteLine: string, textLine: string, lineNo: number, props: NoteProps): Generator<void, boolean, void> {
  const text = withoutEnding(textLine);
  if (noteLine === text) { return true; }                    // (1) equal, whatever the line holds
  const kind = kindOf(noteLine, lineNo, props);              // (2) no mask, (3) not declared, (5) only masks: no match
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

// ---------------------------------------------------------------- candidates

interface Compiled { pattern: Pattern; memo?: Uint8Array; }   // memo: two bits for each distinct text line

/** A text with every distinct line numbered once, so that comparing exact lines is comparing numbers. */
class NumberedText {
  readonly ids = new Map<string, number>();
  readonly distinct: string[] = [];
  readonly seq: Int32Array;
  private readonly points: (Uint32Array | undefined)[] = [];
  private kept = 0;
  private readonly patterns = new Map<string, Compiled>();

  private constructor(readonly props: NoteProps, readonly text: string[], private readonly norm: (line: string) => string) {
    this.seq = new Int32Array(text.length);
  }

  static *of(props: NoteProps, text: string[], norm: (line: string) => string, slicer: Slicer): Generator<number, NumberedText, void> {
    const numbered = new NumberedText(props, text, norm);
    for (let i = 0; i < text.length; i++) {
      let id = numbered.ids.get(text[i]);
      if (id === undefined) {
        id = numbered.distinct.length;
        numbered.ids.set(text[i], id);
        numbered.distinct.push(text[i]);
      }
      numbered.seq[i] = id;
      if (slicer.due(4)) { yield slicer.done; slicer.resume(); }
    }
    return numbered;
  }

  private *compiled(noteLine: string, slicer: Slicer): Generator<number, Compiled, void> {
    let c = this.patterns.get(noteLine);
    if (!c) {
      c = { pattern: yield* drive(compile(noteLine), slicer) };
      this.patterns.set(noteLine, c);
    }
    return c;
  }

  /** One pattern against one distinct text line; the caller remembers the answer. */
  private *test(p: Pattern, id: number, slicer: Slicer): Generator<number, boolean, void> {
    const line = this.distinct[id];
    if (!line.startsWith(p.head) || !line.endsWith(p.tail)) { return false; }
    let t = this.points[id];
    if (!t) {
      t = line.length < STEP ? runToEnd(codePoints(line)) : yield* drive(codePoints(line), slicer);
      if (this.kept + t.length <= 4_000_000) { this.points[id] = t; this.kept += t.length; }   // kept while they are few
    }
    return p.size + t.length < STEP ? runToEnd(fits(p, t)) : yield* drive(fits(p, t), slicer);
  }

  /** Every start (0-based) where all lines of the block match in order. None is dropped; there is no cap. */
  *starts(block: Block, slicer: Slicer): Generator<number, number[], void> {
    const length = block.code.length, total = this.seq.length, seq = this.seq;
    if (length === 0 || length > total) { return []; }
    const exact = new Int32Array(length).fill(-1);    // the number of each exact line; -1 for the other kinds
    const patterns: { at: number; c: Compiled }[] = [];
    for (let k = 0; k < length; k++) {
      const line = this.norm(block.code[k]);
      const kind = kindOf(line, block.from + k, this.props);   // the mask permission of a line is that of its recorded number
      if (kind === "exact") {
        const id = this.ids.get(line);
        if (id === undefined) { return []; }           // a line the text does not hold at all
        exact[k] = id;
      } else if (kind === "pattern") {
        patterns.push({ at: k, c: yield* this.compiled(line, slicer) });
      }
      if (slicer.due(4)) { yield slicer.done; slicer.resume(); }
    }
    // (1) The longest run of exact lines, searched in the text's numbers with Knuth-Morris-Pratt.
    let runAt = 0, runLength = 0;
    for (let k = 0; k < length; k++) {
      if (exact[k] < 0) { continue; }
      let end = k;
      while (end < length && exact[end] >= 0) { end++; }
      if (end - k > runLength) { runAt = k; runLength = end - k; }
      k = end;
    }
    let starts: number[] = [];
    if (runLength > 0) {
      const fail = runLength < STEP ? runToEnd(failSteps(exact, runAt, runLength)) : yield* drive(failSteps(exact, runAt, runLength), slicer);
      for (let i = 0, k = 0; i < total; i++) {
        while (k > 0 && seq[i] !== exact[runAt + k]) { k = fail[k - 1]; }
        if (seq[i] === exact[runAt + k]) { k++; }
        if (k === runLength) {
          const start = i - runLength + 1 - runAt;
          if (start >= 0 && start + length <= total) { starts.push(start); }
          k = fail[k - 1];
        }
        if (slicer.due()) { yield slicer.done; slicer.resume(); }
      }
    } else {
      // No exact line: every start that leaves room, taken directly.
      for (let start = 0; start + length <= total; start++) { starts.push(start); }
    }
    // (2) The other exact lines, as numbers, only at the starts still left.
    const others: number[] = [];
    for (let k = 0; k < length; k++) {
      if (exact[k] >= 0 && (k < runAt || k >= runAt + runLength)) { others.push(k); }
    }
    if (others.length > 0 && starts.length > 0) {
      const left: number[] = [];
      for (const start of starts) {
        let ok = true;
        for (const k of others) {
          if (seq[start + k] !== exact[k]) { ok = false; break; }
          if (slicer.due()) { yield slicer.done; slicer.resume(); }
        }
        if (ok) { left.push(start); }
      }
      starts = left;
    }
    // (3) Pattern lines, only at the starts still left; each (pattern, text line) pair is tested once in the note.
    // (4) "any" lines are never compared.
    if (patterns.length > 0 && starts.length > 0) {
      const left: number[] = [];
      for (const start of starts) {
        let ok = true;
        for (const { at, c } of patterns) {
          const id = seq[start + at], shift = (id & 3) << 1;
          const memo = c.memo ?? (c.memo = new Uint8Array((this.distinct.length + 3) >> 2));
          let answer = (memo[id >> 2] >> shift) & 3;   // 0 not tested yet, 1 no, 2 yes
          if (answer === 0) {
            answer = (yield* this.test(c.pattern, id, slicer)) ? 2 : 1;
            memo[id >> 2] |= answer << shift;
            if (slicer.due(16 + (this.distinct[id].length >> 2))) { yield slicer.done; slicer.resume(); }
          } else if (slicer.due()) { yield slicer.done; slicer.resume(); }
          if (answer !== 2) { ok = false; break; }
        }
        if (ok) { left.push(start); }
      }
      starts = left;
    }
    return starts;
  }
}

function* withoutEndings(textLines: string[], slicer: Slicer): Generator<number, string[], void> {
  const text: string[] = new Array(textLines.length);
  for (let i = 0; i < textLines.length; i++) {
    text[i] = withoutEnding(textLines[i]);
    if (slicer.due()) { yield slicer.done; slicer.resume(); }
  }
  return text;
}

function* allStarts(numbered: NumberedText, blocks: Block[], slicer: Slicer): Generator<number, number[][], void> {
  const found: number[][] = [];
  for (const block of blocks) {
    found.push(yield* numbered.starts(block, slicer));
    slicer.done++;
  }
  return found;
}

/** For each block of the note, in the note's order: every start line (1-based) where its whole code matches. */
export function* candidates(note: FileNote, textLines: string[]): Generator<number, number[][], void> {
  const slicer = new Slicer();
  const text = yield* withoutEndings(textLines, slicer);
  const numbered = yield* NumberedText.of(note.props, text, (line) => line, slicer);
  const found = yield* allStarts(numbered, note.blocks, slicer);
  return found.map((starts) => starts.map((start) => start + 1));
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
  const text = yield* withoutEndings(textLines, slicer);
  const total = text.length;
  const numbered = yield* NumberedText.of(note.props, text, (line) => line, slicer);
  const found = yield* allStarts(numbered, note.blocks, slicer);

  // Blocks in the order of their recorded `from`. Forward: the best way to place blocks up to this one with this
  // block at this candidate. A block may sit at a candidate that starts after the end of the block placed before.
  const order = note.blocks.map((_, i) => i).sort((a, b) => note.blocks[a].from - note.blocks[b].from);
  const count = order.length;
  const far = (o: number, start: number) => Math.abs(start + 1 - note.blocks[order[o]].from);
  const forward = new Best(total + 1);
  const upCount: Int32Array[] = [], upCost: Float64Array[] = [];
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
    upCount.push(c);
    upCost.push(k);
  }
  forward.find(total + 1);
  const bestCount = forward.foundCount, bestCost = forward.foundCost;

  // Backward: the best way to place this block at this candidate and the blocks after it. A candidate is part of a
  // best solution when the two halves together give the best count and sum.
  const backward = new Best(total + 1);
  const downCount: Int32Array[] = new Array(count), downCost: Float64Array[] = new Array(count);
  const inBest: number[][] = new Array(count);
  for (let o = count - 1; o >= 0; o--) {
    const starts = found[order[o]], length = note.blocks[order[o]].code.length;
    const c = new Int32Array(starts.length), k = new Float64Array(starts.length);
    const best: number[] = [];
    for (let j = 0; j < starts.length; j++) {
      backward.find(total - starts[j] - length + 1);     // entries are kept at (total - start + 1): those that start after this end
      c[j] = backward.foundCount + 1;
      k[j] = backward.foundCost + far(o, starts[j]);
      if (upCount[o][j] + backward.foundCount === bestCount && upCost[o][j] + backward.foundCost === bestCost) { best.push(j); }
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    for (let j = 0; j < starts.length; j++) {
      backward.add(total - starts[j] + 1, c[j], k[j]);
      if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
    }
    downCount[o] = c;
    downCost[o] = k;
    inBest[o] = best;
  }

  // Plan: "if another best solution places it elsewhere, its state is ambiguous". The plan is silent on a block that
  // one best solution places and another, equally good, leaves out (two blocks that cannot both keep their order).
  // Neither is called current here: both are ambiguous. This can happen only when more blocks have a place in some
  // best solution than one solution holds.
  const leftOut: boolean[] = new Array(count).fill(false);
  if (inBest.filter((best) => best.length > 0).length > bestCount) {
    const after = new Best(total + 1);                   // the blocks after block o
    for (let o = count - 1; o >= 0; o--) {
      const starts = found[order[o]];
      if (inBest[o].length > 0) {
        after.find(total + 1);
        let skipped = after.foundCount === bestCount && after.foundCost === bestCost;   // nothing placed before it either
        for (let before = 0; before < o && !skipped; before++) {
          const length = note.blocks[order[before]].code.length;
          for (const j of inBest[before]) {
            after.find(total - found[order[before]][j] - length + 1);
            if (upCount[before][j] + after.foundCount === bestCount && upCost[before][j] + after.foundCost === bestCost) { skipped = true; break; }
            if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
          }
        }
        leftOut[o] = skipped;
      }
      for (let j = 0; j < starts.length; j++) {
        after.add(total - starts[j] + 1, downCount[o][j], downCost[o][j]);
        if (slicer.due(8)) { yield slicer.done; slicer.resume(); }
      }
    }
  }

  const placed: Placed[] = new Array(count);
  const covered = new Uint8Array(total);
  let loose: NumberedText | undefined;                    // the text with white space at line ends ignored
  for (let o = 0; o < count; o++) {
    const block = note.blocks[order[o]], starts = found[order[o]], length = block.code.length, best = inBest[o];
    if (best.length === 1 && !leftOut[o]) {
      const start = starts[best[0]];
      let masked = false;                                 // exact lines are equal here; any other line that differs matched through a mask
      for (let k = 0; k < length; k++) {
        if (block.code[k] !== text[start + k]) { masked = true; }
        covered[start + k] = 1;
        if (slicer.due()) { yield slicer.done; slicer.resume(); }
      }
      placed[order[o]] = { block, state: masked ? "current-masked" : "current", at: { from: start + 1, to: start + length } };
    } else if (best.length > 0) {
      const places = best.map((j) => starts[j] + 1);
      let near = places[0];
      for (const place of places) { if (Math.abs(place - block.from) < Math.abs(near - block.from)) { near = place; } }
      placed[order[o]] = { block, state: "ambiguous", at: { from: near, to: near + length - 1 }, candidates: places };
    } else {
      // Changed. Its marker: where the code is with white space at line ends ignored, else the recorded lines clipped.
      const last = Math.max(total, 1);
      const from = Math.min(Math.max(block.from, 1), last);
      const changed: Placed = { block, state: "changed", at: { from, to: Math.min(Math.max(block.to, from), last) } };
      // Design: "differs only in spaces at line ends" is said of code that is nowhere exactly. A block whose exact
      // code is in the text but fits the order nowhere keeps its recorded lines and is not called spaces-only.
      if (starts.length === 0 && length > 0) {
        if (!loose) {
          const stripped: string[] = new Array(total);
          for (let i = 0; i < total; i++) {
            stripped[i] = pyRStrip(text[i]);
            if (slicer.due(4)) { yield slicer.done; slicer.resume(); }
          }
          loose = yield* NumberedText.of(note.props, stripped, pyRStrip, slicer);
        }
        const nearly = yield* loose.starts(block, slicer);
        if (nearly.length > 0) {
          changed.at = { from: nearly[0] + 1, to: nearly[0] + length };
          changed.spacesOnly = true;
        }
      }
      placed[order[o]] = changed;
    }
  }

  // Unexplained: non-blank lines outside every block that is current or current-masked.
  const unexplained: [number, number][] = [];
  let open = 0;                                           // the first line of the range being collected, or 0
  for (let i = 0; i < total; i++) {
    const bare = covered[i] === 0 && pyStrip(text[i]) !== "";
    if (bare && open === 0) { open = i + 1; }
    if (!bare && open > 0) { unexplained.push([open, i]); open = 0; }
    if (slicer.due(2)) { yield slicer.done; slicer.resume(); }
  }
  if (open > 0) { unexplained.push([open, total]); }
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
