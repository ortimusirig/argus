import { test } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PathRules, Project, posixRules, projectFor, relativeIn, sourceInRoot, systemRules } from "../core/projects";

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

// ---------------------------------------------------------------- links read one component at a time

/** The POSIX rules over a disk that is not there: `links` are its symbolic links (the path of each and what is
 *  written in it, whether or not that exists), `files` its files, by their real paths. */
function disk(links: Record<string, string>, files: string[]): PathRules {
  const written = new Map(Object.entries(links));
  return posixRules({ link: (file) => written.get(file), isFile: (file) => files.includes(file) });
}

test("sourceInRoot: a link whose target does not exist is followed all the same (POSIX rules)", () => {
  // The reviewer's case: Python follows the link, lands outside the root, and the checker refuses the source.
  const dangling = disk({ "/repo/alias": "/outside/missing" }, ["/repo/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", dangling), undefined);
  assert.equal(sourceInRoot("/repo", "alias\\..\\target.py", dangling), undefined);
  assert.equal(sourceInRoot("/repo", "/repo/alias/../target.py", dangling), undefined);
  assert.equal(sourceInRoot("/repo", "alias/../repo/target.py", dangling), undefined);        // /outside/repo is not /repo
  assert.equal(sourceInRoot("/repo", "alias/../../repo/target.py", dangling), "target.py");   // back in through the top
  assert.equal(sourceInRoot("/repo", "target.py", dangling), "target.py");
  assert.equal(relativeIn("/repo", "/repo/alias/../unsaved.py", dangling), undefined);
  assert.equal(relativeIn("/outside", "/repo/alias/../unsaved.py", dangling), "unsaved.py");
  // The same link written relative to its folder.
  const relative = disk({ "/repo/alias": "../outside/missing" }, ["/repo/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", relative), undefined);
  // A target that does not exist inside the root: the .. goes up from where the link points.
  const within = disk({ "/repo/alias": "sub/missing" }, ["/repo/target.py", "/repo/sub/target.py"]);
  assert.equal(sourceInRoot("/repo", "alias/../target.py", within), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "alias/target.py", within), undefined);
  // A folder that does not exist and is no link: the .. takes its name out again.
  assert.equal(sourceInRoot("/repo", "new/../target.py", within), "target.py");
});

test("sourceInRoot: a chain of two links, and links that lead back inside the root (POSIX rules)", () => {
  const files = ["/repo/sub/target.py", "/repo/sub/deep/inner.py", "/elsewhere/target.py"];
  const chain = disk({ "/repo/first": "second", "/repo/second": "/repo/sub/deep", "/repo/away": "far", "/repo/far": "/elsewhere/deep" }, files);
  assert.equal(sourceInRoot("/repo", "first/../target.py", chain), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "first/inner.py", chain), "sub/deep/inner.py");
  assert.equal(sourceInRoot("/repo", "away/../target.py", chain), undefined);            // the second link leads out
  // A link whose target is inside the root: accepted, by the real path.
  const inner = disk({ "/repo/alias": "/repo/sub/deep", "/repo/near": "sub/deep", "/repo/sub/up": "..", "/repo/short.py": "sub/target.py",
    "/repo/sub/deep/back": "../../sub" }, files);
  assert.equal(sourceInRoot("/repo", "alias/inner.py", inner), "sub/deep/inner.py");
  assert.equal(sourceInRoot("/repo", "alias/../target.py", inner), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "near/inner.py", inner), "sub/deep/inner.py");      // written relative to the link's folder
  assert.equal(sourceInRoot("/repo", "near/../target.py", inner), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "sub/up/sub/target.py", inner), "sub/target.py");
  assert.equal(sourceInRoot("/repo", "short.py", inner), "sub/target.py");               // a link to a file
  assert.equal(sourceInRoot("/repo", "alias/back/target.py", inner), "sub/target.py");   // a link reached through a link
  assert.equal(sourceInRoot("/repo/alias/..", "target.py", inner), "target.py");         // the root itself through a link
  assert.equal(relativeIn("/repo", "/repo/alias/new.py", inner), "sub/deep/new.py");
  assert.equal(projectFor("/repo/near/inner.py", [project("/repo/sub"), project("/repo/alias")], inner)?.sourceRoot, "/repo/alias");
});

