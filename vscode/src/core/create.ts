// The rules of "Create explanation" and "Update explanation". No import of "vscode": src/create.ts carries them
// out. Here: what the command becomes, which program it names, whether a run may start, what a run may show and
// for which file, and what the end of a run means. The two kinds of run share every rule; only words differ.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Need } from "./selection";

/** The kind of a run: Create writes the note of a file that has none, Update brings a note up to the code. */
export type Kind = "create" | "update";

/** The name of the task of Create, and so of its terminal. */
export const TASK_NAME = "Argus: create explanation";
const TASK: Record<Kind, string> = { create: TASK_NAME, update: "Argus: update explanation" };
const COMMAND: Record<Kind, string> = { create: "argus.createCommand", update: "argus.updateCommand" };

/** The name of the task of a run of this kind, and so of its terminal. */
export function taskName(kind: Kind): string {
  return TASK[kind];
}

/** The setting that holds the command of this kind of run. */
export function commandSetting(kind: Kind): string {
  return COMMAND[kind];
}

export interface Values { file: string; notesFolder: string; sourceRoot: string; depth: "map" | "full"; }

/** The command with its placeholders filled: `${file}` (the path inside the source root), `${notesFolder}`,
 *  `${sourceRoot}`, `${depth}`. Each argument is filled on its own and stays one argument; nothing is joined, so
 *  no value can become a second argument or a command. A value is put in once and never read again. The program
 *  (the first entry) is the user's own word and is not filled. A value that would begin an argument with `-` gets
 *  `./` before it, so a file named `--help` cannot be read as an option. */
export function fill(command: readonly string[], values: Values): string[] {
  return command.map((part, i) => i === 0 ? part : part.replace(/\$\{(file|notesFolder|sourceRoot|depth)\}/g,
    (_whole, name: keyof Values, at: number) => at === 0 && values[name].startsWith("-") ? `./${values[name]}` : values[name]));
}

/** The arguments that name the model, from the setting `argus.createModel`: none for the empty text, else `--model`
 *  and the value, two arguments. They are placed right after the program, before the command's other arguments.
 *  The value is the name of a model and nothing else: letters, digits and `. - _ : /`, at most 100 characters, and
 *  no `-` at its start, so it can never be read as an option. Anything else: a sentence, and nothing is started. */
export function modelArgs(model: unknown): { args: string[] } | { problem: string } {
  if (model === "") { return { args: [] }; }
  if (typeof model !== "string" || model.length > 100 || model.startsWith("-") || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    return { problem: "the setting argus.createModel is not a model name: it may hold letters, digits and . - _ : / only, "
      + "at most 100 characters, and must not begin with -; nothing was started" };
  }
  return { args: ["--model", model] };
}

/** VS Code's task runner reads `${name}` in a task's arguments and folder as one of its own variables: the value of
 *  an environment variable, or the result of a command it then runs. A path is never handed to it with `${` in it:
 *  a file or a folder named so could make the task read a secret or run a command. The sentence that says so, or
 *  undefined when the paths are plain. The user's own command text is the user's own and is not looked at. */
export function variableIn(values: Values): string | undefined {
  for (const name of ["file", "notesFolder", "sourceRoot"] as const) {
    if (values[name].includes("${")) {
      return "the path '" + values[name] + "' holds '${', which the task runner of VS Code would read as a variable; nothing was started";
    }
  }
  return undefined;
}

/** Why Create starts nothing for this document; undefined when it may go on. `file` is the document's path inside
 *  its project's source root, undefined when it is in no project. A name with a control character or a line break
 *  is not handed to an agent: there it could be read as a new line of the request. */
export function refusal(at: { trusted: boolean; onDisk: boolean; file: string | undefined }): string | undefined {
  if (!at.trusted) { return "nothing was started: this window is in Restricted Mode"; }
  if (!at.onDisk) { return "Argus explains saved files only; this document has no path on disk, so nothing was started"; }
  if (at.file === undefined) { return "this file is not in an Argus project; nothing was started"; }
  for (let i = 0; i < at.file.length; i++) {
    const c = at.file.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) {
      return "this file's name holds a control character or a line break; nothing was started";
    }
  }
  return undefined;
}

/** Why Update starts nothing for a file that Create's rules let through; undefined when it may go on. `notes`: how
 *  many notes explain the file. `note`: the one note that is shown for it. `need`: what the match of the note
 *  against the text found, when it is known; not known, the agent finds out itself. */
