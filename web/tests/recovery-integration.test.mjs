import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runtime } from './helpers/server-admin-fixture.mjs';

const module = await build({ stdin: { contents: "export * from './src/article-submit.ts';export {ApiError} from './src/api.ts';export * from './admin/src/model.ts';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2023' });
const { submitNewArticle, bindArticleRecovery, ApiError, EditorState, AdminError } = await import('data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].text).toString('base64'));

test('lost article creation + real intervening D1 edit requires bound user rebase and preserves the other tab summary', async () => {
  const r = await runtime();
  try {
    const user = await r.session(), body = { title: 'original', publicUrl: 'https://demo.notion.site/' + crypto.randomUUID(), embedUrl: '', summary: 'original summary', category: '', courseId: '' };
    const draft = { key: crypto.randomUUID(), title: body.title }, persist = async () => {};
    let lost = true, id;
    const send = async (path, method, input, headers) => {
      const result = await r.send('/api' + path, method, input, user.cookie, headers);
      if (result.status >= 400) throw new ApiError(result.data.error, result.status, result.data.code);
      if (method === 'POST' && lost) { lost = false; id = result.data.article.id; throw Error('response lost after actual commit'); }
      return result.data;
    };
    await assert.rejects(submitNewArticle(draft, body, send, persist), /response lost/);
    assert.equal((await r.send('/api/articles/' + id, 'PATCH', { summary: 'other tab summary' }, user.cookie, { 'If-Match': '1' })).status, 200);
    const desired = { ...body, title: 'local title' }; draft.title = desired.title;
    await assert.rejects(submitNewArticle(draft, desired, send, persist), /別の更新/);
    let latest = (await r.send('/api/articles/' + id)).data.article;
    assert.equal(latest.revision, 2); assert.equal(latest.title, 'original'); assert.equal(draft.title, 'local title');
    const trigger = { disabled: false }, box = { textContent: '' }, dialog = { open: true, isConnected: true, querySelector: selector => selector === '#refresh-article-revision' ? trigger : box };
    bindArticleRecovery(dialog, { draft, send, confirm: () => { assert.match(box.textContent, /other tab summary/); return true; }, persist });
    await trigger.onclick();
    await submitNewArticle(draft, desired, send, persist);
    latest = (await r.send('/api/articles/' + id)).data.article;
    assert.equal(latest.revision, 3); assert.equal(latest.title, 'local title'); assert.equal(latest.summary, 'other tab summary');
    assert.equal((await r.send('/api/my/articles', 'GET', undefined, user.cookie)).data.articles.length, 1);
    // An ambiguous response without another writer remains a successful retry.
    const clean = { ...body, publicUrl: 'https://demo.notion.site/' + crypto.randomUUID() }, cleanDraft = { key: crypto.randomUUID() }; lost = true;
    await assert.rejects(submitNewArticle(cleanDraft, clean, send, persist), /response lost/);
    assert.equal((await submitNewArticle(cleanDraft, clean, send, persist)).article.revision, 1);
  } finally { await r.mf.dispose(); }
});

test('lost admin creation + real intervening D1 edit keeps inputs until explicit rebase; published surveys lock questions', async () => {
  const r = await runtime();
  try {
    const original = { id: '', revision: 0, title: 'original', body: 'original body', link: '', startAt: new Date(Date.now()-86400000).toISOString(), endAt: new Date(Date.now()+86400000).toISOString(), createdAt: '', updatedAt: '', status: 'draft' };
    const state = new EditorState('announcements', original);
    let lost = true, created;
    const send = async (path, method = 'GET', body, headers) => {
      const result = await r.adm(path, method, body, headers);
      if (result.status >= 400) throw new AdminError(result.data.error, result.status, result.data.code);
      if (method === 'POST' && lost) { lost = false; created = result.data.announcement ?? result.data.survey; throw Error('lost after actual commit'); }
      return result.data;
    };
    await assert.rejects(state.save(send), /lost/);
    assert.equal((await r.adm('/announcements/' + created.id, 'PATCH', { revision: 1, body: 'other tab body' })).status, 200);
    state.item.title = 'local title';
    await assert.rejects(state.save(send), { status: 409 });
    assert.equal((await r.adm('/announcements/' + created.id)).data.announcement.title, 'original');
    assert.equal(state.item.title, 'local title'); assert.equal(state.pendingCreate.body.title, 'original');
    state.rebase(); await state.save(send);
    assert.equal(state.item.title, 'local title'); assert.equal(state.item.body, 'other tab body'); assert.equal(state.item.revision, 3);
    const draft = await r.content('surveys');
    // A lost create can be recovered by the same exact request key and payload.
    const originalSurvey = { ...draft, id: '', revision: 0 }, surveyState = new EditorState('surveys', originalSurvey); lost = true;
    await assert.rejects(surveyState.save(send), /lost/);
    const published = await r.publish('surveys', created); assert.equal(published.status, 200);
    surveyState.item.title = 'local survey title'; surveyState.item.questions[0].title = 'local unsaved question';
    await assert.rejects(surveyState.save(send), { status: 409 });
    assert.equal(surveyState.item.status, 'published');
    surveyState.rebase(); assert.equal(surveyState.retainedInput.questions[0].title, 'local unsaved question');
    await surveyState.save(send);
    assert.equal(surveyState.item.title, 'local survey title'); assert.notEqual(surveyState.item.questions[0].title, 'local unsaved question');
    const clean = new EditorState('announcements', original); lost = true;
    await assert.rejects(clean.save(send), /lost/); await clean.save(send); assert.equal(clean.item.revision, 1);
  } finally { await r.mf.dispose(); }
});
