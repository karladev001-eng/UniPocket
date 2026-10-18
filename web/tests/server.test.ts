import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { cleanup, digest, jstDay } from '../server/worker.ts';
import { notionUrl } from '../server/validation.ts';
import type { Database, Statement } from '../server/types.ts';

// Real SQLite executes the identical migration, queries, constraints and triggers.
// batch has D1's documented sequential transaction/rollback semantics.
class SQLiteD1 implements Database {
  sqlite = new DatabaseSync(':memory:');
  constructor() { this.sqlite.exec(readFileSync(new URL('../migrations/0001_articles.sql', import.meta.url), 'utf8')); }
  prepare(sql: string): Statement {
    const statement = this.sqlite.prepare(sql); let values: any[] = [];
    const api: Statement = {
      bind(...args: unknown[]) { values = args; return api; },
      async first<T>() { return (statement.get(...values) || null) as T | null; },
      async all<T>() { return {results: statement.all(...values) as T[]}; },
      async run() { return statement.run(...values); },
    }; return api;
  }
  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN');
    try { const values = []; for (const statement of statements) values.push(await statement.run()); this.sqlite.exec('COMMIT'); return values; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
function app() {
  const DB = new SQLiteD1();
  const send = async (path: string, method = 'GET', body?: unknown, cookie?: string, extra: Record<string,string> = {}) => {
    const response = await worker.fetch(new Request(`https://campus.example${path}`, {method,
      headers: {'Origin': 'https://campus.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? {Cookie: cookie} : {}), ...extra},
      ...(body !== undefined ? {body: JSON.stringify(body)} : {})}), {DB});
    return {status: response.status, data: await response.json() as any, headers: response.headers};
  };
  const session = async () => {
    const result = await send('/api/session', 'POST', {});
    assert.equal(result.status, 200);
    return {cookie: result.headers.get('Set-Cookie')!.split(';')[0], user: result.data.user, result};
  };
  const create = (cookie: string, overrides: Record<string,unknown> = {}, key = crypto.randomUUID()) => send('/api/articles', 'POST', {title: '履修ガイド', publicUrl: `https://demo.notion.site/${crypto.randomUUID()}`, summary: '履修登録の準備', category: '学習', courseId: 'course-1', ...overrides}, cookie, {'Idempotency-Key': key});
  return {DB, send, session, create};
}
test('anonymous session uses random hashed secret and secure cookie; forged IDs fail', async () => {
  const {DB,send,session} = app();
  assert.equal((await send('/api/session')).data.user, null);
  const a = await session();
  assert.match(a.result.headers.get('Set-Cookie')!, /HttpOnly; Secure; SameSite=Strict/);
  const raw = a.cookie.split('=')[1];
  const stored = DB.sqlite.prepare('SELECT token_hash,user_id FROM sessions').get() as any;
  assert.equal(stored.token_hash, await digest(raw)); assert.notEqual(stored.token_hash, raw);
  assert.equal((await send('/api/session', 'GET', undefined, a.cookie)).data.user.id, a.user.id);
  assert.equal((await send('/api/session', 'POST', {}, a.cookie)).data.user.id, a.user.id);
  assert.equal((await send('/api/session', 'GET', undefined, `__Host-campus_session=${a.user.id}`)).data.user, null);
  assert.equal((await send('/api/articles', 'POST', {title:'x', publicUrl:'https://demo.notion.site/a',authorId:a.user.id})).status, 401);
  DB.sqlite.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await send('/api/session', 'GET', undefined, a.cookie)).data.user, null);
});
test('CRUD enforces cookie ownership and filters by stable author ID', async () => {
  const {send,session,create} = app(); const a = await session(); const b = await session();
  await send('/api/session', 'PATCH', {displayName:'同じ名前'}, a.cookie);
  await send('/api/session', 'PATCH', {displayName:'同じ名前'}, b.cookie);
  const made = await create(a.cookie); assert.equal(made.status,201); const id = made.data.article.id;
  assert.equal(made.data.article.canEdit,true); assert.equal(made.data.article.authorId,a.user.id);
  await create(b.cookie, {title:'別の記事', category:'生活'});
  assert.equal((await send(`/api/articles/${id}`, 'PATCH', {title:'乗っ取り'}, b.cookie)).status,403);
  assert.equal((await send(`/api/articles/${id}`, 'DELETE', undefined, b.cookie)).status,403);
  assert.equal((await send(`/api/articles/${id}`, 'PATCH', {authorId:b.user.id}, a.cookie)).status,400);
  assert.equal((await send(`/api/articles/${id}`, 'GET', undefined, b.cookie)).data.article.canEdit,false);
  const filtered = await send(`/api/articles?authorId=${a.user.id}&q=${encodeURIComponent('履修')}&category=${encodeURIComponent('学習')}&courseId=course-1`);
  assert.equal(filtered.data.articles.length,1); assert.equal(filtered.data.articles[0].authorId,a.user.id);
  assert.equal((await send('/api/articles?q=%25')).data.articles.length,0);
  assert.equal((await send(`/api/articles/${id}`, 'PATCH', {title:'更新'}, a.cookie)).data.article.title,'更新');
  const first = await send('/api/articles?limit=1'); assert.ok(first.data.nextCursor);
  const second = await send(`/api/articles?limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`);
  assert.equal(second.data.articles.length,1); assert.notEqual(second.data.articles[0].id,first.data.articles[0].id);
  assert.equal((await send(`/api/articles/${id}`, 'DELETE', undefined,a.cookie)).status,200);
  assert.equal((await send(`/api/articles/${id}`)).status,404);
});
test('create retries and concurrent bookmark/view requests are idempotent; users isolated', async () => {
  const {DB,send,session,create} = app(); const a = await session(); const b = await session();
  const fixed = {publicUrl:'https://demo.notion.site/a?utm_source=test'}; const key = crypto.randomUUID();
  // This adapter serializes batch transactions, like D1; asynchronous request work overlaps.
  const made = await create(a.cookie,fixed,key); const id = made.data.article.id;
  const retries = await Promise.all(Array.from({length:8},() => create(a.cookie,fixed,key)));
  for (const retry of retries) { assert.equal(retry.status,201); assert.equal(retry.data.article.id,id); }
  assert.equal((DB.sqlite.prepare('SELECT COUNT(*) n FROM articles').get() as any).n,1);
  assert.equal((await create(a.cookie,{...fixed,title:'違う内容'},key)).status,409);
  assert.equal((await create(a.cookie,{publicUrl:'https://demo.notion.site/a'})).status,409);
  const bookmarks = await Promise.all(Array.from({length:12},()=> send(`/api/articles/${id}/bookmark`,'PUT',{},b.cookie)));
  for(const result of bookmarks) { assert.equal(result.status,200); assert.equal(result.data.bookmarkCount,1); }
  assert.equal((await send('/api/articles?bookmarked=1','GET',undefined,a.cookie)).data.articles.length,0);
  assert.equal((await send('/api/articles?bookmarked=1','GET',undefined,b.cookie)).data.articles.length,1);
  assert.equal((await send('/api/articles?bookmarked=1')).status,401);
  assert.equal((await send(`/api/articles/${id}/bookmark`,'PUT',{})).status,401);
  assert.equal((await send(`/api/articles/${id}/bookmark`,'PUT',{userId:a.user.id},b.cookie)).status,400);
  assert.equal((await send(`/api/articles/${id}/bookmark`,'DELETE',undefined,a.cookie)).data.bookmarkCount,1);
  const views = await Promise.all(Array.from({length:12},()=> send(`/api/articles/${id}/view`,'POST',{},b.cookie)));
  for(const result of views) { assert.equal(result.status,200); assert.equal(result.data.viewCount,1); }
  const deletes = await Promise.all(Array.from({length:8},()=>send(`/api/articles/${id}/bookmark`,'DELETE',undefined,b.cookie)));
  for(const result of deletes) assert.equal(result.data.bookmarkCount,0);
  const anonymousView = await send(`/api/articles/${id}/view`,'POST',{});
  assert.equal(anonymousView.data.viewCount,2);
  const viewerCookie = anonymousView.headers.get('Set-Cookie')!.split(';')[0];
  const reused = await send('/api/session','POST',{},viewerCookie); assert.ok(reused.data.user.id);
  assert.equal((await send(`/api/articles/${id}/view`,'POST',{},viewerCookie)).data.viewCount,2);
  assert.equal(jstDay(Date.parse('2026-10-18T14:59:59Z')),'2026-10-18');
  assert.equal(jstDay(Date.parse('2026-10-18T15:00:00Z')),'2026-10-19');
  // Simulate yesterday's dedupe row; retention must not subtract cumulative views.
  DB.sqlite.prepare("UPDATE view_events SET day_jst='2000-01-01'").run();
  await cleanup(DB);
  assert.equal((DB.sqlite.prepare('SELECT COUNT(*) n FROM view_events').get() as any).n,0);
  assert.equal((await send(`/api/articles/${id}`)).data.article.viewCount,2);
  await send(`/api/articles/${id}`,'DELETE',undefined,a.cookie);
  assert.equal((await create(a.cookie,fixed,key)).status,410);
});
test('origin, body, URL validation, SQL binding and cache protections fail closed', async () => {
  const {send,session,create} = app(); const a = await session();
  for (const origin of ['', 'https://evil.example', 'null']) assert.equal((await send('/api/session','POST',{},undefined,{Origin:origin})).status,403);
  assert.equal((await send('/api/session','POST',{},undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await send('/api/session','POST',{},undefined,{'Content-Type':'text/plain'})).status,415);
  for(const url of ['http://demo.notion.site/a','https://notion.site.evil.test/a','https://evilnotion.site/a','https://u:p@demo.notion.site/a','https://demo.notion.site:8443/a','https://127.0.0.1/a','javascript:alert(1)','https://notion.site/','https://a..notion.site/a']) {
    assert.equal((await create(a.cookie,{publicUrl:url})).status,400,url);
  }
  assert.equal(notionUrl('https://DEMO.notion.site/page?source=copy_link&utm_a=x#anchor'),'https://demo.notion.site/page');
  assert.equal((await create(a.cookie,{embedUrl:'<iframe src="https://demo.notion.site/a"></iframe>'})).status,400);
  assert.equal((await create(a.cookie,{title:'x'.repeat(121)})).status,400);
  assert.equal((await create(a.cookie,{summary:'x'.repeat(281)})).status,400);
  assert.equal((await create(a.cookie,{summary:'x'.repeat(17000)})).status,413);
  const sql = await send(`/api/articles?q=${encodeURIComponent("' OR 1=1 --")}`); assert.equal(sql.status,200); assert.equal(sql.data.articles.length,0);
  for(const path of ['/api/session','/api/articles','/api/nope']) {
    const result = await send(path,'GET',undefined,a.cookie); assert.match(result.headers.get('Cache-Control')!,/no-store/);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
    assert.ok(!JSON.stringify(result.data).includes('token_hash'));
  }
});
test('session creation and authenticated writes have persistent atomic limits', async () => {
  const {send,session} = app(); const a = await session();
  const attempted = await Promise.all(Array.from({length:130},()=>send('/api/session','PATCH',{displayName:'匿名'},a.cookie)));
  assert.ok(attempted.some(result=>result.status===429));
  for(const result of attempted) assert.ok([200,429].includes(result.status));
  const other = app();
  for(let i=0;i<10;i++) assert.equal((await other.send('/api/session','POST',{})).status,200);
  assert.equal((await other.send('/api/session','POST',{})).status,429);
});

test('anonymous view keeps issued cookie when a post-write read fails; retry counts once', async () => {
  const {DB,send,session,create} = app();
  const author = await session();
  const made = await create(author.cookie); const id = made.data.article.id;
  const prepare = DB.prepare.bind(DB); let articleReads = 0;
  DB.prepare = (sql: string): Statement => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT a.id')) {
      const first = statement.first.bind(statement);
      statement.first = async <T>() => {
        articleReads++;
        if (articleReads === 2) throw new Error('Injected transient post-write read failure');
        return await first<T>();
      };
    }
    return statement;
  };
  const failed = await send(`/api/articles/${id}/view`, 'POST', {});
  assert.equal(failed.status,503);
  const cookie = failed.headers.get('Set-Cookie');
  assert.ok(cookie); assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((DB.sqlite.prepare('SELECT view_count FROM articles WHERE id=?').get(id) as any).view_count,1);
  assert.equal((DB.sqlite.prepare('SELECT COUNT(*) n FROM view_events WHERE article_id=?').get(id) as any).n,1);
  const retry = await send(`/api/articles/${id}/view`, 'POST', {},cookie.split(';')[0]);
  assert.equal(retry.status,200); assert.equal(retry.data.viewCount,1);
  assert.equal((DB.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as any).n,2);
});
