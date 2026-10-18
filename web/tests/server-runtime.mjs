import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');

test('real workerd/D1: migrations, concurrent creation, isolation, bookmarks and views', async () => {
  const built = await build({entryPoints: [new URL('../server/worker.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023'});
  // Miniflare 5 exposes its supported v4-to-v5 option converter for this source form.
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-10-18', d1Databases: ['DB']}));
  try {
    const db = await mf.getD1Database('DB');
    const migration = readFileSync(new URL('../migrations/0001_articles.sql', import.meta.url),'utf8');
    // D1 exec accepts complete SQL statements per line. Preserve trigger BEGIN/END.
    const statements = migration.replace(/^--.*$/gm,'').match(/\s*CREATE TRIGGER[\s\S]*?END;|(?:[^;]+;)/g) || [];
    for (const statement of statements) await db.exec(statement.replace(/^--.*$/gm,'').replace(/\s+/g,' ').trim());
    const send = async (path, method='GET', body, cookie, extra={}) => {
      const result = await mf.dispatchFetch(`https://campus.example${path}`, {method,
        headers: {Origin:'https://campus.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.4',...(cookie ? {Cookie:cookie}:{}),...extra},
        ...(body !== undefined ? {body:JSON.stringify(body)}:{})});
      return {status:result.status,data:await result.json(),headers:result.headers};
    };
    const one = await send('/api/session','POST',{}); assert.equal(one.status,200);
    const two = await send('/api/session','POST',{}); assert.equal(two.status,200);
    const a = one.headers.get('Set-Cookie').split(';')[0];
    const b = two.headers.get('Set-Cookie').split(';')[0];
    const key = crypto.randomUUID();
    const body = {title:'同時作成',publicUrl:'https://demo.notion.site/concurrent',embedUrl:'https://demo.notion.site/embed/sample'};
    const created = await Promise.all(Array.from({length:12},()=>send('/api/articles','POST',body,a,{'Idempotency-Key':key})));
    for(const result of created) assert.equal(result.status,201,JSON.stringify(result.data));
    const id = created[0].data.article.id;
    for(const result of created) assert.equal(result.data.article.id,id);
    assert.equal((await send('/api/articles')).data.articles.length,1);
    assert.equal((await send(`/api/articles/${id}`,'PATCH',{title:'不可'},b)).status,403);
    const marked = await Promise.all(Array.from({length:20},()=>send(`/api/articles/${id}/bookmark`,'PUT',{},b)));
    for(const result of marked) { assert.equal(result.status,200); assert.equal(result.data.bookmarkCount,1); }
    assert.equal((await send('/api/articles?bookmarked=1','GET',undefined,a)).data.articles.length,0);
    assert.equal((await send('/api/articles?bookmarked=1','GET',undefined,b)).data.articles.length,1);
    const viewed = await Promise.all(Array.from({length:20},()=>send(`/api/articles/${id}/view`,'POST',{},b)));
    for(const result of viewed) { assert.equal(result.status,200); assert.equal(result.data.viewCount,1); }
    const anonymous = await send(`/api/articles/${id}/view`,'POST',{}); assert.equal(anonymous.data.viewCount,2);
    const c = anonymous.headers.get('Set-Cookie').split(';')[0];
    assert.ok((await send('/api/session','POST',{},c)).data.user.id);
    assert.equal((await send(`/api/articles/${id}/view`,'POST',{},c)).data.viewCount,2);
    assert.equal((await send('/api/articles')).headers.get('Cache-Control'),'private, no-store');
    assert.equal((await send('/api/session','POST',{},undefined,{Origin:'https://attacker.example'})).status,403);
    assert.equal((await send('/api/articles','POST',{...body,title:'conflict'},a,{'Idempotency-Key':key})).status,409);
    assert.equal((await send('/api/articles','POST',body,a,{'Idempotency-Key':crypto.randomUUID()})).status,409);
    await send(`/api/articles/${id}`,'DELETE',undefined,a);
    assert.equal((await send('/api/articles','POST',body,a,{'Idempotency-Key':key})).status,410);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM bookmarks').first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM view_events').first()).n,0);
  } finally { await mf.dispose(); }
});
