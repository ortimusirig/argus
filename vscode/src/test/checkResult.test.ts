import { test } from "node:test";
import * as assert from "node:assert/strict";
import { CheckResult, badgeOf, detailsOf, fingerprintOf, stateOf } from "../core/checkResult";
import { body } from "../core/panelHtml";
import { parseFileNote } from "../core/notes";

// Recorded results, in the shape check_notes.py --json prints (skill 2.9.2).
function recorded(over: Partial<CheckResult> & Record<string, unknown> = {}): string {
  return JSON.stringify({ result: "PASS", exit_code: 0, scope: ["a.py"], fingerprint: "abc123", notes_checked: ["N", "Other", "P - Start Here"],
    notes_not_checked: [], explained: { "a.py": "N", "b.py": "Other" }, missing: [], fails: [], stale: [], warns: [], infos: [],
    masked_lines: {}, graph: { used: true, covered: ["a.py"], not_covered: ["b.py"] }, ...over }, null, 2);
}

test("a pass with the file covered by the graph is checked", () => {
  const outcome = stateOf(0, recorded(), "a.py");
  assert.equal(outcome.state, "checked");
  assert.equal(outcome.result?.fingerprint, "abc123");
  assert.equal(badgeOf(outcome, "N").label, "checked");
});

test("a pass with the file not covered is checked, not in the graph", () => {
  const outcome = stateOf(0, recorded(), "b.py");
  assert.equal(outcome.state, "checked-not-in-graph");
  assert.equal(badgeOf(outcome, "Other").label, "checked; this file is not in the graph");
});

test("a pass without the graph is checked without graph", () => {
  const outcome = stateOf(0, recorded({ result: "PASS WITHOUT THE GRAPH CHECK", graph: { used: false, covered: [], not_covered: [] } }), "a.py");
  assert.equal(outcome.state, "checked-without-graph");
  const badge = badgeOf(outcome, "N");
  assert.equal(badge.label, "checked, graph not used");
  assert.equal(badge.details?.graph, "graph not used");
});

test("a pass with warnings and masked lines: the details list them, this note first, then the graph, then the others", () => {
  const text = recorded({ masked_lines: { N: [5, 9], Other: [2] }, stale: [{ note: "Other", text: "Other: written at commit abc, source is now at def" }],
    warns: [{ note: "Other", graph: false, text: "Other: no 'commit' property" }, { note: null, graph: true, text: "graph: b.py is not in the graph" },
      { note: "N", graph: false, text: "N: 2 masked lines (5, 9); a person must confirm" }, { note: null, graph: false, text: "folders left out" }] });
  const outcome = stateOf(0, text, "a.py");
  assert.equal(outcome.state, "checked");
  const details = detailsOf(outcome.result as CheckResult, "N");
  assert.equal(details.graph, "the graph covers 1 of 2 explained files");
  assert.deepEqual(details.masked, [5, 9]);
  assert.deepEqual(details.warnings, ["N: 2 masked lines (5, 9); a person must confirm", "graph: b.py is not in the graph", "Other: no 'commit' property", "folders left out"]);
  assert.deepEqual(details.stale, ["Other: written at commit abc, source is now at def"]);
  assert.deepEqual(badgeOf(outcome, "N").details, details, "a success badge always carries the details");
});

test("a failure about this note, one only about the graph, one only about another note: each is check failed, grouped", () => {
  const mine = stateOf(1, recorded({ result: "NOT PASSED", exit_code: 1, fails: [{ note: "N", graph: false, text: "N: block 1 code differs from the source at line 3" }] }), "a.py");
  assert.equal(mine.state, "failed");
  assert.deepEqual(detailsOf(mine.result as CheckResult, "N").fails, { mine: ["N: block 1 code differs from the source at line 3"], graph: [], others: [], missing: [] });

  const graph = stateOf(1, recorded({ result: "NOT PASSED", exit_code: 1, fails: [{ note: null, graph: true, text: "graph: 'run' is in a.py but its note never names it" }] }), "a.py");
  assert.equal(graph.state, "failed");
  assert.deepEqual(detailsOf(graph.result as CheckResult, "N").fails, { mine: [], graph: ["graph: 'run' is in a.py but its note never names it"], others: [], missing: [] });

  const other = stateOf(1, recorded({ result: "NOT PASSED", exit_code: 1, missing: ["c.py"],
    fails: [{ note: "Other", graph: false, text: "Other: no other note links to it" }, { note: null, graph: false, text: "note name used twice: X" }] }), "a.py");
  assert.equal(other.state, "failed");
  assert.equal(badgeOf(other, "N").label, "check failed");
  assert.deepEqual(detailsOf(other.result as CheckResult, "N").fails, { mine: [], graph: [], others: ["Other: no other note links to it", "note name used twice: X"], missing: ["c.py"] });
});

