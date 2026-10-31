import { type Article, type Sender } from "./model";
/** A confirmation owns one immutable intent/key, including retries after a lost response. */
export class VisibilityOperation {
  readonly key = crypto.randomUUID();
  readonly input: {
    revision: number;
    visibility: "hidden" | "published";
    reason: string;
  };
  constructor(
    readonly articleId: string,
    revision: number,
    visibility: "hidden" | "published",
    reason: string,
  ) {
    const text = reason.trim();
    if (visibility === "hidden" && (!text || text.length > 500))
      throw Error("非表示の理由は1〜500文字で入力してください。");
    this.input = Object.freeze({
      revision,
      visibility,
      reason: visibility === "hidden" ? text : "",
    });
  }
  async submit(send: Sender): Promise<Article> {
    return (
      await send<{
        article: Article;
      }>(
        "/articles/" + encodeURIComponent(this.articleId) + "/visibility",
        "POST",
        this.input,
        { "Idempotency-Key": this.key },
      )
    ).article;
  }
}
/** Server-backed cursor pages. A newer filter always wins over an older network response. */
export class AdminPages<
  T extends {
    id: string;
  },
> {
  items: T[] = [];
  nextCursor: string | null = null;
  loading = false;
  private epoch = 0;
  private filters: Record<string, string> = {};
  constructor(
    readonly kind: "articles" | "reports",
    private send: Sender,
  ) {}
  async reset(filters: Record<string, string>): Promise<boolean> {
    this.filters = { ...filters };
    this.items = [];
    this.nextCursor = null;
    return this.fetchPage(++this.epoch, null);
  }
  async more(): Promise<boolean> {
    if (this.loading || !this.nextCursor) return false;
    return this.fetchPage(this.epoch, this.nextCursor);
  }
  private async fetchPage(
    epoch: number,
    cursor: string | null,
  ): Promise<boolean> {
    this.loading = true;
    const query = new URLSearchParams({
      ...this.filters,
      limit: "50",
      ...(cursor ? { cursor } : {}),
    });
    try {
      const data = await this.send<Record<string, unknown>>(
        "/" + this.kind + "?" + query.toString(),
      );
      if (epoch !== this.epoch) return false;
      const rows = data[this.kind] as T[];
      const previous = cursor ? this.items : [];
      this.items = [
        ...previous,
        ...rows.filter((row) => !previous.some((item) => item.id === row.id)),
      ];
      this.nextCursor =
        typeof data.nextCursor === "string" && data.nextCursor
          ? data.nextCursor
          : null;
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      throw error;
    } finally {
      if (epoch === this.epoch) this.loading = false;
    }
  }
}
export async function reportArticle(
  articleId: string,
  send: Sender,
): Promise<Article> {
  return (
    await send<{
      article: Article;
    }>("/articles/" + encodeURIComponent(articleId))
  ).article;
}
