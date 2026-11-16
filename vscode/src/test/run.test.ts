import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkerArgs, mayRun } from "../core/run";
import { fingerprintOf, stateOf } from "../core/checkResult";

const node = process.execPath;

test("mayRun: with isTrusted false nothing is started", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-run-"));
  try {
    const mark = path.join(tmp, "started.txt");
    const program = `require("fs").writeFileSync(${JSON.stringify(mark)}, "x")`;
    assert.equal(mayRun({ isTrusted: false }, node, ["-e", program]), undefined);
    await new Promise((go) => setTimeout(go, 300));
    assert.equal(fs.existsSync(mark), false);
    const ran = await mayRun({ isTrusted: true }, node, ["-e", program]);
    assert.equal(ran?.exit, 0);
    assert.ok(fs.existsSync(mark));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("mayRun: exit code and output; a program that is not there; a run stopped at its time limit", async () => {
  const one = await mayRun({ isTrusted: true }, node, ["-e", "process.stdout.write('out'); process.exit(1)"]);
  assert.deepEqual([one?.started, one?.exit, one?.stdout], [true, 1, "out"]);
  const none = await mayRun({ isTrusted: true }, path.join(os.tmpdir(), "argus-no-such-program.exe"), []);
  assert.deepEqual([none?.started, none?.exit], [false, null]);
  assert.ok(none?.reason);
  const slow = await mayRun({ isTrusted: true }, node, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 });
  assert.equal(slow?.exit, null);
  assert.match(slow?.reason ?? "", /stopped/);
});

test("mayRun: arguments are an argument list, never read by a shell", async () => {
  const hostile = "a.py & echo injected > x | $(whoami) `id` \"quoted\" ; %PATH%";
  const ran = await mayRun({ isTrusted: true }, node, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", hostile]);
  assert.deepEqual(JSON.parse(ran?.stdout ?? "[]"), [hostile]);
});

test("the checker's arguments are the plan's, in its order", () => {
  const project = { sourceRoot: "C:/src", notesFolder: "C:/notes" };
  assert.deepEqual(checkerArgs("C:/ext/scripts/check_notes.py", project, "sub/a.py", "--json"),
    ["-B", "C:/ext/scripts/check_notes.py", "--json", "--notes", "C:/notes", "--source", "C:/src", "--scope", "sub/a.py", "--no-graph"]);
  assert.deepEqual(checkerArgs("c.py", { ...project, vaultFolder: "C:/vault", graph: "C:/g.json" }, "a.py", "--fingerprint"),
    ["-B", "c.py", "--fingerprint", "--notes", "C:/notes", "--source", "C:/src", "--scope", "a.py", "--vault", "C:/vault", "--graph", "C:/g.json"]);
});

test("only mayRun starts a program: no other execFile, no exec, no spawn, no shell, no task start in the source", () => {
  const src = path.resolve(__dirname, "../../src");
  const files = fs.readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.replace(/\\/g, "/").startsWith("test/"));
  assert.ok(files.length >= 15);
  for (const file of files) {
    const text = fs.readFileSync(path.join(src, file), "utf8");
    const name = file.replace(/\\/g, "/");
    assert.equal((text.match(/\bexecFile\(/g) ?? []).length, name === "core/run.ts" ? 1 : 0, `${name}: execFile(`);
    // child_process is imported in one file only, and of it only execFile: so no exec, no spawn, no fork anywhere.
    assert.equal(text.includes("child_process"), name === "core/run.ts", `${name}: child_process`);
    if (name === "core/run.ts") { assert.ok(text.includes('import { execFile } from "node:child_process";')); }
    for (const word of [/shell\s*:\s*true/, /\bexecuteTask\(/, /\bcreateTerminal\(/,/\bfetch\(/, /XMLHttpRequest/, /require\(["']https?["']\)/, /from ["'](node:)?(https?|net|tls|dgram)["']/]) {
      assert.doesNotMatch(text, word, `${name}: ${word}`);
    }
  }
});

const python = spawnSync("python", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "Python ('python') was not found; the run of the real checker was skipped" : false;

test("the real checker, started through mayRun with these arguments, gives a result the extension reads", { skip: noPython }, async () => {
  const checker = path.resolve(__dirname, "../../../skills/argus/scripts/check_notes.py");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-check-"));
  try {
    const project = { sourceRoot: path.join(tmp, "src"), notesFolder: path.join(tmp, "notes") };
    fs.mkdirSync(project.sourceRoot);
    fs.mkdirSync(project.notesFolder);
    fs.writeFileSync(path.join(project.sourceRoot, "a.py"), "x = 1\n");
    const ran = await mayRun({ isTrusted: true }, "python", checkerArgs(checker, project, "a.py", "--json"), { timeoutMs: 120000, maxBuffer: 20 * 1024 * 1024 });
    assert.equal(ran?.exit, 1, ran?.stdout ?? "");
    const outcome = stateOf(ran?.exit ?? null, ran?.stdout ?? "", "a.py");
    assert.equal(outcome.state, "failed");
    assert.deepEqual(outcome.result?.missing, ["a.py"]);
    const print = await mayRun({ isTrusted: true }, "python", checkerArgs(checker, project, "a.py", "--fingerprint"));
    assert.equal(fingerprintOf(print?.exit ?? null, print?.stdout ?? ""), outcome.result?.fingerprint);
    assert.deepEqual(fs.readdirSync(project.notesFolder), [], "the check changes nothing");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