test("sourceInRoot: a path that ends in a circle of links names no file; one that leaves the circle by .. is read on (POSIX rules)", () => {
  const files = ["/repo/target.py", "/repo/sub/target.py"];
  const loop = disk({ "/repo/a": "b", "/repo/b": "/repo/a", "/repo/self": "self", "/repo/deep": "deep/x" }, files);
  // The link in the circle stays as written (see the test of the reviewer's case below): no file is at or below it.
  for (const source of ["a", "a/target.py", "self", "self/target.py", "deep/../target.py", "sub/../a/target.py"]) {
    assert.equal(sourceInRoot("/repo", source, loop), undefined, `source '${source}'`);
  }
  for (const source of ["a/../target.py", "b/../target.py", "self/../target.py", "target.py"]) {
    assert.equal(sourceInRoot("/repo", source, loop), "target.py", `source '${source}'`);
  }
  assert.equal(sourceInRoot("/repo/a", "target.py", loop), undefined);
  // A path that need not be a file: the real path Python gives, the link kept as a name.
  assert.equal(relativeIn("/repo", "/repo/a/x.py", loop), "a/x.py");
  assert.equal(relativeIn("/repo/self", "/repo/target.py", loop), undefined);
  const here = project("/repo"), circle = project("/repo/a");
  assert.equal(projectFor("/repo/self/x.py", [here], loop), here);
  assert.equal(projectFor("/repo/target.py", [circle, here], loop), here);               // a root in a circle holds only what is written below it
});

/** A chain of `n` links in /repo: l0 names l1, l1 names l2, and so on; the last one names the folder `sub`. */
const chain = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [`/repo/l${k}`, k + 1 < n ? `l${k + 1}` : "sub"]));

test("sourceInRoot: a long chain of links that is no circle resolves, as Python's resolve() resolves it (POSIX rules)", () => {
  const files = ["/repo/target.py", "/repo/sub/target.py"];
  // No count of links is a limit: 40, 41 (one more than the system follows in one path) and 1,000 all resolve.
  for (const n of [40, 41, 1000]) {
    const rules = disk(chain(n), files);
    assert.equal(sourceInRoot("/repo", "l0/target.py", rules), "sub/target.py", `a chain of ${n} links`);
    assert.equal(sourceInRoot("/repo", `l${n - 1}/../l0/../target.py`, rules), "target.py", `a chain of ${n} links, entered twice`);
    assert.equal(relativeIn("/repo", "/repo/l0/unsaved.py", rules), "sub/unsaved.py");
    assert.equal(projectFor("/repo/l0/target.py", [project("/repo/sub")], rules)?.sourceRoot, "/repo/sub");
  }
});

test("sourceInRoot: a link met twice in one path, but not while it is being resolved, is no circle (POSIX rules)", () => {
  const files = ["/repo/target.py", "/repo/sub/target.py", "/repo/sub/deep/inner.py"];
  const links = { "/repo/a": "sub", "/repo/twice": "a/../a", "/repo/both": "a/deep/../../a/deep", "/repo/sub/deep/up": "../../a",
    "/repo/left": "a", "/repo/right": "a", "/repo/fork": "left/../right" };
  const rules = disk(links, files);
  assert.equal(sourceInRoot("/repo", "a/../a/target.py", rules), "sub/target.py");               // twice in the path as written
  assert.equal(sourceInRoot("/repo", "twice/target.py", rules), "sub/target.py");                // twice in what one link names
  assert.equal(sourceInRoot("/repo", "both/inner.py", rules), "sub/deep/inner.py");
  assert.equal(sourceInRoot("/repo", "fork/target.py", rules), "sub/target.py");                 // through two links that name it
  assert.equal(sourceInRoot("/repo", "a/deep/up/deep/up/target.py", rules), "sub/target.py");    // back to it through a link below it
  assert.equal(sourceInRoot("/repo", "left/../right/../a/../target.py", rules), "target.py");
});

