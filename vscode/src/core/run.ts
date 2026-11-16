// Starts a program. No import of "vscode". `mayRun` is the trust guard and the one place in the extension that
// starts a process: with an argument list, without a shell, and only in a trusted workspace.

import { execFile } from "node:child_process";
import { Project } from "./projects";

/** How a run ended. `exit` is null when the program did not start or was stopped (a signal, the time limit, too
 *  much output); `reason` then says which. */
export interface Ran { started: boolean; exit: number | null; stdout: string; reason?: string; }

export interface RunOptions { cwd?: string; timeoutMs?: number; maxBuffer?: number; }

/**
 * Runs `program` with `args` when the workspace is trusted. Not trusted: nothing is started and the answer is
 * undefined. The promise never rejects: a failure to start is an answer too.
 */
export function mayRun(trust: { isTrusted: boolean }, program: string, args: readonly string[], options: RunOptions = {}): Promise<Ran> | undefined {
  if (!trust.isTrusted) { return undefined; }
  return new Promise<Ran>((resolve) => {
    try {
      execFile(program, [...args], { cwd: options.cwd, timeout: options.timeoutMs ?? 120000, maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
        windowsHide: true, shell: false, encoding: "utf8" }, (error, stdout) => {
        if (!error) { resolve({ started: true, exit: 0, stdout }); return; }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: string | number | null };
        if (typeof failure.code === "number") { resolve({ started: true, exit: failure.code, stdout }); return; }
        if (failure.killed || failure.signal) {
          resolve({ started: true, exit: null, stdout, reason: `the program was stopped (${failure.signal ?? "time limit"})` });
          return;
        }
        const started = typeof failure.code === "string" && failure.code.startsWith("ERR_CHILD_PROCESS");   // too much output
        resolve({ started, exit: null, stdout: typeof stdout === "string" ? stdout : "",
          reason: started ? `the program was stopped: ${failure.message}` : `could not start '${program}': ${failure.message}` });
      });
    } catch (error) {
      resolve({ started: false, exit: null, stdout: "", reason: `could not start '${program}': ${error instanceof Error ? error.message : String(error)}` });
    }
  });
}

/**
 * The same guard for a VS Code task (Create runs the agent as one): hands `task` to `tasks` when the workspace is
 * trusted. Not trusted: nothing is started and the answer is undefined. This is the one place that starts a task.
 * The task holds a program and an argument list (a ProcessExecution), never a shell line; src/create.ts builds it.
 */
export function mayStart<T, E>(trust: { isTrusted: boolean }, tasks: { executeTask: (task: T) => PromiseLike<E> }, task: T): PromiseLike<E> | undefined {
  if (!trust.isTrusted) { return undefined; }
  return tasks.executeTask(task);
}

/** The arguments of the checker for one source file of a project: `--json` for a check, `--fingerprint` to ask
 *  whether a stored result is still valid. */
export function checkerArgs(checker: string, project: Project, sourceRel: string, mode: "--json" | "--fingerprint"): string[] {
  return ["-B", checker, mode, "--notes", project.notesFolder, "--source", project.sourceRoot, "--scope", sourceRel,
    ...(project.vaultFolder ? ["--vault", project.vaultFolder] : []),
    ...(project.graph ? ["--graph", project.graph] : ["--no-graph"])];
}
