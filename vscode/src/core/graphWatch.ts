// Which files stand for the graph of a project, and whether an event names one of them. No import of "vscode".
// A stored check depends on the graph file. The graph may be a link: then the file it leads to is watched too.
// A watcher takes a pattern, and a file name may hold pattern signs ("graph[1].json"): so the folder is watched
// and each event is compared with the file's path, letter for letter.

import * as path from "node:path";

function key(file: string, windows: boolean): string {
  const tidy = windows ? path.win32.normalize(file) : path.posix.normalize(file);
  return windows ? tidy.toLowerCase() : tidy;
}

/** Whether the path of an event is this very file. Windows compares without regard to letter case. */
export function isPlace(seen: string, place: string, windows: boolean): boolean {
  return key(seen, windows) === key(place, windows);
}

/** The files to watch for a graph: the configured path, and the path it really leads to when that is another
 *  file. `real` is undefined when the path leads nowhere. */
export function graphPlaces(graph: string, real: string | undefined, windows: boolean): string[] {
  return real === undefined || isPlace(real, graph, windows) ? [graph] : [graph, real];
}