export function updateRefusal(at: { notes: number; note: "none" | "unreadable" | "readable"; need?: Need }): string | undefined {
  if (at.notes === 0) { return "no Argus note explains this file yet, so there is nothing to update; use 'Create explanation'. Nothing was started"; }
  if (at.note === "none") { return "several notes explain this file; pick one in the Argus panel first. Nothing was started"; }
  if (at.note === "unreadable") { return "the note of this file cannot be read, so it is not given to the agent to update; nothing was started"; }
  if (at.need && at.need.changed === 0 && at.need.unexplained === 0) {
    return "every block of the note fits the code and no line is unexplained: there is nothing to update. Nothing was started";
  }
  return undefined;
}

/** The question asked before a run when the file has unsaved changes: the agent reads the file from disk. */
export function saveQuestion(kind: Kind, file: string): { message: string; detail: string; yes: string } {
  const message = `${file} has unsaved changes. The agent reads the file from disk.`;
  return kind === "create"
    ? { message, detail: "Create explains the saved file only.", yes: "Save and create" }
    : { message, detail: "Update compares the note with the saved file only.", yes: "Save and update" };
}

/** Said when the file or the settings changed between the click and the start. */
export function changedMeanwhile(kind: Kind): string {
  return `the file or the settings changed while ${kind === "create" ? "Create" : "Update"} was starting; nothing was started`;
}

/** Said when the note of a file is not there any more at the start of an Update. */
export const NOTE_GONE = "the note of this file is not there any more; nothing was started";

/** What the lookup of a program asks of the system. Tests give the other system, and a disk that is not there. */
export interface Lookup { windows: boolean; env: Record<string, string | undefined>; isFile(file: string): Promise<boolean>;
  read?: (file: string) => Promise<string>;     // the text of a launcher file; without it a batch file is always refused
  setting?: string; }                           // the setting the command came from, named in a problem; argus.createCommand when not given
/** `before`: arguments that come before the command's own (the script that node runs, for an npm launcher). */
export type Program = { path: string; before?: string[] } | { problem: string };

/** The full path of the program of the command: a name is looked up on PATH (on Windows with the endings of
 *  PATHEXT), a full path is taken as it is. The full path is what is started, so what was looked at is what runs.
 *  A relative path, a relative PATH entry and the current folder are never used: the agent runs in the source
 *  root, and a workspace must not supply the program. On Windows a batch file is refused: the system starts it
 *  through a command shell, which would read the arguments. */
export async function findProgram(program: string, lookup: Lookup): Promise<Program> {
  const p = lookup.windows ? path.win32 : path.posix;
  const setting = lookup.setting ?? COMMAND.create, SETTING = `see the setting ${setting}`;
  if (program === "" || program.includes("\0")) { return { problem: `could not start the agent: the command names no program; ${SETTING}` }; }
  const full = (file: string): boolean => p.isAbsolute(file) && (!lookup.windows || /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(file));
  const env = (name: string): string | undefined => {
    if (!lookup.windows) { return Object.hasOwn(lookup.env, name) ? lookup.env[name] : undefined; }
    for (const key of Object.keys(lookup.env)) { if (key.toUpperCase() === name) { return lookup.env[key]; } }
    return undefined;
  };
  const endings = lookup.windows ? (env("PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter((ending) => /^\.[^.\\/:]+$/.test(ending)) : [];
  const spellings = (file: string): string[] => lookup.windows
    ? [...(p.extname(file) !== "" ? [file] : []), ...endings.map((ending) => file + ending.toLowerCase())] : [file];
  const first = async (file: string): Promise<string | undefined> => {
    for (const spelling of spellings(file)) { if (await lookup.isFile(spelling)) { return spelling; } }
    return undefined;
  };

  let found: string | undefined;
  if (full(program)) {
    found = await first(p.normalize(program));
  } else if (/[\\/]/.test(lookup.windows ? program : program.replace(/\\/g, "")) || (lookup.windows && program.includes(":"))) {
    return { problem: `could not start '${program}': give the program's name or its full path, not a relative path; ${SETTING}` };
  } else {
    for (const entry of (env("PATH") ?? "").split(lookup.windows ? ";" : ":")) {
      const folder = lookup.windows ? entry.replace(/^"(.*)"$/, "$1") : entry;
      if (!full(folder)) { continue; }
      found = await first(p.join(folder, program));
      if (found !== undefined) { break; }
    }
  }
  if (found === undefined) { return { problem: `could not start '${program}': the program was not found; ${SETTING}` }; }
  if (lookup.windows && [".bat", ".cmd"].includes(p.extname(found).toLowerCase())) {
    // A launcher that npm wrote only names the real program: that program is started itself, without the batch
    // file and so without a command shell.
    const through = lookup.read ? await behindShim(found, lookup, p) : undefined;
    if (through) { return through; }
    return { problem: `could not start '${found}': it is a batch file, and Windows hands the arguments of a batch file to a command shell. `
      + `Name a program (an .exe) in ${setting}; ${SETTING}` };
  }
  return { path: found };
}

/** What an npm launcher (`name.cmd`) starts: the line `"%dp0%\...\program.exe" %*`, or `"%_prog%"  "%dp0%\...\script.js" %*`
 *  with node. Only a target inside the launcher's own folder counts, written without `..`. Undefined when the
 *  file is no such launcher; then it is refused as any batch file. */
async function behindShim(shim: string, lookup: Lookup, p: typeof path.win32): Promise<Program | undefined> {
  let text: string;
  try { text = await (lookup.read as (file: string) => Promise<string>)(shim); } catch { return undefined; }
  if (text.length > 20000) { return undefined; }
  const folder = p.dirname(shim);
  const inside = (rel: string): string | undefined =>
    rel.split(/[\\/]/).some((part) => part === ".." || part === "" || part.includes(":")) ? undefined : p.join(folder, rel);
  // Every line must be one that npm's launcher writes; one line, and only one, starts the program. A line in a
  // comment, or a batch file that does anything else, is no launcher: it is refused as any batch file.
  const SETUP = [/^@echo off$/i, /^goto start$/i, /^:find_dp0$/i, /^set dp0=%~dp0$/i, /^exit \/b$/i, /^:start$/i, /^setlocal$/i,
    /^call :find_dp0$/i, /^if exist "%dp0%\\node\.exe" \($/i, /^set "_prog=%dp0%\\node\.exe"$/i, /^\) else \($/i,
    /^set "_prog=node"$/i, /^set pathext=%pathext:;\.js;=;%$/i, /^\)$/];
  const EXE = /^"%dp0%\\([^"%]+\.exe)"\s+%\*$/i;
  const JS = /^(?:endlocal & goto #_undefined_# 2>nul \|\| title %comspec% & )?"%_prog%"\s+"%dp0%\\([^"%]+\.[cm]?js)"\s+%\*$/i;
  const starts: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || SETUP.some((known) => known.test(line))) { continue; }
    starts.push(line);
  }
  if (starts.length !== 1) { return undefined; }
  const exe = EXE.exec(starts[0]);
  if (exe) {
    const target = inside(exe[1]);
    return target !== undefined && await lookup.isFile(target) ? { path: target } : undefined;
  }
  const js = JS.exec(starts[0]);
  if (js) {
    const script = inside(js[1]);
    if (script === undefined || !await lookup.isFile(script)) { return undefined; }
    const beside = p.join(folder, "node.exe");
    if (await lookup.isFile(beside)) { return { path: beside, before: [script] }; }
    const node = await findProgram("node", { ...lookup, read: undefined });
    return "path" in node ? { path: node.path, before: [script] } : undefined;
  }
  return undefined;
}

