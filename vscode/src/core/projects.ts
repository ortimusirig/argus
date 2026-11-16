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
 *  there at once.
 *  Links that lead round in a circle are no error, as they are none to resolve() without `strict` (Python 3.13,
 *  posixpath.realpath): a link met while it is itself being resolved is kept as written, as a name that is no link
 *  is, and the components after it are read on, each `..` from there. Whether the path reached is a file, and
 *  inside the root, is asked afterwards by the callers. */
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
      at = leads.get(here) ?? here;                        // being resolved now: a circle, and the link stays as written
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

// ---------------------------------------------------------------- Windows paths, read as Python reads them
//
// The checker's `on_disk` is three steps of Python: Path(root).resolve(), (base / source).resolve(), and
// path.relative_to(base). On Windows each has rules of its own, and Node's differ from them: Node's native real
// path takes the prefix \\?\ off every path, Python keeps it on a path that had it; Node opens every file by a
// \\?\ path, which the system takes as written, Python by the path given, in which the system first drops dots
// and spaces at the end of a name. So the three steps are written here as Python 3.13 has them (ntpath.py and
// pathlib), in text, and the disk is asked only what Python asks it.

const NS = "\\\\?\\";             // a path with this prefix is in the Win32 file namespace: the system reads it as written
const NS_UNC = "\\\\?\\UNC\\";

/** ntpath.splitroot: the drive (`C:`, `\\server\share`, `\\?\C:`, `\\?\UNC\server\share`), the root (one separator
 *  or none) and the rest. */
