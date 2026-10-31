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
export function appendUnique<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const ids = new Set(current.map((a) => a.id));
  return [
    ...current,
    ...incoming.filter((a) => {
      if (ids.has(a.id)) return false;
      ids.add(a.id);
      return true;
    }),
  ];
}

// A list redraw may replace controls while a mutation is in flight.
export class BookmarkRequests {
  private pending = new Set<string>();
  private settled = new Map<
    string,
    { revision: number; state: BookmarkState }
  >();
  revision = 0;
  has(id: string) {
    return this.pending.has(id);
  }
  async update(
    id: string,
    request: () => Promise<BookmarkState>,
    apply: (state: BookmarkState) => void,
    sync: () => void,
  ) {
    if (this.pending.has(id)) return;
    this.pending.add(id);
    try {
      sync();
      const state = await request();
      this.settled.set(id, { revision: ++this.revision, state });
      apply(state);
    } finally {
      this.pending.delete(id);
      sync();
    }
  }
  // A GET started before a successful local mutation must not restore its old count.
  reconcile<T extends BookmarkState & { id: string }>(
    incoming: T[],
    requestRevision: number,
  ): T[] {
    return incoming.map((article) => {
      const local = this.settled.get(article.id);
      return local && local.revision > requestRevision
        ? { ...article, ...local.state }
        : article;
    });
  }
}
