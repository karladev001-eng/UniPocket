import { AdminError, type Article, type Sender } from './model';
import { notionURL, embedSource } from '../../src/api';
export const articleFields = ['title', 'publicUrl', 'summary', 'category', 'courseId', 'embedUrl'] as const;
export type ArticleDraft = Record<typeof articleFields[number], string>;
export function articleDraft(item?: Article): ArticleDraft { return { title: item?.title || '', publicUrl: item?.publicUrl || '', summary: item?.summary || '', category: item?.category || '', courseId: item?.courseId || '', embedUrl: item?.embedUrl || '' }; }
export function articleErrors(input: ArticleDraft): Partial<ArticleDraft> {
    const errors: Partial<ArticleDraft> = {};
    for (const [field, max] of [['title', 120], ['summary', 280], ['category', 60], ['courseId', 120]] as const)
        if ((field === 'title' && !input[field].trim()) || Array.from(input[field].trim()).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input[field]))
            errors[field] = `1〜${max}文字${field === 'title' ? 'で入力してください。' : '以内で入力してください。'}`;
    try {
        notionURL(input.publicUrl);
    }
    catch (e) {
        errors.publicUrl = (e as Error).message;
    }
    try {
        embedSource(input.embedUrl);
    }
    catch (e) {
        errors.embedUrl = (e as Error).message;
    }
    return errors;
}
export function articlePayload(input: ArticleDraft): ArticleDraft { return { ...Object.fromEntries(articleFields.map(k => [k, input[k].trim()])) as ArticleDraft, publicUrl: notionURL(input.publicUrl), embedUrl: embedSource(input.embedUrl) }; }
/** Stable confirmed request survives network loss and reauthentication; input is never overwritten by recovery. */
export class ArticleEditor {
    input: ArticleDraft;
    baseline: ArticleDraft;
    item?: Article;
    latest?: Article;
    private recoverySource?: ArticleDraft;
    pending?: {
        key: string;
        body: Record<string, unknown>;
        path: string;
        method: string;
        input: ArticleDraft;
    };
    constructor(item?: Article) { this.item = item; this.input = articleDraft(item); this.baseline = structuredClone(this.input); }
    get hasInputToLose() { return !!this.pending || JSON.stringify(this.input) !== JSON.stringify(this.baseline); }
    async refresh(send: Sender): Promise<void> {
        if (!this.item) throw Error('先に再送結果を確認してください。');
        this.latest = (await send<{ article: Article }>('/articles/' + this.item.id)).article;
    }
    rebase(): void {
        if (!this.latest) return;
        // A rejected edit compares to the original saved version. Once a request
        // committed, only edits made after its confirmed snapshot are reapplied.
        const source = this.recoverySource || this.baseline;
        const edits = Object.fromEntries(articleFields.filter(k => this.input[k] !== source[k]).map(k => [k, this.input[k]]));
        this.item = this.latest;
        this.baseline = articleDraft(this.latest);
        this.input = { ...this.baseline, ...edits };
        this.latest = undefined;
        this.pending = undefined;
        this.recoverySource = undefined;
    }
    async submit(send: Sender) {
        if (this.latest)
            throw new AdminError('最新版と比較してから再確認してください。', 409);
        if (!this.pending) {
            if (Object.keys(articleErrors(this.input)).length)
                throw Error('入力欄を確認してください。');
            const input = structuredClone(this.input);
            this.pending = { key: crypto.randomUUID(), body: { ...articlePayload(input), ...(this.item ? { revision: this.item.revision } : {}) }, path: '/articles' + (this.item ? '/' + this.item.id : ''), method: this.item ? 'PATCH' : 'POST', input };
        }
        const pending = this.pending;
        let saved: Article;
        try {
            saved = (await send<{
                article: Article;
            }>(pending.path, pending.method, pending.body, { 'Idempotency-Key': pending.key })).article;
        }
        catch (error) {
            if (error instanceof AdminError && error.code === 'revision_conflict')
                await this.refresh(send).catch(() => { });
            if (error instanceof AdminError && ([400, 413, 415, 422].includes(error.status) || error.code === 'duplicate_article'))
                this.pending = undefined;
            throw error;
        }
        this.item = saved;
        if (JSON.stringify(this.input) !== JSON.stringify(pending.input) || saved.revision !== (Number(pending.body.revision || 0) + 1)) {
            this.recoverySource = pending.input;
            this.latest = saved;
            throw new AdminError('送信した内容は保存されました。保持した入力と最新版を比較してください。', 409);
        }
        this.input = articleDraft(saved);
        this.baseline = structuredClone(this.input);
        this.pending = undefined;
        return saved;
    }
}
