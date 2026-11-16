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

/** What the POSIX rules read from a disk. Tests give a disk that is not there. */
export interface PosixDisk {
  /** What is written in the symbolic link at this path, whether or not it exists; undefined when the path is no
   *  link, or is not there. The path given has no link before its last component. */
  link(file: string): string | undefined;
  isFile(file: string): boolean;
}

/** The real path on a POSIX system, read one component at a time as the file system reads it, and as Python's
 *  (base / rel).resolve() does: a symbolic link is replaced by what is written in it (from the root, or from the
 *  link's folder) whether or not that exists; a `..` goes up from where the components before it have led; a name
 *  that is not on disk is kept as written (a file not saved yet).
 *  No count of links is a limit. A link is read once: where it leads is kept, and a path that meets it again goes
 *  there at once. Throws when the links lead round in a circle: a link is met while it is itself being resolved. */
function posixReal(full: string, link: (file: string) => string | undefined): string {
  // The components still to read, the next one last. Where a link's own components end, the link is written down
  // instead of a component: all before it are read, so the path reached is where the link leads.
  const left: (string | { resolved: string })[] = full.split("/").reverse();
  const leads = new Map<string, string | undefined>();     // each link met: where it leads; undefined while it is being resolved
  let at = "";                                             // the real path so far; "" is the root
  while (left.length > 0) {
    const name = left.pop() as string | { resolved: string };
    if (typeof name !== "string") { leads.set(name.resolved, at); continue; }
    if (name === "" || name === ".") { continue; }
    if (name === "..") { at = at.slice(0, at.lastIndexOf("/")); continue; }
    const here = at + "/" + name;
    if (leads.has(here)) {
      const known = leads.get(here);
      if (known === undefined) { throw new Error(`symbolic links lead round in a circle at '${here}', in '${full}'`); }
      at = known;
      continue;
    }
    const target = link(here);
    if (target === undefined) { at = here; continue; }
    leads.set(here, undefined);
    left.push({ resolved: here });
    if (target.startsWith("/")) { at = ""; }
    const parts = target.split("/");
    for (let k = parts.length - 1; k >= 0; k--) { left.push(parts[k]); }
  }
  return at || "/";
}

/** The POSIX rules over the disk given. A path that does not begin at the root is read from `folder`. */
export function posixRules(disk: PosixDisk, folder: () => string = () => "/"): PathRules {
  return {
    windows: false,
    real: (file) => posixReal(file.startsWith("/") ? file : folder() + "/" + file, (at) => disk.link(at)),
    isFile: (file) => disk.isFile(file),
  };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const posixSystem = posixRules({
  link(file: string): string | undefined {
    try {
      return fs.lstatSync(file).isSymbolicLink() ? fs.readlinkSync(file) : undefined;
    } catch {
      return undefined;      // not there, or not to be read: the name stays as written
    }
  },
  isFile,
}, () => process.cwd());

/** The rules of the system the extension runs on. */
export const systemRules: PathRules = {
  windows: process.platform === "win32",
  real(file: string): string {
    if (process.platform !== "win32") { return posixSystem.real(file); }
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
  isFile,
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
  try {
    return inside(rules.real(root), rules.real(filePath), rules);
  } catch {
    return undefined;      // links that do not end: the path is nowhere
  }
}

/** The project whose `sourceRoot` contains the file, the longest root first; undefined when none does. */
export function projectFor<P extends Project>(filePath: string, projects: readonly P[], rules: PathRules = systemRules): P | undefined {
  let best: P | undefined, longest = -1;
  try {
    const file = rules.real(filePath);
    for (const project of projects) {
      let root: string;
      try { root = rules.real(project.sourceRoot); } catch { continue; }      // a root that is nowhere holds no file
      if (root.length > longest && inside(root, file, rules) !== undefined) { best = project; longest = root.length; }
    }
  } catch {
    return undefined;      // links that do not end: the file is nowhere
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
