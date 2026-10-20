import { describe, expect, it } from 'vitest';
import { ApiError, type Article } from '../src/api';
import { AnnouncementReads, SurveySubmission, surveyAnswers, surveyFields, ownArticleCard, type Survey, type Send } from '../src/community';
import { submitNewArticle } from '../src/article-submit';

const survey: Survey = {
  id: 'survey', title: '使い心地', intro: '任意です', status: 'published', revision: 1,
  startAt: '2026-10-20T00:00:00Z', endAt: '2026-11-03T14:59:00Z', createdAt: '', updatedAt: '',
  questions: [
    { id: 'one', title: '単一', type: 'single', required: true, options: [{ id: 'a', label: '予定' }, { id: 'b', label: '記事' }] },
    { id: 'many', title: '複数', type: 'multiple', required: true, options: [{ id: 'c', label: 'お知らせ' }, { id: 'd', label: '地図' }] },
    { id: 'text', title: '感想', type: 'text', required: false, options: [] },
  ],
};
const filled = { one: 'b', many: ['c', 'd'], text: '残す回答' };

describe('public community inputs and anonymous submissions', () => {
  it('validates required multiple choice, unknown choices, duplicate options and Unicode text limit', () => {
    expect(() => surveyAnswers(survey, {})).toThrow('単一');
    expect(() => surveyAnswers(survey, { one: 'a', many: [] })).toThrow('複数');
    expect(() => surveyAnswers(survey, { ...filled, many: ['c', 'c'] })).toThrow('選択肢');
    expect(() => surveyAnswers(survey, { ...filled, one: 'not-an-option' })).toThrow('選択肢');
    expect(surveyAnswers(survey, { ...filled, text: '😀'.repeat(1000) })[2].value).toHaveLength(2000);
    expect(() => surveyAnswers(survey, { ...filled, text: '😀'.repeat(1001) })).toThrow('1000');
    expect(surveyAnswers(survey, filled)).toEqual([{ questionId: 'one', value: 'b' }, { questionId: 'many', value: ['c', 'd'] }, { questionId: 'text', value: '残す回答' }]);
  });
  it('renders isolated groups, retained input and safe plain text with 44px choice classes', () => {
    const html = surveyFields(survey, { ...filled, text: '</textarea><img onerror=alert(1)>' });
    expect(html).toContain('name="one" type="radio" value="b" checked');
    expect(html).toContain('name="many" type="checkbox" value="c" checked');
    expect(html).toContain('name="many" type="checkbox" value="d" checked');
    expect(html).toContain('&lt;/textarea&gt;&lt;img onerror=alert(1)&gt;');
    expect(html).toContain('個人情報は書かない');
    expect(html).toContain('class="survey-choice"');
    expect(html).not.toContain('<img');
  });
  it('holds dirty/sending through a lost response, prevents overlapping sends and retries original answers/key once', async () => {
    const calls: { body: unknown; key: string | undefined }[] = [];
    let finish!: () => void, sessions = 0, activity = 0;
    const send: Send = async <T>(_path: string, method?: string, body?: unknown, headers?: Record<string, string>) => {
      expect(method).toBe('POST');
      calls.push({ body, key: headers?.['Idempotency-Key'] });
      if (calls.length === 1) { await new Promise<void>(resolve => { finish = resolve; }); throw Error('response lost after commit'); }
      return { ok: true, responseId: 'existing-response' } as T;
    };
    const state = new SurveySubmission(survey, send, async () => { sessions++; }, () => { activity++; });
    for (const [id, value] of Object.entries(filled)) state.change(id, value);
    const running = state.submit();
    await Promise.resolve();
    expect(state.sending).toBe(true); expect(state.dirty).toBe(true);
    await state.submit(); expect(calls).toHaveLength(1);
    finish(); await expect(running).rejects.toThrow('response lost');
    expect(state.values).toEqual(filled); expect(state.dirty).toBe(true); expect(state.sending).toBe(false);
    state.change('text', 'edited after ambiguous failure');
    await state.submit();
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
    expect(state.completed).toBe(true); expect(state.dirty).toBe(false);
    await state.submit(); expect(calls).toHaveLength(2); expect(sessions).toBe(2); expect(activity).toBeGreaterThan(4);
  });
  it('keeps input after closing deadline or network failure and permits correction after definitive rejection', async () => {
    let status = 410, captured: unknown;
    const state = new SurveySubmission(survey, async <T>(_path: string, _method?: string, body?: unknown) => {
      captured = body;
      if (status) throw new ApiError('closed', status, 'survey_closed');
      return { ok: true, responseId: 'id' } as T;
    }, async () => {});
    Object.entries(filled).forEach(([id, value]) => state.change(id, value));
    await expect(state.submit()).rejects.toMatchObject({ status: 410 });
    expect(state.values).toEqual(filled); expect(state.dirty).toBe(true);
    status = 400;
    await expect(state.submit()).rejects.toMatchObject({ status: 400 });
    state.change('text', 'corrected'); status = 0;
    await state.submit();
    expect(captured).toEqual({ answers: [{ questionId: 'one', value: 'b' }, { questionId: 'many', value: ['c', 'd'] }, { questionId: 'text', value: 'corrected' }] });
  });
  it('stores only id and revision reads locally, so a new revision is unread and storage failure stays usable', () => {
    const writes: string[] = [];
    const storage = { getItem: () => '[]', setItem: (_key: string, value: string) => { writes.push(value); } };
    const reads = new AnnouncementReads(storage);
    const announcement = { id: 'announcement', revision: 1 };
    expect(reads.has(announcement)).toBe(false); reads.mark(announcement);
    expect(reads.has(announcement)).toBe(true); expect(reads.has({ ...announcement, revision: 2 })).toBe(false);
    expect(writes).toEqual(['["announcement:1"]']);
    expect(new AnnouncementReads({ ...storage, getItem: () => writes[0] }).has(announcement)).toBe(true);
    const blocked = new AnnouncementReads({ getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } });
    expect(() => blocked.mark(announcement)).not.toThrow(); expect(blocked.has(announcement)).toBe(true);
  });
  it('shows hidden author status/reason without a public detail or iframe and preserves author operations', () => {
    const html = ownArticleCard({ id: 'hidden', title: '<private>', summary: '説明', visibility: 'hidden', hiddenReason: '確認中 <理由>', revision: 3 } as Article);
    expect(html).toContain('非表示'); expect(html).toContain('確認中 &lt;理由&gt;');
    expect(html).toContain('own-edit-hidden'); expect(html).toContain('own-delete-hidden');
    expect(html).not.toContain('#articles/hidden'); expect(html).not.toContain('iframe'); expect(html).not.toContain('再公開');
  });
  it('uses replayed revision for the corrective author PATCH after ambiguous creation', async () => {
    const original = { title: 'old', publicUrl: 'https://example.notion.site/a', embedUrl: '', category: '', courseId: '', summary: '' };
    const draft = { pendingBody: JSON.stringify(original), key: 'key' };
    let headers: Record<string, string> | undefined;
    await submitNewArticle(draft, { ...original, title: 'new' }, async <T>(_path: string, method: string, body: unknown, requestHeaders?: Record<string, string>) => {
      if (method === 'PATCH') headers = requestHeaders;
      return { article: { id: 'a', revision: 7, ...(body as object) } } as T;
    }, async () => {});
    expect(headers).toEqual({ 'If-Match': '7' });
  });
});

