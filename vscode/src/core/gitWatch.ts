// When git's folders are watched, and what an event under the source root means until they are. No import of
// "vscode". A stored check depends on git's history. The watcher on the source root sees everything git writes in
// `.git`, most of it noise (the index, the objects); so git is asked where it keeps its data, and HEAD and the refs
// there get watchers of their own. But git can only be asked about a repository that is there: one made after the
// window opened must be found later. Until its folders are watched, an event in `.git` is not noise: it says "ask
// git again".

/** Where a path under the source root stands to git's folder: it is a `.git`, it lies inside one, or neither. */
export function gitPart(rel: string): "none" | "itself" | "inside" {
  const parts = rel.split(/[\\/]/);
  const at = parts.indexOf(".git");
  return at < 0 ? "none" : at === parts.length - 1 ? "itself" : "inside";
}

/** What follows from an event of the source watcher: `touch`, something the checker reads may have changed;
 *  `discover`, git is to be asked again where its folders are. */
export interface Seen { touch: boolean; discover: boolean; }
/** What follows from git's answer: `replace`, the git watchers are set anew on the folders named; `touch`,
 *  something the checker reads may have changed. */
export interface Found { replace: boolean; touch: boolean; }

export class GitWatch {
  private folders: string[] = [];    // the folders the git watchers are on
  private first = true;              // git has not answered yet
  private missed = false;            // an event in `.git` came while no git watcher was there to judge it
  private stale = false;             // the watched folders may be gone: the next answer sets the watchers anew

  /** Whether git's folders are watched. */
  get watched(): boolean { return this.folders.length > 0 && !this.stale; }

  /** An event of the watcher on the source root, for a path given from that root. */
  seen(rel: string, kind: "create" | "change" | "delete"): Seen {
    const part = gitPart(rel);
    if (part === "none") { return { touch: true, discover: false }; }
    if (part === "itself") {
      // A `.git` came or went: a repository was made or deleted. A deleted one takes the watched folders with it.
      if (kind === "delete") { this.stale = true; }
      const discover = !this.watched;
      if (discover) { this.missed = true; }
      return { touch: true, discover };
    }
    if (this.watched) { return { touch: false, discover: false }; }     // the git watchers speak for HEAD and the refs
    this.missed = true;
    return { touch: false, discover: true };
  }

  /** Git answered where the repository keeps its data: no folder when there is no repository. Not called when
   *  git could not be asked (Restricted Mode). The first answer at the start is no input change by itself: the
   *  start asks the fingerprint anyway. A later answer that differs is one, and so is an answer that names a
   *  repository after events in `.git` went by unwatched. */
  found(folders: readonly string[]): Found {
    const now = [...new Set(folders)].sort();
    const differs = now.length !== this.folders.length || now.some((folder, n) => folder !== this.folders[n]);
    const replace = differs || (this.stale && now.length > 0);
    const touch = (differs && !this.first) || ((this.missed || this.stale) && now.length > 0);
    this.folders = now;
    this.first = false;
    this.missed = false;
    this.stale = false;
    return { replace, touch };
  }
}
