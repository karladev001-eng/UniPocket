import type { Article, Env, Issued, User } from "../types.ts";
import {
  ifMatch,
  conflict,
  digest,
  jstDay,
  rate,
  response,
} from "../shared.ts";
import { ApiError, articleInput, jsonBody, textField } from "../validation.ts";
import {
  ARTICLE_COLUMNS,
  ARTICLE_FROM,
  SELECT,
  article,
  getArticle,
  readCursor,
} from "../articles.ts";
import { createSession, requireUser } from "../session.ts";
// Article endpoints: collection (/api/articles), own list (/api/my/articles) and
// single-article actions (/api/articles/:id[/bookmark|/view|/report]).
async function listArticles(
  url: URL,
  env: Env,
  user: User | null,
): Promise<Response> {
  const sort = url.searchParams.get("sort") ?? "newest";
  if (sort !== "popular" && sort !== "newest")
    throw new ApiError(400, "sortが不正です。");
  const cursor = readCursor(url.searchParams.get("cursor"), sort);
  const popularCursor = cursor && !Array.isArray(cursor) ? cursor : null;
  // The calendar window travels with the cursor; ranks themselves may change.
  const endDay = popularCursor?.endDay ?? jstDay();
  const startDay =
    popularCursor?.startDay ??
    new Date(Date.parse(endDay) - 6 * 86400000).toISOString().slice(0, 10);
  const q = textField(url.searchParams.get("q") || "", "q", 120);
  const conditions: string[] = ["a.visibility='published'"];
  const values: unknown[] = [user?.id || "", user?.id || ""];
  if (sort === "popular") values.push(startDay, endDay);
  for (const [param, column] of [
    ["category", "a.category"],
    ["courseId", "a.course_id"],
    ["authorId", "a.author_id"],
  ] as const) {
    const value = textField(url.searchParams.get(param) || "", param, 120);
    if (value) {
      conditions.push(`${column}=?`);
      values.push(value);
    }
  }
  if (q) {
    conditions.push(
      "(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')",
    );
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    values.push(pattern, pattern);
  }
  if (url.searchParams.get("bookmarked") === "1") {
    user = requireUser(user);
    conditions.push(
      "EXISTS(SELECT 1 FROM bookmarks mine WHERE mine.article_id=a.id AND mine.user_id=?)",
    );
    values.push(user.id);
  }
  const limitString = url.searchParams.get("limit") || "20";
  if (!/^\d+$/.test(limitString) || +limitString < 1 || +limitString > 50)
    throw new ApiError(400, "limitは1–50です。");
  const limit = +limitString;
  if (Array.isArray(cursor)) {
    conditions.push("(a.created_at < ? OR (a.created_at=? AND a.id<?))");
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  let sql = `${SELECT}${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ?`;
  if (sort === "popular") {
    // Rank the entire filtered population in SQL before applying the page limit.
    sql = `WITH ranked AS (SELECT ${ARTICLE_COLUMNS},
  (SELECT COUNT(*) FROM view_events v WHERE v.article_id=a.id AND v.day_jst>=? AND v.day_jst<=?)
  + 3 * (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) AS rankKey
  ${ARTICLE_FROM}${where}) SELECT * FROM ranked`;
    if (popularCursor) {
      sql +=
        " WHERE (rankKey<? OR (rankKey=? AND (createdAt<? OR (createdAt=? AND id<?))))";
      values.push(
        popularCursor.rankKey,
        popularCursor.rankKey,
        popularCursor.createdAt,
        popularCursor.createdAt,
        popularCursor.id,
      );
    }
    sql += " ORDER BY rankKey DESC,createdAt DESC,id DESC LIMIT ?";
  }
  const result = await env.DB.prepare(sql)
    .bind(...values, limit + 1)
    .all<
      Article & {
        rankKey?: number;
      }
    >();
  const rows = result.results.slice(0, limit);
  const articles = rows.map(({ rankKey: _rankKey, ...row }) => article(row));
  const last = rows.at(-1);
  const next =
    last &&
    (sort === "popular"
      ? {
          sort,
          version: 1,
          startDay,
          endDay,
          rankKey: last.rankKey,
          createdAt: last.createdAt,
          id: last.id,
        }
      : [last.createdAt, last.id]);
  return response({
    articles,
    nextCursor:
      result.results.length > limit && next ? btoa(JSON.stringify(next)) : null,
  });
}
async function createArticle(
  request: Request,
  env: Env,
  user: User | null,
): Promise<Response> {
  user = requireUser(user);
  const input = articleInput(await jsonBody(request)) as Required<
    ReturnType<typeof articleInput>
  >;
  const requestKey =
    request.headers.get("Idempotency-Key") || crypto.randomUUID();
  if (!/^[\w.-]{8,128}$/.test(requestKey))
    throw new ApiError(400, "Idempotency-Keyが不正です。");
  const hash = await digest(JSON.stringify(input));
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO create_keys(user_id,request_key,request_hash,article_id,created_at) VALUES(?,?,?,?,?)",
    ).bind(user.id, requestKey, hash, newId, Math.floor(Date.now() / 1000)),
    env.DB.prepare(
      `INSERT INTO articles(id,author_id,public_url,embed_url,title,summary,category,course_id,created_at,updated_at)
  SELECT ?,?,?,?,?,?,?,?,?,? FROM create_keys k WHERE k.user_id=? AND k.request_key=? AND k.request_hash=? AND k.article_id=?`,
    ).bind(
      newId,
      user.id,
      input.publicUrl,
      input.embedUrl,
      input.title,
      input.summary,
      input.category,
      input.courseId,
      now,
      now,
      user.id,
      requestKey,
      hash,
      newId,
    ),
  ]);
  const key = await env.DB.prepare(
    "SELECT request_hash,article_id FROM create_keys WHERE user_id=? AND request_key=?",
  )
    .bind(user.id, requestKey)
    .first<{
      request_hash: string;
      article_id: string;
    }>();
  if (!key || key.request_hash !== hash)
    throw new ApiError(
      409,
      "同じ送信キーで内容が変更されています。",
      "idempotency_conflict",
    );
  const row = await env.DB.prepare(
    "SELECT id FROM articles WHERE id=? AND visibility!='deleted'",
  )
    .bind(key.article_id)
    .first();
  if (!row)
    throw new ApiError(
      410,
      "この送信で作成した記事は削除済みです。",
      "article_deleted",
    );
  return response(
    { article: await getArticle(env.DB, key.article_id, user, true) },
    201,
  );
}
export async function articlesRoute(
  request: Request,
  env: Env,
  user: User | null,
): Promise<Response> {
  const method = request.method;
  if (method === "GET") return listArticles(new URL(request.url), env, user);
  if (method === "POST") return createArticle(request, env, user);
  throw new ApiError(405, "未対応の操作です。", "method_not_allowed");
}
export async function myArticlesRoute(
  env: Env,
  user: User | null,
): Promise<Response> {
  user = requireUser(user);
  const rows = await env.DB.prepare(
    `${SELECT.replace(ARTICLE_FROM, ", a.visibility, a.hidden_reason AS hiddenReason" + ARTICLE_FROM)} WHERE a.author_id=? AND a.author_kind='user' AND a.visibility!='deleted' ORDER BY a.created_at DESC,a.id DESC`,
  )
    .bind(user.id, user.id, user.id)
    .all<Article>();
  return response({ articles: rows.results.map(article) });
}
export async function articleItemRoute(
  request: Request,
  env: Env,
  user: User | null,
  issued: Issued,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const match =
    /^\/api\/articles\/([a-f0-9-]{36})(?:\/(bookmark|view|report))?$/.exec(
      path,
    );
  if (!match) throw new ApiError(404, "見つかりません。", "not_found");
  const [, id, action] = match;
  const authorMutation = !action && (method === "PATCH" || method === "DELETE");
  const existing = await getArticle(env.DB, id, user, authorMutation);
  if (!action && method === "GET") return response({ article: existing });
  if (!action && (method === "PATCH" || method === "DELETE")) {
    user = requireUser(user);
    if (existing.authorKind === "admin" || existing.authorId !== user.id)
      throw new ApiError(403, "自分の記事だけを変更できます。", "forbidden");
    const expected = ifMatch(request);
    if (existing.revision !== expected) conflict();
    if (method === "DELETE") {
      const changed = await env.DB.prepare(
        "UPDATE articles SET visibility='deleted',public_url='deleted:'||id,embed_url='',title='削除済み記事',summary='',category='',course_id='',hidden_reason='',revision=revision+1,updated_at=? WHERE id=? AND author_id=? AND revision=? AND visibility!='deleted' RETURNING id",
      )
        .bind(new Date().toISOString(), id, user.id, expected)
        .first();
      if (!changed) conflict();
      return response({ ok: true });
    }
    const input = articleInput(await jsonBody(request), true);
    const columns = {
      title: "title",
      publicUrl: "public_url",
      embedUrl: "embed_url",
      summary: "summary",
      category: "category",
      courseId: "course_id",
    };
    const entries = Object.entries(input) as [keyof typeof columns, string][];
    const changed = await env.DB.prepare(
      `UPDATE articles SET ${entries.map(([key]) => `${columns[key]}=?`).join(",")},updated_at=?,revision=revision+1 WHERE id=? AND author_id=? AND revision=? AND visibility!='deleted' RETURNING id`,
    )
      .bind(
        ...entries.map(([, value]) => value),
        new Date().toISOString(),
        id,
        user.id,
        expected,
      )
      .first();
    if (!changed) conflict();
    return response({ article: await getArticle(env.DB, id, user, true) });
  }
  if (action === "report" && method === "POST") {
    user = requireUser(user);
    const body = await jsonBody(request);
    if (
      Object.keys(body).some((k) => !["reason", "details"].includes(k)) ||
      !["inappropriate", "incorrect", "broken_link", "other"].includes(
        String(body.reason),
      )
    )
      throw new ApiError(400, "通報理由が不正です。");
    const details = textField(body.details ?? "", "details", 500);
    await rate(env.DB, `report:${user.id}`, 10, 3600);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO article_reports(id,article_id,user_id,reason,details,created_at,updated_at) SELECT ?,?,?,?,?,?,? FROM articles WHERE id=? AND visibility='published'",
    )
      .bind(
        crypto.randomUUID(),
        id,
        user.id,
        body.reason,
        details,
        now,
        now,
        id,
      )
      .run();
    await getArticle(env.DB, id, user);
    return response({ ok: true });
  }
  if (action === "bookmark" && (method === "PUT" || method === "DELETE")) {
    user = requireUser(user);
    if (method === "PUT") {
      const body = await jsonBody(request);
      if (Object.keys(body).length)
        throw new ApiError(400, "ブックマークにユーザーIDは指定できません。");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO bookmarks(user_id,article_id) VALUES(?,?)",
      )
        .bind(user.id, id)
        .run();
    } else {
      // DELETE has no body in the API. Identity is exclusively the verified cookie.
      if (request.body)
        throw new ApiError(400, "ブックマーク解除に本文は指定できません。");
      await env.DB.prepare(
        "DELETE FROM bookmarks WHERE user_id=? AND article_id=?",
      )
        .bind(user.id, id)
        .run();
    }
    const updated = await getArticle(env.DB, id, user);
    return response({
      bookmarked: updated.bookmarked,
      bookmarkCount: updated.bookmarkCount,
    });
  }
  if (action === "view" && method === "POST") {
    const body = await jsonBody(request);
    if (Object.keys(body).length)
      throw new ApiError(400, "閲覧者IDは指定できません。");
    let cookie: string | undefined;
    if (!user) {
      const session = await createSession(request, env);
      user = session.user;
      cookie = session.cookie;
      // The DB may commit the view before a later read fails. Keep this identity
      // even on an error response so a retry cannot count a new anonymous viewer.
      issued.cookie = session.cookie;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO view_events(article_id,viewer_key,day_jst) VALUES(?,?,?)",
    )
      .bind(id, user.id, jstDay())
      .run();
    return response(
      { viewCount: (await getArticle(env.DB, id, user)).viewCount },
      200,
      cookie,
    );
  }
  throw new ApiError(405, "未対応の操作です。", "method_not_allowed");
}
