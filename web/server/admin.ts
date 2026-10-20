import type { Env, Database, Article, Statement } from './types.ts';
import { ApiError, jsonBody, textField } from './validation.ts';
import { authenticate } from './access.ts';
import { cols, contentInput, getContent, unpack, type Content } from './content.ts';
import { audit, conflict, csv, digest, key, originCheck, response, revision } from './shared.ts';
import { metrics, surveyResultSnapshot } from './metrics.ts';
const articleCols = `a.id,a.author_id AS authorId,p.display_name AS authorName,a.title,a.public_url AS publicUrl,a.embed_url AS embedUrl,a.summary,a.category,a.course_id AS courseId,a.created_at AS createdAt,a.updated_at AS updatedAt,a.view_count AS viewCount,a.visibility,a.revision,a.hidden_reason AS hiddenReason,CASE WHEN a.visibility='deleted' THEN 0 ELSE (SELECT COUNT(*) FROM bookmarks b WHERE b.article_id=a.id) END AS bookmarkCount`;
async function adminArticle(db: Database, id: string) {
    const a = await db.prepare(`SELECT ${articleCols} FROM articles a JOIN profiles p ON p.id=a.author_id WHERE a.id=?`).bind(id).first<Article>();
    if (!a)
        throw new ApiError(404, '記事が見つかりません。', 'not_found');
    return a;
}
const reportCols = 'r.id,r.article_id AS articleId,a.title AS articleTitle,r.reason,r.details,r.status,r.revision,r.created_at AS createdAt,r.updated_at AS updatedAt';
async function command(request: Request, db: Database, path: string, body: unknown, target: string): Promise<{
    condition: string;
    values: string[];
    statement: Statement;
    target: string;
    replay: boolean;
    operation: string;
}> {
    const requestKey = key(request), hash = await digest(JSON.stringify([path, body])), operation = crypto.randomUUID();
    const old = await db.prepare('SELECT request_hash,target_id FROM admin_keys WHERE request_key=?').bind(requestKey).first<{
        request_hash: string;
        target_id: string;
    }>();
    if (old && old.request_hash !== hash)
        throw new ApiError(409, '同じ送信キーの内容が異なります。', 'idempotency_conflict');
    return { operation, condition: 'EXISTS(SELECT 1 FROM admin_keys WHERE request_key=? AND operation_id=?)', values: [requestKey, operation], statement: db.prepare('INSERT OR IGNORE INTO admin_keys(request_key,request_hash,operation_id,target_id,created_at) VALUES(?,?,?,?,?)').bind(requestKey, hash, operation, target, new Date().toISOString()), target: old?.target_id || target, replay: !!old };
}
function discardFailedKey(db: Database, operation: string): Statement {
    return db.prepare('DELETE FROM admin_keys WHERE operation_id=? AND NOT EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind(operation, operation);
}
async function snapshot(db: Database, id: string): Promise<Statement> {
    return db.prepare('INSERT INTO announcement_revisions SELECT id,revision,title,body,link,start_at,end_at,status,updated_at FROM announcements WHERE id=? AND changes()=1').bind(id);
}
interface PageRow {
    id: string;
    createdAt: string;
}
function pagination(url: URL, alias: string): {
    limit: number;
    condition: string;
    values: unknown[];
} {
    const rawLimit = url.searchParams.get('limit') || '50';
    if (!/^\d+$/.test(rawLimit) || +rawLimit < 1 || +rawLimit > 100)
        throw new ApiError(400, 'limitは1–100です。');
    const encoded = url.searchParams.get('cursor');
    if (encoded === null)
        return { limit: +rawLimit, condition: '', values: [] };
    let cursor: unknown;
    try {
        if (!encoded || encoded.length > 512)
            throw Error();
        cursor = JSON.parse(atob(encoded));
    }
    catch {
        throw new ApiError(400, 'cursorが不正です。');
    }
    if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || typeof cursor[1] !== 'string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor[0]) || !Number.isFinite(Date.parse(cursor[0]))
        || new Date(cursor[0]).toISOString() !== cursor[0] || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(cursor[1])) {
        throw new ApiError(400, 'cursorが不正です。');
    }
    return { limit: +rawLimit, condition: ` AND (${alias}.created_at<? OR (${alias}.created_at=? AND ${alias}.id<?))`, values: [cursor[0], cursor[0], cursor[1]] };
}
function page<T extends PageRow>(rows: T[], limit: number): {
    rows: T[];
    nextCursor: string | null;
} {
    const items = rows.slice(0, limit), last = items.at(-1);
    return { rows: items, nextCursor: rows.length > limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null };
}
async function route(request: Request, env: Env, email: string): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method, db = env.DB;
    if (!['GET', 'POST', 'PATCH'].includes(method))
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    if (method !== 'GET')
        originCheck(request, env);
    if (path === '/api/admin/me' && method === 'GET')
        return response({ admin: { email } });
    if (path === '/api/admin/overview' && method === 'GET') {
        const now = new Date().toISOString();
        const row = await db.prepare(`SELECT (SELECT COUNT(*) FROM articles WHERE visibility='published') AS publishedArticles,(SELECT COUNT(*) FROM article_reports WHERE status='pending') AS pendingReports,(SELECT COUNT(*) FROM announcements WHERE status='published' AND start_at<=? AND end_at>?) AS activeAnnouncements,(SELECT COUNT(*) FROM surveys WHERE status='published' AND start_at<=? AND end_at>?) AS activeSurveys`).bind(now, now, now, now).first();
        return response(row);
    }
    if (path === '/api/admin/articles' && method === 'GET') {
        const q = textField(url.searchParams.get('q') || '', 'q', 120), visibility = url.searchParams.get('visibility') || '';
        if (visibility && !['published', 'hidden', 'deleted'].includes(visibility))
            throw new ApiError(400, '状態が不正です。');
        const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
        const paging = pagination(url, 'a');
        const rows = await db.prepare(`SELECT ${articleCols} FROM articles a JOIN profiles p ON p.id=a.author_id WHERE (?='' OR a.visibility=?) AND (a.title LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\' OR a.category LIKE ? ESCAPE '\\')${paging.condition} ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).bind(visibility, visibility, pattern, pattern, pattern, ...paging.values, paging.limit + 1).all<Article>();
        const result = page(rows.results, paging.limit);
        return response({ articles: result.rows, nextCursor: result.nextCursor });
    }
    const singleArticle = /^\/api\/admin\/articles\/([a-f0-9-]{36})$/.exec(path);
    if (singleArticle && method === 'GET')
        return response({ article: await adminArticle(db, singleArticle[1]) });
    const articleMatch = /^\/api\/admin\/articles\/([a-f0-9-]{36})\/visibility$/.exec(path);
    if (articleMatch && method === 'POST') {
        const id = articleMatch[1], body = await jsonBody(request, 131072), v = revision(body.revision);
        if (!['hidden', 'published'].includes(String(body.visibility)) || Object.keys(body).some(k => !['revision', 'visibility', 'reason'].includes(k)))
            throw new ApiError(400, '状態が不正です。');
        const reason = textField(body.reason ?? '', 'reason', 500, body.visibility === 'hidden'), cmd = await command(request, db, path, body, id);
        if (cmd.replay)
            return response({ article: await adminArticle(db, id) });
        const current = await adminArticle(db, id);
        if (current.visibility === 'deleted')
            throw new ApiError(409, '削除済み記事は再公開できません。', 'article_deleted');
        if (current.revision !== v)
            conflict();
        const results = await db.batch([cmd.statement, db.prepare(`UPDATE articles SET visibility=?,hidden_reason=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND visibility!='deleted' AND ${cmd.condition}`).bind(body.visibility, reason, new Date().toISOString(), id, v, ...cmd.values), audit(db, email, id, `article.${body.visibility}`, true, cmd.operation), discardFailedKey(db, cmd.operation)]);
        const updated = await adminArticle(db, id);
        if (updated.revision !== v + 1) {
            const record = await db.prepare('SELECT operation_id FROM admin_keys WHERE request_key=?').bind(key(request)).first();
            if (!record)
                conflict();
        }
        // A losing revision race produces no audit; the mutation is not accepted.
        const changed = results[1] as {
            meta?: {
                changes?: number;
            };
        };
        if (changed.meta?.changes === 0) {
            const replay = await db.prepare('SELECT request_hash FROM admin_keys WHERE request_key=?').bind(key(request)).first<{
                request_hash: string;
            }>();
            if (replay?.request_hash !== await digest(JSON.stringify([path, body])))
                conflict();
        }
        return response({ article: updated });
    }
    if (path === '/api/admin/reports' && method === 'GET') {
        const status = url.searchParams.get('status') || '';
        if (status && !['pending', 'reviewed'].includes(status))
            throw new ApiError(400, '状態が不正です。');
        const paging = pagination(url, 'r');
        const rows = await db.prepare(`SELECT ${reportCols} FROM article_reports r JOIN articles a ON a.id=r.article_id WHERE (?='' OR r.status=?)${paging.condition} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).bind(status, status, ...paging.values, paging.limit + 1).all<PageRow>();
        const result = page(rows.results, paging.limit);
        return response({ reports: result.rows, nextCursor: result.nextCursor });
    }
    const reportMatch = /^\/api\/admin\/reports\/([a-f0-9-]{36})$/.exec(path);
    if (reportMatch && method === 'PATCH') {
        const body = await jsonBody(request, 131072), v = revision(body.revision);
        if (!['pending', 'reviewed'].includes(String(body.status)) || Object.keys(body).some(k => !['revision', 'status'].includes(k)))
            throw new ApiError(400, '状態が不正です。');
        const result = await db.batch([db.prepare('UPDATE article_reports SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(body.status, new Date().toISOString(), reportMatch[1], v), audit(db, email, reportMatch[1], 'report.review', true)]);
        if ((result[0] as {
            meta?: {
                changes?: number;
            };
        }).meta?.changes === 0)
            conflict();
        const report = await db.prepare(`SELECT ${reportCols} FROM article_reports r JOIN articles a ON a.id=r.article_id WHERE r.id=?`).bind(reportMatch[1]).first();
        return response({ report });
    }
    if ((path === '/api/admin/metrics' || path === '/api/admin/metrics.csv') && method === 'GET') {
        const data = await metrics(db, url);
        if (path.endsWith('.csv')) {
            await audit(db, email, `${data.start}/${data.end}`, 'metrics.csv').run();
            return csv([['date', 'contentId', 'title', 'metric', 'count', 'asOf'], ...data.daily.flatMap(d => [[d.day, '', '全記事', 'articleViews', d.articleViews === null ? '未収集' : d.articleViews, data.asOf], [d.day, '', '全アンケート', 'surveyResponses', d.surveyResponses === null ? '未収集' : d.surveyResponses, data.asOf]]), ...data.articles.flatMap(a => [['', a.id, a.title, 'articleViews', a.views === null ? '未収集' : a.views, data.asOf], ['', a.id, a.title, 'currentBookmarks', a.bookmarks, data.asOf]])]);
        }
        return response(data);
    }
    const resultMatch = /^\/api\/admin\/surveys\/([a-f0-9-]{36})\/(results|responses.csv)$/.exec(path);
    if (resultMatch && method === 'GET') {
        const { result: data, responseRows } = await surveyResultSnapshot(db, resultMatch[1]);
        if (resultMatch[2] === 'results')
            return response(data);
        const rows = responseRows.flatMap(r => (JSON.parse(r.answers) as {
            questionId: string;
            value: string | string[];
        }[]).map(a => {
            const q = data.survey.questions!.find(q => q.id === a.questionId);
            return [r.submitted_at, a.questionId, q?.title, q?.type === 'text' ? a.value : (Array.isArray(a.value) ? a.value : [a.value]).map(v => q?.options.find(o => o.id === v)?.label || '').join(' / ')];
        }));
        await audit(db, email, resultMatch[1], 'survey.responses.csv').run();
        return csv([['resultsComplete', data.resultsComplete], ['resultsSince', data.resultsSince], ['individualResponseRetention', '90 days after survey end'], [], ['submittedAt', 'questionId', 'question', 'answer'], ...rows]);
    }
    const match = /^\/api\/admin\/(announcements|surveys)(?:\/([a-f0-9-]{36})(?:\/(publish|end))?)?$/.exec(path);
    if (!match)
        throw new ApiError(404, '見つかりません。', 'not_found');
    const type = match[1] as 'announcements' | 'surveys', id = match[2], action = match[3], singular = type === 'surveys' ? 'survey' : 'announcement';
    if (method === 'GET' && !action) {
        if (id)
            return response({ [singular]: unpack(await getContent(db, type, id)) });
        const rows = await db.prepare(`SELECT ${cols[type]} FROM ${type} ORDER BY created_at DESC LIMIT 500`).all<Content>();
        return response({ [type]: rows.results.map(unpack) });
    }
    const body = await jsonBody(request, 131072), now = new Date().toISOString();
    if (method === 'POST' && !id) {
        const input = contentInput(type, body), fresh = crypto.randomUUID(), cmd = await command(request, db, path, body, fresh);
        if (cmd.replay)
            return response({ [singular]: unpack(await getContent(db, type, cmd.target)) }, 201);
        const fields = ['title', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link']), 'startAt', 'endAt'], columns = ['title', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link']), 'start_at', 'end_at'];
        const insert = db.prepare(`INSERT INTO ${type}(id,${columns.join(',')},created_at,updated_at) SELECT ?,${fields.map(() => '?').join(',')},?,? WHERE ${cmd.condition}`).bind(fresh, ...fields.map(f => input[f]), now, now, ...cmd.values);
        await db.batch([cmd.statement, insert, audit(db, email, fresh, `${singular}.create`, true, cmd.operation), ...(type === 'announcements' ? [await snapshot(db, fresh)] : []), discardFailedKey(db, cmd.operation)]);
        // A concurrent retry may have inserted the original target instead of fresh.
        const saved = await db.prepare('SELECT target_id,request_hash FROM admin_keys WHERE request_key=?').bind(key(request)).first<{
            target_id: string;
            request_hash: string;
        }>();
        if (saved?.request_hash !== await digest(JSON.stringify([path, body])))
            throw new ApiError(409, '同じ送信キーの内容が異なります。', 'idempotency_conflict');
        return response({ [singular]: unpack(await getContent(db, type, saved!.target_id)) }, 201);
    }
    if (!id)
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    const old = await getContent(db, type, id), v = revision(body.revision);
    const cmd = method === 'POST' && action ? await command(request, db, path, body, id) : null;
    if (cmd?.replay)
        return response({ [singular]: unpack(old) });
    if (old.revision !== v)
        conflict();
    let update: Statement;
    if (method === 'PATCH' && !action) {
        const input = contentInput(type, body, unpack({ ...old }));
        if (type === 'surveys' && old.everPublished) {
            if (String(input.questions) !== JSON.stringify(unpack({ ...old }).questions) || input.startAt !== old.startAt)
                throw new ApiError(409, '公開後の設問・開始日時は変更できません。複製してください。', 'survey_immutable');
        }
        const fields = ['title', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link']), 'startAt', 'endAt'], columns = ['title', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link']), 'start_at', 'end_at'];
        update = db.prepare(`UPDATE ${type} SET ${columns.map(c => c + '=?').join(',')},revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(...fields.map(f => input[f]), now, id, v);
    }
    else if (method === 'POST' && action) {
        if (Object.keys(body).some(k => k !== 'revision'))
            throw new ApiError(400, 'revisionだけを指定してください。');
        if (action === 'publish' && Date.parse(old.endAt) <= Date.now())
            throw new ApiError(400, '終了日時を未来に変更してください。', 'content_expired');
        update = db.prepare(`UPDATE ${type} SET status=?,revision=revision+1,updated_at=?${type === 'surveys' ? (action === 'publish' ? ',ever_published=1,ended_at=NULL' : ',ended_at=?') : ''} WHERE id=? AND revision=? AND ${cmd!.condition}`).bind(action === 'publish' ? 'published' : 'ended', now, ...(type === 'surveys' && action === 'end' ? [now] : []), id, v, ...cmd!.values);
    }
    else
        throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
    const batch: Statement[] = [...(cmd ? [cmd.statement] : []), update, audit(db, email, id, `${singular}.${action || 'edit'}`, true, cmd?.operation)];
    if (type === 'announcements')
        batch.push(await snapshot(db, id));
    if (cmd)
        batch.push(discardFailedKey(db, cmd.operation));
    const outcome = await db.batch(batch);
    if ((outcome[cmd ? 1 : 0] as {
        meta?: {
            changes?: number;
        };
    }).meta?.changes === 0) {
        if (!cmd)
            conflict();
        const replay = await db.prepare('SELECT request_hash FROM admin_keys WHERE request_key=?').bind(key(request)).first<{
            request_hash: string;
        }>();
        if (replay?.request_hash !== await digest(JSON.stringify([path, body])))
            conflict();
    }
    return response({ [singular]: unpack(await getContent(db, type, id)) });
}
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        let verifiedEmail: string | undefined;
        try {
            const admin = await authenticate(request, env);
            verifiedEmail = admin.email;
            const path = new URL(request.url).pathname;
            if (path.startsWith('/api/'))
                return await route(request, env, admin.email);
            if (path === '/sw.js' || path.endsWith('/service-worker.js'))
                return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
            const asset = env.ASSETS ? await env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
            const headers = new Headers(asset.headers);
            headers.set('Cache-Control', 'private, no-store');
            headers.set('X-Robots-Tag', 'noindex, nofollow');
            headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
            return new Response(asset.body, { status: asset.status, headers });
        }
        catch (error) {
            const path = new URL(request.url).pathname;
            if (verifiedEmail && path.startsWith('/api/admin/') && (request.method !== 'GET' || path.endsWith('.csv'))) {
                try {
                    await env.DB.prepare("INSERT INTO admin_audit(id,admin_email,target_id,action,result,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), verifiedEmail, path, request.method, error instanceof ApiError ? error.code : 'unavailable', new Date().toISOString()).run();
                }
                catch {
                    console.error('Admin failure audit could not be persisted');
                }
            }
            if (error instanceof Error && /UNIQUE constraint failed: article_reports/.test(error.message))
                return response({ error: '同じ記事の未確認通報がすでにあります。', code: 'report_conflict' }, 409);
            if (error instanceof ApiError)
                return response({ error: error.message, code: error.code }, error.status);
            console.error('Admin operation failed');
            return response({ error: '管理機能を利用できません。入力を保持して再試行してください。', code: 'unavailable' }, 503);
        }
    }
};
