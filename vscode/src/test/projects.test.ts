import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PathRules, Project, projectFor, relativeIn, sourceInRoot, systemRules } from "../core/projects";

function project(sourceRoot: string): Project {
  return { sourceRoot, notesFolder: sourceRoot + "-notes" };
}

/** Path rules of one system without a disk: every path is its own real path; `files` are the files that exist. */
function rules(windows: boolean, files: string[] = []): PathRules {
  const p = windows ? path.win32 : path.posix;
  const key = (file: string) => (windows ? p.resolve(file).toLowerCase() : p.resolve(file));
  const known = new Set(files.map(key));
  return { windows, real: (file) => p.resolve(file), isFile: (file) => known.has(key(file)) };
}

test("Windows paths: letter case and the two slashes do not matter; the longest root wins", () => {
  const win = rules(true);
  const app = project("c:/work/app"), src = project("C:\\Work\\App\\src"), other = project("D:\\Work\\App");
  assert.equal(projectFor("C:\\Work\\App\\src\\a.py", [app, src, other], win), src);
  assert.equal(projectFor("C:\\Work\\App\\src\\a.py", [src, app, other], win), src);
  assert.equal(projectFor("c:/WORK/app/SRC/deep/a.py", [app, src, other], win), src);
  assert.equal(projectFor("C:\\Work\\App\\main.py", [app, src, other], win), app);
  assert.equal(projectFor("C:\\Work\\Application\\main.py", [app, src, other], win), undefined);   // a name that only starts alike
  assert.equal(projectFor("E:\\Work\\App\\main.py", [app, src, other], win), undefined);
  assert.equal(projectFor("C:\\Work\\App\\src\\..\\..\\Else\\a.py", [app, src], win), undefined);
  assert.equal(projectFor("C:\\Work\\App\\src\\..\\a.py", [app, src], win), app);
  assert.equal(projectFor("C:\\Work\\App", [app], win), undefined);                                // the root itself is no file in it
  assert.equal(relativeIn("c:/work/app", "C:\\Work\\App\\src\\Deep\\a.py", win), "src/Deep/a.py");
  assert.equal(relativeIn("c:/work/app", "C:\\Work\\Other\\a.py", win), undefined);
});

test("POSIX paths: letter case matters", () => {
  const posix = rules(false);
  const app = project("/work/app"), src = project("/work/app/src");
  assert.equal(projectFor("/work/app/src/a.py", [app, src], posix), src);
  assert.equal(projectFor("/work/app/main.py", [app, src], posix), app);
  assert.equal(projectFor("/work/App/main.py", [app, src], posix), undefined);
  assert.equal(projectFor("/work/application/main.py", [app, src], posix), undefined);
  assert.equal(projectFor("/work/app/src/../../else/a.py", [app, src], posix), undefined);
  assert.equal(projectFor("/work/app/..data/a.py", [app], posix), app);                            // a name that starts with two dots
  assert.equal(relativeIn("/work/app/", "/work/app/src/a.py", posix), "src/a.py");
});

test("sourceInRoot: a .. that stays inside, one that leaves the root, another letter case", () => {
  const win = rules(true, ["C:\\Work\\App\\a.py", "C:\\Work\\App\\sub\\b.py", "C:\\Work\\outside.py"]);
  assert.equal(sourceInRoot("C:\\Work\\App", "a.py", win), "a.py");
  assert.equal(sourceInRoot("C:\\Work\\App", "sub/../a.py", win), "a.py");
  assert.equal(sourceInRoot("C:\\Work\\App", "sub\\b.py", win), "sub/b.py");
  assert.equal(sourceInRoot("C:\\Work\\App", "../outside.py", win), undefined);
  assert.equal(sourceInRoot("C:\\Work\\App", "sub/../../outside.py", win), undefined);
  assert.equal(sourceInRoot("C:\\Work\\App", "SUB/B.PY", win), "SUB/B.PY");        // accepted; a real disk gives its own spelling (below)
  assert.equal(sourceInRoot("C:\\Work\\App", "C:/work/app/a.py", win), "a.py");    // an absolute path inside the root
  assert.equal(sourceInRoot("C:\\Work\\App", "C:\\Work\\outside.py", win), undefined);
  assert.equal(sourceInRoot("C:\\Work\\App", "missing.py", win), undefined);
  assert.equal(sourceInRoot("C:\\Work\\App", "sub", win), undefined);              // a folder is no file
  assert.equal(sourceInRoot("C:\\Work\\App", "", win), undefined);
  const posix = rules(false, ["/work/app/a.py", "/work/app/sub/b.py", "/work/outside.py"]);
  assert.equal(sourceInRoot("/work/app", "sub/../a.py", posix), "a.py");
  assert.equal(sourceInRoot("/work/app", "sub\\b.py", posix), "sub/b.py");         // the checker reads \ as / on every system
  assert.equal(sourceInRoot("/work/app", "../outside.py", posix), undefined);
  assert.equal(sourceInRoot("/work/app", "A.py", posix), undefined);
  assert.equal(sourceInRoot("/work/app", "/work/app/sub/b.py", posix), "sub/b.py");
});

