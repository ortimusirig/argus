import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Creates, Ended, Follow, Lookup, TASK_NAME, afterRun, alreadyRunning, fileHash, fill, findProgram, noteMark, refusal,
  revisionMark, variableIn } from "../core/create";
import { mayStart } from "../core/run";
import { DEFAULT_CREATE_COMMAND } from "../core/settings";

const values = { file: "sub/a.py", notesFolder: "C:\\vault\\P", sourceRoot: "C:\\src", depth: "full" as const };

test("fill: the placeholders are replaced inside each argument, and the arguments are never joined", () => {
  assert.deepEqual(fill(DEFAULT_CREATE_COMMAND, values), ["claude",
    "Use the argus skill. Explain sub/a.py, depth full. Source root: C:\\src. Put the notes in C:\\vault\\P."]);
  assert.deepEqual(fill(["agent", "--file", "${file}", "--to=${notesFolder}", "${depth}${depth}", "${other} $file {file}"], values),
    ["agent", "--file", "sub/a.py", "--to=C:\\vault\\P", "fullfull", "${other} $file {file}"]);
});

test("fill: a value is put in as it is; it is never read again as a placeholder, a pattern or a command", () => {
  const hostile = "a b & echo x | $(id) `id` \"q\" ; %PATH% ${depth} $& $1 $$";
  const filled = fill(["agent", "explain ${file} now", "${file}"], { ...values, file: hostile });
  assert.deepEqual(filled, ["agent", `explain ${hostile} now`, hostile]);
  assert.equal(filled.length, 3, "one argument stays one argument");
});

test("fill: the program is the user's own word, never built from a file name; a value that would start an argument with - cannot be read as an option", () => {
  assert.deepEqual(fill(["${file}", "${file}", "x ${file}"], { ...values, file: "--help" }), ["${file}", "./--help", "x --help"]);
  assert.deepEqual(fill(["agent", "${sourceRoot}"], { ...values, sourceRoot: "-r" }), ["agent", "./-r"]);
});

test("refusal: nothing is started in Restricted Mode, for a document without a path, outside a project, or for a name with a control character", () => {
  const fine = { trusted: true, onDisk: true, file: "sub/a.py" };
  assert.equal(refusal(fine), undefined);
  assert.match(refusal({ ...fine, trusted: false }) ?? "", /Restricted Mode/);
  assert.match(refusal({ ...fine, onDisk: false }) ?? "", /no path on disk/);
  assert.match(refusal({ ...fine, file: undefined }) ?? "", /not in an Argus project/);
  for (const name of ["a\nb.py", "a\rb.py", "a\tb.py", "a\u0000b.py", "a\u001bb.py", "a\u007fb.py", "a\u0085b.py", "a\u2028b.py"]) {
    assert.match(refusal({ ...fine, file: name }) ?? "", /control character|line break/, JSON.stringify(name));
  }
  for (const text of [refusal({ ...fine, trusted: false }), refusal({ ...fine, file: undefined }), refusal({ ...fine, file: "a\nb" })]) {
    assert.match(text ?? "", /nothing was started/);
  }
});

test("variableIn: a path that VS Code's task runner would read as a variable is found, so nothing is started with it", () => {
  assert.equal(variableIn(values), undefined);
  assert.equal(variableIn({ ...values, file: "$ {x} $x {y} a$b" }), undefined);
  for (const hostile of ["${command:workbench.action.terminal.kill}.py", "sub/${env:SECRET_TOKEN}/a.py", "${input:x}", "a${", "${workspaceFolder}"]) {
    for (const name of ["file", "notesFolder", "sourceRoot"] as const) {
      const said = variableIn({ ...values, [name]: hostile });
      assert.match(said ?? "", /nothing was started/, `${name} ${hostile}`);
      assert.ok((said ?? "").includes("${"));
    }
  }
});

