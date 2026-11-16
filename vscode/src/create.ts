// "Create explanation" inside VS Code: starts the coding agent as a task in a terminal the person can type into,
// follows it to its end, and then has the note checked. Wiring only. The rules are in src/core: create.ts (the
// command, the program, one run at a time, what a run may show and for which file, what its end means), run.ts
// (`mayStart`, the trust guard and the only task start), settings.ts (the command comes from the user's own
// settings only). Nothing here ever writes a note: the agent does.

import * as fs from "node:fs";
import * as vscode from "vscode";
import { Check } from "./check";
import { Index } from "./index";
import { Creates, Ended, Follow, Run, Status, TASK_NAME, afterRun, alreadyRunning, fileHash, fill, findProgram, noteMark, refusal,
  revisionMark, variableIn } from "./core/create";
import { Entry } from "./core/noteIndex";
import { Project } from "./core/projects";
import { mayStart } from "./core/run";
import { createDepth, projectKey, userCommand } from "./core/settings";

const SETTLE_MS = 500;        // the agent's last writes reach the watchers before the notes are read
const AGAIN_MS = 2000;        // a check whose result was not used (the notes still moved) is run once more
const CHANGED = "the file or the settings changed while Create was starting; nothing was started";

/** What a run was started with. */
interface Started { run: Run; project: Project; file: string; path: string; program: string; notes: string; source: string | undefined; }

async function isProgram(file: string): Promise<boolean> {
  try {
    if (!(await fs.promises.stat(file)).isFile()) { return false; }
    if (process.platform !== "win32") { await fs.promises.access(file, fs.constants.X_OK); }
    return true;
  } catch {
    return false;
  }
}

export class Create implements vscode.Disposable {
  private readonly runs = new Creates();
  private following?: { task: vscode.Task; follow: Follow };
  private readonly listeners: vscode.Disposable[];
  private disposed = false;
  private waiting?: { timer: NodeJS.Timeout; go: () => void };   // the one pause of the run that is ending

  /** `say` shows a sentence to the person now; `changed` is called when what a run says may have changed. */
  constructor(private readonly index: Index, private readonly check: Check, private readonly say: (text: string) => void,
    private readonly changed: () => void) {
    this.listeners = [
      vscode.tasks.onDidEndTaskProcess((event) => { if (this.mine(event.execution)) { this.following?.follow.processEnded(event.exitCode); } }),
      vscode.tasks.onDidEndTask((event) => { if (this.mine(event.execution)) { this.following?.follow.taskEnded(); } }),
    ];
  }

  /** Whether an event is about the task of the run that is going. One run goes at a time. */
  private mine(execution: vscode.TaskExecution): boolean {
    const task = this.following?.task;
    return task !== undefined && (execution.task === task
      || (execution.task.name === task.name && execution.task.source === task.source && execution.task.definition.type === task.definition.type));
  }

  /** The settings were read again: what was kept for a project that is no longer there goes. */
  configure(): void {
    this.runs.settings((key) => this.index.projects.some((project) => projectKey(project) === key));
  }

  /** What Create says for this file of this project: asked at each drawing of the panel. */
  status(project: Project, sourceRel: string, notes: readonly Entry[]): Status | undefined {
    return this.runs.status(projectKey(project), sourceRel, () => revisionMark(notes));
  }

  /** Waits; at shutdown the wait ends at once and no timer is left. */
  private wait(ms: number): Promise<void> {
    return new Promise((go) => {
      this.waiting = { go, timer: setTimeout(() => { this.waiting = undefined; go(); }, ms) };
    });
  }

  private live(run: Run): boolean {
    return !this.disposed && this.runs.live(run);
  }

