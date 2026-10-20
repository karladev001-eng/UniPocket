import type { Database, Env, Statement } from './types.ts';
import { ApiError } from './validation.ts';
export function response(data: unknown, status = 200, cookie?: string): Response {
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (cookie)
        headers['Set-Cookie'] = cookie;
    if (status === 429)
        headers['Retry-After'] = '60';
    return Response.json(data, { status, headers });
}
export function originCheck(request: Request, env: Env): void {
    const expected = env.APP_ORIGIN || new URL(request.url).origin;
    if (request.headers.get('Origin') !== expected || request.headers.get('Sec-Fetch-Site') === 'cross-site')
        throw new ApiError(403, '同じアプリから操作してください。', 'origin_rejected');
}
export async function digest(value: string): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function jstDay(now = Date.now()): string {
    return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}
export function revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1)
        throw new ApiError(400, 'revisionが必要です。');
    return Number(value);
}
export function ifMatch(request: Request): number {
    const v = (request.headers.get('If-Match') || '').replace(/^"|"$/g, '');
    return revision(/^\d+$/.test(v) ? Number(v) : NaN);
}
export function conflict(): never {
    throw new ApiError(409, 'ほかの更新があります。入力を保持して最新情報を確認してください。', 'revision_conflict');
}
export function uuid(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}
export function key(request: Request): string {
    const k = request.headers.get('Idempotency-Key') || '';
    if (!/^[\w.-]{8,128}$/.test(k))
        throw new ApiError(400, 'Idempotency-Keyが必要です。');
    return k;
}
export async function rate(db: Database, value: string, limit: number, seconds: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000), bucket = `${await digest(value)}:${Math.floor(now / seconds)}`;
    const result = await db.prepare('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(bucket, now + seconds * 2, limit).first();
    if (!result)
        throw new ApiError(429, '操作が多すぎます。しばらく待って再試行してください。', 'rate_limited');
}
export function audit(db: Database, email: string, target: string, action: string, conditional = false, id: string = crypto.randomUUID()): Statement {
    return db.prepare(`INSERT INTO admin_audit(id,admin_email,target_id,action,result,created_at) SELECT ?,?,?,?,'success',?${conditional ? ' WHERE changes()=1' : ''}`).bind(id, email, target, action, new Date().toISOString());
}
export function csvCell(v: unknown): string {
    let s = String(v ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s))
        s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
}
export function csv(rows: unknown[][]): Response {
    return new Response('\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="export.csv"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