function lookup(windows: boolean, files: string[], env: Record<string, string | undefined>): Lookup & { asked: string[] } {
  const asked: string[] = [];
  const have = new Set(files.map((f) => windows ? f.toLowerCase() : f));
  return { windows, env, asked, isFile: async (file) => { asked.push(file); return have.has(windows ? file.toLowerCase() : file); } };
}

test("findProgram: a name is looked up on PATH, in its order; a full path is taken as it is", async () => {
  const posix = lookup(false, ["/usr/bin/claude", "/opt/bin/claude", "/opt/tools/agent"], { PATH: "/opt/bin:/usr/bin" });
  assert.deepEqual(await findProgram("claude", posix), { path: "/opt/bin/claude" });
  assert.deepEqual(await findProgram("/opt/tools/agent", posix), { path: "/opt/tools/agent" });
  const missing = await findProgram("codex", posix);
  assert.ok("problem" in missing);
  assert.match(missing.problem, /could not start 'codex'.*argus\.createCommand/);
  const gone = await findProgram("/opt/tools/none", posix);
  assert.ok("problem" in gone && /argus\.createCommand/.test(gone.problem));
});

test("findProgram on Windows: PATHEXT, letter case of the variable names, and the name as written when it has an ending", async () => {
  const win = lookup(true, ["C:\\Tools\\claude.exe", "C:\\Other\\claude.exe", "C:\\Tools\\py.com", "D:\\x\\agent.exe"],
    { Path: "C:\\Empty;C:\\Tools;C:\\Other", PathExt: ".COM;.EXE;.BAT;.CMD" });
  assert.deepEqual(await findProgram("claude", win), { path: "C:\\Tools\\claude.exe" });
  assert.deepEqual(await findProgram("claude.exe", win), { path: "C:\\Tools\\claude.exe" });
  assert.deepEqual(await findProgram("py", win), { path: "C:\\Tools\\py.com" });
  assert.deepEqual(await findProgram("D:\\x\\agent", win), { path: "D:\\x\\agent.exe" });
  assert.deepEqual(await findProgram("D:/x/agent.exe", win), { path: "D:\\x\\agent.exe" });
  assert.ok("problem" in await findProgram("nothing", win));
  // No PATHEXT at all: the system's usual endings.
  assert.deepEqual(await findProgram("claude", lookup(true, ["C:\\Tools\\claude.exe"], { PATH: "C:\\Tools" })), { path: "C:\\Tools\\claude.exe" });
});

