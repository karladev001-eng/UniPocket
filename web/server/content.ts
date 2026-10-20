import type { Database, User } from './types.ts';
import { ApiError, textField } from './validation.ts';
import { digest, jstDay, key, rate, response, uuid } from './shared.ts';
export interface Question {
    id: string;
    title: string;
    type: 'single' | 'multiple' | 'text';
    required: boolean;
    options: {
        id: string;
        label: string;
    }[];
}
export interface Content {
    id: string;
    title: string;
    body?: string;
    link?: string;
    intro?: string;
    startAt: string;
    endAt: string;
    status: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    questions?: Question[];
    everPublished?: number;
}
export const cols = { announcements: 'id,title,body,link,start_at AS startAt,end_at AS endAt,status,revision,created_at AS createdAt,updated_at AS updatedAt', surveys: 'id,title,intro,start_at AS startAt,end_at AS endAt,status,revision,questions,ever_published AS everPublished,created_at AS createdAt,updated_at AS updatedAt' };
export function unpack(row: Content): Content {
    if (typeof row.questions === 'string')
        row.questions = JSON.parse(row.questions);
    delete row.everPublished;
    return row;
}
export function date(value: unknown, name: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new ApiError(400, `${name}が不正です。`);
    return new Date(value).toISOString();
}
export function questions(value: unknown): Question[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10)
        throw new ApiError(400, '設問は1–10問です。');
    const ids = new Set<string>();
    return value.map(q => {
        if (!q || typeof q !== 'object' || !uuid(q.id) || ids.has(q.id) || !['single', 'multiple', 'text'].includes(q.type) || typeof q.required !== 'boolean' || !Array.isArray(q.options))
            throw new ApiError(400, '設問が不正です。');
        ids.add(q.id);
        if ((q.type === 'text' && q.options.length) || (q.type !== 'text' && (q.options.length < 2 || q.options.length > 10)))
            throw new ApiError(400, '選択肢は2–10件です。');
        return { id: q.id, title: textField(q.title, '設問', 200, true), type: q.type, required: q.required, options: q.options.map((o: {
                id: string;
                label: string;
            }) => {
                if (!o || !uuid(o.id) || ids.has(o.id))
                    throw new ApiError(400, '選択肢IDが不正です。');
                ids.add(o.id);
                return { id: o.id, label: textField(o.label, '選択肢', 200, true) };
            }) };
    });
}
export function contentInput(type: 'announcements' | 'surveys', body: Record<string, unknown>, old?: Content): Record<string, unknown> {
    const allowed = ['title', 'startAt', 'endAt', 'revision', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link'])];
    if (Object.keys(body).some(k => !allowed.includes(k)))
        throw new ApiError(400, '許可されていない項目があります。');
    const result: Record<string, unknown> = {};
    for (const field of ['title', 'startAt', 'endAt', ...(type === 'surveys' ? ['intro', 'questions'] : ['body', 'link'])]) {
        const value = field in body ? body[field] : old?.[field as keyof Content];
        if (field === 'questions')
            result[field] = JSON.stringify(questions(value));
        else if (field === 'startAt' || field === 'endAt')
            result[field] = date(value, field);
        else if (field === 'link') {
            const raw = textField(value ?? '', 'link', 2048);
            if (raw) {
                let u: URL;
                try {
                    u = new URL(raw);
                }
                catch {
                    throw new ApiError(400, 'リンクが不正です。');
                }
                if (u.protocol !== 'https:' || u.username || u.password)
                    throw new ApiError(400, 'HTTPSリンクを入力してください。');
            }
            result[field] = raw;
        }
        else
            result[field] = textField(value ?? '', field, field === 'title' ? 80 : 2000, field === 'title' || field === 'body');
    }
    if (Date.parse(String(result.endAt)) <= Date.parse(String(result.startAt)))
        throw new ApiError(400, '終了は開始より後にしてください。');
    return result;
}
export async function getContent(db: Database, type: 'announcements' | 'surveys', id: string, publicOnly = false): Promise<Content> {
    const now = new Date().toISOString();
    const row = await db.prepare(`SELECT ${cols[type]} FROM ${type} WHERE id=?${publicOnly ? " AND status='published' AND start_at<=? AND end_at>?" : ''}`).bind(id, ...(publicOnly ? [now, now] : [])).first<Content>();
    if (!row)
        throw new ApiError(404, '見つかりません。', 'not_found');
    return row;
}
export async function publicContent(request: Request, db: Database, user: User | null): Promise<Response | null> {
    const match = /^\/api\/(announcements|surveys)(?:\/([a-f0-9-]{36})(?:\/(responses))?)?$/.exec(new URL(request.url).pathname);
    if (!match)
        return null;
    const type = match[1] as 'announcements' | 'surveys', id = match[2], action = match[3];
    if (request.method === 'GET' && !action) {
        const now = new Date().toISOString();
        if (!id) {
            const rows = await db.prepare(`SELECT ${cols[type]} FROM ${type} WHERE status='published' AND start_at<=? AND end_at>? ORDER BY start_at DESC,id DESC LIMIT 100`).bind(now, now).all<Content>();
            const answeredIds = new Set<string>();
            if (type === 'surveys' && user && rows.results.length) {
                const hashes = await Promise.all(rows.results.map(row => digest(`survey-user:${row.id}:${user.id}`)));
                const receipts = await db.prepare(`SELECT survey_id FROM survey_response_receipts WHERE user_hash IN (${hashes.map(() => '?').join(',')})`).bind(...hashes).all<{
                    survey_id: string;
                }>();
                for (const receipt of receipts.results)
                    answeredIds.add(receipt.survey_id);
            }
            return response({ [type]: rows.results.map(row => {
                    const content = unpack(row);
                    return type === 'surveys' ? { ...content, answered: answeredIds.has(row.id) } : content;
                }) });
        }
        const row = unpack(await getContent(db, type, id, true));
        if (type === 'announcements')
            return response({ announcement: row });
        const answered = !!user && !!await db.prepare('SELECT response_id FROM survey_response_receipts WHERE survey_id=? AND user_hash=?').bind(id, await digest(`survey-user:${id}:${user.id}`)).first();
        return response({ survey: row, answered });
    }
    if (type === 'surveys' && id && action === 'responses' && request.method === 'POST') {
        if (!user)
            throw new ApiError(401, '匿名セッションが必要です。', 'session_required');
        const requestKey = key(request), body = await (await import('./validation.ts')).jsonBody(request, 65536);
        if (Object.keys(body).length !== 1 || !Array.isArray(body.answers))
            throw new ApiError(400, '回答が不正です。');
        const hash = await digest(`survey-answers:${id}:${JSON.stringify(body.answers)}`), userHash = await digest(`survey-user:${id}:${user.id}`), keyHash = await digest(`survey-key:${id}:${requestKey}`);
        const previous = await db.prepare('SELECT response_id AS id,key_hash AS request_key,request_hash,survey_id FROM survey_response_receipts WHERE (survey_id=? AND user_hash=?) OR (user_hash=? AND key_hash=?)').bind(id, userHash, userHash, keyHash).first<{
            id: string;
            request_key: string;
            request_hash: string;
            survey_id: string;
        }>();
        if (previous) {
            if (previous.survey_id !== id || (previous.request_key === keyHash && previous.request_hash !== '' && previous.request_hash !== hash))
                throw new ApiError(409, '同じ送信キーの内容が異なります。', 'idempotency_conflict');
            return response({ ok: true, responseId: previous.id });
        }
        await rate(db, `survey-response:${user.id}`, 10, 3600);
        let survey: Content;
        try {
            survey = unpack(await getContent(db, 'surveys', id, true));
        }
        catch (error) {
            if (error instanceof ApiError && error.status === 404)
                throw new ApiError(410, 'アンケートの受付は終了しています。', 'survey_closed');
            throw error;
        }
        const qs = survey.questions!;
        const seen = new Set<string>();
        const normalized: {
            questionId: string;
            value: string | string[];
        }[] = [];
        for (const answer of body.answers as {
            questionId: string;
            value: unknown;
        }[]) {
            const q = qs.find(q => q.id === answer?.questionId);
            if (!q || seen.has(q.id))
                throw new ApiError(400, '回答する設問が不正です。');
            seen.add(q.id);
            let value: string | string[];
            if (q.type === 'text')
                value = textField(answer.value, '自由記述', 1000, q.required);
            else {
                const values = q.type === 'single' ? (answer.value === '' ? [] : [answer.value]) : answer.value;
                if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(v => typeof v !== 'string' || !q.options.some(o => o.id === v)) || (q.required && !values.length))
                    throw new ApiError(400, '選択した回答が不正です。');
                value = q.type === 'single' ? (values.length ? String(values[0]) : '') : values as string[];
            }
            normalized.push({ questionId: q.id, value });
        }
        if (qs.some(q => q.required && !seen.has(q.id)))
            throw new ApiError(400, '必須設問へ回答してください。');
        const responseId = crypto.randomUUID(), now = new Date().toISOString();
        await db.batch([
            db.prepare(`INSERT OR IGNORE INTO survey_response_receipts(survey_id,user_hash,key_hash,request_hash,response_id) SELECT ?,?,?,?,? FROM surveys WHERE id=? AND status='published' AND start_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND end_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND revision=?`).bind(id, userHash, keyHash, hash, responseId, id, survey.revision),
            db.prepare('INSERT INTO survey_responses(id,survey_id,user_id,request_key,request_hash,answers,submitted_at,day_jst) SELECT ?,?,?,?,?,?,?,? FROM survey_response_receipts WHERE survey_id=? AND user_hash=? AND response_id=?').bind(responseId, id, user.id, requestKey, hash, JSON.stringify(normalized), now, jstDay(), id, userHash, responseId),
        ]);
        const saved = await db.prepare('SELECT response_id AS id,key_hash AS request_key,request_hash FROM survey_response_receipts WHERE survey_id=? AND user_hash=?').bind(id, userHash).first<{
            id: string;
            request_key: string;
            request_hash: string;
        }>();
        if (!saved)
            throw new ApiError(409, '受付が終了または変更されました。入力を保持して確認してください。', 'survey_closed');
        if (saved.request_key === keyHash && saved.request_hash !== '' && saved.request_hash !== hash)
            throw new ApiError(409, '同じ送信キーの内容が異なります。', 'idempotency_conflict');
        return response({ ok: true, responseId: saved.id });
    }
    throw new ApiError(405, '未対応の操作です。', 'method_not_allowed');
}
