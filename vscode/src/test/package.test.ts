import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (file: string): string => fs.readFileSync(path.join(root, file), "utf8");
const pack = JSON.parse(read("package.json"));

test("the package leaves out the sources, the tests, the maps, the tools and earlier packages", () => {
  const ignored = read(".vscodeignore").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  for (const pattern of ["src/**", "out/test/**", "**/*.map", "**/*.ts", "node_modules/**", "**/__pycache__/**", "**/*.pyc", "tsconfig.json",
    "package-lock.json", "**/*.vsix", ".vscodeignore", ".gitignore", ".vscode/**", "**/.env*"]) {
    assert.ok(ignored.includes(pattern), `.vscodeignore does not list ${pattern}`);
  }
  // Nothing is taken back in: a line that starts with ! would put a left-out file into the package again.
  assert.deepEqual(ignored.filter((line) => line.startsWith("!")), []);
  // What the extension needs at run time is not left out.
  for (const needed of ["out/**", "out/core/**", "media/**", "scripts/**", "scripts/*.py", "README.md", "package.json", "**/*.js", "**/*.py"]) {
    assert.ok(!ignored.includes(needed), `.vscodeignore leaves out ${needed}`);
  }
});

test("npm run package: compile, copy the checker, run the tests, then vsce; nothing is published", () => {
  const script: string = pack.scripts.package;
  assert.match(script, /^npm test && vsce package /, "the tests run first (npm test compiles and copies the checker), and a failure stops the package");
  assert.ok(script.includes(`--out argus-${pack.version}.vsix`));
  assert.ok(script.includes("--no-dependencies"), "there are no run-time dependencies to pack");
  assert.match(pack.scripts.test, /^npm run build && /);
  assert.match(pack.scripts.build, /^tsc -p \. && npm run copy-checker$/);
  for (const text of Object.values(pack.scripts) as string[]) { assert.doesNotMatch(text, /vsce publish|ovsx|npm publish|--pat\b/); }
  assert.equal(pack.private, true, "npm never publishes it");
  assert.equal(pack.dependencies, undefined, "no run-time library");
  assert.deepEqual(Object.keys(pack.devDependencies).sort(), ["@types/node", "@types/vscode", "@vscode/vsce", "typescript"], "the plan's four tools and no other");
  assert.equal(pack.version, "3.0.0");
  assert.equal(pack.main, "./out/extension.js");
  assert.ok(fs.existsSync(path.join(root, "out/extension.js")), "the compiled entry point is there");
  for (const file of ["media/panel.js", "media/panel.css", "media/argus.svg", "media/lock.svg"]) { assert.ok(fs.existsSync(path.join(root, file)), file); }
  const ignore = fs.readFileSync(path.resolve(root, "../.gitignore"), "utf8").split(/\r?\n/);
  assert.ok(ignore.includes("vscode/*.vsix"), "a built package is not put under version control");
});

test("every command of package.json is registered, and every registered command is in package.json", () => {
  const listed = (pack.contributes.commands as { command: string }[]).map((c) => c.command).sort();
  const registered = [...read("src/extension.ts").matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(registered, listed);
  assert.doesNotMatch(read("src/extension.ts") + read("src/panel.ts"), /not built yet/, "no command is a stub any more");
  for (const menu of Object.values(pack.contributes.menus) as { command: string }[][]) {
    for (const item of menu) { assert.ok(listed.includes(item.command), item.command); }
  }
});

test("every message the page sends is one the extension handles, and the reverse", () => {
  const sent = [...new Set([...read("media/panel.js").matchAll(/type: "([A-Za-z]+)"/g)].map((m) => m[1]))].sort();
  const handled = [...new Set([...read("src/core/messages.ts").matchAll(/case "([A-Za-z]+)":/g)].map((m) => m[1]))].sort();
  assert.deepEqual(sent, handled);
  assert.deepEqual(sent, ["back", "check", "create", "external", "obsidian", "openNote", "pick", "setup"]);
});

test("the README says what a person needs: install, the settings, the skill, the states, the badges, what is never done", () => {
  const text = read("README.md");
  for (const setting of Object.keys(pack.contributes.configuration.properties)) { assert.ok(text.includes(`\`${setting}\``), setting); }
  for (const word of ["sourceRoot", "notesFolder", "vaultFolder", "graph", "${file}", "${notesFolder}", "${sourceRoot}", "${depth}"]) {
    assert.ok(text.includes(word), word);
  }
  for (const command of pack.contributes.commands as { title: string }[]) { assert.ok(text.includes(command.title), command.title); }
  for (const state of ["current", "changed", "ambiguous", "unexplained"]) { assert.ok(text.includes(state), state); }
  for (const badge of ["checked", "checked; this file is not in the graph", "checked, graph not used", "check failed", "check error", "not checked"]) {
    assert.ok(text.includes(badge), badge);
  }
  for (const word of ["Install from VSIX", "skills/argus", "Restricted Mode", "Marketplace", "batch file", "Obsidian"]) { assert.ok(text.includes(word), word); }
  assert.doesNotMatch(text, /[—]/, "plain punctuation");
});