test("findProgram: the workspace cannot supply the program: no relative path, no relative PATH entry, never the current folder", async () => {
  for (const windows of [false, true]) {
    const sep = windows ? "\\" : "/";
    const here = lookup(windows, [`tools${sep}agent`, "agent", `.${sep}agent`, "agent.exe", `.${sep}agent.exe`, `bin${sep}agent`, `bin${sep}agent.exe`],
      { PATH: windows ? ".;bin;;" : ".:bin::" });
    for (const program of [`tools${sep}agent`, `.${sep}agent`, "tools/agent", `..${sep}agent`]) {
      const found = await findProgram(program, here);
      assert.ok("problem" in found, program);
      assert.match(found.problem, /full path/);
    }
    assert.ok("problem" in await findProgram("agent", here), "relative PATH entries are not searched");
    assert.deepEqual(here.asked.filter((file) => !(windows ? /^[A-Za-z]:\\/ : /^\//).test(file)), [], "no relative path was even asked of the disk");
  }
});

test("findProgram on Windows: a batch file is refused, because Windows hands its arguments to a command shell", async () => {
  const win = lookup(true, ["C:\\npm\\claude.cmd", "C:\\b\\run.bat", "C:\\b\\Tool.CMD"], { PATH: "C:\\npm;C:\\b", PATHEXT: ".COM;.EXE;.BAT;.CMD" });
  for (const program of ["claude", "claude.cmd", "run", "C:\\b\\run.bat", "C:\\b\\tool"]) {
    const found = await findProgram(program, win);
    assert.ok("problem" in found, program);
    assert.match(found.problem, /batch file.*argus\.createCommand/, program);
  }
  // On other systems `.cmd` is a name like any other.
  assert.deepEqual(await findProgram("x.cmd", lookup(false, ["/b/x.cmd"], { PATH: "/b" })), { path: "/b/x.cmd" });
});

test("findProgram: an empty name, or a name with a NUL, is refused without asking the disk", async () => {
  const any = lookup(false, [], { PATH: "/b" });
  for (const program of ["", "a\u0000b"]) { assert.ok("problem" in await findProgram(program, any)); }
  assert.deepEqual(any.asked, []);
});

test("mayStart: in Restricted Mode no task is started; trusted, the task is handed over once", async () => {
  const started: string[] = [];
  const tasks = { executeTask: (task: string) => { started.push(task); return Promise.resolve(`execution of ${task}`); } };
  assert.equal(mayStart({ isTrusted: false }, tasks, "t1"), undefined);
  assert.deepEqual(started, []);
  assert.equal(await mayStart({ isTrusted: true }, tasks, "t2"), "execution of t2");
  assert.deepEqual(started, ["t2"]);
});

test("Follow: the program's end gives the exit code; a task that is over without it never started the program; one end only", () => {
  const seen: Ended[] = [];
  let f = new Follow((ended) => { seen.push(ended); });
  f.processEnded(0); f.taskEnded(); f.processEnded(1);
  assert.deepEqual(seen, [{ how: "exit", code: 0 }]);
  f = new Follow((ended) => { seen.push(ended); });
  f.taskEnded(); f.taskEnded(); f.processEnded(0);
  assert.deepEqual(seen, [{ how: "exit", code: 0 }, { how: "no-process" }]);
  f = new Follow((ended) => { seen.push(ended); });
  assert.equal(f.stop(), true, "stopped before any end: the caller reports the failure itself");
  f.processEnded(0); f.taskEnded();
  assert.equal(seen.length, 2, "a stopped follow tells nothing more");
  f = new Follow((ended) => { seen.push(ended); });
  f.processEnded(undefined);
  assert.equal(f.stop(), false, "it had ended already");
  assert.deepEqual(seen[2], { how: "exit", code: undefined });
});

test("afterRun: the completion rules in the design's order", () => {
  const exit = (code: number | undefined): Ended => ({ how: "exit", code });
  const none = afterRun({ how: "no-process" }, "C:\\Tools\\claude.exe", "", "m1", false);
  assert.equal(none.check, false);
  assert.match(none.say ?? "", /did not run: the task ended without starting the program.*claude\.exe.*argus\.createCommand/);
  for (const code of [1, 2, -1, undefined]) {
    const failed = afterRun(exit(code), "claude", "", "m1", false);     // a note was written, and still it is an error
    assert.equal(failed.check, false);
    assert.match(failed.say ?? "", /stopped with an error/);
    assert.ok((failed.say ?? "").includes(`'${TASK_NAME}'`), "it names the terminal that holds the output");
  }
  for (const [before, after] of [["", ""], ["m1", "m1"], ["m1", ""]]) {
    assert.deepEqual(afterRun(exit(0), "claude", before, after, false), { check: false, say: "the agent finished without writing the note" });
  }
  assert.deepEqual(afterRun(exit(0), "claude", "", "m1", false), { check: true });
  assert.deepEqual(afterRun(exit(0), "claude", "m1", "m2", false), { check: true });
  const edited = afterRun(exit(0), "claude", "m1", "m2", true);
  assert.equal(edited.check, true);
  assert.match(edited.say ?? "", /changed on disk while the agent ran/);
});

test("noteMark: the File notes of a file by path and text; no note is the empty mark; the order does not count", () => {
  const a = { path: "/n/A.md", text: "one" }, b = { path: "/n/B.md", text: "two" };
  assert.equal(noteMark([]), "");
  assert.equal(noteMark([a, b]), noteMark([b, a]));
  assert.notEqual(noteMark([a]), "");
  assert.notEqual(noteMark([a]), noteMark([{ ...a, text: "one " }]));
  assert.notEqual(noteMark([a]), noteMark([{ ...a, path: "/n/C.md" }]));
  assert.notEqual(noteMark([a]), noteMark([a, b]));
  // A path that holds what could be read as a second entry is still one entry.
  assert.notEqual(noteMark([{ path: "x\",\"y", text: "t" }]), noteMark([{ path: "x", text: "t" }, { path: "y", text: "t" }]));
  assert.ok(noteMark([{ path: "/n/A.md", text: "x".repeat(5_000_000) }]).length < 200, "a mark is small, whatever the note");
  assert.equal(revisionMark([{ id: 2, revision: 9 }, { id: 1, revision: 4 }]), revisionMark([{ id: 1, revision: 4 }, { id: 2, revision: 9 }]));
  assert.notEqual(revisionMark([{ id: 1, revision: 4 }]), revisionMark([{ id: 1, revision: 5 }]));
  assert.notEqual(revisionMark([{ id: 1, revision: 4 }]), revisionMark([]));
});

test("fileHash: the bytes on disk; undefined for a file that is not there", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-create-"));
  try {
    const file = path.join(tmp, "a.py");
    fs.writeFileSync(file, "x = 1\r\n");
    const first = await fileHash(file);
    assert.equal(first, await fileHash(file));
    fs.writeFileSync(file, "x = 1\n");
    assert.notEqual(await fileHash(file), first, "a change of line endings only is a change on disk");
    assert.equal(await fileHash(path.join(tmp, "none.py")), undefined);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("Creates: a second click while one runs starts no second run, for the same file or for another", () => {
  const runs = new Creates();
  const run = runs.begin("P", "a.py");
  assert.ok(run);
  assert.equal(runs.begin("P", "a.py"), undefined);
  assert.equal(runs.begin("P", "b.py"), undefined);
  assert.equal(runs.begin("Q", "a.py"), undefined);
  assert.equal(runs.running(), run);
  assert.match(alreadyRunning(run), /already.*a\.py/);
  for (const phase of ["running", "ending"] as const) {
    runs.move(run, phase);
    assert.equal(runs.begin("P", "a.py"), undefined, phase);
  }
  runs.finish(run);
  assert.equal(runs.running(), undefined);
  const next = runs.begin("P", "b.py");
  assert.ok(next && next !== run);
});

test("Creates: what a run says is shown for its own file of its own project only", () => {
  const runs = new Creates();
  const run = runs.begin("P", "a.py");
  assert.ok(run);
  const mark = (): string => "m";
  assert.deepEqual(runs.status("P", "a.py", mark), { running: true, text: "starting the agent…" });
  for (const [project, file] of [["P", "b.py"], ["Q", "a.py"], ["P", "A.py"], ["P", "__proto__"]]) {
    assert.equal(runs.status(project, file, mark), undefined, `${project} ${file}`);
  }
  runs.move(run, "running");
  assert.match(runs.status("P", "a.py", mark)?.text ?? "", new RegExp(`agent running in the terminal '${TASK_NAME}'; answer it there if it asks`));
  runs.move(run, "ending");
  assert.equal(runs.status("P", "a.py", mark)?.running, true);
  runs.finish(run, { text: "the agent finished without writing the note", mark: "m" });
  assert.deepEqual(runs.status("P", "a.py", mark), { running: false, text: "the agent finished without writing the note" });
  assert.equal(runs.status("P", "b.py", mark), undefined);
  assert.equal(runs.status("Q", "a.py", mark), undefined);
});

test("Creates: an ended run's sentence goes when the file's notes change, at a new run, and with its project", () => {
  const runs = new Creates();
  let run = runs.begin("P", "a.py");
  assert.ok(run);
  runs.finish(run, { text: "ended", mark: "m1" });
  let asked = 0;
  assert.equal(runs.status("P", "b.py", () => { asked++; return "m1"; }), undefined);
  assert.equal(asked, 0, "the mark is asked for only when there is a sentence to keep or drop");
  assert.equal(runs.status("P", "a.py", () => "m1")?.text, "ended");
  assert.equal(runs.status("P", "a.py", () => "m2"), undefined, "a note of the file was written, changed or deleted since");
  assert.equal(runs.status("P", "a.py", () => "m1"), undefined, "and it does not come back");

  run = runs.begin("P", "a.py");
  assert.ok(run);
  runs.finish(run, { text: "first", mark: "m" });
  run = runs.begin("P", "a.py");
  assert.ok(run);
  assert.equal(runs.status("P", "a.py", () => "m")?.text, "starting the agent…", "a new run takes the old sentence away");
  runs.finish(run);
  assert.equal(runs.status("P", "a.py", () => "m"), undefined);

  run = runs.begin("Q", "a.py");
  assert.ok(run);
  runs.finish(run, { text: "of Q", mark: "m" });
  runs.settings((project) => project === "P");
  assert.equal(runs.status("Q", "a.py", () => "m"), undefined, "the project left the settings");
});

test("Creates: a run whose project left the settings is not shown and leaves no sentence, but still keeps a second run from starting", () => {
  const runs = new Creates();
  const run = runs.begin("P", "a.py");
  assert.ok(run);
  runs.move(run, "running");
  assert.equal(runs.live(run), true);
  runs.settings((project) => project === "P");
  assert.equal(runs.live(run), true, "its project is still there");
  runs.settings(() => false);
  assert.equal(runs.live(run), false);
  assert.equal(runs.status("P", "a.py", () => "m"), undefined);
  assert.equal(runs.begin("P", "a.py"), undefined, "the agent is still in its terminal");
  runs.settings((project) => project === "P");
  assert.equal(runs.live(run), false, "a project that comes back is not the one the run was started for");
  runs.finish(run, { text: "late result", mark: "m" });
  assert.equal(runs.status("P", "a.py", () => "m"), undefined, "its result is shown nowhere");
  assert.ok(runs.begin("P", "a.py"));
});

test("Creates: a run that is over, or was cleared at shutdown, changes nothing any more", () => {
  const runs = new Creates();
  const old = runs.begin("P", "a.py");
  assert.ok(old);
  runs.finish(old);
  const now = runs.begin("P", "b.py");
  assert.ok(now);
  assert.equal(runs.live(old), false);
  runs.move(old, "ending");
  runs.finish(old, { text: "stale", mark: "m" });
  assert.equal(runs.running(), now, "the old run's end does not end the new run");
  assert.equal(runs.status("P", "a.py", () => "m"), undefined);
  assert.deepEqual(runs.status("P", "b.py", () => "m"), { running: true, text: "starting the agent…" });
  runs.clear();
  assert.equal(runs.live(now), false);
  assert.equal(runs.running(), undefined);
  runs.finish(now, { text: "after shutdown", mark: "m" });
  assert.equal(runs.status("P", "b.py", () => "m"), undefined);
});

test("Creates: many ended sentences are looked up at once, and a file named like a property of Object is a file like any other", () => {
  const runs = new Creates();
  for (let i = 0; i < 20000; i++) {
    const run = runs.begin("P", `f${i}.py`);
    assert.ok(run);
    runs.finish(run, { text: `ended ${i}`, mark: "m" });
  }
  for (const name of ["__proto__", "constructor", "toString"]) {
    assert.equal(runs.status("P", name, () => "m"), undefined);
    const run = runs.begin("P", name);
    assert.ok(run);
    runs.finish(run, { text: `ended ${name}`, mark: "m" });
    assert.equal(runs.status("P", name, () => "m")?.text, `ended ${name}`);
  }
  const start = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) { assert.equal(runs.status("P", `f${i}.py`, () => "m")?.text, `ended ${i}`); }
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 500);
  assert.equal(runs.status("P", "f1.py\nx", () => "m"), undefined);
});
