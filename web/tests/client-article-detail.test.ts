import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import { notionURL, ApiError, type Article } from '../src/api';
import { updateBookmark } from '../src/article-request';
import { adminBadge } from '../src/author-badge';

// Exercise the product handlers, including their async publication gate, instead
// of reimplementing a second detail renderer in the test.
const source = readFileSync(new URL('../src/screens/articles.ts', import.meta.url), 'utf8');
const detailSource = source.slice(source.indexOf('let detailRequest ='), source.indexOf('const anonymousNotice ='));
const statsSource = source.slice(source.indexOf('function articleStats('), source.indexOf('function articleCard('));
const article = (): Article => ({ id: 'fixture', revision: 1, authorId: 'author', authorName: '運営ユーザー', authorKind: 'admin', title: '☆記事の公開方法☆', summary: '投稿者の紹介文を残す', category: '運営', courseId: '', publicUrl: 'https://demo.notion.site/page', embedUrl: 'https://demo.notion.site/ebd/page', createdAt: '', updatedAt: '', viewCount: 4, bookmarkCount: 2, bookmarked: false, canEdit: false });
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function fixture(options: { online?: boolean; article?: Article; get?: () => Promise<unknown>; failView?: boolean; failBookmark?: boolean } = {}) {
  const a = options.article ?? article(), actions = new Map<string, () => Promise<unknown>>(), errors: string[] = [], requests: string[] = [];
  const page = { innerHTML: '', querySelector: (selector: string) => selector === '.article-stats' ? stats : selector.includes('detail-bookmark') ? bookmark : null };
  const stats = { set outerHTML(value: string) { page.innerHTML = page.innerHTML.replace(/<div class="article-stats">[\s\S]*?<\/button><\/div>/, value); } };
  const bookmark = { disabled: false };
  const location = { hash: '#articles/fixture' };
  const context: Record<string, unknown> = { page, location, navigator: { onLine: options.online ?? true }, ApiError, notionURL, updateBookmark, adminBadge, esc: escape,
    pageEpoch: { scope: (expected: string, current: () => string) => () => current() === expected },
    action: (name: string, fn: () => Promise<unknown>) => actions.set(name, fn),
    error: (e: Error) => errors.push(e.message), session: async () => ({}),
    api: async (path: string, method = 'GET') => {
      requests.push(method + ' ' + path);
      if (path.endsWith('/view')) { if (options.failView) throw Error('view unavailable'); return { viewCount: 5 }; }
      if (path.endsWith('/bookmark')) { if (options.failBookmark) throw Error('bookmark unavailable'); return { bookmarked: true, bookmarkCount: 3 }; }
      if (method === 'DELETE') return {};
      return options.get ? options.get() : { article: a };
    },
    btn: (label: string, action: string, cls = '') => `<button class="${cls}" data-action="${action}">${label}</button>`,
    icon: (name: string) => `<svg data-icon="${name}"></svg>`, namedAuthor: (name: string) => !!name,
    filterAuthor() {}, articleForm() {}, confirm: () => true, reportArticle() {},
  };
  runInNewContext(transpileModule(`let user, busy = 0, updates; ${statsSource} ${detailSource}; globalThis.renderDetail = renderArticleDetail;`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText, context);
  return { page, errors, requests, actions, a, location, render: context.renderDetail as (id: string) => Promise<void> };
}
describe('content-first article detail publication and action gates', () => {
  it('inserts the frame only after the current public detail response; keeps labels, summary and three compact actions', async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise(resolve => { release = resolve; });
    const f = fixture({ get: () => gate });
    const pending = f.render('fixture'); await Promise.resolve();
    expect(f.page.innerHTML).toContain('読み込み中'); expect(f.page.innerHTML).not.toContain('<iframe');
    release({ article: article() }); await pending;
    expect(f.page.innerHTML).toContain('投稿者の紹介文を残す'); expect(f.page.innerHTML).toContain('管理者');
    for (const text of ['NOTION ARTICLE', '記事のメニュー', '日本時間1日1回', 'Notionの読込には通信', '読込完了イベント']) expect(f.page.innerHTML).not.toContain(text);
    expect(f.page.innerHTML).toMatch(/article-detail-tools[\s\S]*?>通報<\/button>[\s\S]*?>再読み込み<\/button>[\s\S]*?>Notionで開く ↗<\/a><\/div><iframe/);
    expect(f.page.innerHTML).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(f.page.innerHTML).toContain('referrerpolicy="strict-origin-when-cross-origin"'); expect(f.page.innerHTML).toContain('rel="noopener noreferrer"');
    expect(f.page.innerHTML).toContain('aria-label="閲覧5回"'); expect(f.requests).toEqual(['GET /articles/fixture', 'POST /articles/fixture/view']);
    await f.actions.get('frame-retry')!(); expect(f.requests.filter(r => r === 'GET /articles/fixture')).toHaveLength(2);
  });
  it('keeps missing embed short, removes pointless reload, and exposes ownership controls only for the owner', async () => {
    const a = article(); a.embedUrl = ''; a.canEdit = true;
    const f = fixture({ article: a }); await f.render('fixture');
    expect(f.page.innerHTML).toContain('埋め込み未登録'); expect(f.page.innerHTML).toContain('Notionで開く');
    expect(f.page.innerHTML).not.toContain('<iframe'); expect(f.page.innerHTML).not.toContain('data-action="frame-retry"');
    expect(f.page.innerHTML).toContain('投稿者の操作'); expect(f.page.innerHTML).toContain('detail-edit'); expect(f.page.innerHTML).toContain('detail-delete');
    const visitor = fixture(); await visitor.render('fixture'); expect(visitor.page.innerHTML).not.toContain('article-owner-menu');
  });
  it('does not embed offline, unavailable, malformed URL, hidden or stale responses', async () => {
    const offline = fixture({ online: false }); await offline.render('fixture'); expect(offline.page.innerHTML).toContain('オフラインです'); expect(offline.requests).toEqual([]);
    for (const a of [{ ...article(), visibility: 'hidden' as const }, { ...article(), embedUrl: 'https://evil.test/embed' }, { ...article(), publicUrl: 'javascript:alert(1)' }]) {
      const f = fixture({ article: a }); await f.render('fixture'); expect(f.page.innerHTML).not.toContain('<iframe');
    }
    for (const status of [404, 410, 503]) {
      const f = fixture({ get: async () => { throw new ApiError('server detail', status); } }); await f.render('fixture');
      expect(f.page.innerHTML).not.toContain('<iframe'); expect(f.page.innerHTML).toContain('記事一覧');
      expect(f.page.innerHTML.includes('detail-retry')).toBe(status === 503); expect(f.requests).toEqual(['GET /articles/fixture']);
    }
    let release!: (value: unknown) => void;
    const gate = new Promise(resolve => { release = resolve; });
    const stale = fixture({ get: () => gate });
    const pending = stale.render('fixture'); await Promise.resolve(); stale.location.hash = '#notes'; release({ article: article() }); await pending;
    expect(stale.page.innerHTML).not.toContain('<iframe'); expect(stale.requests).toEqual(['GET /articles/fixture']);
  });
  it('retains successful rendering and previous counts when view/bookmark writes fail', async () => {
    const f = fixture({ failView: true, failBookmark: true }); await f.render('fixture');
    expect(f.page.innerHTML).toContain('<iframe'); expect(f.a.viewCount).toBe(4); expect(f.page.innerHTML).toContain('aria-label="閲覧4回"');
    await f.actions.get('detail-bookmark')!();
    expect(f.a.bookmarkCount).toBe(2); expect(f.a.bookmarked).toBe(false);
    expect(f.errors).toEqual(['閲覧記録を保存できませんでした。', 'bookmark unavailable']);
  });
});
