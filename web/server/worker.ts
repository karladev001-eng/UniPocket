export {digest,jstDay} from './shared.ts';
import type { Article, Database, Env, User } from './types.ts';
import { publicContent } from './content.ts';
import { ifMatch, conflict, digest, jstDay, rate, originCheck, response } from './shared.ts';
import { ApiError, articleInput, jsonBody, textField } from './validation.ts';
const COOKIE = '__Host-campus_session';
const SESSION_SECONDS = 60 * 60 * 24 * 365;
const ARTICLE_COLUMNS = `a.id, a.author_id AS authorId, p.display_name AS authorName,
 a.title, a.public_url AS publicUrl, a.embed_url AS embedUrl, a.summary, a.category,
 a.course_id AS courseId, a.created_at AS createdAt, a.updated_at AS updatedAt,
 a.view_count AS viewCount, a.revision,
 (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) AS bookmarkCount,
 EXISTS(SELECT 1 FROM bookmarks b WHERE b.article_id=a.id AND b.user_id=?) AS bookmarked,
 a.author_id=? AS canEdit`;
const ARTICLE_FROM = ' FROM articles a JOIN profiles p ON p.id=a.author_id';
const SELECT = `SELECT ${ARTICLE_COLUMNS}${ARTICLE_FROM}`;
function article(row: Article): Article {
    return { ...row, bookmarked: !!row.bookmarked, canEdit: !!row.canEdit };
}

