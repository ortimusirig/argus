import { test } from "node:test";
import * as assert from "node:assert/strict";
import { GitWatch, gitPart } from "../core/gitWatch";

test("gitPart: a path is git's own folder, lies inside it, or has nothing to do with it", () => {
  assert.equal(gitPart("a.py"), "none");
  assert.equal(gitPart("sub/.gitignore"), "none");
  assert.equal(gitPart("sub\\my.git\\x"), "none");
  assert.equal(gitPart(".git"), "itself");
  assert.equal(gitPart("sub/.git"), "itself");
  assert.equal(gitPart(".git/HEAD"), "inside");
  assert.equal(gitPart(".git\\refs\\heads\\main"), "inside");
  assert.equal(gitPart("sub\\.git\\index"), "inside");
});

test("the window started before git init: what git writes is not ignored until its folders are watched", () => {
  const git = new GitWatch();
  // Git was asked when the window started: no repository.
  assert.deepEqual(git.found([]), { replace: false, touch: false });
  assert.equal(git.watched, false);
  assert.deepEqual(git.seen("a.py", "change"), { touch: true, discover: false });

  // git init, a commit: nobody watches HEAD and the refs yet, so the events mean "ask git again".
  assert.deepEqual(git.seen(".git", "create"), { touch: true, discover: true });
  assert.deepEqual(git.seen(".git/HEAD", "create"), { touch: false, discover: true });
  assert.deepEqual(git.seen(".git/refs/heads/main", "change"), { touch: false, discover: true });

  // Git now names its folder: it is watched, and the history that changed unseen is an input change.
  assert.deepEqual(git.found(["/r/.git"]), { replace: true, touch: true });
  assert.equal(git.watched, true);

  // From here the watchers on HEAD and the refs speak for git; the rest of its folder is ignored.
  assert.deepEqual(git.seen(".git/index", "change"), { touch: false, discover: false });
  assert.deepEqual(git.seen(".git/objects/ab/cd", "create"), { touch: false, discover: false });
  assert.deepEqual(git.seen("a.py", "change"), { touch: true, discover: false });
  assert.deepEqual(git.found(["/r/.git"]), { replace: false, touch: false }, "the same answer again changes nothing");
});

test("the first answer of git at the start is no input change; a later one that differs is", () => {
  const git = new GitWatch();
  assert.deepEqual(git.found(["/r/.git"]), { replace: true, touch: false }, "the start asks the fingerprint itself");
  assert.deepEqual(git.found(["/r/.git", "/r/common"]), { replace: true, touch: true });
  assert.deepEqual(git.found(["/r/common", "/r/.git"]), { replace: false, touch: false }, "the order is nothing");
  assert.deepEqual(git.found([]), { replace: true, touch: true }, "the repository went");
  assert.equal(git.watched, false);
});

test("git events seen before the first answer came are not lost", () => {
  const git = new GitWatch();
  assert.deepEqual(git.seen(".git/HEAD", "change"), { touch: false, discover: true });
  assert.deepEqual(git.found(["/r/.git"]), { replace: true, touch: true });
  // Events for a folder git does not know as a repository change nothing the checker reads.
  const none = new GitWatch();
  none.seen(".git/x", "create");
  assert.deepEqual(none.found([]), { replace: false, touch: false });
});

test("git's folder is deleted: its watchers are of no use, git is asked again, and the events count again", () => {
  const git = new GitWatch();
  git.found(["/r/.git"]);
  assert.deepEqual(git.seen(".git", "delete"), { touch: true, discover: true });
  assert.equal(git.watched, false);
  assert.deepEqual(git.seen(".git/HEAD", "create"), { touch: false, discover: true }, "git init again");
  // Git names the same folder as before: the old watchers were on a folder that is gone, so they are set anew.
  assert.deepEqual(git.found(["/r/.git"]), { replace: true, touch: true });
  assert.equal(git.watched, true);
});
