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

/** The real path on a POSIX system, the components kept as written until the file system has read them: a `..`
 *  after a symbolic link goes up from where the link leads, as in Python's (base / rel).resolve(). */
function posixReal(full: string): string {
  try {
    return fs.realpathSync.native(full);
  } catch {
    // Not on disk (a file not saved yet): the real path of what comes before the last component, then that
    // component: `..` goes up from the real folder, a name is added as written.
    let end = full.length;
    while (end > 1 && full[end - 1] === "/") { end--; }
    const cut = full.lastIndexOf("/", end - 1);
    if (end <= 1 || cut < 0) { return full.slice(0, end); }
    const parent = posixReal(cut === 0 ? "/" : full.slice(0, cut)), name = full.slice(cut + 1, end);
    if (name === "" || name === ".") { return parent; }
    return name === ".." ? path.posix.dirname(parent) : path.posix.join(parent, name);
  }
}

/** The rules of the system the extension runs on. */
export const systemRules: PathRules = {
  windows: process.platform === "win32",
  real(file: string): string {
    if (process.platform !== "win32") {
      return posixReal(file.startsWith("/") ? file : process.cwd() + "/" + file);
    }
    // Windows takes `name\..` out of a path before it reads any link, and so does Python there (ntpath.realpath
    // begins with normpath): collapsing in the text first is the system's own rule on Windows.
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
    const written = source.replace(/\\/g, "/");
    // POSIX: the source is joined to the root as written, and `rules.real` reads each `..` after the links before
    // it. Windows collapses `..` in the text before any link is read (see systemRules.real), so there the text is
    // resolved first.
    const joined = rules.windows ? p.resolve(base, written)
      : written.startsWith("/") ? written : base + (base.endsWith("/") ? "" : "/") + written;
    const file = rules.real(joined);
    return rules.isFile(file) ? inside(base, file, rules) : undefined;
  } catch {
    return undefined;
  }
}