const SOURCES = ["a.py", "sub/../a.py", "sub/b.py", "sub\\b.py", "./sub/./b.py", "../outside.py", "sub/../../outside.py", "A.PY", "SUB/B.py",
  "missing.py", "sub", ".", "sub/b.py/"];

function onDisk(run: (root: string, outside: string) => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-paths-"));
  try {
    const root = path.join(tmp, "Root");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(root, "sub", "b.py"), "y = 2\n");
    fs.writeFileSync(path.join(tmp, "outside.py"), "z = 3\n");
    run(root, path.join(tmp, "outside.py"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("on the disk of this system: real paths, containment, the spelling on disk", () => {
  onDisk((root, outside) => {
    const windows = process.platform === "win32";
    assert.equal(systemRules.windows, windows);
    assert.equal(sourceInRoot(root, "a.py"), "a.py");
    assert.equal(sourceInRoot(root, "sub/../a.py"), "a.py");
    assert.equal(sourceInRoot(root, "sub\\b.py"), "sub/b.py");
    assert.equal(sourceInRoot(root, "../outside.py"), undefined);
    assert.equal(sourceInRoot(root, outside), undefined);
    assert.equal(sourceInRoot(root, path.join(root, "sub", "b.py")), "sub/b.py");
    assert.equal(sourceInRoot(root, "missing.py"), undefined);
    assert.equal(sourceInRoot(root, "sub"), undefined);
    assert.equal(sourceInRoot(root, "A.PY"), windows ? "a.py" : undefined);
    const here = project(root), deeper = project(path.join(root, "sub"));
    assert.equal(projectFor(path.join(root, "sub", "b.py"), [here, deeper]), deeper);
    assert.equal(projectFor(path.join(root, "a.py"), [here, deeper]), here);
    assert.equal(projectFor(path.join(root, "sub", "..", "a.py"), [deeper, here]), here);
    assert.equal(projectFor(path.join(root, "not-yet-saved.py"), [here]), here);     // a file that is not on disk yet
    assert.equal(projectFor(outside, [here, deeper]), undefined);
    assert.equal(relativeIn(root, path.join(root, "sub", "b.py")), "sub/b.py");
    if (windows) {
      assert.equal(projectFor(path.join(root, "SUB", "B.PY").toUpperCase(), [here, deeper]), deeper);
      assert.equal(projectFor(path.join(root, "a.py").replace(/\\/g, "/"), [here]), here);
      assert.equal(relativeIn(root.toUpperCase(), path.join(root, "SUB", "B.PY")), "sub/b.py");
    }
  });
});

const python = spawnSync("python", ["--version"], { encoding: "utf8" });
const noPython = python.error || python.status !== 0 ? "Python ('python') was not found; the parity test with on_disk in _common.py did not run" : false;

test("sourceInRoot gives what on_disk in _common.py gives", { skip: noPython }, () => {
  onDisk((root, outside) => {
    const sources = [...SOURCES, outside, path.join(root, "a.py"), path.join(root, "sub", "b.py")];
    const list = path.join(root, "..", "sources.json");
    fs.writeFileSync(list, JSON.stringify(sources), "utf8");
    const program = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from _common import on_disk",
      "print(json.dumps([on_disk(sys.argv[2], rel) for rel in json.load(open(sys.argv[3], encoding='utf-8'))]))"].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, path.resolve(__dirname, "../../../skills/argus/scripts"), root, list], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as (string | null)[];
    sources.forEach((source, i) => assert.equal(sourceInRoot(root, source) ?? null, answers[i], `source '${source}'`));
    assert.ok(answers.filter((a) => a !== null).length >= 6);
  });
});

/** POSIX rules without a disk where the folders in `links` are symbolic links: `real` follows each link when it
 *  reaches it and only then reads the next component, as the file system does. */
function linked(links: Record<string, string>, files: string[]): PathRules {
  const real = (file: string): string => {
    let at = "";
    for (const name of file.split("/")) {
      if (name === "" || name === ".") { continue; }
      if (name === "..") { at = at.slice(0, at.lastIndexOf("/")); continue; }
      at = links[at + "/" + name] ?? at + "/" + name;
    }
    return at || "/";
  };
  return { windows: false, real, isFile: (file) => files.includes(file) };
}

test("sourceInRoot: a .. after a symbolic link is resolved by the file system, not in the text (POSIX rules)", () => {
  const links = { "/repo/alias": "/repo/sub/deep", "/repo/out": "/elsewhere/deep" };
  const only = linked(links, ["/repo/sub/target.py", "/elsewhere/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", only), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "alias\\..\\target.py", only), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "/repo/alias/../target.py", only), "sub/target.py");   // an absolute source too
  assert.equal(sourceInRoot("/repo", "sub/deep/../target.py", only), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "out/../target.py", only), undefined);                 // the link leads out of the root
  // A file of that name beside the link is not the one the source names.
  const both = linked(links, ["/repo/sub/target.py", "/repo/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", both), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "target.py", both), "target.py");
  const beside = linked(links, ["/repo/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", beside), undefined);
  // The root itself reached through a link.
  assert.equal(sourceInRoot("/repo/alias/..", "target.py", only), "target.py");
});

