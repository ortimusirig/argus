import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Latest } from "../core/latest";

test("what was asked for after the selection moved is not dropped by the late follow", () => {
  const latest = new Latest();
  latest.moved();                    // the selection changes; the follow waits 200 ms
  latest.asked("pinned", "shown", "notice");   // a CodeLens is clicked within that time
  // the follow runs now
  assert.equal(latest.stale("pinned"), false);
  assert.equal(latest.stale("shown"), false);
  assert.equal(latest.stale("notice"), false);
});

test("what was asked for before the selection moved is dropped by the follow", () => {
  const latest = new Latest();
  latest.asked("pinned", "shown", "notice");
  latest.moved();
  assert.equal(latest.stale("pinned"), true);
  assert.equal(latest.stale("shown"), true);
  assert.equal(latest.stale("notice"), true);
  latest.asked("pinned");
  latest.moved();                    // a new move after the new request: the request is old again
  assert.equal(latest.stale("pinned"), true);
});

test("each kept thing has its own time: a notice after the move stays, older pinned lines go", () => {
  const latest = new Latest();
  latest.asked("pinned");
  latest.moved();
  latest.moved();                    // a second move in the same quiet time
  latest.asked("notice");
  assert.equal(latest.stale("pinned"), true);
  assert.equal(latest.stale("notice"), false);
  assert.equal(latest.stale("shown"), true);     // never asked for: nothing to keep
});