/** How the task of a run ended: its program ended (with an exit code, when the system gave one), or the task was
 *  over without the program ever ending, which means it never started. */
export type Ended = { how: "exit"; code: number | undefined } | { how: "no-process" };

/** Follows the two events of one task and tells its end once. */
export class Follow {
  private over = false;
  constructor(private readonly tell: (ended: Ended) => void) {}
  private once(ended: Ended): void {
    if (this.over) { return; }
    this.over = true;
    this.tell(ended);
  }
  /** The program ended. */
  processEnded(code: number | undefined): void { this.once({ how: "exit", code }); }
  /** The task is over, with or without a program. */
  taskEnded(): void { this.once({ how: "no-process" }); }
  /** Nothing more is told. False when the end was told already. */
  stop(): boolean {
    const was = this.over;
    this.over = true;
    return !was;
  }
}

/** One mark for the File notes of a source file: every note by its path and the hash of its text. Empty when
 *  there is no note. Two marks are equal exactly when the same notes hold the same text. */
export function noteMark(notes: readonly { path: string; text: string }[]): string {
  if (notes.length === 0) { return ""; }
  const each = notes.map((note) => [note.path, crypto.createHash("sha256").update(note.text, "utf8").digest("hex")]);
  each.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return crypto.createHash("sha256").update(JSON.stringify(each), "utf8").digest("hex");
}

/** The same question, cheap, for each drawing of the panel: the notes by the index's id and revision. */
export function revisionMark(notes: readonly { id: number; revision: number }[]): string {
  return notes.map((note) => `${note.id}:${note.revision}`).sort().join(",");
}

/** The hash of a file's bytes on disk; undefined when it cannot be read. */
export async function fileHash(file: string): Promise<string | undefined> {
  try {
    return crypto.createHash("sha256").update(await fs.promises.readFile(file)).digest("hex");
  } catch {
    return undefined;
  }
}

/** What the end of a run means, in the design's order. `before` and `after` are the note marks of the file from
 *  before the start and from the index read again after the end. `check`: the check is run and its state shown.
 *  The rules are the same for both kinds of run; the sentences fit the kind: Create writes a note, Update changes one. */
