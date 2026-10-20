import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker, { cleanup, digest, jstDay } from '../server/worker.ts';
import { notionUrl } from '../server/validation.ts';
import type { Database, Statement } from '../server/types.ts';

// Real SQLite executes the identical migration, queries, constraints and triggers.
// batch has D1's documented sequential transaction/rollback semantics.
class SQLiteD1 implements Database {
  sqlite = new DatabaseSync(':memory:');
  constructor() { for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort())this.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8')); }
  prepare(sql: string): Statement {
    const statement = this.sqlite.prepare(sql); let values: any[] = [];
    const api: Statement = {
      bind(...args: unknown[]) { values = args; return api; },
      async first<T>() { return (statement.get(...values) || null) as T | null; },
      async all<T>() { return {results: statement.all(...values) as T[]}; },
      async run() {const result=statement.run(...values);return {meta:{changes:Number(result.changes)}}; },
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
      headers: {'Origin': 'https://campus.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? {Cookie: cookie} : {}), ...((method==='PATCH'||method==='DELETE')&&/^\/api\/articles\/[a-f0-9-]{36}$/.test(path)&&cookie?{'If-Match':String((DB.sqlite.prepare('SELECT revision FROM articles WHERE id=?').get(path.split('/')[3]) as any)?.revision||1)}:{}),...extra},
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
  for(let i=0;i<100;i++) assert.equal((await other.send('/api/session','POST',{})).status,200);
  const spam=await Promise.all(Array.from({length:100},()=>other.send('/api/session','POST',{})));
  assert.ok(spam.some(result=>result.status===429));
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

const FIXED_NOW = Date.parse('2026-10-20T15:00:00.000Z'); // JST has just entered October 21.
function fixedTime(t: {after: (fn: () => void) => void}) {
  const now = Date.now; Date.now = () => FIXED_NOW; t.after(() => { Date.now = now; });
}
function seedRanking(DB: SQLiteD1, firstAuthor: string, secondAuthor = firstAuthor, count = 67) {
  const viewers = Array.from({length: 5}, () => crypto.randomUUID());
  for (const id of viewers) DB.sqlite.prepare('INSERT INTO profiles VALUES(?,?,?)').run(id, '閲覧者', '2026-01-01T00:00:00.000Z');
  return Array.from({length: count}, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    // Repeated timestamps exercise the ID tie-break across page boundaries.
    const createdAt = new Date(FIXED_NOW - Math.floor(i / 3) * 3600000).toISOString();
    const title = `${i % 4 === 0 ? '検索一致' : '記事'}${i}`;
    const category = i % 2 ? '生活' : '学習'; const courseId = `course-${i % 3}`;
    const authorId = i % 2 ? secondAuthor : firstAuthor;
    DB.sqlite.prepare(`INSERT INTO articles(id,author_id,public_url,title,summary,category,course_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, authorId, `https://demo.notion.site/seed-${i}`, title, '紹介文', category, courseId, createdAt, createdAt);
    const views = i % 5; const bookmarks = i % 3;
    for (let n = 0; n < views; n++) DB.sqlite.prepare('INSERT INTO view_events VALUES(?,?,?)').run(id, viewers[n], '2026-10-15');
    for (let n = 0; n < bookmarks; n++) DB.sqlite.prepare('INSERT INTO bookmarks VALUES(?,?)').run(viewers[n], id);
    return {id, createdAt, title, category, courseId, authorId, rankKey: views + bookmarks * 3};
  });
}
type SeedRow = ReturnType<typeof seedRanking>[number];
const newestOrder = (a: SeedRow, b: SeedRow) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
const popularOrder = (a: SeedRow, b: SeedRow) => b.rankKey - a.rankKey || newestOrder(a,b);

test('popular ranks the complete population before limit, uses all tie-breaks, and preserves old newest clients', async t => {
  fixedTime(t);
  const {DB,send,session} = app(); const author = await session();
  const rows = seedRanking(DB,author.user.id);
  // An old article outside the first twenty newest results must win the first popular page.
  const winner = rows[66]; winner.rankKey += 30;
  for (let i = 0; i < 10; i++) {
    const viewer = crypto.randomUUID(); DB.sqlite.prepare('INSERT INTO profiles VALUES(?,?,?)').run(viewer,'保存者',winner.createdAt);
    DB.sqlite.prepare('INSERT INTO bookmarks VALUES(?,?)').run(viewer,winner.id);
  }
  const popular = await send('/api/articles?sort=popular'); assert.equal(popular.status,200);
  assert.deepEqual(popular.data.articles.map((a: any) => a.id), [...rows].sort(popularOrder).slice(0,20).map(a=>a.id));
  assert.equal(popular.data.articles[0].id,winner.id);
  assert.ok(!('rankKey' in popular.data.articles[0]));
  const defaultList = await send('/api/articles'); const newest = await send('/api/articles?sort=newest');
  assert.deepEqual(defaultList.data,newest.data);
  assert.deepEqual(newest.data.articles.map((a: any)=>a.id), [...rows].sort(newestOrder).slice(0,20).map(a=>a.id));
  const legacy = JSON.parse(atob(newest.data.nextCursor)); assert.equal(legacy.length,2);
  const legacyNext = await send(`/api/articles?cursor=${encodeURIComponent(newest.data.nextCursor)}`);
  assert.deepEqual(legacyNext.data.articles.map((a: any)=>a.id), [...rows].sort(newestOrder).slice(20,40).map(a=>a.id));
  DB.sqlite.exec('DELETE FROM view_events; DELETE FROM bookmarks;');
  const zero = await send('/api/articles?sort=popular');
  assert.deepEqual(zero.data.articles.map((a: any)=>a.id),newest.data.articles.map((a: any)=>a.id));
  // Retention and ranking changes never subtract historical cumulative display counts.
  const viewed = zero.data.articles.find((a: any)=>a.id === rows[2].id); assert.equal(viewed.viewCount,2);
});

test('popular and newest traverse over fifty fixed rows with no duplicates or omissions', async t => {
  fixedTime(t);
  const {DB,send,session} = app(); const author = await session(); const rows = seedRanking(DB,author.user.id);
  for (const sort of ['popular','newest']) {
    const ids: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const result = await send(`/api/articles?sort=${sort}&limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(result.status,200); ids.push(...result.data.articles.map((a: any)=>a.id));
      cursor = result.data.nextCursor; assert.ok(++pages < 12);
    } while (cursor);
    assert.equal(ids.length,rows.length); assert.equal(new Set(ids).size,rows.length);
    assert.deepEqual(ids,[...rows].sort(sort === 'popular' ? popularOrder : newestOrder).map(a=>a.id));
  }
});

test('popular applies q/category/course/author/bookmarked filters before SQL rank and paging', async t => {
  fixedTime(t);
  const {DB,send,session} = app(); const a = await session(); const b = await session();
  const rows = seedRanking(DB,a.user.id,b.user.id);
  const saved = rows.filter((_,i)=>i % 4 === 0 || i % 7 === 0);
  for (const row of saved) DB.sqlite.prepare('INSERT INTO bookmarks VALUES(?,?)').run(a.user.id,row.id);
  for (const row of saved) row.rankKey += 3;
  const cases: [string, (row: SeedRow) => boolean][] = [
    ['q=検索一致', row=>row.title.includes('検索一致')],
    ['category=学習', row=>row.category === '学習'],
    ['courseId=course-1', row=>row.courseId === 'course-1'],
    [`authorId=${b.user.id}`,row=>row.authorId === b.user.id],
    ['bookmarked=1',row=>saved.includes(row)],
    [`q=検索一致&category=学習&courseId=course-1&authorId=${a.user.id}&bookmarked=1`,
      row=>row.title.includes('検索一致') && row.category === '学習' && row.courseId === 'course-1' && row.authorId === a.user.id && saved.includes(row)],
  ];
  for (const [query,filter] of cases) {
    const expected = rows.filter(filter).sort(popularOrder).map(a=>a.id); const actual: string[] = []; let cursor: string | null = null;
    do {
      const result = await send(`/api/articles?sort=popular&limit=3&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET',undefined,a.cookie);
      assert.equal(result.status,200,query); actual.push(...result.data.articles.map((a: any)=>a.id)); cursor = result.data.nextCursor;
    } while (cursor);
    assert.deepEqual(actual,expected,query);
  }
  assert.equal((await send('/api/articles?sort=popular&bookmarked=1')).status,401);
  for (const q of ["' OR 1=1 --", '%', '_']) {
    const result = await send(`/api/articles?sort=popular&q=${encodeURIComponent(q)}`);
    assert.equal(result.status,200); assert.deepEqual(result.data.articles,[]);
  }
});

test('popular uses exactly seven JST calendar days and fixes that window through cursor continuation', async t => {
  fixedTime(t);
  const {DB,send,session} = app(); const author = await session(); const rows = seedRanking(DB,author.user.id,author.user.id,4);
  DB.sqlite.exec('DELETE FROM view_events; DELETE FROM bookmarks; UPDATE articles SET view_count=0;');
  const viewer = author.user.id;
  // At 15:00 UTC October 20, the JST window is October 15–21 inclusive.
  for (const [i,day] of [[0,'2026-10-14'],[1,'2026-10-15'],[2,'2026-10-21'],[3,'2026-10-22']] as const) {
    DB.sqlite.prepare('INSERT INTO view_events VALUES(?,?,?)').run(rows[i].id,viewer,day);
    rows[i].rankKey = i === 1 || i === 2 ? 1 : 0;
  }
  const otherViewer = (DB.sqlite.prepare('SELECT id FROM profiles WHERE id<>? LIMIT 1').get(viewer) as any).id;
  DB.sqlite.prepare('INSERT INTO view_events VALUES(?,?,?)').run(rows[3].id,otherViewer,'2026-10-22');
  const first = await send('/api/articles?sort=popular&limit=1');
  assert.equal(first.data.articles[0].id,rows[2].id); assert.equal(first.data.articles[0].viewCount,1);
  const window = JSON.parse(atob(first.data.nextCursor)); assert.equal(window.startDay,'2026-10-15'); assert.equal(window.endDay,'2026-10-21');
  // The first request before midnight would still count October 14 and exclude October 21.
  Date.now = () => FIXED_NOW - 1;
  const previous = await send('/api/articles?sort=popular&limit=1'); assert.equal(previous.data.articles[0].id,rows[1].id);
  const previousWindow = JSON.parse(atob(previous.data.nextCursor)); assert.equal(previousWindow.startDay,'2026-10-14'); assert.equal(previousWindow.endDay,'2026-10-20');
  Date.now = () => FIXED_NOW + 86400000;
  const continued = await send(`/api/articles?sort=popular&limit=1&cursor=${encodeURIComponent(first.data.nextCursor)}`);
  assert.equal(continued.data.articles[0].id,rows[1].id);
  const continuedWindow = JSON.parse(atob(continued.data.nextCursor)); assert.equal(continuedWindow.startDay,window.startDay); assert.equal(continuedWindow.endDay,window.endDay);
  const refreshed = await send('/api/articles?sort=popular&limit=1'); assert.equal(refreshed.data.articles[0].id,rows[3].id);
});

test('sort and cursor input reject malformed or mixed positions', async t => {
  fixedTime(t);
  const {DB,send,session} = app(); const author = await session(); seedRanking(DB,author.user.id,author.user.id,3);
  const first = await send('/api/articles?sort=popular&limit=1'); const cursor = JSON.parse(atob(first.data.nextCursor));
  const newest = await send('/api/articles?limit=1');
  const encode = (value: unknown) => encodeURIComponent(btoa(JSON.stringify(value)));
  const invalid: unknown[] = [null, [], {}, [cursor.createdAt,cursor.id], {...cursor,sort:'newest'}, {...cursor,version:2},
    {...cursor,startDay:'2026-02-30'}, {...cursor,endDay:'2026-13-01'}, {...cursor,startDay:'2026-10-14'},
    {...cursor,rankKey:-1}, {...cursor,rankKey:0.5}, {...cursor,rankKey:'3'}, {...cursor,rankKey:Number.MAX_SAFE_INTEGER+1},
    {...cursor,rankKey:null}, {...cursor,createdAt:'2026-02-30T00:00:00.000Z'}, {...cursor,createdAt:'2026-10-20T24:00:00.000Z'},
    {...cursor,id:'-'.repeat(36)}, {...cursor,id:"00000000-0000-4000-8000-00000000000'"}, {...cursor,extra:true}];
  for (const value of invalid) assert.equal((await send(`/api/articles?sort=popular&cursor=${encode(value)}`)).status,400,JSON.stringify(value));
  for (const raw of ['', '%%%', 'a'.repeat(1025)]) assert.equal((await send(`/api/articles?sort=popular&cursor=${raw}`)).status,400);
  for (const sort of ['', 'latest', 'POPULAR', "popular' OR 1=1 --"]) assert.equal((await send(`/api/articles?sort=${encodeURIComponent(sort)}`)).status,400);
  for (const sort of ['newest','']) assert.equal((await send(`/api/articles?${sort ? `sort=${sort}&` : ''}cursor=${encodeURIComponent(first.data.nextCursor)}`)).status,400);
  assert.equal((await send(`/api/articles?sort=popular&cursor=${encodeURIComponent(newest.data.nextCursor)}`)).status,400);
  for (const position of [['2026-02-30T00:00:00.000Z',cursor.id], [cursor.createdAt,'-'.repeat(36)], [cursor.createdAt,cursor.id,0]]) {
    assert.equal((await send(`/api/articles?sort=newest&cursor=${encode(position)}`)).status,400);
  }
  const valid = await send(`/api/articles?sort=popular&limit=1&cursor=${encode({...cursor,rankKey:0})}`); assert.equal(valid.status,200);
});
