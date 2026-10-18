import type { Article, Database, Env, User } from './types.ts';
import { ApiError, articleInput, jsonBody, textField } from './validation.ts';

const COOKIE = '__Host-campus_session';
const SESSION_SECONDS = 60 * 60 * 24 * 365;
const SELECT = `SELECT a.id, a.author_id AS authorId, p.display_name AS authorName,
 a.title, a.public_url AS publicUrl, a.embed_url AS embedUrl, a.summary, a.category,
 a.course_id AS courseId, a.created_at AS createdAt, a.updated_at AS updatedAt,
 a.view_count AS viewCount,
 (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) AS bookmarkCount,
 EXISTS(SELECT 1 FROM bookmarks b WHERE b.article_id=a.id AND b.user_id=?) AS bookmarked,
 a.author_id=? AS canEdit FROM articles a JOIN profiles p ON p.id=a.author_id`;
function article(row: Article): Article { return {...row, bookmarked: !!row.bookmarked, canEdit: !!row.canEdit}; }
export function jstDay(now = Date.now()): string { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
async function currentUser(request: Request, db: Database): Promise<User | null> {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(v => v.trim());
  const values = cookies.filter(v => v.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT p.id, p.display_name AS displayName FROM sessions s JOIN profiles p ON p.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token), Math.floor(Date.now() / 1000)).first<User>();
}
function requireUser(user: User | null): User {
  if (!user) throw new ApiError(401, '匿名セッションを準備してから再試行してください。', 'session_required');
  return user;
}
async function rate(db: Database, key: string, limit: number, seconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = `${await digest(key)}:${Math.floor(now / seconds)}`;
  const row = await db.prepare(`INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`)
    .bind(bucket, now + seconds * 2, limit).first<{count: number}>();
  if (!row) throw new ApiError(429, '操作が多すぎます。しばらく待って再試行してください。', 'rate_limited');
}
async function createSession(request: Request, env: Env): Promise<{user: User; cookie: string}> {
  await rate(env.DB, `session:${request.headers.get('CF-Connecting-IP') || 'local'}`, 10, 3600);
  const user = {id: crypto.randomUUID(), displayName: '匿名ユーザー'};
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)').bind(user.id, user.displayName, new Date().toISOString()),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token), user.id, now + SESSION_SECONDS),
  ]);
  return {user, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`};
}
async function getArticle(db: Database, id: string, user: User | null): Promise<Article> {
  const row = await db.prepare(`${SELECT} WHERE a.id=?`).bind(user?.id || '', user?.id || '', id).first<Article>();
  if (!row) throw new ApiError(404, '記事が見つかりません。', 'not_found');
  return article(row);
}
function originCheck(request: Request, env: Env): void {
  const expected = env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get('Origin') !== expected || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, '同じアプリから操作してください。', 'origin_rejected');
  }
}
function response(data: unknown, status = 200, cookie?: string): Response {
  const headers: Record<string,string> = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Origin',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
  if (cookie) headers['Set-Cookie'] = cookie;
  if (status === 429) headers['Retry-After'] = '60';
  return Response.json(data, {status, headers});
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
  if (method !== 'GET') originCheck(request, env);
  let user = await currentUser(request, env.DB);
  if (method !== 'GET') {
    await rate(env.DB, `write-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 180, 60);
    if (user) await rate(env.DB, `write-user:${user.id}`, 120, 60);
  }
  if (path === '/api/session') {
    if (method === 'GET') return response({user});
    if (method === 'POST') {
      const body = await jsonBody(request);
      if (Object.keys(body).length) throw new ApiError(400, 'セッション作成にユーザーIDは指定できません。');
      if (user) return response({user});
      const session = await createSession(request, env);
      return response({user: session.user}, 200, session.cookie);
    }
    if (method === 'PATCH') {
      user = requireUser(user);
      const body = await jsonBody(request);
      if (Object.keys(body).length !== 1 || !('displayName' in body)) throw new ApiError(400, '表示名だけを指定してください。');
      const displayName = textField(body.displayName, 'displayName', 40, true);
      await env.DB.prepare('UPDATE profiles SET display_name=? WHERE id=?').bind(displayName, user.id).run();
      return response({user: {...user, displayName}});
    }
    throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
  }
  if (path === '/api/articles') {
    if (method === 'GET') {
      const q = textField(url.searchParams.get('q') || '', 'q', 120);
      const conditions: string[] = []; const values: unknown[] = [user?.id || '', user?.id || ''];
      for (const [param, column] of [['category', 'a.category'], ['courseId', 'a.course_id'], ['authorId', 'a.author_id']] as const) {
        const value = textField(url.searchParams.get(param) || '', param, 120);
        if (value) { conditions.push(`${column}=?`); values.push(value); }
      }
      if (q) {
        conditions.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')");
        const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`; values.push(pattern, pattern);
      }
      if (url.searchParams.get('bookmarked') === '1') {
        user = requireUser(user); conditions.push('EXISTS(SELECT 1 FROM bookmarks mine WHERE mine.article_id=a.id AND mine.user_id=?)'); values.push(user.id);
      }
      const limitString = url.searchParams.get('limit') || '20';
      if (!/^\d+$/.test(limitString) || +limitString < 1 || +limitString > 50) throw new ApiError(400, 'limitは1–50です。');
      const limit = +limitString;
      const cursor = url.searchParams.get('cursor');
      if (cursor) {
        let parsed: unknown;
        try { parsed = JSON.parse(atob(cursor)); } catch { throw new ApiError(400, 'cursorが不正です。'); }
        if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(parsed[0]) || !/^[a-f0-9-]{36}$/.test(parsed[1])) throw new ApiError(400, 'cursorが不正です。');
        conditions.push('(a.created_at < ? OR (a.created_at=? AND a.id<?))'); values.push(parsed[0], parsed[0], parsed[1]);
      }
      const result = await env.DB.prepare(`${SELECT}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).bind(...values, limit + 1).all<Article>();
      const articles = result.results.slice(0, limit).map(article);
      const last = articles.at(-1);
      return response({articles, nextCursor: result.results.length > limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null});
    }
    if (method === 'POST') {
      user = requireUser(user);
      const input = articleInput(await jsonBody(request)) as Required<ReturnType<typeof articleInput>>;
      const requestKey = request.headers.get('Idempotency-Key') || crypto.randomUUID();
      if (!/^[\w.-]{8,128}$/.test(requestKey)) throw new ApiError(400, 'Idempotency-Keyが不正です。');
      const hash = await digest(JSON.stringify(input));
      const newId = crypto.randomUUID(); const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO create_keys(user_id,request_key,request_hash,article_id,created_at) VALUES(?,?,?,?,?)').bind(user.id, requestKey, hash, newId, Math.floor(Date.now()/1000)),
        env.DB.prepare(`INSERT INTO articles(id,author_id,public_url,embed_url,title,summary,category,course_id,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,? FROM create_keys k WHERE k.user_id=? AND k.request_key=? AND k.request_hash=? AND k.article_id=?`)
          .bind(newId, user.id, input.publicUrl, input.embedUrl, input.title, input.summary, input.category, input.courseId, now, now, user.id, requestKey, hash, newId),
      ]);
      const key = await env.DB.prepare('SELECT request_hash,article_id FROM create_keys WHERE user_id=? AND request_key=?').bind(user.id, requestKey).first<{request_hash: string; article_id: string}>();
      if (!key || key.request_hash !== hash) throw new ApiError(409, '同じ送信キーで内容が変更されています。', 'idempotency_conflict');
      const row = await env.DB.prepare('SELECT id FROM articles WHERE id=?').bind(key.article_id).first();
      if (!row) throw new ApiError(410, 'この送信で作成した記事は削除済みです。', 'article_deleted');
      return response({article: await getArticle(env.DB, key.article_id, user)}, 201);
    }
    throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
  }
  const match = /^\/api\/articles\/([a-f0-9-]{36})(?:\/(bookmark|view))?$/.exec(path);
  if (!match) throw new ApiError(404, '見つかりません。', 'not_found');
  const [, id, action] = match;
  const existing = await getArticle(env.DB, id, user);
  if (!action && method === 'GET') return response({article: existing});
  if (!action && (method === 'PATCH' || method === 'DELETE')) {
    user = requireUser(user);
    if (existing.authorId !== user.id) throw new ApiError(403, '自分の記事だけを変更できます。', 'forbidden');
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM articles WHERE id=? AND author_id=?').bind(id, user.id).run();
      return response({ok: true});
    }
    const input = articleInput(await jsonBody(request), true);
    const columns = {title: 'title', publicUrl: 'public_url', embedUrl: 'embed_url', summary: 'summary', category: 'category', courseId: 'course_id'};
    const entries = Object.entries(input) as [keyof typeof columns,string][];
    await env.DB.prepare(`UPDATE articles SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')},updated_at=? WHERE id=? AND author_id=?`)
      .bind(...entries.map(([,value]) => value), new Date().toISOString(), id, user.id).run();
    return response({article: await getArticle(env.DB, id, user)});
  }
  if (action === 'bookmark' && (method === 'PUT' || method === 'DELETE')) {
    user = requireUser(user);
    if (method === 'PUT') {
      const body = await jsonBody(request);
      if (Object.keys(body).length) throw new ApiError(400, 'ブックマークにユーザーIDは指定できません。');
      await env.DB.prepare('INSERT OR IGNORE INTO bookmarks(user_id,article_id) VALUES(?,?)').bind(user.id, id).run();
    } else {
      // DELETE has no body in the API. Identity is exclusively the verified cookie.
      if (request.body) throw new ApiError(400, 'ブックマーク解除に本文は指定できません。');
      await env.DB.prepare('DELETE FROM bookmarks WHERE user_id=? AND article_id=?').bind(user.id, id).run();
    }
    const updated = await getArticle(env.DB, id, user);
    return response({bookmarked: updated.bookmarked, bookmarkCount: updated.bookmarkCount});
  }
  if (action === 'view' && method === 'POST') {
    const body = await jsonBody(request);
    if (Object.keys(body).length) throw new ApiError(400, '閲覧者IDは指定できません。');
    let cookie: string | undefined;
    if (!user) { const session = await createSession(request, env); user = session.user; cookie = session.cookie; }
    await env.DB.prepare('INSERT OR IGNORE INTO view_events(article_id,viewer_key,day_jst) VALUES(?,?,?)').bind(id, user.id, jstDay()).run();
    return response({viewCount: (await getArticle(env.DB, id, user)).viewCount}, 200, cookie);
  }
  throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
}
/** Bounded, repeatable cleanup. Retains cumulative views and public author profiles. */
export async function cleanup(db: Database): Promise<void> {
  const now = Math.floor(Date.now()/1000);
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 500)').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE expires_at<=? LIMIT 500)').bind(now),
    db.prepare('DELETE FROM view_events WHERE rowid IN (SELECT rowid FROM view_events WHERE day_jst<? LIMIT 500)').bind(jstDay(Date.now() - 7*86400000)),
    db.prepare('DELETE FROM create_keys WHERE rowid IN (SELECT rowid FROM create_keys WHERE created_at<? LIMIT 500)').bind(now - 30*86400),
  ]);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status: 404});
    try { return await route(request, env); }
    catch (error) {
      if (error instanceof ApiError) return response({error: error.message, code: error.code}, error.status);
      if (error instanceof Error && /UNIQUE constraint failed: articles.author_id, articles.public_url/.test(error.message)) return response({error: 'この公開URLはすでに登録されています。', code: 'duplicate_url'}, 409);
      // Never expose SQL, token hashes, profile/session tables, or request bodies.
      console.error('Article API operation failed');
      return response({error: '共有機能を利用できません。入力を保持して再試行してください。', code: 'unavailable'}, 503);
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> { await cleanup(env.DB); },
};
