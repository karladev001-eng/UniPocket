import { ApiError, type Article } from "./api";

type ArticleBody = Pick<Article, "title" | "publicUrl" | "embedUrl" | "summary" | "category" | "courseId">;
type Send = <T>(path: string, method: string, body: unknown, headers?: Record<string, string>) => Promise<T>;

// Persist the exact payload before posting. After a lost response, recover the same
// creation before applying later edits, rather than reusing its key for new content.
export async function submitNewArticle(
  draft: Record<string, string>, body: ArticleBody, send: Send, persist: () => Promise<void>,
): Promise<{ article: Article }> {
  if (!draft.pendingBody) {
    draft.pendingBody = JSON.stringify(body);
  }
  await persist();
  const original = JSON.parse(draft.pendingBody) as ArticleBody;
  let result: { article: Article };
  try {
    result = await send("/articles", "POST", original, { "Idempotency-Key": draft.key });
  } catch (e) {
    // Only deterministic payload rejection permits corrected input. A rate limit
    // or auth failure can precede idempotency lookup on a retry whose earlier
    // request already committed, so it must retain the original snapshot.
    if (e instanceof ApiError && ([400, 413, 415].includes(e.status) || e.code === "duplicate_url")) {
      delete draft.pendingBody;
      await persist();
    }
    throw e;
  }
  if (JSON.stringify(body) !== draft.pendingBody)
    result = await send("/articles/" + encodeURIComponent(result.article.id), "PATCH", body, { "If-Match": String(result.article.revision) });
  return result;
}