test("broken JSON, exit code 2, a stopped run and results that certify nothing are check errors", () => {
  assert.equal(stateOf(0, "{ \"result\": \"PASS\", ", "a.py").state, "error");
  assert.equal(stateOf(0, "", "a.py").state, "error");
  assert.equal(stateOf(0, "[1, 2]", "a.py").state, "error");
  assert.equal(stateOf(0, JSON.stringify({ result: "PASS", exit_code: 0 }), "a.py").state, "error");
  const two = stateOf(2, "usage: check_notes.py", "a.py");
  assert.equal(two.state, "error");
  assert.match(two.reason ?? "", /exit code 2/);
  assert.equal(stateOf(2, recorded(), "a.py").state, "error", "a pass is not read from a run that ended with another code");
  assert.equal(stateOf(null, recorded(), "a.py").state, "error", "nor from a run that was stopped");
  assert.equal(stateOf(1, recorded(), "a.py").state, "error", "nor when the exit code is not the result's own");
  assert.equal(stateOf(0, recorded({ result: "NOT PASSED" }), "a.py").state, "error");
  assert.equal(stateOf(0, recorded({ result: "PASS", graph: { used: true, covered: [], not_covered: [] } }), "a.py").state, "error",
    "a pass that names this file nowhere certifies nothing about it");
  assert.equal(stateOf(0, recorded({ fails: [{ note: "N" }] as never }), "a.py").state, "error");
  assert.equal(badgeOf(two, "N").label, "check error");
  assert.equal(badgeOf(two, "N").details, undefined);
});

test("fingerprintOf reads only a well-formed answer of a run that ended with 0", () => {
  assert.equal(fingerprintOf(0, '{"fingerprint": "abc"}'), "abc");
  assert.equal(fingerprintOf(1, '{"fingerprint": "abc"}'), undefined);
  assert.equal(fingerprintOf(null, '{"fingerprint": "abc"}'), undefined);
  assert.equal(fingerprintOf(0, '{"fingerprint": 7}'), undefined);
  assert.equal(fingerprintOf(0, "not a folder: x"), undefined);
  assert.equal(fingerprintOf(0, '{"fingerprint": ""}'), undefined);
});

test("the panel shows the check details under the badge, escaped, with the warnings folded when more than three", () => {
  const note = parseFileNote("N", "/n/N.md", "---\ntype: file\nwritten_by: argus\nsource: a.py\ndepth: map\n---\n");
  const view = (text: string, exit = 0): string => body({ kind: "file", file: "a.py", note, noteId: 1, whole: false, linkTo: () => undefined, problems: [],
    badge: badgeOf(stateOf(exit, text, "a.py"), "N") });
  const html = view(recorded({ masked_lines: { N: [5, 9] }, stale: [{ note: "N", text: "N: written at commit abc" }],
    warns: ["one", "two", "three", "<img src=x onerror=alert(1)>"].map((text) => ({ note: null, graph: false, text })) }));
  assert.ok(html.includes("the graph covers 1 of 2 explained files"));
  assert.ok(html.includes("5, 9") && html.includes("confirm each hides a secret and nothing else"));
  assert.ok(html.includes('<details data-fold="warnings">') && html.includes("4 warnings"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;") && !html.includes("<img"));
  assert.ok(html.includes("N: written at commit abc"));
  const few = view(recorded({ warns: [{ note: null, graph: false, text: "only one" }] }));
  assert.ok(few.includes("only one") && !few.includes('data-fold="warnings"'));
  const failed = view(recorded({ result: "NOT PASSED", exit_code: 1, missing: ["c.py"], fails: [{ note: "N", graph: false, text: "N: bad block" },
    { note: null, graph: true, text: "graph: bad" }, { note: "Other", graph: false, text: "Other: bad" }] }), 1);
  assert.ok(failed.includes("check failed"));
  for (const part of ["About this note", "N: bad block", "About the graph", "graph: bad", "About other notes", "Other: bad", "Files without a note", "c.py"]) {
    assert.ok(failed.includes(part), part);
  }
  const error = view("nonsense", 2);
  assert.ok(error.includes("check error") && error.includes("exit code 2"));
});

test("a note named like something every object has (constructor, toString, __proto__) has no masked lines of its own", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const outcome = stateOf(0, recorded({ masked_lines: { N: [5] } }), "a.py");
    assert.deepEqual(badgeOf(outcome, name).details?.masked, [], name);
    assert.ok(body({ kind: "file", file: "a.py", note: parseFileNote(name, "/n.md", "---\ntype: file\nsource: a.py\n---\n"), noteId: 1,
      whole: false, badge: badgeOf(outcome, name), linkTo: () => undefined, problems: [] }).includes("checked"), name);
  }
  // Such a name with masked lines written for it gets exactly those.
  const text = '{"result":"PASS","exit_code":0,"fingerprint":"f","explained":{},"missing":[],"fails":[],"warns":[],"stale":[],'
    + '"masked_lines":{"__proto__":[3],"constructor":[4]},"graph":{"used":true,"covered":["a.py"],"not_covered":[]}}';
  const outcome = stateOf(0, text, "a.py");
  assert.deepEqual(badgeOf(outcome, "__proto__").details?.masked, [3]);
  assert.deepEqual(badgeOf(outcome, "constructor").details?.masked, [4]);
  assert.deepEqual(badgeOf(outcome, "toString").details?.masked, []);
});

test("a pass that validated another note of the same file is no success badge for this note", () => {
  const outcome = stateOf(0, recorded(), "a.py");                 // the checker took note "N" for a.py
  assert.equal(badgeOf(outcome, "N", undefined, "a.py").label, "checked");
  const other = badgeOf(outcome, "n", undefined, "a.py");         // a second note for a.py, picked in the panel
  assert.equal(other.label, "not checked");
  assert.match(other.why ?? "", /'N'/);
  assert.equal(other.details, undefined, "no details of a check that was not of this note");
  // A failure is shown whatever note is picked: it is about the folder.
  const failed = stateOf(1, recorded({ result: "NOT PASSED", exit_code: 1, fails: [{ note: "N", graph: false, text: "N: differs" }] }), "a.py");
  assert.equal(badgeOf(failed, "n", undefined, "a.py").label, "check failed");
});