test("sourceInRoot: a circle of two links and a link to itself are read at once, however they are reached (POSIX rules)", () => {
  const files = ["/repo/target.py", "/repo/sub/target.py"];
  const reads = { count: 0 };
  const links = new Map(Object.entries({ "/repo/a": "b", "/repo/b": "a", "/repo/self": "self", "/repo/self2": "./self2",
    "/repo/in": "sub/../in/x", "/repo/to-circle": "a", ...Object.fromEntries(Object.entries(chain(1000)).map(([k, v]) => [k, v === "sub" ? "a" : v])) }));
  const rules = posixRules({ link: (file) => { reads.count++; return links.get(file); }, isFile: (file) => files.includes(file) });
  const out = ["a", "b", "a/target.py", "self", "self2/target.py", "in/../target.py"];          // at or below a link of a circle: no file
  const back = ["a/../target.py", "self/../target.py", "to-circle/../target.py", "sub/../b/../target.py", "l0/../target.py"];
  for (const source of [...out, ...back]) {
    reads.count = 0;
    const started = performance.now();
    assert.equal(sourceInRoot("/repo", source, rules), back.includes(source) ? "target.py" : undefined, `source '${source}'`);
    const took = performance.now() - started;
    assert.ok(took < 100, `source '${source}': answered after ${took} ms`);
    assert.ok(reads.count < 1100, `source '${source}': the disk was asked ${reads.count} times`);   // l0: 1,000 links, each read once
  }
  assert.equal(sourceInRoot("/repo", "target.py", rules), "target.py");
});

test("a link already resolved is not read again: a long chain costs each of its links once (POSIX rules)", () => {
  const files = ["/repo/sub/target.py"];
  const links = new Map(Object.entries(chain(1000)));
  let reads = 0;
  const rules = posixRules({ link: (file) => { if (links.has(file)) { reads++; } return links.get(file); }, isFile: (file) => files.includes(file) });
  // The whole chain is named 200 times in one path. Followed again each time, that is 200,000 links read.
  const started = performance.now();
  assert.equal(rules.real("/repo/" + "l0/../".repeat(200) + "l0/target.py"), "/repo/sub/target.py");
  const took = performance.now() - started;
  console.log(`timing: a chain of 1,000 links named 200 times in one path resolved in ${took.toFixed(1)} ms, ${reads} links read`);
  assert.ok(reads <= 1200, `${reads} links were read`);
  assert.ok(took < 200, `took ${took} ms`);
});

test("on the disk of this system: a link whose target does not exist, as the system and the checker read it", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argus-dangling-"));
  try {
    const root = path.join(tmp, "Root");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "target.py"), "x = 1\n");
    fs.writeFileSync(path.join(root, "sub", "target.py"), "y = 2\n");
    const windows = process.platform === "win32";
    try {
      fs.symlinkSync(path.join(tmp, "Outside", "missing"), path.join(root, "alias"), windows ? "junction" : "dir");
      fs.symlinkSync(path.join(root, "sub", "missing"), path.join(root, "within"), windows ? "junction" : "dir");
      if (!windows) { fs.symlinkSync("../Outside/missing", path.join(root, "relative"), "dir"); }
    } catch (error) {
      t.skip(`this system did not let the test create a link to a folder that does not exist (${(error as Error).message}); the test on disk did not run`);
      return;
    }
    const sources = ["alias/../target.py", "alias/target.py", "alias", "within/../target.py", "within/target.py", "target.py",
      "new/../target.py", ...(windows ? [] : ["relative/../target.py", "alias/../../Root/target.py"])];
    // POSIX follows the link, though it leads nowhere, and goes up from there. Windows, and Python on Windows, take
    // `alias\..` out of the path before any link is read.
    const expected = windows
      ? ["target.py", undefined, undefined, "target.py", undefined, "target.py", "target.py"]
      : [undefined, undefined, undefined, "sub/target.py", undefined, "target.py", "target.py", undefined, "target.py"];
    sources.forEach((source, i) => assert.equal(sourceInRoot(root, source), expected[i], `source '${source}'`));
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