import { vi } from 'vitest';
import { Community } from '../src/community';
function communityHarness(send: Send) {
  const page = { innerHTML: '', querySelector: () => null };
  let epoch = 0;
  const actions = new Map<string, () => unknown>();
  const community = new Community({
    page: () => page as unknown as HTMLElement,
    current: () => { const captured = epoch; return () => captured === epoch; },
    heading: title => `<h1>${title}</h1>`, action: (key, fn) => { actions.set(key, fn); },
    send, session: async () => {}, activity: () => {}, editArticle: () => {}, deleteArticle: async () => {},
  });
  return { community, page, actions, leave: () => { epoch++; page.innerHTML = 'Personal notes'; } };
}
describe('public community rendering and asynchronous navigation', () => {
  it('combines at most one compact home line while keeping feed failures distinct from zero', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {});
    try {
      let fail = false;
      const harness = communityHarness(async <T>(path: string) => {
        if (fail) throw Error('offline');
        return (path === '/announcements' ? { announcements: [] } : { surveys: [] }) as T;
      });
      await harness.community.renderFeed();
      expect(harness.page.innerHTML).toContain('公開中のお知らせ・アンケートはありません');
      expect(harness.community.homeLine().match(/class="community-line"/g)).toHaveLength(1);
      fail = true; await harness.community.renderFeed();
      expect(harness.page.innerHTML).toContain('取得できませんでした');
      expect(harness.page.innerHTML).not.toContain('公開中のお知らせ・アンケートはありません');
      expect(harness.page.innerHTML).toContain('予定・メモは引き続き使えます');
      expect(harness.actions.has('community-retry')).toBe(true);
      vi.stubGlobal('navigator', { onLine: false });
      await harness.community.renderFeed();
      expect(harness.page.innerHTML).toContain('オフラインです');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not mark a notice read or overwrite personal notes after an older detail fetch completes', async () => {
    vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('window', {});
    try {
      let resolve!: (value: unknown) => void;
      const harness = communityHarness(<T>() => new Promise<T>(done => { resolve = done as (value: unknown) => void; }));
      const running = harness.community.renderAnnouncement('old');
      harness.leave();
      resolve({ announcement: { id: 'old', revision: 1, title: 'old', body: 'body', link: '', startAt: survey.startAt, endAt: survey.endAt } });
      await running;
      expect(harness.page.innerHTML).toBe('Personal notes');
    } finally { vi.unstubAllGlobals(); }
  });
  it('ignores an older same-route request and only renders the fresh public announcement', async () => {
    vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('window', {});
    try {
      const pending: ((value: unknown) => void)[] = [];
      const harness = communityHarness(<T>() => new Promise<T>(done => { pending.push(done as (value: unknown) => void); }));
      const first = harness.community.renderAnnouncement('same');
      const second = harness.community.renderAnnouncement('same');
      const announcement = { id: 'same', revision: 2, title: 'fresh', body: '<script>unsafe</script>', link: 'javascript:alert(1)', startAt: survey.startAt, endAt: survey.endAt };
      pending[1]({ announcement }); await second;
      pending[0]({ announcement: { ...announcement, title: 'stale' } }); await first;
      expect(harness.page.innerHTML).toContain('fresh'); expect(harness.page.innerHTML).not.toContain('stale');
      expect(harness.page.innerHTML).toContain('&lt;script&gt;'); expect(harness.page.innerHTML).not.toContain('javascript:');
    } finally { vi.unstubAllGlobals(); }
  });
  it('shows expired content separately from a connection failure and never displays stale body', async () => {
    vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('window', {});
    try {
      let status = 404;
      const harness = communityHarness(async () => { throw new ApiError('unavailable', status); });
      await harness.community.renderAnnouncement('expired');
      expect(harness.page.innerHTML).toContain('公開を終了したか');
      expect(harness.page.innerHTML).not.toContain('community-detail-retry');
      status = 503; await harness.community.renderAnnouncement('expired');
      expect(harness.page.innerHTML).toContain('取得できませんでした');
      expect(harness.page.innerHTML).toContain('community-detail-retry');
    } finally { vi.unstubAllGlobals(); }
  });
});

