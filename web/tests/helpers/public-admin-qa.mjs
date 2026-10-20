// Test-only product QA. No deployed Worker imports this module or its signing key.
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runtime } from './server-admin-fixture.mjs';

export async function seedQa(r) {
  const owner = await r.session();
  for (const [title, summary, category] of [
    ['図書館で集中するための小さな工夫', '静かな学習場所を見つけるヒント。ローカル検証用の架空記事です。', '学習'],
    ['秋学期の履修を確認する', '時間割と課題を整理するための架空の案内です。', 'キャンパス'],
    ['学食の混雑を避けたいとき', 'ランチの時間を少しずらす工夫。ローカル検証用です。', '暮らし'],
  ]) {
    const made = await r.send('/api/articles', 'POST', { title, summary, category, publicUrl: 'https://demo.notion.site/' + crypto.randomUUID() }, owner.cookie, { 'Idempotency-Key': crypto.randomUUID() });
    if (made.status !== 201) throw Error(JSON.stringify(made));
    await r.send(`/api/articles/${made.data.article.id}/view`, 'POST', {}, owner.cookie);
    await r.send(`/api/articles/${made.data.article.id}/bookmark`, 'PUT', {}, owner.cookie);
  }
  const notice = await r.content('announcements', { title: '秋学期の予定を確認しましょう', body: '時間割と予定はこの端末で管理できます。これはローカル検証用のお知らせです。', link: '' });
  const survey = await r.content('surveys', { title: 'Uni Pocket の使い心地', intro: '今後の改善の参考にする架空のアンケートです。回答は任意です。' });
  for (const [type, value] of [['announcements', notice], ['surveys', survey]]) {
    const result = await r.publish(type, value);
    if (result.status !== 200) throw Error(JSON.stringify(result));
  }
  const sample = await r.session();
  const answers = survey.questions.map(q => ({ questionId: q.id, value: q.type === 'text' ? '予定がすぐに見られると便利です。' : q.options[0].id }));
  const answered = await r.send(`/api/surveys/${survey.id}/responses`, 'POST', { answers }, sample.cookie, { 'Idempotency-Key': crypto.randomUUID() });
  if (answered.status !== 200 && answered.status !== 201) throw Error(JSON.stringify(answered));
  return { noticeId: notice.id, surveyId: survey.id };
}

export async function startQa({ publicPort = 8890, adminPort = 8891, seed = true } = {}) {
  const r = await runtime({ assetDirectories: { public: fileURLToPath(new URL('../../dist/', import.meta.url)), admin: fileURLToPath(new URL('../../dist-admin/', import.meta.url)) } });
  const servers = [];
  try {
    const fixtures = seed ? await seedQa(r) : {};
    async function listen(kind, port) {
      const upstream = kind === 'public' ? 'https://campus.example' : 'https://admin.example';
      const server = createServer(async (req, res) => {
        try {
          const local = `http://127.0.0.1:${server.address().port}`;
          if (req.headers.host !== new URL(local).host) { res.writeHead(400); res.end('Loopback host required'); return; }
          const url = new URL(req.url, local);
          if (url.pathname.startsWith('/__test')) { res.writeHead(404); res.end('Not found'); return; }
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !['host', 'connection', 'content-length', 'cf-access-jwt-assertion'].includes(name)) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          if (headers.has('cookie')) headers.set('cookie', headers.get('cookie').replace(/(?:^|;\s*)qa_public_campus_session=/g, '; __Host-campus_session=').replace(/^; /, ''));
          if (headers.get('origin') === local) headers.set('Origin', upstream);
          headers.set('CF-Connecting-IP', '192.0.2.50');
          if (kind === 'admin') headers.set('Cf-Access-Jwt-Assertion', await r.token());
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const response = await r.mf.dispatchFetch(upstream + url.pathname + url.search, { method: req.method, headers, ...(body.length ? { body } : {}) });
          const outgoing = {};
          response.headers.forEach((value, name) => { if (!['set-cookie', 'content-length', 'transfer-encoding', 'content-encoding'].includes(name)) outgoing[name] = value; });
          // __Host- cookies require Secure. Map the name only inside this HTTP
          // loopback relay, then restore it upstream; production is unchanged.
          const cookies = response.headers.getSetCookie();
          if (cookies.length) outgoing['set-cookie'] = cookies.map(value => value.replace(/^__Host-campus_session=/, 'qa_public_campus_session=').replace(/;\s*Secure\b/ig, ''));
          res.writeHead(response.status, outgoing);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) { console.error('Local QA request failed:', error.message); res.writeHead(502); res.end('Local QA request failed'); }
      });
      servers.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}`;
    }
    const publicUrl = await listen('public', publicPort), adminUrl = await listen('admin', adminPort);
    return { publicUrl, adminUrl, fixtures, runtime: r, async close() { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); await r.mf.dispose(); } };
  } catch (error) { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); await r.mf.dispose(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const qa = await startQa();
  console.log(JSON.stringify({ publicUrl: qa.publicUrl, adminUrl: qa.adminUrl, fixtures: qa.fixtures, data: 'Synthetic ephemeral local D1 only; Ctrl+C discards it.' }, null, 2));
  const stop = async () => { await qa.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