test("on the disk of this system: a .. after a link to a folder resolves as the system and the checker resolve it", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-link-"));
  try {
    const root = path.join(tmp, "Root");
    fs.mkdirSync(path.join(root, "sub", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "sub", "target.py"), "x = 1\n");
    fs.writeFileSync(path.join(root, "sub", "deep", "inner.py"), "y = 2\n");
    const windows = process.platform === "win32";
    try {
      fs.symlinkSync(path.join(root, "sub", "deep"), path.join(root, "alias"), windows ? "junction" : "dir");
    } catch (error) {
      t.skip(`this system did not let the test create a link to a folder (${(error as Error).message}); the test on disk did not run`);
      return;
    }
    const sources = ["alias/../target.py", "alias/../sub/target.py", "alias/inner.py", "alias/../deep/inner.py", "alias/../missing.py",
      "alias/../../sub/target.py", "alias/./../target.py", "sub/deep/../target.py", "alias/../new/../target.py"];
    // POSIX follows the link and then goes up from where it leads. Windows, and Python on Windows, take `alias\..`
    // out of the path before any link is read.
    const expected = windows
      ? [undefined, "sub/target.py", "sub/deep/inner.py", undefined, undefined, undefined, undefined, "sub/target.py", undefined]
      : ["sub/target.py", undefined, "sub/deep/inner.py", "sub/deep/inner.py", undefined, undefined, "sub/target.py", "sub/target.py", "sub/target.py"];
    sources.forEach((source, i) => assert.equal(sourceInRoot(root, source), expected[i], `source '${source}'`));
    // A file that is not saved yet, named through the link: the folder it will be in is the real one.
    const unsaved = path.join(root, "alias", "..", "unsaved.py");
    assert.equal(relativeIn(root, unsaved), windows ? "unsaved.py" : "sub/unsaved.py");
    assert.equal(projectFor(unsaved, [project(path.join(root, "sub"))])?.sourceRoot, windows ? undefined : path.join(root, "sub"));
    if (noPython) { t.diagnostic(noPython); return; }
    const list = path.join(tmp, "sources.json");
    fs.writeFileSync(list, JSON.stringify(sources), "utf8");
    const program = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from _common import on_disk",
      "print(json.dumps([on_disk(sys.argv[2], rel) for rel in json.load(open(sys.argv[3], encoding='utf-8'))]))"].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, path.resolve(__dirname, "../../../skills/argus/scripts"), root, list], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as (string | null)[];
    sources.forEach((source, i) => assert.equal(sourceInRoot(root, source) ?? null, answers[i], `source '${source}' against on_disk`));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
