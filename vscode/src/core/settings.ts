// Reads the extension's settings from what VS Code gives. No import of "vscode".

import { Project } from "./projects";

/** The values the design gives; used when the user has set none. */
export const DEFAULT_CREATE_COMMAND: readonly string[] = ["claude",
  "Use the argus skill. Explain ${file}, depth ${depth}. Source root: ${sourceRoot}. Put the notes in ${notesFolder}."];
export const DEFAULT_UPDATE_COMMAND: readonly string[] = ["claude",
  "Use the argus skill. Update the explanation of ${file}: run changed_blocks.py, then rewrite only the changed blocks and add blocks "
  + "for unexplained lines. Depth ${depth}. Source root: ${sourceRoot}. Notes folder: ${notesFolder}."];
export const DEFAULT_PYTHON = "python";

/** What `WorkspaceConfiguration.inspect()` answers. Only `globalValue`, the user's own, is ever read here. */
export interface Inspected { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown; defaultValue?: unknown; }

/** `argus.createCommand`, or `argus.updateCommand` for an Update: the user's own list of strings, else the
 *  extension's constant for that kind of run. A workspace cannot set either. */
export function userCommand(inspected: Inspected | undefined, kind: "create" | "update" = "create"): string[] {
  const own = inspected?.globalValue;
  if (Array.isArray(own) && own.length > 0 && own.every((part) => typeof part === "string") && own[0] !== "") { return [...own]; }
  return [...(kind === "update" ? DEFAULT_UPDATE_COMMAND : DEFAULT_CREATE_COMMAND)];
}

/** `argus.python`: the user's own value, else the extension's constant. A workspace cannot set it. */
export function userPython(inspected: Inspected | undefined): string {
  const own = inspected?.globalValue;
  return typeof own === "string" && own !== "" ? own : DEFAULT_PYTHON;
}

/** `argus.createModel`: the user's own value as it was written, or the empty text when there is none. A workspace
 *  cannot set it. Whether the value is a model name is decided by `modelArgs` (core/create.ts). */
export function userModel(inspected: Inspected | undefined): unknown {
  return inspected?.globalValue ?? "";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `argus.projects`: the entries that name a source root and a notes folder; anything else is left out. */
export function projectsFrom(value: unknown): Project[] {
  const projects: Project[] = [];
  const seen = new Set<string>();                  // the same entry written twice is one project
  if (!Array.isArray(value)) { return projects; }
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) { continue; }
    const given = entry as Record<string, unknown>;
    const sourceRoot = text(given.sourceRoot), notesFolder = text(given.notesFolder);
    if (!sourceRoot || !notesFolder) { continue; }
    const project: Project = { sourceRoot, notesFolder };
    const vaultFolder = text(given.vaultFolder), graph = text(given.graph);
    if (vaultFolder) { project.vaultFolder = vaultFolder; }
    if (graph) { project.graph = graph; }
    const key = projectKey(project);
    if (seen.has(key)) { continue; }
    seen.add(key);
    projects.push(project);
  }
  return projects;
}

/** `argus.createDepth`. */
export function createDepth(value: unknown): "map" | "full" {
  return value === "map" ? "map" : "full";
}

/** One text for one project: the same settings give the same key. */
export function projectKey(project: Project): string {
  return JSON.stringify([project.sourceRoot, project.notesFolder, project.vaultFolder ?? null, project.graph ?? null]);
}