test("sourceInRoot: a link in a circle is kept as written and the path is read on, as Python's resolve() reads it (POSIX rules)", () => {
  // The reviewer's case: /repo/self names itself. Python 3.13's Path.resolve() (posixpath.realpath, not strict)
  // does not fail there: it keeps /repo/self and reads on, so the .. takes it out again.
  const files = ["/repo/target.py", "/repo/sub/target.py", "/elsewhere/target.py"];
  const self = disk({ "/repo/self": "self" }, files);
  assert.equal(sourceInRoot("/repo", "self/../target.py", self), "target.py");
  assert.equal(sourceInRoot("/repo", "self\\..\\target.py", self), "target.py");
  assert.equal(sourceInRoot("/repo", "/repo/self/../target.py", self), "target.py");
  assert.equal(sourceInRoot("/repo", "self/missing/../../sub/target.py", self), "sub/target.py");   // a name that is not there, after the circle
  assert.equal(sourceInRoot("/repo", "self/target.py", self), undefined);                          // read to the end, but no file
  assert.equal(sourceInRoot("/repo", "self", self), undefined);
  assert.equal(self.real("/repo/self/x.py"), "/repo/self/x.py");
  // A circle of two: the link met while it is being resolved is the one that is kept.
  const two = disk({ "/repo/a": "b", "/repo/b": "/repo/a" }, files);
  assert.equal(sourceInRoot("/repo", "a/../target.py", two), "target.py");
  assert.equal(sourceInRoot("/repo", "b/../target.py", two), "target.py");
  assert.equal(two.real("/repo/a"), "/repo/a");
  assert.equal(two.real("/repo/b"), "/repo/b");
  assert.equal(sourceInRoot("/repo", "sub/../a/target.py", two), undefined);
  // What the link names after the circle is still read: components, and each .. from where they have led.
  const more = disk({ "/repo/deep": "deep/x", "/repo/in": "sub/../in/x", "/repo/up": "up/..", "/repo/out": "out/../../elsewhere" }, files);
  assert.equal(more.real("/repo/deep"), "/repo/deep/x");
  assert.equal(sourceInRoot("/repo", "deep/../target.py", more), undefined);                       // /repo/deep/target.py
  assert.equal(sourceInRoot("/repo", "deep/../../target.py", more), "target.py");
  assert.equal(sourceInRoot("/repo", "in/../target.py", more), undefined);                         // /repo/in/target.py
  assert.equal(sourceInRoot("/repo", "in/../../target.py", more), "target.py");
  assert.equal(sourceInRoot("/repo", "up/target.py", more), "target.py");                          // /repo/up/.. is /repo
  assert.equal(sourceInRoot("/repo", "up/../target.py", more), undefined);                         // /target.py: outside
  assert.equal(sourceInRoot("/repo", "out/target.py", more), undefined);                           // a file, but outside the root
  assert.equal(more.real("/repo/out/target.py"), "/elsewhere/target.py");
});

// ---------------------------------------------------------------- Windows namespaces, as Python's resolve() keeps them

const notWindows = process.platform === "win32" ? false : "this system is not Windows; the test on a Windows disk did not run";
const NS = "\\\\?\\";     // the prefix \\?\ of a path in the Win32 file namespace

test("sourceInRoot: a root and a source of which one has the prefix \\\\?\\ do not meet, as on_disk's do not", { skip: notWindows }, () => {
  onDisk((root) => {
    // The reviewer's two cases. Python's resolve() keeps the prefix of a path that has it, and gives none to a path
    // that has none; a path with the prefix is on another drive (`\\?\C:`) than the same path without it (`C:`).
    assert.equal(sourceInRoot(root, NS + path.join(root, "a.py")), undefined);
    assert.equal(sourceInRoot(NS + root, path.join(root, "a.py")), undefined);
    assert.equal(sourceInRoot(root, NS + path.join(root, "sub", "b.py")), undefined);
    assert.equal(sourceInRoot(NS + root, path.join(root, "sub", "b.py").toUpperCase()), undefined);
    // Both with the prefix, or a source relative to a root that has it: the same namespace.
    assert.equal(sourceInRoot(NS + root, NS + path.join(root, "a.py")), "a.py");
    assert.equal(sourceInRoot(NS + root, "a.py"), "a.py");
    assert.equal(sourceInRoot(NS + root.toUpperCase(), "SUB/B.PY"), "sub/b.py");
    assert.equal(sourceInRoot(root, "a.py"), "a.py");
    // relativeIn and projectFor have no counterpart in the checker; they keep the rule of sourceInRoot.
    assert.equal(relativeIn(root, NS + path.join(root, "a.py")), undefined);
    assert.equal(relativeIn(NS + root, path.join(root, "a.py")), undefined);
    assert.equal(relativeIn(NS + root, NS + path.join(root, "sub", "b.py")), "sub/b.py");
    assert.equal(projectFor(NS + path.join(root, "a.py"), [project(root)]), undefined);
    assert.equal(projectFor(path.join(root, "a.py"), [project(NS + root)]), undefined);
    assert.equal(projectFor(NS + path.join(root, "a.py"), [project(root), project(NS + root)])?.sourceRoot, NS + root);
  });
});

