import { ApiError, type Article } from './api';

export interface Announcement {
  id: string; title: string; body: string; link: string; startAt: string; endAt: string;
  status: 'draft' | 'published' | 'ended'; revision: number; createdAt: string; updatedAt: string;
}
export interface Question { id: string; title: string; type: 'single' | 'multiple' | 'text'; required: boolean; options: { id: string; label: string }[] }
export interface Survey extends Omit<Announcement, 'body' | 'link'> { intro: string; questions?: Question[]; answered?: boolean }
export type Answers = Record<string, string | string[]>;
export type Send = <T>(path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;
export const escapeHTML = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
const e = escapeHTML;
const date = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const button = (text: string, key: string, cls = '') => `<button type="button" class="${cls}" data-action="${e(key)}">${text}</button>`;
const readKey = 'pocket-announcement-read-v1';

// The only announcement state stored on the device is the exact id/revision read.
export class AnnouncementReads {
  private values = new Set<string>();
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try { const saved: unknown = JSON.parse(storage?.getItem(readKey) ?? '[]'); if (Array.isArray(saved)) for (const v of saved) if (typeof v === 'string') this.values.add(v); } catch { /* Private storage may be unavailable. */ }
  }
  has(a: Pick<Announcement, 'id' | 'revision'>) { return this.values.has(`${a.id}:${a.revision}`); }
  mark(a: Pick<Announcement, 'id' | 'revision'>) {
    this.values.add(`${a.id}:${a.revision}`);
    try { this.storage?.setItem(readKey, JSON.stringify([...this.values].slice(-1000))); } catch { /* Keep this visit readable when storage is full. */ }
  }
}
export function surveyAnswers(survey: Survey, values: Answers) {
  const questions = survey.questions ?? [];
  if (!questions.length || questions.length > 10) throw Error('設問を読み込めません。再試行してください。');
  return questions.map(q => {
    const raw = values[q.id], value = q.type === 'multiple' ? (Array.isArray(raw) ? raw : []) : (typeof raw === 'string' ? raw : '');
    if (q.required && (Array.isArray(value) ? !value.length : !value.trim())) throw Error(`「${q.title}」に回答してください。`);
    if (q.type === 'text' && Array.from(value as string).length > 1000) throw Error(`「${q.title}」は1000字以内です。`);
    const choices = Array.isArray(value) ? value : value ? [value] : [];
    if (q.type !== 'text' && (new Set(choices).size !== choices.length || choices.some(v => !q.options.some(o => o.id === v)))) throw Error('選択肢を確認してください。');
    return { questionId: q.id, value };
  });
}
export function surveyFields(survey: Survey, values: Answers) {
  return (survey.questions ?? []).map((q, i) => `<fieldset class="survey-question"><legend>${i + 1}. ${e(q.title)} <span class="muted">${q.required ? '必須' : '任意'}</span></legend>${q.type === 'text' ? `<label class="sr-only" for="survey-${e(q.id)}">${e(q.title)}</label><textarea id="survey-${e(q.id)}" name="${e(q.id)}" maxlength="1000" ${q.required ? 'required' : ''}>${e(values[q.id] ?? '')}</textarea><p class="muted">1000字以内。氏名・連絡先などの個人情報は書かないでください。</p>` : q.options.map(o => `<label class="survey-choice"><input name="${e(q.id)}" type="${q.type === 'single' ? 'radio' : 'checkbox'}" value="${e(o.id)}" ${q.type === 'single' ? values[q.id] === o.id ? 'checked' : '' : Array.isArray(values[q.id]) && values[q.id].includes(o.id) ? 'checked' : ''} ${q.required && q.type === 'single' ? 'required' : ''}><span>${e(o.label)}</span></label>`).join('')}</fieldset>`).join('');
}

