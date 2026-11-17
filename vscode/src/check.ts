// The check inside VS Code: runs the skill's own checker, stores its result, and asks the checker's fingerprint
// whether a stored result still holds. Wiring only. The rules are in src/core: validity.ts (which finished call
// may be used), checkResult.ts (what a result means), run.ts (`mayRun`, the trust guard and the only process start).
// Nothing here ever changes a note.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Index } from "./index";
import { Outcome, badgeOf, fingerprintOf, stateOf } from "./core/checkResult";
import { GitWatch } from "./core/gitWatch";
import { graphPlaces, isPlace } from "./core/graphWatch";
import { Entry } from "./core/noteIndex";
import { Badge } from "./core/panelHtml";
import { Project } from "./core/projects";
import { Ran, RunOptions, checkerArgs, mayRun } from "./core/run";
import { projectKey, userPython } from "./core/settings";
import { Checks, Memory, Stored, memoryOf } from "./core/validity";

const QUIET_MS = 1500;
const GIT_QUIET_MS = 300;
// PYTHONUTF8: the checker writes its result as UTF-8 on every system (on Windows Python would else use the
// system's own encoding, and a file name outside it broke the result).
const LIMITS: RunOptions = { timeoutMs: 120000, maxBuffer: 20 * 1024 * 1024, env: { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } };
const RESTRICTED = "this window is in Restricted Mode";

interface Per {
  project: Project; checks: Checks;
  watchers: vscode.Disposable[];
  git: GitWatch;                       // whether git's folders are watched, and what a `.git` event means (core/gitWatch.ts)
  gitWatchers: vscode.Disposable[];
  graphWatchers: vscode.Disposable[];  // on the graph file, and on the file it leads to when it is a link
  graphPlaces?: string;                // the files the graph watchers are on, as one text
  graphAsked: number;                  // counts the questions where the graph leads: only the answer to the last one is used
  gitTimer?: NodeJS.Timeout;
  gitWork: Promise<void>;              // git is asked one question at a time
  timer?: NodeJS.Timeout;
  work: Promise<void>;                 // fingerprint calls of one project run one after the other
  running: Set<string>;                // the source files whose check is running
}

export class Check implements vscode.Disposable {
  private readonly per = new Map<string, Per>();
  private readonly kept = new Map<string, Checks>();          // a project's results outlive a change of the settings
  private readonly listeners: vscode.Disposable[];

