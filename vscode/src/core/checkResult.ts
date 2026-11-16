// Reads what check_notes.py --json prints and says which validation state it gives. No import of "vscode".
// The checker is the authority on validity; nothing here judges a note.

export interface About { note: string | null; graph?: boolean; text: string; }
export interface CheckResult {
  result: string; exit_code: number; fingerprint: string;
  explained: Record<string, string>; missing: string[];
  fails: About[]; warns: About[]; stale: About[];
  masked_lines: Record<string, number[]>;
  graph: { used: boolean; covered: string[]; not_covered: string[] };
}

export type CheckState = "checked" | "checked-not-in-graph" | "checked-without-graph" | "failed" | "error";
/** `result` is there for every state but "error"; `reason` says why a run is an error. */
export interface Outcome { state: CheckState; result?: CheckResult; reason?: string; }

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function abouts(value: unknown): value is About[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null
    && typeof (item as About).text === "string" && ((item as About).note === null || typeof (item as About).note === "string"));
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The expected object, or undefined when the output is anything else. */
export function parseResult(stdout: string): CheckResult | undefined {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { return undefined; }
  if (!record(data)) { return undefined; }
  const graph = data.graph, masked = data.masked_lines, explained = data.explained;
  if (typeof data.result !== "string" || typeof data.exit_code !== "number" || typeof data.fingerprint !== "string" || data.fingerprint === ""
    || !strings(data.missing) || !abouts(data.fails) || !abouts(data.warns) || !abouts(data.stale)
    || !record(explained) || !Object.values(explained).every((name) => typeof name === "string")
    || !record(masked) || !Object.values(masked).every((lines) => Array.isArray(lines) && lines.every((n) => typeof n === "number"))
    || !record(graph) || typeof graph.used !== "boolean" || !strings(graph.covered) || !strings(graph.not_covered)) {
    return undefined;
  }
  return data as unknown as CheckResult;
}

/** The state a well-formed result gives for the file, in the design's order. Nothing else counts as success. */
export function stateOfResult(result: CheckResult, sourceRel: string): Outcome {
  if (result.exit_code === 1) { return { state: "failed", result }; }
  if (result.exit_code === 0 && result.result === "PASS") {
    if (result.graph.covered.includes(sourceRel)) { return { state: "checked", result }; }
    if (result.graph.not_covered.includes(sourceRel)) { return { state: "checked-not-in-graph", result }; }
    return { state: "error", reason: `the result passes but names ${sourceRel} neither as covered by the graph nor as not covered` };
  }
  if (result.exit_code === 0 && result.result === "PASS WITHOUT THE GRAPH CHECK") { return { state: "checked-without-graph", result }; }
  return { state: "error", reason: `the result '${result.result}' with exit code ${result.exit_code} is not one the extension knows` };
}

/** The state of a finished run: `exit` is null when the program did not start or was stopped. */
export function stateOf(exit: number | null, stdout: string, sourceRel: string): Outcome {
  if (exit === null) { return { state: "error", reason: "the checker did not start, or was stopped before its end" }; }
  if (exit !== 0 && exit !== 1) { return { state: "error", reason: `the checker ended with exit code ${exit}` }; }
  const result = parseResult(stdout);
  if (!result) { return { state: "error", reason: "the checker's output is not the expected result" }; }
  if (result.exit_code !== exit) { return { state: "error", reason: `the checker ended with exit code ${exit} but its result says ${result.exit_code}` }; }
  return stateOfResult(result, sourceRel);
}

/** The value a `--fingerprint` run printed; undefined when the run failed or printed anything else. */
export function fingerprintOf(exit: number | null, stdout: string): string | undefined {
  if (exit !== 0) { return undefined; }
  try {
    const data: unknown = JSON.parse(stdout);
    return record(data) && typeof data.fingerprint === "string" && data.fingerprint !== "" ? data.fingerprint : undefined;
  } catch {
    return undefined;
  }
}

/** The "Check details" block: shown under the badge whenever a result is stored, whatever the badge. */
export interface Details {
  graph: string;                 // "the graph covers N of M explained files", or "graph not used"
  masked: number[];              // the masked lines of this note
  warnings: string[];            // first those about this note, then those about the graph, then the others
  stale: string[];
  fails: { mine: string[]; graph: string[]; others: string[]; missing: string[] };
}

export function detailsOf(result: CheckResult, noteName: string): Details {
  const split = (list: About[]): { mine: string[]; graph: string[]; others: string[] } => ({
    mine: list.filter((item) => item.note === noteName).map((item) => item.text),
    graph: list.filter((item) => item.note !== noteName && item.graph === true).map((item) => item.text),
    others: list.filter((item) => item.note !== noteName && item.graph !== true).map((item) => item.text),
  });
  const warns = split(result.warns);
  const covered = result.graph.covered.length;
  return {
    graph: result.graph.used ? `the graph covers ${covered} of ${covered + result.graph.not_covered.length} explained files` : "graph not used",
    // The note's own entry only: a note named `constructor` or `__proto__` must not get what every object has.
    masked: Object.hasOwn(result.masked_lines, noteName) ? [...result.masked_lines[noteName]] : [],
    warnings: [...warns.mine, ...warns.graph, ...warns.others],
    stale: result.stale.map((item) => item.text),
    fails: { ...split(result.fails), missing: [...result.missing] },
  };
}

const LABEL: Record<CheckState, string> = {
  "checked": "checked",
  "checked-not-in-graph": "checked; this file is not in the graph",
  "checked-without-graph": "checked, graph not used",
  "failed": "check failed",
  "error": "check error",
};

/** The badge of an outcome. Every badge that comes from a result carries the details: a success badge is never
 *  shown without them. */
export function badgeOf(outcome: Outcome, noteName: string, why?: string): { label: string; why?: string; details?: Details } {
  return { label: LABEL[outcome.state], why: outcome.reason ?? why, details: outcome.result ? detailsOf(outcome.result, noteName) : undefined };
}