import { installUpdates } from '../src/update';
it('refuses the real all-tab update prepare while a survey is dirty/sending or failed, and permits it after success', async () => {
  vi.useFakeTimers();
  const sw = new EventTarget() as EventTarget & { controller: object; register: () => Promise<unknown> };
  sw.controller = {};
  const registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: async () => {} });
  sw.register = async () => registration;
  vi.stubGlobal('navigator', { serviceWorker: sw, onLine: true });
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  let fail = true, resolve!: () => void;
  const draft = new SurveySubmission(survey, async <T>() => {
    await new Promise<void>(done => { resolve = done; });
    if (fail) throw Error('lost response');
    return { ok: true, responseId: 'once' } as T;
  }, async () => {});
  const replies: { type: string }[] = [];
  const worker = { postMessage: (data: { type: string }) => replies.push(data) };
  const prepare = vi.fn(async () => {});
  installUpdates({ isIdle: () => !draft.dirty && !draft.sending, prepare, freeze: () => {}, notice: () => {}, error: () => {} });
  const receive = async (type = 'PREPARE_UPDATE') => {
    sw.dispatchEvent(Object.assign(new Event('message'), { data: { type, protocol: 2, token: 'test' }, source: worker }));
    await Promise.resolve(); await Promise.resolve();
  };
  try {
    Object.entries(filled).forEach(([id, value]) => draft.change(id, value));
    await receive(); expect(replies.at(-1)?.type).toBe('UPDATE_REFUSED');
    const sending = draft.submit(); await Promise.resolve();
    await receive(); expect(replies.at(-1)?.type).toBe('UPDATE_REFUSED');
    resolve(); await expect(sending).rejects.toThrow('lost response');
    await receive(); expect(replies.at(-1)?.type).toBe('UPDATE_REFUSED'); expect(prepare).not.toHaveBeenCalled();
    fail = false; const retry = draft.submit(); await Promise.resolve(); resolve(); await retry;
    await receive(); expect(replies.at(-1)?.type).toBe('UPDATE_READY'); expect(prepare).toHaveBeenCalledOnce();
    await receive('ABORT_UPDATE');
  } finally { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

import { api } from '../src/api';
import { bindArticlePreview } from '../src/article-preview';
describe('review regressions at the actual transport and form handlers', () => {
  it.each([
    ['HTML login response', '<html>Sign in</html>'],
    ['null JSON', 'null'],
    ['array JSON', '[]'],
    ['error envelope with HTTP 200', '{"error":"login required"}'],
    ['missing acceptance', '{}'],
    ['missing response ID', '{"ok":true}'],
    ['false acceptance', '{"ok":false,"responseId":"not-accepted"}'],
    ['empty response ID', '{"ok":true,"responseId":" "}'],
  ])('retains survey input and original retry key after %s', async (_label, body) => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
      requests.push(init);
      return requests.length === 1 ? new Response(body, { status: 200 }) : Response.json({ ok: true, responseId: 'accepted-once' });
    });
    try {
      const draft = new SurveySubmission(survey, api, async () => {});
      Object.entries(filled).forEach(([id, value]) => draft.change(id, value));
      await expect(draft.submit()).rejects.toMatchObject({ code: 'invalid_response' });
      expect(draft.completed).toBe(false); expect(draft.dirty).toBe(true); expect(draft.sending).toBe(false);
      expect(draft.values).toEqual(filled); expect(draft.pendingRetry).toBe(true);
      draft.change('text', 'changed during authentication retry');
      await draft.submit();
      expect(requests[1].body).toBe(requests[0].body);
      expect((requests[1].headers as Record<string, string>)['Idempotency-Key']).toBe((requests[0].headers as Record<string, string>)['Idempotency-Key']);
      expect(draft.completed).toBe(true); expect(draft.dirty).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('the rendered survey submit handler keeps its form after HTTP 200 login HTML and clears it only after valid acceptance', async () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('navigator', { onLine: true });
    let values = { ...filled };
    vi.stubGlobal('FormData', class {
      get(name: keyof typeof filled) { return values[name]; }
      getAll(name: keyof typeof filled) { const value = values[name]; return Array.isArray(value) ? value : value ? [value] : []; }
    });
    const state = { textContent: '', isConnected: true }, errorBox = { hidden: true, textContent: '' };
    const form = { inert: false, oninput: undefined as (() => void) | undefined, onsubmit: undefined as ((event: Event) => Promise<void>) | undefined };
    const content = { innerHTML: '', querySelector: (selector: string) => selector === 'form' ? form : selector === '#survey-state' ? state : errorBox };
    const page = { innerHTML: '', querySelector: () => content };
    const posted: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json({ survey, answered: false });
      posted.push(init);
      return posted.length === 1 ? new Response('<html>Cloudflare login</html>') : Response.json({ ok: true, responseId: 'accepted' });
    });
    const community = new Community({ page: () => page as unknown as HTMLElement, current: () => () => true, action: () => {}, heading: () => '', send: api, session: async () => {}, activity: () => {}, editArticle: () => {}, deleteArticle: async () => {} });
    try {
      await community.renderSurvey(survey.id);
      form.oninput!(); await form.onsubmit!(new Event('submit'));
      expect(content.innerHTML).toContain('<form'); expect(content.innerHTML).not.toContain('回答を受け付けました');
      expect(errorBox.textContent).toContain('認証状態を確認'); expect(errorBox.textContent).toContain('入力を保持');
      expect(errorBox.hidden).toBe(false); expect(form.inert).toBe(false); expect(community.dirty).toBe(true);
      values = { ...filled, text: 'edited after failed login' };
      form.oninput!(); await form.onsubmit!(new Event('submit'));
      expect(posted[1].body).toBe(posted[0].body);
      expect(content.innerHTML).toContain('回答を受け付けました'); expect(community.dirty).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('the bound author-preview click handler refuses iframe insertion when connectivity drops during the public GET', async () => {
    const connection = { onLine: true };
    vi.stubGlobal('navigator', connection);
    vi.stubGlobal('FormData', class { get(name: string) { return name === 'publicUrl' ? 'https://example.notion.site/public' : 'https://example.notion.site/embed'; } });
    const button = { onclick: undefined as (() => Promise<void>) | undefined }, preview = { innerHTML: '' }, errorBox = { hidden: true, textContent: '' };
    const dialog = { open: true, isConnected: true, querySelector: (selector: string) => selector === '#preview-article' ? button : selector === '#article-preview' ? preview : selector === '.modal-error' ? errorBox : {} };
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
    try {
      bindArticlePreview(dialog as unknown as HTMLDialogElement, { id: 'article', visibility: 'published' } as Article);
      const running = button.onclick!();
      connection.onLine = false; finish(Response.json({ article: { id: 'article', revision: 2 } })); await running;
      expect(preview.innerHTML).toBe(''); expect(errorBox.hidden).toBe(false); expect(errorBox.textContent).toContain('オフライン');
      // The same bound handler is usable after connectivity returns and status is freshly verified.
      connection.onLine = true;
      const retry = button.onclick!(); finish(Response.json({ article: { id: 'article', revision: 2 } })); await retry;
      expect(preview.innerHTML).toContain('<iframe');
    } finally { vi.unstubAllGlobals(); }
  });
});
