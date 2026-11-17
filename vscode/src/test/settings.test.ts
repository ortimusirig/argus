import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_CREATE_COMMAND, DEFAULT_PYTHON, createDepth, projectsFrom, userCommand, userPython } from "../core/settings";

test("the workspace value of argus.createCommand and argus.python is ignored", () => {
  const fromWorkspace = { workspaceValue: ["evil.exe", "now"], workspaceFolderValue: ["worse.exe"], defaultValue: ["other"] };
  assert.deepEqual(userCommand(fromWorkspace), [...DEFAULT_CREATE_COMMAND]);
  assert.deepEqual(userCommand({ ...fromWorkspace, globalValue: ["codex", "explain ${file}"] }), ["codex", "explain ${file}"]);
  assert.equal(userPython({ workspaceValue: "C:/evil/python.exe", workspaceFolderValue: "worse" }), DEFAULT_PYTHON);
  assert.equal(userPython({ workspaceValue: "evil", globalValue: "py" }), "py");
  assert.deepEqual(userCommand(undefined), [...DEFAULT_CREATE_COMMAND]);
  assert.equal(userPython(undefined), DEFAULT_PYTHON);
});

test("a user value of the wrong kind falls back to the extension's own constant", () => {
  assert.deepEqual(userCommand({ globalValue: "claude --go" }), [...DEFAULT_CREATE_COMMAND]);
  assert.deepEqual(userCommand({ globalValue: [] }), [...DEFAULT_CREATE_COMMAND]);
  assert.deepEqual(userCommand({ globalValue: ["claude", 3] }), [...DEFAULT_CREATE_COMMAND]);
  assert.equal(userPython({ globalValue: "" }), DEFAULT_PYTHON);
  assert.equal(userPython({ globalValue: ["python"] }), DEFAULT_PYTHON);
});

test("the defaults are the design's, and package.json documents the same ones", () => {
  assert.equal(DEFAULT_PYTHON, "python");
  assert.equal(DEFAULT_CREATE_COMMAND[0], "claude");
  for (const holder of ["${file}", "${depth}", "${sourceRoot}", "${notesFolder}"]) { assert.ok(DEFAULT_CREATE_COMMAND[1].includes(holder)); }
  const pack = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
  const props = pack.contributes.configuration.properties;
  assert.deepEqual(props["argus.createCommand"].default, [...DEFAULT_CREATE_COMMAND]);
  assert.equal(props["argus.python"].default, DEFAULT_PYTHON);
  assert.deepEqual(pack.capabilities.untrustedWorkspaces.restrictedConfigurations, ["argus.createCommand", "argus.updateCommand", "argus.createModel", "argus.python", "argus.projects"]);
  assert.equal(pack.capabilities.untrustedWorkspaces.supported, "limited");
  assert.equal(pack.dependencies, undefined);
});

test("argus.projects: only whole entries are projects", () => {
  assert.deepEqual(projectsFrom([{ sourceRoot: "C:/src", notesFolder: "C:/notes", vaultFolder: "C:/vault", graph: "C:/g.json", extra: 1 },
    { sourceRoot: "C:/b", notesFolder: "C:/n" }, { sourceRoot: "C:/c" }, { sourceRoot: "", notesFolder: "x" }, "text", null,
    { sourceRoot: "C:/d", notesFolder: "C:/n", vaultFolder: 7, graph: "" }]),
  [{ sourceRoot: "C:/src", notesFolder: "C:/notes", vaultFolder: "C:/vault", graph: "C:/g.json" }, { sourceRoot: "C:/b", notesFolder: "C:/n" },
    { sourceRoot: "C:/d", notesFolder: "C:/n" }]);
  assert.deepEqual(projectsFrom(undefined), []);
  assert.deepEqual(projectsFrom({ sourceRoot: "a", notesFolder: "b" }), []);
});

test("argus.createDepth is map or full", () => {
  assert.equal(createDepth("map"), "map");
  assert.equal(createDepth("full"), "full");
  assert.equal(createDepth("deep"), "full");
  assert.equal(createDepth(undefined), "full");
});
