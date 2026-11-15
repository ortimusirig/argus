// Path rules: which project a file belongs to, and which file a note's `source` names. No import of "vscode".

import * as fs from "node:fs";
import * as path from "node:path";

export interface Project { sourceRoot: string; notesFolder: string; vaultFolder?: string; graph?: string; }

/** What the rules need from the system. Tests give the rules of the other system, or a disk that is not there. */
export interface PathRules {
  windows: boolean;                 // compare without regard to letter case, and read \ as /
  real(file: string): string;       // the real path: absolute, links followed, in the spelling on disk
  isFile(file: string): boolean;
}

/** The rules of the system the extension runs on. */
export const systemRules: PathRules = {
  windows: process.platform === "win32",
  real(file: string): string {
    const full = path.resolve(file);
    try {
      return fs.realpathSync.native(full);
    } catch {
      // Not on disk (a file not saved yet): the real path of the folder that exists, then the rest as written.
      const parent = path.dirname(full);
      return parent === full ? full : path.join(systemRules.real(parent), path.basename(full));
    }
  },
  isFile(file: string): boolean {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
};

/** The path of `file` relative to `root`, with /, when it lies inside the root; both are real paths already. */
function inside(root: string, file: string, rules: PathRules): string | undefined {
  const p = rules.windows ? path.win32 : path.posix;
  const rel = p.relative(root, file);      // on Windows this compares without regard to letter case
  if (rel === "" || rel === ".." || rel.startsWith(".." + p.sep) || p.isAbsolute(rel)) { return undefined; }
  return rules.windows ? rel.replace(/\\/g, "/") : rel;
}

/** The file's path relative to the root, with /, when its real path lies inside the root's real path. */
export function relativeIn(root: string, filePath: string, rules: PathRules = systemRules): string | undefined {
  return inside(rules.real(root), rules.real(filePath), rules);
}

/** The project whose `sourceRoot` contains the file, the longest root first; undefined when none does. */
export function projectFor<P extends Project>(filePath: string, projects: readonly P[], rules: PathRules = systemRules): P | undefined {
  const file = rules.real(filePath);
  let best: P | undefined, longest = -1;
  for (const project of projects) {
    const root = rules.real(project.sourceRoot);
    if (root.length > longest && inside(root, file, rules) !== undefined) { best = project; longest = root.length; }
  }
  return best;
}

/** The note's `source` resolved against the root: its path relative to the root, with /, when the result is a
 *  file inside the root, whatever its spelling; else undefined. The same rule as `on_disk` in _common.py. */
export function sourceInRoot(root: string, source: string, rules: PathRules = systemRules): string | undefined {
  if (!source) { return undefined; }     // the checker asks only for a `source` that is given
  const p = rules.windows ? path.win32 : path.posix;
  try {
    const base = rules.real(root);
    const file = rules.real(p.resolve(base, source.replace(/\\/g, "/")));
    return rules.isFile(file) ? inside(base, file, rules) : undefined;
  } catch {
    return undefined;
  }
}
