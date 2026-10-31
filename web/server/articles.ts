import type { Article, Database, User } from "./types.ts";
import { ApiError } from "./validation.ts";
// Article SQL fragments, row mapping, cursor parsing and the single-article lookup.
export const ARTICLE_COLUMNS = `a.id, a.author_id AS authorId, p.display_name AS authorName, CASE WHEN a.author_kind='admin' THEN 'admin' ELSE 'user' END AS authorKind,
 a.title, a.public_url AS publicUrl, a.embed_url AS embedUrl, a.summary, a.category,
 a.course_id AS courseId, a.created_at AS createdAt, a.updated_at AS updatedAt,
 a.view_count AS viewCount, a.revision,
 (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) AS bookmarkCount,
 EXISTS(SELECT 1 FROM bookmarks b WHERE b.article_id=a.id AND b.user_id=?) AS bookmarked,
 (a.author_id=? AND a.author_kind='user') AS canEdit`;
export const ARTICLE_FROM =
  " FROM articles a JOIN profiles p ON p.id=a.author_id";
export const SELECT = `SELECT ${ARTICLE_COLUMNS}${ARTICLE_FROM}`;
export function article(row: Article): Article {
  return { ...row, bookmarked: !!row.bookmarked, canEdit: !!row.canEdit };
}
export interface PopularCursor {
  sort: "popular";
  version: 1;
  startDay: string;
  endDay: string;
  rankKey: number;
  createdAt: string;
  id: string;
}
function validDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validPosition(createdAt: unknown, id: unknown): boolean {
  return (
    typeof createdAt === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) &&
    Number.isFinite(Date.parse(createdAt)) &&
    new Date(createdAt).toISOString() === createdAt &&
    typeof id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  );
}
export function readCursor(
  value: string | null,
  sort: "popular" | "newest",
): PopularCursor | [string, string] | null {
  if (value === null) return null;
  const invalid = () => new ApiError(400, "cursorが不正です。");
  if (!value || value.length > 1024) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(value));
  } catch {
    throw invalid();
  }
  if (sort === "newest") {
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !validPosition(parsed[0], parsed[1])
    )
      throw invalid();
    return parsed as [string, string];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw invalid();
  const cursor = parsed as PopularCursor;
  if (
    Object.keys(cursor).sort().join(",") !==
      "createdAt,endDay,id,rankKey,sort,startDay,version" ||
    cursor.sort !== "popular" ||
    cursor.version !== 1 ||
    !validDay(cursor.startDay) ||
    !validDay(cursor.endDay) ||
    Date.parse(cursor.endDay) - Date.parse(cursor.startDay) !== 6 * 86400000 ||
    !Number.isSafeInteger(cursor.rankKey) ||
    cursor.rankKey < 0 ||
    !validPosition(cursor.createdAt, cursor.id)
  )
    throw invalid();
  return cursor;
}
export async function getArticle(
  db: Database,
  id: string,
  user: User | null,
  own = false,
): Promise<Article> {
  const row = await db
    .prepare(
      `${own ? SELECT.replace(ARTICLE_FROM, ", a.visibility, a.hidden_reason AS hiddenReason" + ARTICLE_FROM) : SELECT} WHERE a.id=? AND (a.visibility='published'${own ? " OR (a.author_id=? AND a.visibility='hidden')" : ""})`,
    )
    .bind(user?.id || "", user?.id || "", id, ...(own ? [user?.id || ""] : []))
    .first<Article>();
  if (!row) throw new ApiError(404, "記事が見つかりません。", "not_found");
  return article(row);
}
