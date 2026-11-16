// Runs the matcher for documents without ever holding the editor: the text is split into lines in slices, then
// `assign` runs in slices (MatchRuns). No import of "vscode". The panel and the markers share one Matcher.

import { Assignment, MatchRuns, RunKey } from "./match";
import { FileNote } from "./notes";

const SLICE_MS = 2;

/** The lines of a text, cut at each line feed; a carriage return before it stays, and `assign` takes it off.
 *  A generator: it yields after every 2 ms of work. */
export function* splitLines(text: string): Generator<void, string[], void> {
  const lines: string[] = [];
  let at = 0, since = performance.now();
  for (;;) {
    const end = text.indexOf("\n", at);
    if (end < 0) { break; }
    lines.push(text.slice(at, end));
    at = end + 1;
    if ((lines.length & 1023) === 0 && performance.now() - since >= SLICE_MS) { yield; since = performance.now(); }
  }
  lines.push(text.slice(at));
  return lines;
}

/** What the matcher needs of a document. */
export interface Doc { uri: string; version: number; text(): string; }
export interface Published { key: RunKey; assignment: Assignment; }
interface Going { key: RunKey; done: number; }

function same(a: RunKey, b: RunKey): boolean {
  return a.uri === b.uri && a.version === b.version && a.revision === b.revision;
}

export class Matcher {
  private readonly runs: MatchRuns;
  private readonly going = new Map<string, Going>();
  private readonly last = new Map<string, Published>();

  /** `changed` is called when a document has a newly published assignment. `later` runs the next slice after
   *  everything else that waits. */
  constructor(private readonly changed: (uri: string) => void,
    private readonly later: (slice: () => void) => void = (slice) => { setImmediate(slice); }) {
    this.runs = new MatchRuns((slice) => {
      this.later(() => {
        try { slice(); } catch (error) { this.failed(); throw error; }
      });
    });
  }

  /** A run that failed is over: its document is not left "matching". */
  private failed(): void {
    for (const uri of [...this.going.keys()]) {
      if (!this.runs.active(uri)) { this.going.delete(uri); }
    }
  }

  /** Asks for the assignment of this note to this document as it is now. Nothing happens when it is published
   *  already or on its way. A run for an older version or revision stops at its next slice. */
  want(doc: Doc, note: FileNote, revision: number): void {
    const key: RunKey = { uri: doc.uri, version: doc.version, revision };
    const last = this.last.get(doc.uri), going = this.going.get(doc.uri);
    if (going && same(going.key, key)) { return; }
    if (last && same(last.key, key)) {
      if (going) { this.going.delete(doc.uri); this.runs.stop(doc.uri); }
      return;
    }
    const mine: Going = { key, done: 0 };
    this.going.set(doc.uri, mine);
    this.runs.stop(doc.uri);                      // a run for the text before is not needed any more
    const steps = splitLines(doc.text());
    const slice = (): void => {
      if (this.going.get(doc.uri) !== mine) { return; }
      let step: IteratorResult<void, string[]>;
      try { step = steps.next(); } catch (error) { this.going.delete(doc.uri); throw error; }
      if (!step.done) { this.later(slice); return; }
      this.runs.start(key, note, step.value, (assignment) => {
        if (this.going.get(doc.uri) !== mine) { return; }
        this.going.delete(doc.uri);
        this.last.set(doc.uri, { key, assignment });
        this.changed(doc.uri);
      }, (blocksDone) => { mine.done = blocksDone; });
    };
    this.later(slice);
  }

  /** The assignment published last for the document, whatever version it was for: the markers keep it while a
   *  newer one is on its way. */
  published(uri: string): Published | undefined {
    return this.last.get(uri);
  }

  /** The published assignment, when it is for this version of the document and this revision of the note. */
  fresh(uri: string, version: number, revision: number): Assignment | undefined {
    const last = this.last.get(uri);
    return last && last.key.version === version && last.key.revision === revision ? last.assignment : undefined;
  }

  /** While the document is being matched: the number of blocks done. Undefined when no run is going. */
  progress(uri: string): number | undefined {
    return this.going.get(uri)?.done;
  }

  /** The document is closed, or has no note any more. */
  drop(uri: string): void {
    this.going.delete(uri);
    this.last.delete(uri);
    this.runs.stop(uri);
  }
}
