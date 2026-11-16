import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Checks, Memory, Stored, Validity } from "../core/validity";
import { CheckResult, stateOfResult } from "../core/checkResult";

function result(fingerprint: string, over: Partial<CheckResult> = {}): CheckResult {
  return { result: "PASS", exit_code: 0, fingerprint, explained: { "a.py": "N" }, missing: [], fails: [], warns: [], stale: [],
    masked_lines: {}, graph: { used: true, covered: ["a.py"], not_covered: [] }, ...over };
}
function pass(fingerprint: string): ReturnType<typeof stateOfResult> { return stateOfResult(result(fingerprint), "a.py"); }

function memory(): Memory & { all: Map<string, Stored> } {
  const all = new Map<string, Stored>();
  return { all, keys: () => [...all.keys()], get: (key) => all.get(key), set: (key, value) => { if (value) { all.set(key, value); } else { all.delete(key); } } };
}
function label(checks: Checks, key = "a.py"): string {
  const shown = checks.shown(key);
  return "outcome" in shown ? shown.outcome.state : "not checked";
}

test("Validity: a call may be used only while the generation is the one at its start", () => {
  const v = new Validity();
  const first = v.begin();
  assert.ok(v.accept(first));
  v.changed();
  assert.equal(v.accept(first), false);
  const second = v.begin();
  assert.ok(v.accept(second));
  v.changed(); v.changed();
  assert.equal(v.accept(second), false);
  assert.ok(v.accept(v.begin()));
});

test("check starts, input changes, the fingerprint for the new state finishes, the old check finishes last: its pass is not stored", () => {
  const m = memory(), checks = new Checks(m);
  const check = checks.begin();
  checks.changed();
  const print = checks.begin();
  checks.fingerprintDone("a.py", print, "new-state");           // nothing is stored: it neither confirms nor deletes
  assert.equal(checks.checkDone("a.py", check, pass("old-state"), 1), false);
  assert.equal(m.all.size, 0);
  assert.equal(label(checks), "not checked");
});

test("a check for the current generation is stored and shown; a change drops it to not checked until a fingerprint answers", () => {
  const m = memory(), checks = new Checks(m);
  assert.ok(checks.checkDone("a.py", checks.begin(), pass("f1"), 5));
  assert.equal(label(checks), "checked");
  assert.equal(m.all.get("a.py")?.time, 5);
  assert.deepEqual(checks.due(), []);

  checks.changed();
  assert.equal(label(checks), "not checked");
  assert.deepEqual(checks.due(), ["a.py"]);
  checks.fingerprintDone("a.py", checks.begin(), "f1");         // the same fingerprint: still valid
  assert.equal(label(checks), "checked");

  checks.changed();
  checks.fingerprintDone("a.py", checks.begin(), "f2");         // another value: the stored result is deleted
  assert.equal(label(checks), "not checked");
  assert.equal(m.all.size, 0);
  const shown = checks.shown("a.py");
  assert.ok("why" in shown && /changed since the last check/.test(shown.why));
});

test("two fingerprint calls finish in the wrong order: only the one for the current generation counts", () => {
  const m = memory(), checks = new Checks(m);
  checks.checkDone("a.py", checks.begin(), pass("f1"), 1);
  checks.changed();
  const older = checks.begin();
  checks.changed();
  const newer = checks.begin();
  checks.fingerprintDone("a.py", newer, "f1");
  assert.equal(label(checks), "checked");
  checks.fingerprintDone("a.py", older, "f-other");             // an answer for an older generation deletes nothing
  assert.equal(label(checks), "checked");
  assert.equal(m.all.size, 1);

  checks.changed();
  const late = checks.begin();
  checks.changed();
  checks.fingerprintDone("a.py", late, "f1");                   // and confirms nothing
  assert.equal(label(checks), "not checked");
  assert.deepEqual(checks.due(), ["a.py"]);
});

test("a change during a check leaves the state not checked until a call for the current generation answers", () => {
  const m = memory(), checks = new Checks(m);
  checks.checkDone("a.py", checks.begin(), pass("f1"), 1);
  const slow = checks.begin();
  checks.changed();
  assert.equal(checks.checkDone("a.py", slow, pass("f1"), 2), false);
  assert.equal(label(checks), "not checked");
  assert.equal(m.all.get("a.py")?.time, 1, "the slow check's result was thrown away");
  checks.fingerprintDone("a.py", checks.begin(), "f1");
  assert.equal(label(checks), "checked");
});

test("a fingerprint call that fails leaves not checked; a stored result from an earlier session waits for its first answer", () => {
  const m = memory();
  m.set("a.py", { result: result("f1"), time: 1 });
  const checks = new Checks(m);
  assert.equal(label(checks), "not checked");
  assert.deepEqual(checks.due(), ["a.py"]);
  checks.fingerprintDone("a.py", checks.begin(), undefined);
  assert.equal(label(checks), "not checked");
  assert.equal(m.all.size, 1, "a failed call deletes nothing");
  assert.deepEqual(checks.due(), [], "and is not asked again until something changes");
  checks.changed();
  checks.fingerprintDone("a.py", checks.begin(), "f1");
  assert.equal(label(checks), "checked");
});

test("a check error is shown for its generation only, and a failed check is stored like a pass", () => {
  const m = memory(), checks = new Checks(m);
  checks.checkDone("a.py", checks.begin(), { state: "error", reason: "exit code 2" }, 1);
  assert.equal(label(checks), "error");
  assert.equal(m.all.size, 0);
  checks.changed();
  assert.equal(label(checks), "not checked");
  const failed = stateOfResult(result("f3", { result: "NOT PASSED", exit_code: 1, fails: [{ note: "N", graph: false, text: "N: bad" }] }), "a.py");
  checks.checkDone("a.py", checks.begin(), failed, 2);
  assert.equal(label(checks), "failed");
  checks.changed();
  checks.fingerprintDone("a.py", checks.begin(), "f3");
  assert.equal(label(checks), "failed");
});
