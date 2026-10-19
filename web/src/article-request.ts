/** A route can be revisited while an older request for that same route is pending. */
export class ViewEpoch {
  private generation = 0;
  advance() {
    this.generation++;
  }
  scope(expectedHash: string, currentHash: () => string): () => boolean {
    const generation = this.generation;
    return () =>
      this.generation === generation && currentHash() === expectedHash;
  }
}
export interface BookmarkState {
  bookmarked: boolean;
  bookmarkCount: number;
}
export async function updateBookmark(
  article: BookmarkState,
  request: () => Promise<BookmarkState>,
  isCurrent: () => boolean,
  redraw: () => void,
) {
  const result = await request();
  article.bookmarked = result.bookmarked;
  article.bookmarkCount = result.bookmarkCount;
  if (isCurrent()) redraw();
}

// Rank changes between pages may repeat IDs. Preserve the visible order and card state.
export function appendUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const ids = new Set(current.map(a => a.id));
  return [...current, ...incoming.filter(a => { if (ids.has(a.id)) return false; ids.add(a.id); return true; })];
}
