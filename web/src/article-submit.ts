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
    // These explicit failures cannot have created an article. Allow corrected input.
    if (e instanceof ApiError && ((e.status >= 400 && e.status < 409) || e.status === 429 || e.code === "duplicate_url")) {
      delete draft.pendingBody;
      await persist();
    }
    throw e;
  }
  if (JSON.stringify(body) !== draft.pendingBody)
    result = await send("/articles/" + encodeURIComponent(result.article.id), "PATCH", body);
  return result;
}