interface PopularCursor {
    sort: 'popular';
    version: 1;
    startDay: string;
    endDay: string;
    rankKey: number;
    createdAt: string;
    id: string;
}
function validDay(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validPosition(createdAt: unknown, id: unknown): boolean {
    return typeof createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)
        && Number.isFinite(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt
        && typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
}
function readCursor(value: string | null, sort: 'popular' | 'newest'): PopularCursor | [
    string,
    string
] | null {
    if (value === null)
        return null;
    const invalid = () => new ApiError(400, 'cursorが不正です。');
    if (!value || value.length > 1024)
        throw invalid();
    let parsed: unknown;
    try {
        parsed = JSON.parse(atob(value));
    }
    catch {
        throw invalid();
    }
    if (sort === 'newest') {
        if (!Array.isArray(parsed) || parsed.length !== 2 || !validPosition(parsed[0], parsed[1]))
            throw invalid();
        return parsed as [
            string,
            string
        ];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw invalid();
    const cursor = parsed as PopularCursor;
    if (Object.keys(cursor).sort().join(',') !== 'createdAt,endDay,id,rankKey,sort,startDay,version'
        || cursor.sort !== 'popular' || cursor.version !== 1 || !validDay(cursor.startDay) || !validDay(cursor.endDay)
        || Date.parse(cursor.endDay) - Date.parse(cursor.startDay) !== 6 * 86400000
        || !Number.isSafeInteger(cursor.rankKey) || cursor.rankKey < 0 || !validPosition(cursor.createdAt, cursor.id))
        throw invalid();
    return cursor;
}

async function currentUser(request: Request, db: Database): Promise<User | null> {
    const cookies = (request.headers.get('Cookie') || '').split(';').map(v => v.trim());
    const values = cookies.filter(v => v.startsWith(`${COOKIE}=`));
    if (values.length !== 1)
        return null;
    const token = values[0].slice(COOKIE.length + 1);
    if (!/^[a-f0-9]{64}$/.test(token))
        return null;
    return db.prepare(`SELECT p.id, p.display_name AS displayName FROM sessions s JOIN profiles p ON p.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token), Math.floor(Date.now() / 1000)).first<User>();
}
function requireUser(user: User | null): User {
    if (!user)
        throw new ApiError(401, '匿名セッションを準備してから再試行してください。', 'session_required');
    return user;
}

async function createSession(request: Request, env: Env): Promise<{
    user: User;
    cookie: string;
}> {
    await rate(env.DB, `session:${request.headers.get('CF-Connecting-IP') || 'local'}`, 300, 3600);
    const user = { id: crypto.randomUUID(), displayName: '匿名ユーザー' };
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
        env.DB.prepare('INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)').bind(user.id, user.displayName, new Date().toISOString()),
        env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token), user.id, now + SESSION_SECONDS),
    ]);
    return { user, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}` };
}
async function getArticle(db: Database, id: string, user: User | null, own = false): Promise<Article> {
    const row = await db.prepare(`${own ? SELECT.replace(ARTICLE_FROM, ", a.visibility, a.hidden_reason AS hiddenReason" + ARTICLE_FROM) : SELECT} WHERE a.id=? AND (a.visibility='published'${own ? " OR (a.author_id=? AND a.visibility='hidden')" : ""})`).bind(user?.id || '', user?.id || '', id, ...(own ? [user?.id || ''] : [])).first<Article>();
    if (!row)
        throw new ApiError(404, '記事が見つかりません。', 'not_found');
    return article(row);
}


async function route(request: Request, env: Env, issued: {
    cookie?: string;
}): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method))
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    if (path === '/api/admin' || path.startsWith('/api/admin/'))
        throw new ApiError(404, '見つかりません。', 'not_found');
    if (method !== 'GET')
        originCheck(request, env);
    let user = await currentUser(request, env.DB);
    if (method !== 'GET') {
        await rate(env.DB, `write-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 180, 60);
        if (user)
            await rate(env.DB, `write-user:${user.id}`, 120, 60);
    }
    if (path === '/api/session') {
        if (method === 'GET')
            return response({ user });
        if (method === 'POST') {
            const body = await jsonBody(request);
            if (Object.keys(body).length)
                throw new ApiError(400, 'セッション作成にユーザーIDは指定できません。');
            if (user)
                return response({ user });
            const session = await createSession(request, env);
            return response({ user: session.user }, 200, session.cookie);
        }
        if (method === 'PATCH') {
            user = requireUser(user);
            const body = await jsonBody(request);
            if (Object.keys(body).length !== 1 || !('displayName' in body))
                throw new ApiError(400, '表示名だけを指定してください。');
            const displayName = textField(body.displayName, 'displayName', 40, true);
            await env.DB.prepare('UPDATE profiles SET display_name=? WHERE id=?').bind(displayName, user.id).run();
            return response({ user: { ...user, displayName } });
        }
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    }
    if (path === '/api/articles') {
        if (method === 'GET') {
            const sort = url.searchParams.get('sort') ?? 'newest';
            if (sort !== 'popular' && sort !== 'newest')
                throw new ApiError(400, 'sortが不正です。');
            const cursor = readCursor(url.searchParams.get('cursor'), sort);
            const popularCursor = cursor && !Array.isArray(cursor) ? cursor : null;
            // The calendar window travels with the cursor; ranks themselves may change.
            const endDay = popularCursor?.endDay ?? jstDay();
            const startDay = popularCursor?.startDay ?? new Date(Date.parse(endDay) - 6 * 86400000).toISOString().slice(0, 10);
            const q = textField(url.searchParams.get('q') || '', 'q', 120);
            const conditions: string[] = ["a.visibility='published'"];
            const values: unknown[] = [user?.id || '', user?.id || ''];
            if (sort === 'popular')
                values.push(startDay, endDay);
            for (const [param, column] of [['category', 'a.category'], ['courseId', 'a.course_id'], ['authorId', 'a.author_id']] as const) {
                const value = textField(url.searchParams.get(param) || '', param, 120);
                if (value) {
                    conditions.push(`${column}=?`);
                    values.push(value);
                }
            }
            if (q) {
                conditions.push("(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')");
                const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
                values.push(pattern, pattern);
            }
            if (url.searchParams.get('bookmarked') === '1') {
                user = requireUser(user);
                conditions.push('EXISTS(SELECT 1 FROM bookmarks mine WHERE mine.article_id=a.id AND mine.user_id=?)');
                values.push(user.id);
            }
            const limitString = url.searchParams.get('limit') || '20';
            if (!/^\d+$/.test(limitString) || +limitString < 1 || +limitString > 50)
                throw new ApiError(400, 'limitは1–50です。');
            const limit = +limitString;
            if (Array.isArray(cursor)) {
                conditions.push('(a.created_at < ? OR (a.created_at=? AND a.id<?))');
                values.push(cursor[0], cursor[0], cursor[1]);
            }
            const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
            let sql = `${SELECT}${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ?`;
            if (sort === 'popular') {
                // Rank the entire filtered population in SQL before applying the page limit.
                sql = `WITH ranked AS (SELECT ${ARTICLE_COLUMNS},
          (SELECT COUNT(*) FROM view_events v WHERE v.article_id=a.id AND v.day_jst>=? AND v.day_jst<=?)
          + 3 * (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) AS rankKey
          ${ARTICLE_FROM}${where}) SELECT * FROM ranked`;
                if (popularCursor) {
                    sql += ' WHERE (rankKey<? OR (rankKey=? AND (createdAt<? OR (createdAt=? AND id<?))))';
                    values.push(popularCursor.rankKey, popularCursor.rankKey, popularCursor.createdAt, popularCursor.createdAt, popularCursor.id);
                }
                sql += ' ORDER BY rankKey DESC,createdAt DESC,id DESC LIMIT ?';
            }
            const result = await env.DB.prepare(sql).bind(...values, limit + 1).all<Article & {
                rankKey?: number;
            }>();
            const rows = result.results.slice(0, limit);
            const articles = rows.map(({ rankKey: _rankKey, ...row }) => article(row));
            const last = rows.at(-1);
            const next = last && (sort === 'popular'
                ? { sort, version: 1, startDay, endDay, rankKey: last.rankKey, createdAt: last.createdAt, id: last.id }
                : [last.createdAt, last.id]);
            return response({ articles, nextCursor: result.results.length > limit && next ? btoa(JSON.stringify(next)) : null });
        }
        if (method === 'POST') {
            user = requireUser(user);
            const input = articleInput(await jsonBody(request)) as Required<ReturnType<typeof articleInput>>;
            const requestKey = request.headers.get('Idempotency-Key') || crypto.randomUUID();
            if (!/^[\w.-]{8,128}$/.test(requestKey))
                throw new ApiError(400, 'Idempotency-Keyが不正です。');
            const hash = await digest(JSON.stringify(input));
            const newId = crypto.randomUUID();
            const now = new Date().toISOString();
            await env.DB.batch([
                env.DB.prepare('INSERT OR IGNORE INTO create_keys(user_id,request_key,request_hash,article_id,created_at) VALUES(?,?,?,?,?)').bind(user.id, requestKey, hash, newId, Math.floor(Date.now() / 1000)),
                env.DB.prepare(`INSERT INTO articles(id,author_id,public_url,embed_url,title,summary,category,course_id,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,? FROM create_keys k WHERE k.user_id=? AND k.request_key=? AND k.request_hash=? AND k.article_id=?`)
                    .bind(newId, user.id, input.publicUrl, input.embedUrl, input.title, input.summary, input.category, input.courseId, now, now, user.id, requestKey, hash, newId),
            ]);
            const key = await env.DB.prepare('SELECT request_hash,article_id FROM create_keys WHERE user_id=? AND request_key=?').bind(user.id, requestKey).first<{
                request_hash: string;
                article_id: string;
            }>();
            if (!key || key.request_hash !== hash)
                throw new ApiError(409, '同じ送信キーで内容が変更されています。', 'idempotency_conflict');
            const row = await env.DB.prepare("SELECT id FROM articles WHERE id=? AND visibility!='deleted'").bind(key.article_id).first();
            if (!row)
                throw new ApiError(410, 'この送信で作成した記事は削除済みです。', 'article_deleted');
            return response({ article: await getArticle(env.DB, key.article_id, user, true) }, 201);
        }
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    }
    if (path === '/api/my/articles' && method === 'GET') {
        user = requireUser(user);
        const rows = await env.DB.prepare(`${SELECT.replace(ARTICLE_FROM, ', a.visibility, a.hidden_reason AS hiddenReason' + ARTICLE_FROM)} WHERE a.author_id=? AND a.visibility!='deleted' ORDER BY a.created_at DESC,a.id DESC`).bind(user.id, user.id, user.id).all<Article>();
        return response({ articles: rows.results.map(article) });
    }
    const contentResponse = await publicContent(request, env.DB, user);
    if (contentResponse)
        return contentResponse;
    const match = /^\/api\/articles\/([a-f0-9-]{36})(?:\/(bookmark|view|report))?$/.exec(path);
    if (!match)
        throw new ApiError(404, '見つかりません。', 'not_found');
    const [, id, action] = match;
    const authorMutation = !action && (method === 'PATCH' || method === 'DELETE');
    const existing = await getArticle(env.DB, id, user, authorMutation);
    if (!action && method === 'GET')
        return response({ article: existing });
    if (!action && (method === 'PATCH' || method === 'DELETE')) {
        user = requireUser(user);
        if (existing.authorId !== user.id)
            throw new ApiError(403, '自分の記事だけを変更できます。', 'forbidden');
        const expected = ifMatch(request);
        if (existing.revision !== expected)
            conflict();
        if (method === 'DELETE') {
            const changed = await env.DB.prepare("UPDATE articles SET visibility='deleted',public_url='deleted:'||id,embed_url='',title='削除済み記事',summary='',category='',course_id='',hidden_reason='',revision=revision+1,updated_at=? WHERE id=? AND author_id=? AND revision=? AND visibility!='deleted' RETURNING id").bind(new Date().toISOString(), id, user.id, expected).first();
            if (!changed)
                conflict();
            return response({ ok: true });
        }
        const input = articleInput(await jsonBody(request), true);
        const columns = { title: 'title', publicUrl: 'public_url', embedUrl: 'embed_url', summary: 'summary', category: 'category', courseId: 'course_id' };
        const entries = Object.entries(input) as [
            keyof typeof columns,
            string
        ][];
        const changed = await env.DB.prepare(`UPDATE articles SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')},updated_at=?,revision=revision+1 WHERE id=? AND author_id=? AND revision=? AND visibility!='deleted' RETURNING id`)
            .bind(...entries.map(([, value]) => value), new Date().toISOString(), id, user.id, expected).first();
        if (!changed)
            conflict();
        return response({ article: await getArticle(env.DB, id, user, true) });
    }
    if (action === 'report' && method === 'POST') {
        user = requireUser(user);
        const body = await jsonBody(request);
        if (Object.keys(body).some(k => !['reason', 'details'].includes(k)) || !['inappropriate', 'incorrect', 'broken_link', 'other'].includes(String(body.reason)))
            throw new ApiError(400, '通報理由が不正です。');
        const details = textField(body.details ?? '', 'details', 500);
        await rate(env.DB, `report:${user.id}`, 10, 3600);
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT OR IGNORE INTO article_reports(id,article_id,user_id,reason,details,created_at,updated_at) SELECT ?,?,?,?,?,?,? FROM articles WHERE id=? AND visibility='published'").bind(crypto.randomUUID(), id, user.id, body.reason, details, now, now, id).run();
        await getArticle(env.DB, id, user);
        return response({ ok: true });
    }
    if (action === 'bookmark' && (method === 'PUT' || method === 'DELETE')) {
        user = requireUser(user);
        if (method === 'PUT') {
            const body = await jsonBody(request);
            if (Object.keys(body).length)
                throw new ApiError(400, 'ブックマークにユーザーIDは指定できません。');
            await env.DB.prepare('INSERT OR IGNORE INTO bookmarks(user_id,article_id) VALUES(?,?)').bind(user.id, id).run();
        }
        else {
            // DELETE has no body in the API. Identity is exclusively the verified cookie.
            if (request.body)
                throw new ApiError(400, 'ブックマーク解除に本文は指定できません。');
            await env.DB.prepare('DELETE FROM bookmarks WHERE user_id=? AND article_id=?').bind(user.id, id).run();
        }
        const updated = await getArticle(env.DB, id, user);
        return response({ bookmarked: updated.bookmarked, bookmarkCount: updated.bookmarkCount });
    }
    if (action === 'view' && method === 'POST') {
        const body = await jsonBody(request);
        if (Object.keys(body).length)
            throw new ApiError(400, '閲覧者IDは指定できません。');
        let cookie: string | undefined;
        if (!user) {
            const session = await createSession(request, env);
            user = session.user;
            cookie = session.cookie;
            // The DB may commit the view before a later read fails. Keep this identity
            // even on an error response so a retry cannot count a new anonymous viewer.
            issued.cookie = session.cookie;
        }
        await env.DB.prepare('INSERT OR IGNORE INTO view_events(article_id,viewer_key,day_jst) VALUES(?,?,?)').bind(id, user.id, jstDay()).run();
        return response({ viewCount: (await getArticle(env.DB, id, user)).viewCount }, 200, cookie);
    }
    throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
}
/** Bounded, repeatable cleanup. Retains cumulative views and public author profiles. */
export async function cleanup(db: Database): Promise<void> {
    const now = Math.floor(Date.now() / 1000), stamp = new Date().toISOString();
    await db.prepare('UPDATE maintenance_status SET last_attempt=? WHERE id=1').bind(stamp).run();
    try {
        // Every accepted view/answer has already incremented its identifier-free daily
        // row in the same SQL statement. Deletion cannot race ahead of aggregation.
        await db.batch([
            db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 500)').bind(now),
            db.prepare('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE expires_at<=? LIMIT 500)').bind(now),
            db.prepare('DELETE FROM view_events WHERE rowid IN (SELECT rowid FROM view_events WHERE day_jst<? LIMIT 500)').bind(jstDay(Date.now() - 30 * 86400000)),
            // Erase low-entropy answer hashes together with their raw rows; only
            // the minimal one-response receipt survives reopening.
            db.prepare("UPDATE survey_response_receipts SET request_hash='' WHERE response_id IN (SELECT r.id FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?) ORDER BY r.id LIMIT 500)").bind(new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
            db.prepare("DELETE FROM survey_responses WHERE id IN (SELECT r.id FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?) ORDER BY r.id LIMIT 500)").bind(new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
            db.prepare('DELETE FROM daily_content_metrics WHERE day<?').bind(jstDay(Date.now() - 365 * 86400000)),
            db.prepare("DELETE FROM survey_option_counts WHERE survey_id IN (SELECT id FROM surveys WHERE end_at<? OR (status='ended' AND ended_at<?))").bind(new Date(Date.now() - 365 * 86400000).toISOString(), new Date(Date.now() - 365 * 86400000).toISOString()),
            db.prepare('DELETE FROM admin_audit WHERE created_at<?').bind(new Date(Date.now() - 365 * 86400000).toISOString()),
            db.prepare('DELETE FROM create_keys WHERE rowid IN (SELECT rowid FROM create_keys WHERE created_at<? LIMIT 500)').bind(now - 30 * 86400),
            db.prepare(`UPDATE maintenance_status SET last_success=?,failures=0,
 pending_views=(SELECT COUNT(*) FROM view_events WHERE day_jst<?),
 pending_responses=(SELECT COUNT(*) FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.end_at<? OR (s.status='ended' AND s.ended_at<?)) WHERE id=1`).bind(stamp, jstDay(Date.now() - 30 * 86400000), new Date(Date.now() - 90 * 86400000).toISOString(), new Date(Date.now() - 90 * 86400000).toISOString()),
        ]);
        const pending = await db.prepare('SELECT pending_views,pending_responses FROM maintenance_status WHERE id=1').first<{
            pending_views: number;
            pending_responses: number;
        }>();
        if (pending && (pending.pending_views || pending.pending_responses))
            console.warn('Content retention has expired records pending; next scheduled run retries');
    }
    catch (error) {
        console.error('Content retention cleanup failed; next scheduled run retries');
        await db.prepare('UPDATE maintenance_status SET last_failure=?,failures=failures+1 WHERE id=1').bind(stamp).run();
        throw error;
    }
}
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (!new URL(request.url).pathname.startsWith('/api/'))
            return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
        const issued: {
            cookie?: string;
        } = {};
        try {
            return await route(request, env, issued);
        }
        catch (error) {
            if (error instanceof ApiError)
                return response({ error: error.message, code: error.code }, error.status, issued.cookie);
            if (error instanceof Error && /article_not_public/.test(error.message))
                return response({ error: '記事は公開されていません。', code: 'not_found' }, 404, issued.cookie);
            if (error instanceof Error && /UNIQUE constraint failed: articles.author_id, articles.public_url/.test(error.message))
                return response({ error: 'この公開URLはすでに登録されています。', code: 'duplicate_url' }, 409, issued.cookie);
            // Never expose SQL, token hashes, profile/session tables, or request bodies.
            console.error('Article API operation failed');
            return response({ error: '共有機能を利用できません。入力を保持して再試行してください。', code: 'unavailable' }, 503, issued.cookie);
        }
    },
    async scheduled(_event: unknown, env: Env): Promise<void> {
        await cleanup(env.DB);
    },
};
