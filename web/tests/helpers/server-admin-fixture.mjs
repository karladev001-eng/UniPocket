import { configureWorkerd } from '../../scripts/runtime.mjs';
configureWorkerd();
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { build } = require('esbuild');
export const team = 'https://test-school.cloudflareaccess.com', aud = 'test-admin-audience', owner = 'owner@example.test';
export const day = n => new Date(Date.now() + 9 * 3600000 + n * 86400000).toISOString().slice(0, 10);
export const instant = n => new Date(Date.now() + n * 86400000).toISOString();
const base64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
export async function runtime({ assetDirectories = {} } = {}) {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256' };
    async function token(overrides = {}, key = pair.privateKey) {
        const now = Math.floor(Date.now() / 1000), h = base64({ alg: 'RS256', kid: 'test-key' }), p = base64({ iss: team, aud: [aud], email: owner, iat: now, exp: now + 3600, ...overrides });
        const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
        return h + '.' + p + '.' + Buffer.from(sig).toString('base64url');
    }
    const options = { bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' };
    const scripts = await Promise.all(['worker', 'admin'].map(name => build({ ...options, entryPoints: [new URL('../../server/' + name + '.ts', import.meta.url).pathname] })));
    const cleanupScript = await build({ ...options, stdin: { contents: "import worker,{cleanup} from './worker.ts'; export default {async fetch(r,e){if(new URL(r.url).pathname==='/__test_cleanup'){await cleanup(e.DB);return new Response('ok')}return worker.fetch(r,e)}}", resolveDir: new URL('../../server/', import.meta.url).pathname } });
    function asset(directory) {
        return request => {
            const root = resolve(directory), pathname = decodeURIComponent(new URL(request.url).pathname), candidate = resolve(root, '.' + pathname);
            if (candidate !== root && !candidate.startsWith(root + sep))
                return new Response('Not found', { status: 404 });
            let target = candidate;
            if (!existsSync(target) || !statSync(target).isFile())
                target = resolve(root, 'index.html');
            if (!existsSync(target))
                return new Response('Not found', { status: 404 });
            const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };
            return new Response(readFileSync(target), { headers: { 'Content-Type': mime[extname(target)] || 'application/octet-stream' } });
        };
    }
    const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
            { name: 'public', routes: ['campus.example/*'], modules: true, script: cleanupScript.outputFiles[0].text, compatibilityDate: '2026-10-18', d1Databases: { DB: 'shared' }, ...(assetDirectories.public ? { serviceBindings: { ASSETS: asset(assetDirectories.public) } } : {}) },
            { name: 'admin', routes: ['admin.example/*'], modules: true, script: scripts[1].outputFiles[0].text, compatibilityDate: '2026-10-18', d1Databases: { DB: 'shared' }, bindings: { APP_ORIGIN: 'https://admin.example', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud, ADMIN_OWNER_EMAIL: owner }, serviceBindings: { ASSETS: assetDirectories.admin ? asset(assetDirectories.admin) : () => new Response('<html>private</html>', { headers: { 'Cache-Control': 'public,max-age=3600' } }) }, outboundService: r => {
                    assert.equal(r.url, team + '/cdn-cgi/access/certs');
                    return Response.json({ keys: [jwk] });
                } },
            { name: 'unconfigured', routes: ['unconfigured.example/*'], modules: true, script: scripts[1].outputFiles[0].text, compatibilityDate: '2026-10-18', d1Databases: { DB: 'shared' } }
        ] }));
    try {
        const db = await mf.getD1Database('DB', 'public');
        for (const f of readdirSync(new URL('../../migrations/', import.meta.url)).sort()) {
            const sql = readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8').replace(/^--.*$/gm, '');
            for (const st of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|(?:[^;]+;)/g) || [])
                await db.exec(st.replace(/\s+/g, ' ').trim());
        }
        const pub = await mf.getWorker('public'), admin = await mf.getWorker('admin'), unconfigured = await mf.getWorker('unconfigured'), jwt = await token();
        async function send(path, method = 'GET', body, cookie, extra = {}, which = 'public') {
            const origin = which === 'public' ? 'https://campus.example' : which === 'admin' ? 'https://admin.example' : 'https://unconfigured.example';
            const target = which === 'public' ? pub : which === 'admin' ? admin : unconfigured;
            const result = await mf.dispatchFetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}), ...(which === 'admin' ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            const text = await result.text();
            let data;
            try {
                data = JSON.parse(text);
            }
            catch {
                data = text;
            }
            return { status: result.status, data, headers: result.headers };
        }
        const adm = (p, m = 'GET', b, headers = {}) => send('/api/admin' + p, m, b, undefined, headers, 'admin');
        async function session() {
            const r = await send('/api/session', 'POST', {});
            assert.equal(r.status, 200, JSON.stringify(r.data));
            return { id: r.data.user.id, cookie: r.headers.get('Set-Cookie').split(';')[0] };
        }
        async function article(cookie) {
            const r = await send('/api/articles', 'POST', { title: '=SUM(1,2)', publicUrl: 'https://demo.notion.site/' + crypto.randomUUID(), category: '学習' }, cookie, { 'Idempotency-Key': crypto.randomUUID() });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data.article;
        }
        async function content(type, overrides = {}) {
            const r = await adm('/' + type, 'POST', { title: 'お知らせ', ...(type === 'announcements' ? { body: '本文', link: 'https://example.test/' } : { intro: '紹介', questions: [{ id: crypto.randomUUID(), title: '選択', type: 'single', required: true, options: [{ id: crypto.randomUUID(), label: 'はい' }, { id: crypto.randomUUID(), label: 'いいえ' }] }, { id: crypto.randomUUID(), title: '自由記述', type: 'text', required: false, options: [] }] }), startAt: instant(-1), endAt: instant(1), ...overrides }, { 'Idempotency-Key': crypto.randomUUID() });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data[type === 'announcements' ? 'announcement' : 'survey'];
        }
        const publish = (type, c) => adm(`/${type}/${c.id}/publish`, 'POST', { revision: c.revision }, { 'Idempotency-Key': crypto.randomUUID() });
        return { mf, db, send, adm, session, article, content, publish, token, pair, jwt, cleanup: () => mf.dispatchFetch('https://campus.example/__test_cleanup') };
    }
    catch (e) {
        await mf.dispose();
        throw e;
    }
}
