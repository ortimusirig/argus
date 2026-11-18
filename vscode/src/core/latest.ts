// The order rule between what the person asked for and the late "follow" of the selection. No import of "vscode".
// The panel follows the selection 200 ms after it moved, and then drops what it kept: the pinned lines of a
// CodeLens, a shown note, a notice. A thing asked for after the selection moved is newer than that move: the late
// follow must leave it alone. Each kept thing remembers when it was asked for; the last move remembers when it was.

export type Kept = "pinned" | "shown" | "notice" | "whole";

export class Latest {
  private turn = 0;
  private movedAt = 0;
  private readonly askedAt = new Map<Kept, number>();

  /** The person asked for this thing now (a CodeLens, a link, a pick, a notice). */
  asked(...kept: Kept[]): void {
    this.turn++;
    for (const name of kept) { this.askedAt.set(name, this.turn); }
  }

  /** The selection, the editor or the text changed now. */
  moved(): void {
    this.movedAt = ++this.turn;
  }

  /** Whether the follow may drop this thing: only when the selection moved after it was asked for. */
  stale(kept: Kept): boolean {
    return (this.askedAt.get(kept) ?? 0) < this.movedAt;
  }
}
