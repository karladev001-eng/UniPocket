import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const apply = async (db, sql) => {
  const clean = sql.replace(/^--.*$/gm, '');
  for (const statement of clean.match(/\s*CREATE TRIGGER[\s\S]*?END;|(?:[^;]+;)/g) || []) await db.exec(statement.replace(/\s+/g, ' ').trim());
};

test('additive migrations preserve existing identities, ownership, shared content and unknown history', { timeout: 60000 }, async () => {
  const script = await build({ entryPoints: [new URL('../server/worker.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: script.outputFiles[0].text, compatibilityDate: '2026-10-18', d1Databases: { DB: 'migration-only' } }));
  try {
    const db = await mf.getD1Database('DB');
    await apply(db, await readFile(new URL('../migrations/0001_articles.sql', import.meta.url), 'utf8'));
    const user = crypto.randomUUID(), id = crypto.randomUUID(), token = '1'.repeat(64);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
    const oldDay = new Date(Date.now() + 9 * 3600000 - 6 * 86400000).toISOString().slice(0, 10);
    const created = '2020-01-01T00:00:00.000Z';
    await db.batch([
      db.prepare('INSERT INTO profiles VALUES(?,?,?)').bind(user, '既存の投稿者', created),
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(hash, user, Math.floor(Date.now()/1000) + 86400),
      db.prepare('INSERT INTO articles(id,author_id,public_url,title,summary,category,created_at,updated_at,view_count) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, user, 'https://demo.notion.site/' + id, '既存の記事', '既存紹介', '学習', created, created, 6),
      db.prepare('INSERT INTO bookmarks VALUES(?,?)').bind(user, id),
      db.prepare('INSERT INTO view_events VALUES(?,?,?)').bind(id, user, oldDay),
      db.prepare('INSERT INTO create_keys VALUES(?,?,?,?,?)').bind(user, 'original-create', 'original-hash', id, 1),
    ]);
    for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).sort().filter(name => name !== '0001_articles.sql')) await apply(db, await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
    const request = path => mf.dispatchFetch('https://campus.example' + path, { headers: { Cookie: '__Host-campus_session=' + token } });
    const identity = await (await request('/api/session')).json(); assert.equal(identity.user.id, user); assert.equal(identity.user.displayName, '既存の投稿者');
    const detail = await (await request('/api/articles/' + id)).json();
    assert.equal(detail.article.id, id); assert.equal(detail.article.canEdit, true); assert.equal(detail.article.bookmarked, true);
    assert.equal(detail.article.viewCount, 7); assert.equal(detail.article.bookmarkCount, 1); assert.equal(detail.article.revision, 1);
    assert.equal((await db.prepare('SELECT visibility FROM articles WHERE id=?').bind(id).first()).visibility, 'published');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM view_events').first()).n, 1);
    assert.equal((await db.prepare('SELECT request_key FROM create_keys').first()).request_key, 'original-create');
    const collected = (await db.prepare('SELECT collected_since FROM metric_settings').first()).collected_since;
    assert.ok(collected > oldDay); assert.equal((await db.prepare('SELECT COUNT(*) n FROM daily_content_metrics WHERE day=?').bind(oldDay).first()).n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM profiles WHERE author_kind='user'").first()).n, 1);
    assert.equal(detail.article.authorKind,'user');
    const reserved=await db.prepare("SELECT id,display_name FROM profiles WHERE author_kind='admin'").first();
    assert.match(reserved.id,/^admin:[a-f0-9]{48}$/); assert.equal(reserved.display_name,'Uni Pocket運営');
    await assert.rejects(db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind('reserved',reserved.id,9999999999).run(),/reserved_author/);
    await assert.rejects(db.prepare("UPDATE profiles SET display_name='偽装' WHERE id=?").bind(reserved.id).run(),/reserved_author/);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions').first()).n, 1);
  } finally { await mf.dispose(); }
});
