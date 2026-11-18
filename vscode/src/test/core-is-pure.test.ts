import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const IMPORTS_VSCODE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)["']vscode["']/;

// The core is reused outside VS Code (version 3.1): no file of src/core may import "vscode".
test("no file of src/core imports vscode", () => {
  const core = path.resolve(__dirname, "../../src/core");
  const files = fs.readdirSync(core, { recursive: true, encoding: "utf8" }).filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  assert.ok(files.length >= 5, `found only ${files.length} files in ${core}`);
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(core, file), "utf8"), IMPORTS_VSCODE, `${file} imports vscode`);
  }
});

test("the test above sees every way of importing", () => {
  for (const line of ['import * as vscode from "vscode";', "import { window } from 'vscode'", 'const v = require("vscode")',
    'const v = await import("vscode")', 'import "vscode";', 'import type { Uri } from "vscode"', 'export { Uri } from "vscode"']) {
    assert.match(line, IMPORTS_VSCODE);
  }
  assert.doesNotMatch('// No import of "vscode".', IMPORTS_VSCODE);
  assert.doesNotMatch('import { x } from "./vscode-like"', IMPORTS_VSCODE);
});
