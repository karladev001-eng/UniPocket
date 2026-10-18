export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'invalid_request') {
    super(message); this.status = status; this.code = code;
  }
}
export function textField(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new ApiError(400, `${name}は文字列で指定してください。`);
  const text = value.trim();
  if ((required && !text) || Array.from(text).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new ApiError(400, `${name}の長さ・文字が不正です。`);
  }
  return text;
}
export function notionUrl(value: unknown, name = 'publicUrl'): string {
  const raw = textField(value, name, 2048, true);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(400, 'NotionのHTTPS URLを入力してください。', 'invalid_url'); }
  const host = url.hostname;
  const allowed = ['notion.site', 'notion.so'].some(root => host === root || host.endsWith(`.${root}`))
    && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || /[\\\s]/u.test(raw) || url.pathname === '/') {
    throw new ApiError(400, '公開されたnotion.site / notion.soのHTTPS URLを入力してください。', 'invalid_url');
  }
  url.hash = '';
  // Share/tracking parameters do not make another public page. Retain other page parameters.
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_') || key === 'source') url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export type ArticleInput = {title: string; publicUrl: string; embedUrl: string; summary: string; category: string; courseId: string};
const limits = {title: 120, summary: 280, category: 60, courseId: 120};
export function articleInput(body: Record<string, unknown>, partial = false): Partial<ArticleInput> {
  const allowed = ['title', 'publicUrl', 'embedUrl', 'summary', 'category', 'courseId'];
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new ApiError(400, '許可されていない項目があります。');
  if (!partial && (!('title' in body) || !('publicUrl' in body))) throw new ApiError(400, 'タイトルと公開URLが必要です。');
  if (partial && !Object.keys(body).length) throw new ApiError(400, '変更する項目が必要です。');
  const result: Partial<ArticleInput> = {};
  for (const field of allowed as (keyof ArticleInput)[]) {
    if (!(field in body)) { if (!partial) result[field] = ''; continue; }
    if (field === 'publicUrl') result[field] = notionUrl(body[field]);
    else if (field === 'embedUrl') result[field] = body[field] === '' ? '' : notionUrl(body[field], field);
    else result[field] = textField(body[field], field, limits[field], field === 'title');
  }
  return result;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'JSONで送信してください。');
  if (Number(request.headers.get('Content-Length')) > 16384) throw new ApiError(413, '送信内容が大きすぎます。');
  // Bound streamed bodies too; Content-Length alone is not trusted.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new ApiError(413, '送信内容が大きすぎます。'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { throw new ApiError(400, 'JSONが不正です。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'JSONオブジェクトを送信してください。');
  return value as Record<string, unknown>;
}