export function ntSplitRoot(p: string): [string, string, string] {
  const n = p.replace(/\//g, "\\");
  if (n.startsWith("\\")) {
    if (n.startsWith("\\", 1)) {
      const start = n.slice(0, 8).toUpperCase() === NS_UNC ? 8 : 2;
      const first = n.indexOf("\\", start);
      if (first < 0) { return [p, "", ""]; }
      const second = n.indexOf("\\", first + 1);
      if (second < 0) { return [p, "", ""]; }
      return [p.slice(0, second), p.slice(second, second + 1), p.slice(second + 1)];
    }
    return ["", p.slice(0, 1), p.slice(1)];
  }
  if (n.startsWith(":", 1)) {
    return n.startsWith("\\", 2) ? [p.slice(0, 2), p.slice(2, 3), p.slice(3)] : [p.slice(0, 2), "", p.slice(2)];
  }
  return ["", "", p];
}

/** ntpath.join of two paths: a second path with a root, or on another drive, takes the place of the first. */
export function ntJoin(first: string, second: string): string {
  let [drive, root, rest] = ntSplitRoot(first);
  const [drive2, root2, rest2] = ntSplitRoot(second);
  if (root2) {
    if (drive2 || !drive) { drive = drive2; }
    root = root2;
    rest = rest2;
  } else if (drive2 && drive2 !== drive && drive2.toLowerCase() !== drive.toLowerCase()) {
    drive = drive2;
    root = root2;
    rest = rest2;
  } else {
    if (drive2 && drive2 !== drive) { drive = drive2; }      // the same drive in another letter case
    if (rest && !/[\\/]$/.test(rest)) { rest += "\\"; }
    rest += rest2;
  }
  if (rest && !root && drive && !/[:\\/]$/.test(drive)) { return drive + "\\" + rest; }
  return drive + root + rest;
}

/** ntpath.normpath: \ for /, no empty name and no `.`, and each `name\..` taken out in the text, before any link
 *  is read: that is the system's own rule on Windows. */
export function ntNormpath(p: string): string {
  const [drive, root, rest] = ntSplitRoot(p.replace(/\//g, "\\"));
  const names: string[] = [];
  for (const name of rest.split("\\")) {
    if (name === "" || name === ".") { continue; }
    if (name !== "..") { names.push(name); continue; }
    if (names.length > 0 && names[names.length - 1] !== "..") { names.pop(); } else if (!root) { names.push(name); }
  }
  return drive + root || names.length > 0 ? drive + root + names.join("\\") : ".";
}

/** ntpath.isabs (Python 3.13): a path that begins with two separators, or with a drive letter and a separator. */
function ntIsAbs(p: string): boolean {
  const start = p.slice(0, 3).replace(/\//g, "\\");
  return start.startsWith("\\\\") || start.slice(1) === ":\\";
}

/** ntpath.split: the folder and the last name. */
function ntSplit(p: string): [string, string] {
  const [drive, root, rest] = ntSplitRoot(p);
  let i = rest.length;
  while (i > 0 && rest[i - 1] !== "\\" && rest[i - 1] !== "/") { i--; }
  return [drive + root + rest.slice(0, i).replace(/[\\/]+$/, ""), rest.slice(i)];
}

/** A path as pathlib's PureWindowsPath holds it: the drive, the root, and the names after it. */
interface WinPath { drive: string; root: string; names: string[]; }

function winParse(p: string): WinPath {
  let [drive, root, rest] = ntSplitRoot(p.replace(/\//g, "\\"));
  if (!root && drive.startsWith("\\") && !drive.endsWith("\\")) {
    const parts = drive.split("\\");
    if ((parts.length === 4 && !"?.".includes(parts[2])) || parts.length === 6) { root = "\\"; }   // \\server\share, \\?\UNC\server\share
  }
  return { drive, root, names: rest.split("\\").filter((name) => name !== "" && name !== ".") };
}

/** str() of a Windows path in pathlib: what Path(text) hands to the system. Reading it twice changes nothing. */
export function winText(p: string): string {
  const { drive, root, names } = winParse(p);
  return drive + root + names.join("\\") || ".";
}

/** PureWindowsPath(file).relative_to(root).as_posix(): compared name by name without regard to letter case; a path
 *  with the prefix \\?\ is on another drive than the path without it. "." when the two are one path. */
function winRelative(root: string, file: string): string | undefined {
  const a = winParse(root), b = winParse(file);
  if (a.drive.toLowerCase() !== b.drive.toLowerCase() || a.root !== b.root || a.names.length > b.names.length) { return undefined; }
  for (let i = 0; i < a.names.length; i++) {
    if (a.names[i].toLowerCase() !== b.names[i].toLowerCase()) { return undefined; }
  }
  const rest = b.names.slice(a.names.length);
  if (rest.length === 0) { return "."; }
  return (rest[0][1] === ":" ? "./" : "") + rest.join("/");      // pathlib: a first name that reads as a drive gets `.` before it
}

/** The path as the system must be given it, so that it reads it as it reads a path Python gives it. Node puts
 *  \\?\ before every full path, and the system then takes each name as written; Python gives the path as it is,
 *  and the system drops dots and spaces at the end of a name, and refuses a path that is too long. A path under
 *  \\.\ is read by those same rules and Node leaves it as it is. */
function asGiven(p: string): string {
  if (p.startsWith("\\\\")) { return p[2] === "?" || p[2] === "." ? p : "\\\\.\\UNC\\" + p.slice(2); }
  return /^[A-Za-z]:\\/.test(p) ? "\\\\.\\" + p : p;
}

/** nt._getfinalpathname: the path the system opens, links followed, in the spelling on disk, always with \\?\. */
function finalPath(p: string): string {
  const out = fs.realpathSync.native(asGiven(p));
  return out.startsWith("\\\\") ? NS_UNC + out.slice(2) : NS + out;
}

function codeOf(error: unknown): string {
  return String((error as NodeJS.ErrnoException | undefined)?.code ?? "");
}

/** ntpath._readlink_deep: what is written in the link at `p`, and in the link that names, to the end. */
function readLinks(p: string): string {
  const seen = new Set<string>();
  while (!seen.has(p.toLowerCase())) {
    seen.add(p.toLowerCase());
    let target: string;
    try { target = fs.readlinkSync(asGiven(p)); } catch { break; }
    // The system writes a full target as \??\C:\…; Python reads that as \\?\C:\…, Node as C:\….
    if (/^[A-Za-z]:[\\/]/.test(target)) { target = NS + target; } else if (/^\\\\[^?.]/.test(target)) { target = NS_UNC + target.slice(2); }
    if (!ntIsAbs(target)) { target = ntNormpath(ntJoin(ntSplit(p)[0], target)); }
    p = target;
  }
  return p;
}

/** The name as it is spelled in its folder, found without opening it (nt._findfirstfile). */
function spelled(folder: string, name: string): string {
  try {
    const lower = name.toLowerCase();
    return fs.readdirSync(asGiven(folder)).find((entry) => entry.toLowerCase() === lower) ?? name;
  } catch {
    return name;
  }
}

/** ntpath._getfinalpathname_nonstrict: the real path of as much of the path as the system opens, then the rest as
 *  written. A name the system does not open is first read as a link. */
function finalPathOfWhatExists(p: string): string {
  let tail = "";
  while (p) {
    let code: string;
    try {
      const real = finalPath(p);
      return tail ? ntJoin(real, tail) : real;
    } catch (error) {
      code = codeOf(error);
    }
    // Not there, or not to be opened: Python goes on. Any other failure it raises, and the checker then finds no file.
    const unopened = ["EPERM", "EACCES", "EBUSY", "EINVAL", "ENOTSUP", "ELOOP", "EISDIR"].includes(code);
    if (code !== "ENOENT" && !unopened) { throw new Error(`the path could not be read (${code}): ${p}`); }
    const linked = readLinks(p);
    if (linked !== p) { return tail ? ntJoin(linked, tail) : linked; }
    const [folder, written] = ntSplit(p);
    const name = unopened ? spelled(folder, written) : written;
    p = folder;
    if (p && !name) { return p + tail; }
    tail = tail ? ntJoin(name, tail) : name;
  }
  return tail;
}

/** ntpath.realpath (Python 3.13, not strict) of str(Path(file)). The prefix \\?\ is kept on a path that has it and
 *  taken off a path that has none, unless the path without it is not the same file. */
function winReal(file: string): string {
  let p = ntNormpath(winText(file));
  if (p.toLowerCase() === "nul") { return "\\\\.\\NUL"; }
  const hadPrefix = p.startsWith(NS);
  if (!hadPrefix && !ntIsAbs(p)) { p = ntJoin(process.cwd(), p); }
  if (p.includes("\0")) { return winText(ntNormpath(p)); }      // no such name on any disk; Python keeps the text
  let failed = "";
  try {
    p = finalPath(p);
  } catch (error) {
    failed = codeOf(error);
    p = finalPathOfWhatExists(p);
  }
  if (!hadPrefix && p.startsWith(NS)) {
    const bare = p.startsWith(NS_UNC) ? "\\\\" + p.slice(NS_UNC.length) : p.slice(NS.length);
    try {
      if (finalPath(bare) === p) { p = bare; }
    } catch (error) {
      if (codeOf(error) === failed) { p = bare; }          // not there before and not there now
    }
  }
  return winText(p);
}

/** The rules of the system the extension runs on. */
export const systemRules: PathRules = {
  windows: process.platform === "win32",
  real(file: string): string {
    return process.platform === "win32" ? winReal(file) : posixSystem.real(file);
  },
  isFile(file: string): boolean {
    return isFile(process.platform === "win32" ? asGiven(file) : file);
  },
};

/** The path of `file` relative to `root`, with /, when it lies inside the root; both are real paths already. The
 *  root itself is "." to the checker (`itself`), and nowhere to the editor, which asks for a file in a folder. */
function inside(root: string, file: string, rules: PathRules, itself = false): string | undefined {
  if (rules.windows) {
    const rel = winRelative(root, file);
    return rel === "." && !itself ? undefined : rel;
  }
  const rel = path.posix.relative(root, file);
  if (rel === "") { return itself ? "." : undefined; }
  if (rel === ".." || rel.startsWith("../") || path.posix.isAbsolute(rel)) { return undefined; }
  return rel;
}

/** The file's path relative to the root, with /, when its real path lies inside the root's real path. */
export function relativeIn(root: string, filePath: string, rules: PathRules = systemRules): string | undefined {
  try {
    return inside(rules.real(root), rules.real(filePath), rules);
  } catch {
    return undefined;      // a path the system could not read is nowhere
  }
}

/** The real path of a source root; undefined when the system cannot read it. `known` keeps the answers, so that
 *  many projects are asked of the disk once and not at every lookup; the caller empties it when the disk may
 *  have changed. */
export function realRoot(sourceRoot: string, rules: PathRules = systemRules, known?: Map<string, string | undefined>): string | undefined {
  if (known?.has(sourceRoot)) { return known.get(sourceRoot); }
  let root: string | undefined;
  try { root = rules.real(sourceRoot); } catch { root = undefined; }
  known?.set(sourceRoot, root);
  return root;
}

/** The project whose `sourceRoot` contains the file, the longest root first; undefined when none does. */
export function projectFor<P extends Project>(filePath: string, projects: readonly P[], rules: PathRules = systemRules,
  known?: Map<string, string | undefined>): P | undefined {
  let best: P | undefined, longest = -1;
  try {
    const file = rules.real(filePath);
    for (const project of projects) {
      const root = realRoot(project.sourceRoot, rules, known);
      if (root === undefined) { continue; }                                   // a root that could not be read holds no file
      if (root.length > longest && inside(root, file, rules) !== undefined) { best = project; longest = root.length; }
    }
  } catch {
    return undefined;      // a path the system could not read is nowhere
  }
  return best;
}

/** The note's `source` resolved against the root: its path relative to the root, with /, when the result is a
 *  file inside the root, whatever its spelling; else undefined. The same rule as `on_disk` in _common.py. */
export function sourceInRoot(root: string, source: string, rules: PathRules = systemRules): string | undefined {
  if (!source) { return undefined; }     // the checker asks only for a `source` that is given
  try {
    const base = rules.real(rules.windows ? winText(root) : root);
    const written = source.replace(/\\/g, "/");
    // POSIX: the source is joined to the root as written, and `rules.real` reads each `..` after the links before
    // it. Windows: joined as pathlib joins (a source with a drive of its own, or a root, is not under the base),
    // and `rules.real` there takes each `name\..` out of the text before any link is read.
    const joined = rules.windows ? winText(ntJoin(base, written))
      : written.startsWith("/") ? written : base + (base.endsWith("/") ? "" : "/") + written;
    const file = rules.real(joined);
    return rules.isFile(file) ? inside(base, file, rules, true) : undefined;
  } catch {
    return undefined;
  }
}