  /** `changed` is called when a badge may have changed. */
  constructor(private readonly context: vscode.ExtensionContext, private readonly index: Index, private readonly changed: () => void) {
    const touch = (project: Project): void => { this.inputChanged(project); };
    this.listeners = [
      index.onDidTouch(touch),            // a note or vault file event
      index.onDidChange(touch),           // the index found the notes changed
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) { return; }
        for (const per of this.per.values()) {
          this.touch(per);                                    // covers changes no watcher saw
          if (!per.git.watched) { void this.watchGit(per); }  // a repository made where no watcher looks
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        for (const per of this.per.values()) { void this.watchGit(per); this.confirm(per); }   // the pending calls start
      }),
    ];
  }

  /** The results of a project in the workspace storage, by source path. */
  private memory(key: string): Memory {
    const name = `argus.check ${key}`;
    return memoryOf(this.context.workspaceState.get<Record<string, Stored>>(name), (all) => { void this.context.workspaceState.update(name, all); });
  }

  /** The projects of the settings changed, or were read for the first time: a settings change is an input event. */
  configure(): void {
    for (const per of this.per.values()) { this.stop(per); }
    this.per.clear();
    for (const project of this.index.projects) {
      const key = projectKey(project);
      let checks = this.kept.get(key);
      if (!checks) { checks = new Checks(this.memory(key)); this.kept.set(key, checks); }
      checks.changed();
      const per: Per = { project, checks, watchers: [], git: new GitWatch(), gitWatchers: [], graphWatchers: [], graphAsked: 0, gitWork: Promise.resolve(),
        work: Promise.resolve(), running: new Set() };
      this.per.set(key, per);
      this.watch(per, project.sourceRoot, "**/*", true);
      void this.watchGraph(per);
      void this.watchGit(per);
      this.confirm(per);                 // on activation: for the files that have a stored result
    }
  }

  private stop(per: Per): void {
    if (per.timer) { clearTimeout(per.timer); }
    if (per.gitTimer) { clearTimeout(per.gitTimer); }
    for (const watcher of [...per.watchers, ...per.gitWatchers, ...per.graphWatchers]) { watcher.dispose(); }
    per.watchers = [];
    per.gitWatchers = [];
    per.graphWatchers = [];
  }

  /** Watches the graph file: its folder is watched and each event compared with the file's own path, since a
   *  file name is no pattern. When the graph is a link, the file it leads to is watched the same way; an event
   *  for the configured path may mean the link leads elsewhere now, so the watchers are set anew. */
  private async watchGraph(per: Per): Promise<void> {
    if (!per.project.graph) { return; }
    const graph = path.resolve(per.project.graph);      // as it is read: an event names a full path
    const asked = ++per.graphAsked;
    const real = await fs.promises.realpath(graph).catch(() => undefined);
    if (this.per.get(projectKey(per.project)) !== per) { return; }        // the settings changed meanwhile
    if (asked !== per.graphAsked) { return; }                             // asked again meanwhile: that answer is the newer one
    const windows = process.platform === "win32";
    // Asked before every check and confirmation too (a link that led nowhere may lead somewhere now): the
    // watchers are set anew only when the files to watch are other ones.
    const places = graphPlaces(graph, real, windows), key = places.join("\n");
    if (key === per.graphPlaces && per.graphWatchers.length > 0) { return; }
    per.graphPlaces = key;
    for (const watcher of per.graphWatchers) { watcher.dispose(); }
    per.graphWatchers = [];
    for (const place of places) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(path.resolve(place))), "*"));
      const seen = (uri: vscode.Uri): void => {
        if (!isPlace(uri.fsPath, place, windows)) { return; }
        this.touch(per);
        if (place === graph) { void this.watchGraph(per); }
      };
      per.graphWatchers.push(watcher, watcher.onDidCreate(seen), watcher.onDidChange(seen), watcher.onDidDelete(seen));
    }
  }

  /** `source`: the watcher on the whole source root. What git keeps under it is followed by the git watchers,
   *  through HEAD and the refs only; while there are none, an event there has git asked again (core/gitWatch.ts). */
  private watch(per: Per, folder: string, pattern: string, source = false, into: vscode.Disposable[] = per.watchers): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.resolve(folder)), pattern));
    const seen = (kind: "create" | "change" | "delete") => (uri: vscode.Uri): void => {
      const what = source ? per.git.seen(path.relative(folder, uri.fsPath), kind) : { touch: true, discover: false };
      if (what.discover) { this.gitSoon(per); }
      if (what.touch) { this.touch(per); }
    };
    into.push(watcher, watcher.onDidCreate(seen("create")), watcher.onDidChange(seen("change")), watcher.onDidDelete(seen("delete")));
  }

  /** Git is asked again after 300 ms of quiet: `git init` writes many files, and one question is enough. */
  private gitSoon(per: Per): void {
    if (per.gitTimer) { clearTimeout(per.gitTimer); }
    per.gitTimer = setTimeout(() => { per.gitTimer = undefined; void this.watchGit(per); }, GIT_QUIET_MS);
  }

  /** Asks git where the repository keeps its data, and watches HEAD, the refs, packed-refs and shallow there.
   *  No git, or not a repository: no git watchers. Asked at the start, and again when a repository may have
   *  appeared or gone: on an event in `.git` that no git watcher covers, on the window's return, before a check. */
  private watchGit(per: Per): Promise<void> {
    per.gitWork = per.gitWork.then(async () => {
      if (this.per.get(projectKey(per.project)) !== per) { return; }
      const root = per.project.sourceRoot;
      const folders = new Set<string>();
      for (const question of ["--absolute-git-dir", "--git-common-dir"]) {
        const ran = await mayRun(vscode.workspace, "git", ["-C", root, "rev-parse", question], { timeoutMs: 10000, maxBuffer: 1024 * 1024 });
        if (!ran) { return; }                                             // Restricted Mode: git was not asked
        const answer = ran.exit === 0 ? ran.stdout.replace(/\r?\n$/, "") : "";
        if (answer !== "") { folders.add(path.resolve(root, answer)); }
      }
      if (this.per.get(projectKey(per.project)) !== per) { return; }      // the settings changed meanwhile
      const found = per.git.found([...folders]);
      if (found.replace) {
        for (const watcher of per.gitWatchers) { watcher.dispose(); }
        per.gitWatchers = [];
        for (const folder of folders) { this.watch(per, folder, "{HEAD,packed-refs,shallow,refs/**}", false, per.gitWatchers); }
      }
      if (found.touch) { this.touch(per); }                               // history changed while nobody watched it
    }).catch(() => undefined);
    return per.gitWork;
  }

  /** Something the checker reads may have changed: the generation moves on, and the fingerprint is asked after
   *  1500 ms of quiet. Also called after a finished Create. */
  inputChanged(project: Project): void {
    const per = this.per.get(projectKey(project));
    if (per) { this.touch(per); }
  }

  private touch(per: Per): void {
    per.checks.changed();
    this.soon(per);
  }

  /** A fingerprint call for the current generation is due, 1500 ms after the last event. */
  private soon(per: Per): void {
    const first = per.timer === undefined;
    if (per.timer) { clearTimeout(per.timer); }
    per.timer = setTimeout(() => { per.timer = undefined; this.confirm(per); }, QUIET_MS);
    if (first) { this.changed(); }       // the badges fell to "not checked"; further events of this burst change nothing more
  }

  /** Starts the checker for one source file. Undefined when the workspace is not trusted: nothing was started. */
  private run(project: Project, sourceRel: string, mode: "--json" | "--fingerprint"): Promise<Ran> | undefined {
    // argus.python is read from the user's own settings only; a workspace cannot choose the program.
    const python = userPython(vscode.workspace.getConfiguration("argus").inspect<unknown>("python"));
    const checker = vscode.Uri.joinPath(this.context.extensionUri, "scripts", "check_notes.py").fsPath;
    return mayRun(vscode.workspace, python, checkerArgs(checker, project, sourceRel, mode), LIMITS);
  }

  /** Asks the fingerprint for every stored result that waits for an answer for the current generation. */
  private confirm(per: Per): void {
    per.work = per.work.then(async () => {
      if (this.per.get(projectKey(per.project)) !== per || per.checks.due().length === 0) { return; }
      if (!vscode.workspace.isTrusted) { return; }             // onDidGrantWorkspaceTrust starts these calls
      await this.watchGraph(per);                              // where the graph leads is asked again before a confirmation
      await this.index.refreshNow(per.project).catch(() => undefined);
      for (const sourceRel of per.checks.due()) {
        const startedAt = per.checks.begin();
        const ran = await this.run(per.project, sourceRel, "--fingerprint");
        if (!ran) { return; }
        per.checks.fingerprintDone(sourceRel, startedAt, fingerprintOf(ran.exit, ran.stdout));
        if (!per.checks.accept(startedAt)) { break; }          // the event that moved the generation asks again
      }
      this.changed();
    }).catch(() => undefined);
  }

  /** "Argus: Check notes" for a document. Returns a sentence for the panel when there is one to say. */
  async check(document: vscode.TextDocument | undefined): Promise<string | undefined> {
    if (!document) { return "open a file first; nothing was checked"; }
    const at = this.index.locate(document);
    if (!at.project || at.sourceRel === undefined) { return "this file is not in an Argus project; nothing was checked"; }
    const done = await this.checkAt(at.project, at.sourceRel);
    return done.always || !at.note ? done.say : undefined;      // with a note, the badge in the panel says it
  }

  /** Runs the check for one source file of a project. `say`: the outcome as a sentence; `always`: nothing was
   *  run, and the sentence says why; `used`: the result was stored for the current generation. Create (piece 7)
   *  calls this at the end of a run, when the document may be closed already. */
  async checkAt(project: Project, key: string): Promise<{ say?: string; always?: boolean; used: boolean }> {
    const per = this.per.get(projectKey(project));
    if (!per) { return { say: "this file is not in an Argus project; nothing was checked", always: true, used: false }; }
    if (!vscode.workspace.isTrusted) { return { say: `not checked: ${RESTRICTED}`, always: true, used: false }; }
    if (per.running.has(key)) { return { used: false }; }
    await this.watchGraph(per);                                // where the graph leads is asked again before a check
    per.running.add(key);
    this.changed();
    let used = false;
    try {
      if (!per.git.watched) { await this.watchGit(per); }                 // a repository made since git was last asked
      await this.index.refreshNow(project).catch(() => undefined);        // the panel and the checker speak of the same notes
      const startedAt = per.checks.begin();
      const ran = await this.run(project, key, "--json");
      if (!ran) { return { say: `not checked: ${RESTRICTED}`, always: true, used: false }; }
      const outcome: Outcome = ran.exit === null
        ? { state: "error", reason: `${ran.reason ?? "the checker did not run"}${ran.started ? "" : "; see the setting argus.python"}` }
        : stateOf(ran.exit, ran.stdout, key);
      // A result for an older generation is thrown away; a fingerprint call for the current one is due.
      used = per.checks.checkDone(key, startedAt, outcome, Date.now());
      if (!used) { this.soon(per); }
    } finally {
      per.running.delete(key);
      this.changed();
    }
    const shown = per.checks.shown(key);
    return { used, say: "outcome" in shown ? `${key}: ${badgeOf(shown.outcome, "").label}${shown.outcome.reason ? ` (${shown.outcome.reason})` : ""}`
      : `${key}: not checked: ${shown.why}` };
  }

  /** The validation badge of a file's note. */
  badge(project: Project, sourceRel: string, note: Entry): Badge {
    const per = this.per.get(projectKey(project));
    if (!vscode.workspace.isTrusted) { return { label: "not checked", why: RESTRICTED }; }
    if (!per) { return { label: "not checked", why: "no check has been run" }; }
    if (per.running.has(sourceRel)) { return { label: "not checked", why: "the check is running…" }; }
    const shown = per.checks.shown(sourceRel);
    if ("why" in shown) { return { label: "not checked", why: shown.why }; }
    return badgeOf(shown.outcome, note.name, shown.time === undefined ? undefined : `last check: ${new Date(shown.time).toLocaleString()}`, sourceRel);
  }

  dispose(): void {
    for (const per of this.per.values()) { this.stop(per); }
    this.per.clear();
    for (const listener of this.listeners) { listener.dispose(); }
  }
}