  /** "Argus: Create explanation" for a document. A second call while a run goes starts nothing. */
  async create(document: vscode.TextDocument | undefined): Promise<void> {
    if (!document) { this.say("open a file first; nothing was started"); return; }
    const at = this.index.locate(document);
    const no = refusal({ trusted: vscode.workspace.isTrusted, onDisk: !document.isUntitled && document.uri.scheme === "file",
      file: at.project ? at.sourceRel : undefined });
    if (no !== undefined) { this.say(no); return; }
    const project = at.project as Project, file = at.sourceRel as string;
    const run = this.runs.begin(projectKey(project), file);
    if (!run) {
      const going = this.runs.running();
      this.say(going ? alreadyRunning(going) : "the agent is already running; no second one was started");
      return;
    }
    this.changed();
    let failed: string | undefined;
    try {
      failed = await this.start(run, document, project, file);
    } catch (error) {
      failed = `could not start the agent: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (failed === undefined) { return; }                    // the agent runs; its end is followed
    // Nothing runs: the running state is cleared, and the person is told why (nothing on a plain Cancel).
    this.runs.finish(run);
    this.changed();
    if (failed !== "" && !this.disposed) { this.say(failed); }
  }

  /** Saves, looks the program up, records the hashes and starts the task. Undefined: the agent was started. A
   *  sentence: nothing runs, for that reason; the empty sentence when the person cancelled. */
  private async start(run: Run, document: vscode.TextDocument, project: Project, file: string): Promise<string | undefined> {
    if (document.isDirty) {
      const answer = await vscode.window.showWarningMessage(`${file} has unsaved changes. The agent reads the file from disk.`,
        { modal: true, detail: "Create explains the saved file only." }, "Save and create");
      if (answer !== "Save and create") { return ""; }
      const saved = await document.save();
      if (!saved || document.isDirty) { return "the file could not be saved; nothing was started"; }
    }
    // The command is the user's own (never the workspace's); each argument is filled on its own.
    const config = vscode.workspace.getConfiguration("argus");
    const values = { file, notesFolder: project.notesFolder, sourceRoot: project.sourceRoot, depth: createDepth(config.get<unknown>("createDepth")) };
    const variable = variableIn(values);
    if (variable !== undefined) { return variable; }
    const command = fill(userCommand(config.inspect<unknown>("createCommand")), values);
    const program = await findProgram(command[0], { windows: process.platform === "win32", env: process.env, isFile: isProgram });
    if ("problem" in program) { return program.problem; }
    // The hashes from before the start: the file as saved, and the file's notes as they are on disk now.
    await this.index.refreshNow(project).catch(() => undefined);
    const source = await fileHash(document.uri.fsPath);
    // Time has passed (the question, the save, the disk): all of it is asked again before anything is started.
    const now = this.index.locate(document);
    if (!this.live(run) || document.isClosed || document.isDirty || !vscode.workspace.isTrusted
      || !now.project || projectKey(now.project) !== run.project || now.sourceRel !== file) { return CHANGED; }
    const started: Started = { run, project, file, path: document.uri.fsPath, program: program.path,
      notes: noteMark(this.index.notes.fileNotesFor(project, file)), source };

    // A program and its argument list, started without a shell, in a terminal that takes the person's typing and
    // stays open after the program ends.
    const task = new vscode.Task({ type: "argus" }, vscode.TaskScope.Workspace, TASK_NAME, "argus",
      new vscode.ProcessExecution(program.path, command.slice(1), { cwd: project.sourceRoot }));
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: true, panel: vscode.TaskPanelKind.Dedicated, close: false };
    const follow = new Follow((ended) => { void this.ended(started, ended); });
    this.following = { task, follow };
    this.runs.move(run, "running");
    this.changed();
    const starting = mayStart(vscode.workspace, vscode.tasks, task);
    try {
      if (starting === undefined) { throw new Error("this window is in Restricted Mode"); }
      await starting;
    } catch (error) {
      if (!follow.stop()) { return undefined; }              // its end was told already, and is handled there
      this.following = undefined;
      return `could not start the agent: ${error instanceof Error ? error.message : String(error)}`;
    }
    return undefined;
  }

  /** The task of a run is over. Every path through here clears the running state. */
  private async ended(started: Started, ended: Ended): Promise<void> {
    const { run, project, file } = started;
    this.following = undefined;
    let say: { text: string; mark: string } | undefined;
    try {
      if (!this.live(run)) { this.late(run); return; }
      this.runs.move(run, "ending");
      this.changed();
      // The notes the agent wrote in its last moment are read before anything is judged.
      await this.wait(SETTLE_MS);
      await this.index.refreshNow(project).catch(() => undefined);
      if (!this.live(run)) { this.late(run); return; }
      this.check.inputChanged(project);                      // a finished Create is an input event of the check
      const result = afterRun(ended, started.program, started.notes, noteMark(this.index.notes.fileNotesFor(project, file)),
        await fileHash(started.path) !== started.source);
      if (result.check) {
        // The check's own generation rule decides whether its result may be shown; a result that was not used
        // because the notes still moved is asked for once more.
        let done = await this.check.checkAt(project, file);
        if (!done.used && !done.always && this.live(run)) {
          await this.wait(AGAIN_MS);
          if (this.live(run)) { done = await this.check.checkAt(project, file); }
        }
      }
      if (!this.live(run)) { this.late(run); return; }
      if (result.say !== undefined) { say = { text: result.say, mark: revisionMark(this.index.notes.fileNotesFor(project, file)) }; }
    } catch (error) {
      say = { text: `the end of the agent's run could not be read: ${error instanceof Error ? error.message : String(error)}`,
        mark: revisionMark(this.index.notes.fileNotesFor(project, file)) };
    } finally {
      this.runs.finish(run, say);
      if (!this.disposed) { this.changed(); }
    }
  }

  /** The end of a run whose project left the settings meanwhile: its result is shown for no file. */
  private late(run: Run): void {
    if (this.disposed) { return; }
    void vscode.window.showWarningMessage(`Argus: the settings changed while the agent ran for ${run.file}; its result was not checked.`);
  }

  dispose(): void {
    this.disposed = true;
    if (this.waiting) { clearTimeout(this.waiting.timer); this.waiting.go(); this.waiting = undefined; }
    this.following?.follow.stop();
    this.following = undefined;
    this.runs.clear();
    for (const listener of this.listeners) { listener.dispose(); }
  }
}