// Ambiguous failures replay the original body with the same key, even after input changes.
export class SurveySubmission {
  values: Answers = {};
  dirty = false;
  sending = false;
  completed = false;
  private pending?: { answers: ReturnType<typeof surveyAnswers>; key: string };
  constructor(readonly survey: Survey, private send: Send, private ensureSession: () => Promise<unknown>, private changed: () => void = () => {}) {}
  change(id: string, value: string | string[]) { this.values[id] = value; this.dirty = true; this.changed(); }
  async submit() {
    if (this.sending || this.completed) return;
    const answers = this.pending?.answers ?? surveyAnswers(this.survey, this.values);
    this.pending ??= { answers, key: crypto.randomUUID() };
    this.sending = true; this.changed();
    try {
      await this.ensureSession();
      await this.send(`/surveys/${encodeURIComponent(this.survey.id)}/responses`, 'POST', { answers: this.pending.answers }, { 'Idempotency-Key': this.pending.key });
      this.completed = true; this.dirty = false;
    } catch (error) {
      if (error instanceof ApiError && [400, 413, 415, 422].includes(error.status)) this.pending = undefined;
      throw error;
    } finally { this.sending = false; this.changed(); }
  }
  get pendingRetry() { return !!this.pending; }
}

interface UI {
  page: () => HTMLElement; current: () => () => boolean;
  action: (key: string, fn: () => unknown) => void;
  heading: (title: string, sub?: string, right?: string) => string;
  send: Send; session: () => Promise<unknown>; activity: () => void;
  editArticle: (article: Article) => void; deleteArticle: (article: Article) => Promise<void>;
}
export class Community {
  private announcements: Announcement[] = [];
  private surveys: Survey[] = [];
  private feedState: 'loading' | 'ready' | 'error' = 'loading';
  private announcementError = false;
  private surveyError = false;
  private feedRequest = 0;
  private viewRequest = 0;
  private reads: AnnouncementReads;
  private draft?: SurveySubmission;
  constructor(private ui: UI) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Browsing settings must not block personal tools. */ }
    this.reads = new AnnouncementReads(storage);
  }
  private view() {
    const request = ++this.viewRequest, current = this.ui.current();
    return () => request === this.viewRequest && current();
  }
  get dirty() { return !!this.draft?.dirty || !!this.draft?.sending; }
  leave() {
    if (this.draft?.sending) return false;
    if (this.draft?.dirty && !confirm('回答の入力を破棄して移動しますか？')) return false;
    this.draft = undefined; this.ui.activity(); return true;
  }
  homeBell() {
    const unread = this.announcements.filter(a => !this.reads.has(a)).length;
    return `<a class="notice-bell" href="#announcements" aria-label="お知らせ、${this.feedState === 'ready' ? `未読${unread}件` : '未読数は未取得'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>${unread ? `<span class="notice-badge">${unread}</span>` : ''}</a>`;
  }
  homeLine() {
    const surveys = this.surveys.filter(s => !s.answered).length;
    const line = this.feedState === 'loading' ? 'お知らせを確認中…' : this.feedState === 'error' ? navigator.onLine ? 'お知らせを取得できませんでした' : 'オフライン · お知らせは未取得' : [this.announcements[0]?.title, surveys ? `アンケート${surveys}件` : ''].filter(Boolean).join(' · ') || '新しいお知らせはありません';
    return `<a class="community-line" href="#announcements"><span>${e(line)}</span><span>すべて ›</span></a>`;
  }
  private paintHome() {
    const page = this.ui.page(), bell = page.querySelector('#home-notice-bell'), line = page.querySelector('#home-community-line');
    if (bell) bell.innerHTML = this.homeBell();
    if (line) line.innerHTML = this.homeLine();
  }
  async refresh() {
    const request = ++this.feedRequest;
    // Never show stale published cards after a failed refresh or foreground return.
    this.announcements = []; this.surveys = []; this.feedState = 'loading'; this.paintHome();
    const [announcements, surveys] = await Promise.allSettled([
      this.ui.send<{ announcements: Announcement[] }>('/announcements'),
      this.ui.send<{ surveys: Survey[] }>('/surveys'),
    ]);
    if (request !== this.feedRequest) return;
    this.announcementError = announcements.status === 'rejected'; this.surveyError = surveys.status === 'rejected';
    this.announcements = announcements.status === 'fulfilled' ? announcements.value.announcements : [];
    this.surveys = surveys.status === 'fulfilled' ? surveys.value.surveys : [];
    this.feedState = this.announcementError || this.surveyError ? 'error' : 'ready'; this.paintHome();
  }
  async renderFeed() {
    const current = this.view(), page = this.ui.page();
    page.innerHTML = this.ui.heading('お知らせ', '') + '<p role="status">読み込んでいます…</p>';
    await this.refresh(); if (!current()) return;
    this.ui.action('community-retry', () => this.renderFeed());
    page.innerHTML = this.ui.heading('お知らせ', '') + '<a href="#home">‹ ホームへ</a>' +
      (this.feedState === 'error' ? `<div class="notice error" role="alert">${navigator.onLine ? '一部のお知らせを取得できませんでした。' : 'オフラインです。'}予定・メモは引き続き使えます。${button('再試行', 'community-retry')}</div>` : '') +
      this.announcements.map(a => `<a class="community-item" href="#announcements/${encodeURIComponent(a.id)}"><small>${!this.reads.has(a) ? '<span class="unread-dot" aria-label="未読"></span>' : ''}${e(date(a.startAt))} · お知らせ</small><strong>${e(a.title)}</strong><small>${e(date(a.endAt))}まで</small></a>`).join('') +
      this.surveys.map(s => `<a class="community-item" href="#surveys/${encodeURIComponent(s.id)}"><small>${s.answered ? '回答済み' : '回答募集中'} · ${e(date(s.endAt))}まで</small><strong>${e(s.title)}</strong><small>回答は任意です</small></a>`).join('') +
      (!this.announcements.length && !this.surveys.length && this.feedState === 'ready' ? '<div class="empty">公開中のお知らせ・アンケートはありません。</div>' : '');
  }
  private failure(error: unknown, expired: string, retry: () => unknown) {
    this.ui.action('community-detail-retry', retry);
    const unavailable = error instanceof ApiError && [404, 410].includes(error.status);
    this.ui.page().innerHTML = this.ui.heading('表示できません', '') + `<div class="notice error" role="alert">${unavailable ? e(expired) : navigator.onLine ? `取得できませんでした。${e(error instanceof Error ? error.message : error)}` : 'オフラインです。接続後に再試行してください。'}</div>${!unavailable ? button('再試行', 'community-detail-retry') : ''}<p><a href="#announcements">お知らせへ戻る</a></p>`;
  }
  async renderAnnouncement(id: string) {
    const current = this.view();
    this.ui.page().innerHTML = this.ui.heading('お知らせ', '') + '<p role="status">読み込んでいます…</p>';
    try {
      const { announcement: a } = await this.ui.send<{ announcement: Announcement }>(`/announcements/${encodeURIComponent(id)}`);
      if (!current()) return;
      this.reads.mark(a);
      let link = ''; try { const url = new URL(a.link); if (url.protocol === 'https:') link = `<p><a href="${e(url.href)}" target="_blank" rel="noopener noreferrer">関連リンク ↗</a></p>`; } catch { /* Optional link. */ }
      this.ui.page().innerHTML = this.ui.heading('お知らせ', '') + `<a href="#announcements">‹ お知らせ一覧へ</a><article class="community-body"><p class="muted">${e(date(a.startAt))} · ${e(date(a.endAt))}まで</p><h2>${e(a.title)}</h2><p class="preserve-lines">${e(a.body)}</p>${link}</article>`;
    } catch (error) { if (current()) this.failure(error, 'このお知らせは公開を終了したか、現在は表示対象外です。', () => this.renderAnnouncement(id)); }
  }
  async renderSurvey(id: string) {
    const current = this.view(), page = this.ui.page();
    page.innerHTML = this.ui.heading('アンケート', '') + '<p role="status">読み込んでいます…</p>';
    try {
      await this.ui.session();
      const { survey, answered } = await this.ui.send<{ survey: Survey; answered: boolean }>(`/surveys/${encodeURIComponent(id)}`);
      if (!current()) return;
      page.innerHTML = this.ui.heading('アンケート', '') + `<a href="#announcements">‹ お知らせ一覧へ</a><article class="community-body"><h2>${e(survey.title)}</h2><p class="preserve-lines">${e(survey.intro)}</p><p class="muted">締切 ${e(date(survey.endAt))}（日本時間） · 回答は任意です。</p><div id="survey-content"></div></article>`;
      const content = page.querySelector<HTMLElement>('#survey-content')!;
      if (answered) { content.innerHTML = '<p class="notice" role="status">この匿名ユーザーIDでは回答済みです。</p>'; return; }
      const draft = this.draft = new SurveySubmission(survey, this.ui.send, this.ui.session, this.ui.activity);
      content.innerHTML = `<form id="survey-response">${surveyFields(survey, draft.values)}<p>同じ匿名ユーザーIDで1回回答できます。</p><div id="survey-error" class="notice error" role="alert" hidden></div><p id="survey-state" role="status"></p><button type="submit" class="primary">回答を送信</button></form>`;
      const form = content.querySelector<HTMLFormElement>('form')!, state = content.querySelector<HTMLElement>('#survey-state')!, errorBox = content.querySelector<HTMLElement>('#survey-error')!;
      const capture = () => { const values = new FormData(form); for (const q of survey.questions ?? []) draft.change(q.id, q.type === 'multiple' ? values.getAll(q.id).map(String) : String(values.get(q.id) ?? '')); };
      form.oninput = capture;
      form.onsubmit = async event => {
        event.preventDefault(); if (draft.sending || draft.completed) return;
        capture(); errorBox.hidden = true; form.inert = true; state.textContent = '送信中…';
        try {
          await draft.submit();
          if (!current()) return;
          content.innerHTML = '<p class="notice" role="status">回答を受け付けました。ありがとうございました。</p>';
          this.draft = undefined; this.ui.activity();
        } catch (error) {
          if (!current()) return;
          errorBox.hidden = false;
          errorBox.textContent = (error instanceof ApiError && [404, 410].includes(error.status) ? '締切に達したか、受付が終了しています。' : error instanceof ApiError && error.status === 409 ? 'すでに回答済みか、受付状態が変わりました。お知らせへ戻って確認してください。' : `送信できませんでした。${error instanceof Error ? error.message : String(error)}`) + ' 入力を保持しています。';
          state.textContent = draft.pendingRetry ? '再試行は最初の送信内容を確認します。二重計上しません。' : '';
        } finally { form.inert = false; if (state.isConnected && draft.completed) state.textContent = ''; else if (state.textContent === '送信中…') state.textContent = ''; }
      };
    } catch (error) { if (current()) this.failure(error, 'このアンケートは締切に達したか、現在は表示対象外です。', () => this.renderSurvey(id)); }
  }
  async renderOwnArticles() {
    const current = this.view(), page = this.ui.page();
    page.innerHTML = this.ui.heading('自分の投稿', '') + '<p role="status">読み込んでいます…</p>';
    try {
      await this.ui.session();
      const { articles } = await this.ui.send<{ articles: Article[] }>('/my/articles'); if (!current()) return;
      page.innerHTML = this.ui.heading('自分の投稿', '') + `<a href="#articles">‹ 記事一覧へ</a><div class="cards">${articles.map(a => {
        this.ui.action(`own-edit-${a.id}`, () => this.ui.editArticle(a));
        this.ui.action(`own-delete-${a.id}`, async () => { await this.ui.deleteArticle(a); if (current()) await this.renderOwnArticles(); });
        return ownArticleCard(a);
      }).join('') || '<p class="empty">自分の投稿はありません。</p>'}</div>`;
    } catch (error) { if (current()) this.failure(error, '投稿を取得できません。', () => this.renderOwnArticles()); }
  }
}
export function ownArticleCard(a: Article) {
  const hidden = a.visibility === 'hidden';
  return `<article class="card"><span class="tag">${hidden ? '非表示' : '公開中'}</span><h2>${hidden ? e(a.title) : `<a href="#articles/${encodeURIComponent(a.id)}">${e(a.title)}</a>`}</h2><p>${e(a.summary)}</p>${hidden ? `<p class="notice">運営による非表示${a.hiddenReason ? `：${e(a.hiddenReason)}` : ''}。登録情報を編集しても公開状態は変わりません。</p>` : ''}<div class="row">${button('登録情報を編集', `own-edit-${a.id}`)}${button('登録を削除', `own-delete-${a.id}`, 'danger')}</div></article>`;
}
