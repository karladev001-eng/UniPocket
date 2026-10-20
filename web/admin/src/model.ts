export type Status = "draft" | "published" | "ended";
export type Question = {
    id: string;
    title: string;
    type: "single" | "multiple" | "text";
    required: boolean;
    options: {
        id: string;
        label: string;
    }[];
};
export interface Content {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    status: Status;
    revision: number;
    createdAt: string;
    updatedAt: string;
}
export interface Announcement extends Content {
    body: string;
    link: string;
}
export interface Survey extends Content {
    intro: string;
    questions: Question[];
}
export type Editable = Announcement | Survey;
export interface Article {
    id: string;
    authorId: string;
    authorName: string;
    title: string;
    publicUrl: string;
    summary: string;
    category: string;
    viewCount: number;
    bookmarkCount: number;
    visibility: "published" | "hidden" | "deleted";
    hiddenReason: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}
export interface Report {
    id: string;
    articleId: string;
    articleTitle: string;
    reason: string;
    details: string;
    status: "pending" | "reviewed";
    revision: number;
    createdAt: string;
}
export interface Metrics {
    start: string;
    end: string;
    collectedSince: string;
    asOf: string;
    daily: {
        day: string;
        articleViews: number | null;
        surveyResponses: number | null;
    }[];
    articleViews: number | null;
    currentBookmarks: number;
    surveyResponses: number | null;
    articles: {
        id: string;
        title: string;
        views: number | null;
        bookmarks: number;
    }[];
}
export interface Results {
    survey: Survey;
    resultsComplete: boolean;
    resultsSince: string;
    responseCount: number;
    questions: {
        questionId: string;
        counts: {
            optionId: string;
            count: number;
        }[];
    }[];
    freeText: {
        questionId: string;
        value: string;
        submittedAt: string;
    }[];
}
export class AdminError extends Error {
    constructor(message: string, public status: number, public code?: string) { super(message); }
}
export type Sender = <T>(path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;
/** Only a successful server /me check opens the client gate. Server remains the authority. */
export class AdminClient {
    email = "";
    authorized = false;
    onExpired: () => void = () => { };
    constructor(private transport: typeof fetch = (...args) => globalThis.fetch(...args)) { }
    private async request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
        let response: Response;
        try {
            response = await this.transport.call(globalThis, "/api/admin" + path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000), headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        }
        catch {
            this.authorized = false;
            this.onExpired();
            throw new AdminError(typeof navigator !== "undefined" && !navigator.onLine ? "オフラインです。入力は保持しています。接続後に認証を再確認してください。" : "通信できませんでした。入力は保持しています。再認証が必要な場合は別タブからログインしてください。", 0);
        }
        if (response.status === 401 || response.status === 403) {
            this.authorized = false;
            this.onExpired();
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({})) as {
                error?: string;
                code?: string;
            };
            throw new AdminError(error.error || `取得に失敗しました (${response.status})`, response.status, error.code);
        }
        return response;
    }
    async authenticate(): Promise<string> {
        this.authorized = false;
        const response = await this.request("/me");
        const value = await response.json() as {
            admin: {
                email: string;
            };
        };
        if (!value.admin?.email)
            throw new AdminError("管理者を確認できませんでした。", 403);
        this.email = value.admin.email;
        this.authorized = true;
        return this.email;
    }
    send: Sender = async <T>(path: string, method = "GET", body?: unknown, headers?: Record<string, string>): Promise<T> => {
        if (!this.authorized)
            throw new AdminError("管理者認証を確認してください。入力は保持しています。", 401);
        const response = await this.request(path, method, body, headers);
        if (!response.headers.get("content-type")?.includes("application/json")) {
            this.authorized = false;
            this.onExpired();
            throw new AdminError("認証の応答を確認できません。別タブで再認証してください。", 401);
        }
        return response.json() as Promise<T>;
    };
    async csv(path: string): Promise<Blob> {
        if (!this.authorized)
            throw new AdminError("再認証してください。", 401);
        const response = await this.request(path);
        if (!response.headers.get("content-type")?.includes("text/csv")) {
            this.authorized = false;
            this.onExpired();
            throw new AdminError("CSVを取得できませんでした。再認証を確認してください。", 401);
        }
        return response.blob();
    }
}
export function jstInput(iso: string): string { return iso ? new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 16) : ""; }
export function utcInput(jst: string): string {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(jst))
        throw Error("日時を入力してください。");
    const date = new Date(jst + ":00+09:00");
    if (!Number.isFinite(date.getTime()) || jstInput(date.toISOString()) !== jst)
        throw Error("有効な日時を入力してください。");
    return date.toISOString();
}
export function tokyoDay(now = new Date()): string { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function dateRange(days: number, now = new Date()): {
    start: string;
    end: string;
} { const end = tokyoDay(now); return { start: new Date(Date.parse(end) - (days - 1) * 86400000).toISOString().slice(0, 10), end }; }
export function validateRange(start: string, end: string): void {
    const valid = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (!valid(start) || !valid(end) || days < 1 || days > 90)
        throw Error("開始日から終了日まで1〜90日で指定してください。");
}
export function safeLink(url: string): string | null { try {
    const value = new URL(url);
    return value.protocol === "https:" && !value.username && !value.password ? value.href : null;
}
catch {
    return null;
} }
export function statusLabel(item: Content, now = Date.now()): string { return item.status === "draft" ? "下書き" : item.status === "ended" ? "終了" : Date.parse(item.endAt) <= now ? "期限終了" : Date.parse(item.startAt) > now ? "予約" : "公開中"; }
export function question(): Question { return { id: crypto.randomUUID(), title: "", type: "single", required: true, options: [{ id: crypto.randomUUID(), label: "" }, { id: crypto.randomUUID(), label: "" }] }; }
export function newContent(kind: "announcements" | "surveys"): Editable {
    const now = new Date(), startAt = now.toISOString(), endAt = new Date(now.getTime() + 14 * 86400000).toISOString();
    const base = { id: "", title: "", startAt, endAt, status: "draft" as const, revision: 0, createdAt: "", updatedAt: "" };
    return kind === "announcements" ? { ...base, body: "", link: "" } : { ...base, intro: "", questions: [question()] };
}
export function duplicateSurvey(source: Survey): Survey { return { ...structuredClone(source), id: "", status: "draft", revision: 0, title: source.title + "（複製）", createdAt: "", updatedAt: "", questions: source.questions.map(q => ({ ...q, id: crypto.randomUUID(), options: q.options.map(o => ({ ...o, id: crypto.randomUUID() })) })) }; }
export function validateContent(item: Editable): void {
    if (!item.title.trim() || item.title.length > 80)
        throw Error("題名は1〜80文字で入力してください。");
    if (!Number.isFinite(Date.parse(item.startAt)) || !Number.isFinite(Date.parse(item.endAt)) || Date.parse(item.endAt) <= Date.parse(item.startAt))
        throw Error("終了・締切は開始より後にしてください。");
    if ("body" in item) {
        if (!item.body.trim() || item.body.length > 2000)
            throw Error("本文は1〜2000文字で入力してください。");
        if (item.link && !safeLink(item.link))
            throw Error("リンクはhttpsのURLを指定してください。");
    }
    else {
        if (item.intro.length > 2000)
            throw Error("紹介は2000文字以内で入力してください。");
        if (item.questions.length < 1 || item.questions.length > 10)
            throw Error("設問は1〜10問にしてください。");
        const ids = new Set<string>();
        for (const q of item.questions) {
            if (!q.title.trim() || q.title.length > 200)
                throw Error("設問は1〜200文字で入力してください。");
            if (ids.has(q.id))
                throw Error("設問IDが重複しています。");
            ids.add(q.id);
            if (q.type !== "text") {
                if (q.options.length < 2 || q.options.length > 10 || q.options.some(o => !o.label.trim() || o.label.length > 200))
                    throw Error("選択肢は2〜10個、それぞれ1〜200文字で入力してください。");
                for (const o of q.options) {
                    if (ids.has(o.id))
                        throw Error("選択肢IDが重複しています。");
                    ids.add(o.id);
                }
            }
        }
    }
}
export function payload(item: Editable): Record<string, unknown> {
    const { title, startAt, endAt } = item;
    return "body" in item ? { title, startAt, endAt, body: item.body, link: item.link } : { title, endAt, intro: item.intro, ...(item.status === "draft" ? { startAt, questions: item.questions } : {}) };
}
/** Original POST/key and local inputs survive recovery and optimistic conflicts. */
export class EditorState {
    item: Editable;
    baseline: string;
    pendingCreate?: {
        key: string;
        body: Record<string, unknown>;
    };
    private recoveryBaseline?: Record<string, unknown>;
    latest?: Editable;
    retainedInput?: Editable;
    private pendingAction?: {
        path: string;
        revision: number;
        key: string;
    };
    constructor(public kind: "announcements" | "surveys", item: Editable) { this.item = structuredClone(item); this.baseline = JSON.stringify(this.item); }
    get dirty(): boolean { return this.pendingCreate !== undefined || JSON.stringify(this.item) !== this.baseline; }
    get hasInputToLose(): boolean { return this.dirty || !!this.retainedInput; }
    async refreshLatest(send: Sender): Promise<void> {
        const name = this.kind === "announcements" ? "announcement" : "survey";
        this.latest = (await send<Record<string, Editable>>("/" + this.kind + "/" + encodeURIComponent(this.item.id)))[name];
        // Keep edited fields, but immediately apply the server publication lock.
        this.item.status = this.latest.status;
    }
    rebase(): void {
        if (!this.latest) throw Error("先に最新版を表示してください。");
        const original = this.recoveryBaseline ?? this.pendingCreate?.body ?? payload(JSON.parse(this.baseline) as Editable);
        const current = structuredClone(this.item), desired = payload(current);
        const edits = Object.fromEntries(Object.entries(desired).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
        if ("questions" in current && this.latest.status !== "draft" && (JSON.stringify(current.questions) !== JSON.stringify((this.latest as Survey).questions) || current.startAt !== this.latest.startAt)) this.retainedInput = current;
        this.item = { ...structuredClone(this.latest), ...edits } as Editable;
        this.baseline = JSON.stringify(this.latest);
        this.recoveryBaseline = payload(this.latest);
        this.latest = undefined;
    }
    async save(send: Sender): Promise<void> {
        if (this.latest) throw new AdminError("最新版と現在の入力を比較してから適用してください。", 409);
        validateContent(this.item);
        const desired = payload(this.item), name = this.kind === "announcements" ? "announcement" : "survey";
        if (!this.item.id) {
            this.pendingCreate ??= { key: crypto.randomUUID(), body: structuredClone(desired) };
            let created: Editable;
            try {
                created = (await send<Record<string, Editable>>("/" + this.kind, "POST", this.pendingCreate.body, { "Idempotency-Key": this.pendingCreate.key }))[name];
            }
            catch (error) {
                if (error instanceof AdminError && [400, 413, 415, 422].includes(error.status))
                    this.pendingCreate = undefined;
                throw error;
            }
            this.item.id = created.id;
            this.item.revision = 1;
            this.item.createdAt = created.createdAt;
            this.item.status = created.status;
            if (created.revision !== 1) {
                this.latest = created;
                throw new AdminError("登録済みの内容に別の更新があります。最新版と比較してください。", 409);
            }
            const matches = JSON.stringify(desired) === JSON.stringify(this.pendingCreate.body);
            if (matches) {
                this.pendingCreate = undefined;
                this.item = created;
                this.baseline = JSON.stringify(created);
                return;
            }
        }
        const original = this.recoveryBaseline ?? this.pendingCreate?.body ?? payload(JSON.parse(this.baseline) as Editable);
        const changes = Object.fromEntries(Object.entries(desired).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
        let saved: Editable;
        try { saved = (await send<Record<string, Editable>>("/" + this.kind + "/" + encodeURIComponent(this.item.id), "PATCH", { ...changes, revision: this.item.revision }))[name]; }
        catch (error) {
            if (error instanceof AdminError && error.status === 409) await this.refreshLatest(send).catch(() => {});
            throw error;
        }
        this.item = saved;
        this.baseline = JSON.stringify(saved);
        this.pendingCreate = undefined;
        this.recoveryBaseline = undefined;
    }
    async action(action: "publish" | "end", send: Sender): Promise<void> {
        if (this.dirty || !this.item.id)
            throw Error("先に変更を保存してください。");
        const path = "/" + this.kind + "/" + encodeURIComponent(this.item.id) + "/" + action;
        if (!this.pendingAction || this.pendingAction.path !== path || this.pendingAction.revision !== this.item.revision)
            this.pendingAction = { path, revision: this.item.revision, key: crypto.randomUUID() };
        const name = this.kind === "announcements" ? "announcement" : "survey";
        const value = await send<Record<string, Editable>>(path, "POST", { revision: this.item.revision }, { "Idempotency-Key": this.pendingAction.key });
        this.item = value[name];
        this.baseline = JSON.stringify(this.item);
        this.pendingAction = undefined;
    }
}
export function errorMessage(error: unknown): string { return error instanceof AdminError && error.status === 409 ? "別の更新と競合しました。入力は保持しています。「最新版と比較」で内容を確認し、変更した項目だけを適用してください。" : error instanceof Error ? error.message : "処理に失敗しました。入力は保持しています。"; }
