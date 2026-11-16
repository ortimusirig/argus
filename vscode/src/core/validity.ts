// The generation rule: which finished check or fingerprint call may still be used. No import of "vscode".
// Every event that can change what the checker reads moves the generation on; a call that started before it can
// never bring "checked" back after it.

import { CheckResult, Outcome, stateOfResult } from "./checkResult";

export class Validity {
  private generation = 0;
  /** A call starts: the generation it must still find at its end. */
  begin(): number { return this.generation; }
  /** Something the checker reads may have changed. */
  changed(): void { this.generation++; }
  /** Whether a call that started at that generation may be used now. */
  accept(startedAt: number): boolean { return startedAt === this.generation; }
}

/** What is stored for a source file: the result object and the time. */
export interface Stored { result: CheckResult; time: number; }
/** Where the results are kept (the workspace storage), by source path. */
export interface Memory { get(key: string): Stored | undefined; set(key: string, value: Stored | undefined): void; keys(): string[]; }

export type Shown = { outcome: Outcome; time?: number } | { why: string };

/** The stored results of one project and what may be shown of them. A key is a source path inside the root. */
export class Checks {
  private readonly confirmed = new Map<string, number>();      // key: the generation its stored result is valid for
  private readonly failed = new Map<string, number>();         // key: the generation whose fingerprint call failed
  private readonly errors = new Map<string, { at: number; outcome: Outcome }>();
  private readonly why = new Map<string, string>();            // key: why its result went

  constructor(private readonly memory: Memory, private readonly validity = new Validity()) {}

  begin(): number { return this.validity.begin(); }
  changed(): void { this.validity.changed(); }
  accept(startedAt: number): boolean { return this.validity.accept(startedAt); }

  /** A check finished. Its result is stored and shown only when the generation is still the one at its start;
   *  else it is thrown away and false is returned: a call for the current generation is due. */
  checkDone(key: string, startedAt: number, outcome: Outcome, time: number): boolean {
    if (!this.validity.accept(startedAt)) {
      this.why.set(key, "the notes, the code or the settings changed while the check ran; its result was not used");
      return false;
    }
    this.why.delete(key);
    this.failed.delete(key);
    if (outcome.result) {
      this.memory.set(key, { result: outcome.result, time });
      this.confirmed.set(key, startedAt);
      this.errors.delete(key);
    } else {
      this.errors.set(key, { at: startedAt, outcome });
    }
    return true;
  }

  /** A fingerprint call finished; `fingerprint` is undefined when it failed. An answer for an older generation
   *  neither confirms nor deletes anything. */
  fingerprintDone(key: string, startedAt: number, fingerprint: string | undefined): void {
    if (!this.validity.accept(startedAt)) { return; }
    const stored = this.memory.get(key);
    if (!stored) { return; }
    if (fingerprint === undefined) {
      this.failed.set(key, startedAt);
    } else if (fingerprint === stored.result.fingerprint) {
      this.confirmed.set(key, startedAt);
      this.failed.delete(key);
    } else {
      this.memory.set(key, undefined);
      this.confirmed.delete(key);
      this.why.set(key, "something the check reads changed since the last check");
    }
  }

  /** The keys whose stored result waits for a fingerprint answer for the current generation. */
  due(): string[] {
    const now = this.validity.begin();
    return this.memory.keys().filter((key) => this.memory.get(key) !== undefined && this.confirmed.get(key) !== now && this.failed.get(key) !== now).sort();
  }

  /** What the badge may show: an outcome that holds for the current generation, or "not checked" and why. */
  shown(key: string): Shown {
    const now = this.validity.begin();
    const error = this.errors.get(key);
    if (error && error.at === now) { return { outcome: error.outcome }; }
    const stored = this.memory.get(key);
    if (stored) {
      if (this.confirmed.get(key) === now) { return { outcome: stateOfResult(stored.result, key), time: stored.time }; }
      return { why: this.failed.get(key) === now ? "the stored result could not be confirmed: the validity call failed"
        : "the stored result is being confirmed against the notes and the code as they are now" };
    }
    return { why: this.why.get(key) ?? "no check has been run" };
  }
}

/** A Memory over the object that the workspace storage holds for a project (`stored`: results by source path).
 *  `save` is given the whole object again after each change. The results are kept in a Map: a source file named
 *  `__proto__` or `constructor` is a key like any other, which it is not on a plain object. */
export function memoryOf(stored: Record<string, Stored> | undefined, save: (all: Record<string, Stored>) => void): Memory {
  const all = new Map<string, Stored>(Object.entries(stored ?? {}));
  return {
    keys: () => [...all.keys()],
    get: (source) => all.get(source),
    set: (source, value) => {
      if (value) { all.set(source, value); } else { all.delete(source); }
      save(Object.fromEntries(all));
    },
  };
}