test("sourceInRoot: a root that is itself the file named is '.', as on_disk gives it; to the editor a root holds no such file", () => {
  // Path(root).resolve() and (base / ".").resolve() are one path, it is a file, and relative_to gives ".".
  const win = rules(true, ["C:\\Work\\App\\a.py"]), posix = rules(false, ["/work/app/a.py"]);
  assert.equal(sourceInRoot("C:\\Work\\App\\a.py", ".", win), ".");
  assert.equal(sourceInRoot("C:\\Work\\App\\a.py", "c:/work/app/A.PY", win), ".");
  assert.equal(sourceInRoot("C:\\Work\\App\\a.py", "../a.py", win), ".");
  assert.equal(sourceInRoot("C:\\Work\\App", ".", win), undefined);                 // a folder is no file
  assert.equal(sourceInRoot("/work/app/a.py", ".", posix), ".");
  assert.equal(sourceInRoot("/work/app/a.py", "/work/app/a.py", posix), ".");
  assert.equal(sourceInRoot("/work/app", ".", posix), undefined);
  assert.equal(relativeIn("C:\\Work\\App\\a.py", "C:\\Work\\App\\a.py", win), undefined);
  assert.equal(relativeIn("/work/app/a.py", "/work/app/a.py", posix), undefined);
  assert.equal(projectFor("/work/app/a.py", [project("/work/app/a.py")], posix), undefined);
});

test("Windows paths in text: drives, joins and containment as ntpath and pathlib have them", () => {
  // No disk: `real` gives each path back, so only the text rules are asked. Expected values are Python 3.13's.
  const text: PathRules = { windows: true, real: (file) => file, isFile: () => true };
  const table: [root: string, source: string, expected: string | undefined][] = [
    ["C:\\Work\\App", "\\\\?\\C:\\Work\\App\\a.py", undefined],                       // \\?\C: is another drive than C:
    ["\\\\?\\C:\\Work\\App", "C:\\Work\\App\\a.py", undefined],
    ["\\\\?\\C:\\Work\\App", "C:a.py", undefined],                                    // a source with a drive of its own
    ["C:\\Work\\App", "c:a.py", "a.py"],                                              // the same drive, no root: under the base
    ["C:\\Work\\App", "D:a.py", undefined],
    ["C:\\Work\\App", "/Work/App/a.py", "a.py"],                                      // a root and no drive: the base's drive
    ["C:\\Work\\App", "/a.py", undefined],
    ["\\\\?\\C:\\Work\\App", "\\\\?\\c:\\WORK\\app\\Sub\\a.py", "Sub/a.py"],
    ["\\\\?\\C:\\", "\\\\?\\C:\\Work\\a.py", "Work/a.py"],
    ["\\\\?\\C:\\", "/Work/a.py", "Work/a.py"],
    ["\\\\server\\share\\App", "\\\\?\\UNC\\server\\share\\App\\a.py", undefined],
    ["\\\\?\\UNC\\server\\share\\App", "\\\\server\\share\\App\\a.py", undefined],
    ["\\\\?\\UNC\\server\\share\\App", "\\\\?\\unc\\SERVER\\share\\app\\a.py", "a.py"],
    ["\\\\server\\share", "a.py", "a.py"],
    ["\\\\server\\share\\App", "\\\\server\\other\\App\\a.py", undefined],
    ["\\\\.\\C:\\Work\\App", "C:\\Work\\App\\a.py", undefined],                       // in text; on disk both resolve to C:\…
    ["C:\\Work\\App", "C:\\Work\\App\\x:s", "./x:s"],                                 // a first name that reads as a drive
    ["C:\\Work\\App", "sub/x:s", "sub/x:s"],
    ["C:\\Work\\App", "x:s", undefined],                                              // drive x:
    ["C:\\Work\\App\\", "./sub//b.py/", "sub/b.py"],
    ["C:/Work/App", "sub/./b.py/.", "sub/b.py"],
  ];
  for (const [root, source, expected] of table) {
    assert.equal(sourceInRoot(root, source, text), expected, `root '${root}' source '${source}'`);
  }
  assert.equal(relativeIn("C:\\Work\\App", "\\\\?\\C:\\Work\\App\\a.py", text), undefined);
  assert.equal(relativeIn("\\\\?\\C:\\Work\\App", "\\\\?\\C:\\Work\\App\\a.py", text), "a.py");
  assert.equal(projectFor("C:\\Work\\App\\a.py", [project("\\\\?\\C:\\Work\\App"), project("c:/work")], text)?.sourceRoot, "c:/work");
});

