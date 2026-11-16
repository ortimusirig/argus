// Which of several File notes for one source file the person picked. No import of "vscode". Kept for this session
// only. A pick changes which note the panel and the editor's markers show, and it may change nothing else: the
// picked note's assignment may be matched and published already. So every pick is told to the listener.

export class Choices {
  private readonly picked = new Map<string, number>();     // a source file of a project: the id of the picked note

  /** `changed` is called at each pick: all that shows a file's note draws again. */
  constructor(private readonly changed: () => void) {}

  /** The person picked the note of this id for the source file of this key. */
  choose(key: string, id: number): void {
    this.picked.set(key, id);
    this.changed();
  }

  /** The note to use for the source file: the only one, or the picked one of several; none when none is picked. */
  of<T extends { id: number }>(key: string, notes: readonly T[]): T | undefined {
    if (notes.length === 1) { return notes[0]; }
    const picked = this.picked.get(key);
    return notes.find((note) => note.id === picked);
  }
}