export function afterRun(ended: Ended, program: string, before: string, after: string, sourceChanged: boolean,
  kind: Kind = "create"): { say?: string; check: boolean } {
  if (ended.how === "no-process") {
    return { check: false, say: `the agent did not run: the task ended without starting the program '${program}'; see the setting ${COMMAND[kind]}` };
  }
  if (ended.code !== 0) {
    return { check: false, say: `the agent stopped with an error${ended.code === undefined ? "" : ` (exit code ${ended.code})`}; `
      + `its output is in the terminal '${TASK[kind]}'` };
  }
  const moved = "the file changed on disk while the agent ran; the note describes the text the agent read";
  if (kind === "update") {
    if (after === "") { return { check: false, say: "the agent ended, and the note of this file is not there any more" }; }
    if (after === before) { return { check: false, say: "the agent ended without changing the note" }; }
    return { check: true, say: sourceChanged ? `the note was updated; ${moved}` : "the note was updated" };
  }
  if (after === "" || after === before) { return { check: false, say: "the agent finished without writing the note" }; }
  return sourceChanged ? { check: true, say: moved } : { check: true };
}

export type Phase = "starting" | "running" | "ending";
/** One run of the agent: the project (its key) and the file (its path inside the source root) it was started for. */
export interface Run { readonly serial: number; readonly project: string; readonly file: string; readonly kind: Kind; phase: Phase; orphan: boolean; }
export interface Status { text: string; running: boolean; }

/** What a run says while it goes. The line names the kind of the run: by its terminal, or in words. */
const PHASE: Record<Kind, Record<Phase, string>> = {
  create: {
    starting: "starting the agent…",
    running: `agent running in the terminal '${TASK.create}'; answer it there if it asks`,
    ending: "the agent has ended; its notes are being read and checked…",
  },
  update: {
    starting: "Update: starting the agent…",
    running: `agent running in the terminal '${TASK.update}'; answer it there if it asks`,
    ending: "Update: the agent has ended; the note is being read and checked…",
  },
};

export function alreadyRunning(run: Run): string {
  return `the agent is already running for ${run.file}; answer it in the terminal '${TASK[run.kind]}'. No second one was started`;
}

function keyOf(project: string, file: string): string {
  return JSON.stringify([project, file]);
}

/** The runs of Create and Update: one at a time across both kinds, and what each may show.
 *  A run belongs to one file of one project. What it says while it runs, and the sentence it leaves at its end,
 *  are given for that file of that project only. The sentence goes when the file's notes change, when a new run
 *  starts for the file, and when its project leaves the settings. A run whose project left the settings shows
 *  nothing and leaves nothing, but while its agent is alive no second run starts. */
export class Creates {
  private run?: Run;
  private serial = 0;
  private readonly ended = new Map<string, { project: string; text: string; mark: string }>();

  /** A run starts, unless one is going: then undefined, and nothing may be started. */
  begin(project: string, file: string, kind: Kind = "create"): Run | undefined {
    if (this.run) { return undefined; }
    this.ended.delete(keyOf(project, file));
    this.run = { serial: ++this.serial, project, file, kind, phase: "starting", orphan: false };
    return this.run;
  }

  running(): Run | undefined { return this.run; }

  /** Whether this run is the one going, and still that of a project of the settings. */
  live(run: Run): boolean { return this.run === run && !run.orphan; }

  move(run: Run, phase: Phase): void {
    if (this.run === run) { run.phase = phase; }
  }

  /** The run is over. `say`: the sentence it leaves for its file, with the mark of the file's notes at that time. */
  finish(run: Run, say?: { text: string; mark: string }): void {
    if (this.run !== run) { return; }
    this.run = undefined;
    if (say && !run.orphan) { this.ended.set(keyOf(run.project, run.file), { project: run.project, ...say }); }
  }

  /** The settings changed: `has` says which projects (by key) are still there. */
  settings(has: (project: string) => boolean): void {
    if (this.run && !has(this.run.project)) { this.run.orphan = true; }
    for (const [key, ended] of this.ended) { if (!has(ended.project)) { this.ended.delete(key); } }
  }

  /** Shut down: no run, no sentence. */
  clear(): void {
    this.run = undefined;
    this.ended.clear();
  }

  /** What to show for this file of this project. `mark` gives the mark of the file's notes now; it is asked only
   *  when a sentence is kept for the file. */
  status(project: string, file: string, mark: () => string): Status | undefined {
    const run = this.run;
    if (run && !run.orphan && run.project === project && run.file === file) { return { running: true, text: PHASE[run.kind][run.phase] }; }
    const key = keyOf(project, file);
    const ended = this.ended.get(key);
    if (!ended) { return undefined; }
    if (ended.mark !== mark()) { this.ended.delete(key); return undefined; }
    return { running: false, text: ended.text };
  }
}