test("on a Windows disk: every form of root and source that the core once read otherwise than on_disk, with on_disk's answers", { skip: notWindows }, (t) => {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "argus-forms-")));
  try {
    const root = path.join(tmp, "Root"), drive = root.slice(0, 2), below = root.slice(3).replace(/\\/g, "/");
    fs.mkdirSync(path.join(root, "sub", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.py"), "x = 1\n");
    fs.writeFileSync(path.join(root, "sub", "b.py"), "y = 2\n");
    fs.writeFileSync(path.join(root, "sub", "deep", "inner.py"), "z = 3\n");
    fs.writeFileSync(path.join(root, "x"), "w = 4\n");
    let long = "";                                           // a path longer than the 260 characters of a plain Windows path
    while ((root + long).length < 300) { long += (long ? "/" : "") + "d".repeat(40); }
    fs.mkdirSync(path.join(root, long), { recursive: true });
    fs.writeFileSync(path.join(root, long, "f.py"), "v = 5\n");
    const a = path.join(root, "a.py"), device = "\\\\.\\";
    const table: [root: string, source: string, expected: string | null][] = [
      // One has the prefix \\?\, the other has not.
      [root, NS + a, null],
      [NS + root, a, null],
      [root, "//?/" + a.replace(/\\/g, "/"), null],
      [NS + root, a.toUpperCase(), null],
      [root, NS + path.join(root, "sub", "..", "a.py"), null],
      [NS + root, drive + "a.py", null],                     // C:a.py: a drive of its own
      [root, drive.toLowerCase() + "a.py", "a.py"],
      [tmp, NS + a, null],
      [path.join(root, "sub"), NS + path.join(root, "sub", "b.py"), null],
      // The same namespace on both sides.
      [NS + root, "a.py", "a.py"],
      [NS + root, NS + a, "a.py"],
      [NS + root.toUpperCase(), "SUB\\B.PY", "sub/b.py"],
      [NS + root, "sub/../a.py", "a.py"],
      [NS + drive + "\\", NS + a, below + "/a.py"],
      [NS + drive + "\\", root.slice(2) + "\\a.py", below + "/a.py"],
      // \\.\ is no namespace of its own to Python: the real path has no prefix.
      [device + root, "a.py", "a.py"],
      [device + root, a, "a.py"],
      [root, device + a, "a.py"],
      [device + root, NS + a, null],
      // Dots and spaces at the end of a name: the system drops them from a path without \\?\ and keeps them in one with it.
      [root, "a.py.", "a.py"],
      [root, "a.py ", "a.py"],
      [root, "a.py. .", "a.py"],
      [root, "sub./b.py", "sub/b.py"],
      [root, "sub /b.py", "sub/b.py"],
      [root, a + ".", "a.py"],
      [root + ".", "a.py", "a.py"],
      [root + " ", "sub/b.py", "sub/b.py"],
      [root + ".", a, "a.py"],
      [NS + root, "a.py.", null],
      [NS + root + ".", "a.py", null],
      // The root is the file.
      [a, ".", "."],
      [a, a, "."],
      [NS + a, ".", "."],
      [NS + a, a, null],
      [a, "../a.py", "."],
      // A longer path than a plain Windows path may be; the answer depends on the system's setting, so it is
      // asked of the checker below and not written here.
    ];
    const depends: [root: string, source: string][] = [[root, long + "/f.py"], [root, path.join(root, long, "f.py")], [NS + root, long + "/f.py"],
      [NS + root, NS + path.join(root, long, "f.py")], [path.join(root, long), "f.py"], [root, NS + path.join(root, long, "f.py")]];
    try {
      fs.writeFileSync(path.join(root, "x:s"), "a stream\n");
      table.push([root, path.join(root, "x:s"), "./x:s"], [NS + root, NS + path.join(root, "x:s"), "./x:s"], [root, "x:s", null],
        [root, "a.py::$DATA", "a.py"], [NS + root, a + "::$DATA", null]);
    } catch { t.diagnostic("this disk has no named streams; those forms did not run"); }
    try {
      fs.symlinkSync(path.join(root, "sub", "deep"), path.join(root, "alias"), "junction");
      table.push([root, NS + path.join(root, "alias", "inner.py"), null], [NS + root, "alias/inner.py", "sub/deep/inner.py"],
        [NS + path.join(root, "alias"), "inner.py", "inner.py"], [path.join(root, "alias"), NS + path.join(root, "sub", "deep", "inner.py"), null]);
    } catch { t.diagnostic("this system did not let the test create a junction; those forms did not run"); }
    const share = `localhost\\${drive[0]}$${root.slice(2)}`;
    if (fs.existsSync("\\\\" + share)) {
      table.push(["\\\\" + share, NS + "UNC\\" + share + "\\a.py", null], [NS + "UNC\\" + share, "\\\\" + share + "\\a.py", null],
        [NS + "UNC\\" + share, "a.py", "a.py"], [NS + "unc\\" + share.toUpperCase(), NS + "UNC\\" + share + "\\sub\\b.py", "sub/b.py"],
        ["\\\\" + share, "a.py.", "a.py"], ["\\\\" + share, a, null], [root, "\\\\" + share + "\\a.py", null]);
    } else { t.diagnostic(`the share \\\\${share} was not reached; the UNC forms did not run`); }
    for (const [from, source, expected] of table) {
      assert.equal(sourceInRoot(from, source) ?? null, expected, `root '${from}' source '${source}'`);
    }
    // relativeIn and projectFor keep the same rule for a file that is there.
    for (const [from, source, expected] of table) {
      if (!/^([A-Za-z]:[\\/]|\\\\|\/\/)/.test(source) || expected === ".") { continue; }
      assert.equal(relativeIn(from, source) ?? null, expected, `relativeIn: root '${from}' file '${source}'`);
      assert.equal(projectFor(source, [project(from)]) !== undefined, expected !== null, `projectFor: root '${from}' file '${source}'`);
    }
    if (noPython) { t.diagnostic(noPython); return; }
    const all = [...table.map(([from, source]) => [from, source]), ...depends];
    const list = path.join(tmp, "forms.json");
    fs.writeFileSync(list, JSON.stringify(all), "utf8");
    const program = ["import json, sys", "sys.path.insert(0, sys.argv[1])", "from _common import on_disk",
      "print(json.dumps([on_disk(root, rel) for root, rel in json.load(open(sys.argv[2], encoding='utf-8'))]))"].join("\n");
    const out = spawnSync("python", ["-B", "-c", program, path.resolve(__dirname, "../../../skills/argus/scripts"), list], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const answers = JSON.parse(out.stdout) as (string | null)[];
    all.forEach(([from, source], i) => assert.equal(sourceInRoot(from, source) ?? null, answers[i], `root '${from}' source '${source}' against on_disk`));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
