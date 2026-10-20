import "./style.css";
import { AdminClient, EditorState, dateRange, duplicateSurvey, errorMessage, jstInput, newContent, question, safeLink, statusLabel, utcInput, validateContent, validateRange, type Article, type Content, type Editable, type Metrics, type Report, type Results, type Survey } from "./model";
import { el, button, field, table, type Child } from "./dom";
import { AdminPages, VisibilityOperation, reportArticle } from "./moderation";
import { resultsSummary } from "./results";
import { editorRecoveryPanel } from "./editor-recovery";
type Section = "overview" | "articles" | "announcements" | "surveys" | "metrics";
const sections: [
    Section,
    string
][] = [["overview", "概要"], ["articles", "記事"], ["announcements", "お知らせ"], ["surveys", "アンケート"], ["metrics", "集計"]];
const client = new AdminClient();
const app = document.querySelector<HTMLDivElement>("#app")!;
const main = el("main", { id: "main", tabindex: -1 });
const auth = el("div", { class: "auth", hidden: true });
const toast = el("div", { class: "toast", role: "status", hidden: true });
const dialog = el("dialog", { "aria-labelledby": "dialog-title" });
const owner = el("p", { class: "owner" });
let section: Section = "overview", generation = 0, editor: EditorState | undefined, busy = false, reportTab = false;
let range = dateRange(7);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const navButtons = sections.map(([id, label]) => button(label, () => void navigate(id), "navitem"));
const nav = el("nav", { "aria-label": "管理区画" }, ...navButtons);
const menu = el("details", { class: "mobilemenu", open: false }, el("summary", {}, "管理メニュー"));
const sidebar = el("aside", { class: "sidebar" }, el("div", { class: "brand" }, "Uni Pocket", el("span", {}, ".")), el("small", {}, "ADMIN"), menu, nav, el("footer", {}, owner, "日時は日本時間"));
app.append(el("a", { href: "#main", class: "skip" }, "本文へ"), el("div", { class: "layout" }, sidebar, el("div", { class: "content" }, auth, main)), dialog, toast);
function notify(message: string): void { toast.textContent = message; toast.hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { toast.hidden = true; }, 7000); }
function authBanner(): void {
    auth.hidden = false;
    auth.replaceChildren(el("strong", {}, "管理者認証を確認してください"), el("p", {}, "入力はこの画面に保持しています。別タブでログイン後、認証を再確認してください。"), el("a", { class: "linebtn", href: "/", target: "_blank", rel: "noopener" }, "別タブでログイン"), button("認証を再確認", () => void run(async () => {
        await client.authenticate();
        owner.textContent = client.email;
        auth.hidden = true;
        notify("認証を確認しました。操作を再試行できます。");
        if (!editor)
            await loadSection();
    })));
    if (dialog.open && !dialog.querySelector(".dialog-auth"))
        dialog.append(el("div", { class: "notice dialog-auth" }, el("p", {}, "入力を保持しています。別タブで再認証し、この確認操作を再試行してください。"), el("a", { class: "linebtn", href: "/", target: "_blank", rel: "noopener" }, "別タブでログイン"), taskButton("認証を再確認", async () => { await client.authenticate(); owner.textContent = client.email; auth.hidden = true; dialog.querySelector(".dialog-auth")?.remove(); notify("認証を確認しました。操作を再試行できます。"); })));
}
client.onExpired = authBanner;
function showError(error: unknown): void {
    const message = errorMessage(error);
    notify(message);
    const box = document.querySelector<HTMLElement>(dialog.open ? "#dialog-error" : "#form-error");
    if (box) {
        box.hidden = false;
        box.textContent = message;
        box.focus();
    }
    if (!client.authorized)
        authBanner();
}
async function run(action: () => Promise<void>, trigger?: HTMLButtonElement): Promise<void> {
    if (busy)
        return;
    busy = true;
    if (trigger)
        trigger.disabled = true;
    main.inert = true;
    main.setAttribute("aria-busy", "true");
    try {
        await action();
    }
    catch (error) {
        showError(error);
    }
    finally {
        busy = false;
        if (trigger)
            trigger.disabled = false;
        main.inert = false;
        main.removeAttribute("aria-busy");
    }
}
function taskButton(label: string, action: () => Promise<void>, className = "linebtn"): HTMLButtonElement { const b = button(label, () => void run(action, b), className); return b; }
function heading(title: string, ...actions: Child[]): void { main.replaceChildren(el("header", { class: "top" }, el("div", {}, el("small", { class: "eyebrow" }, "UNI POCKET / 管理"), el("h1", { tabindex: -1 }, title)), el("div", { class: "row" }, ...actions))); }
function card(label: string, value: number | null, hint?: string): HTMLElement { return el("div", { class: "stat" }, el("small", {}, label), el("b", {}, value === null ? "未収集" : value.toLocaleString("ja-JP")), hint ? el("small", {}, hint) : null); }
const count = (value: number | null) => value === null ? "未収集" : value.toLocaleString("ja-JP");
const formatDate = (iso: string) => iso ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
const empty = (text: string) => el("p", { class: "empty" }, text);
const status = (item: Content) => el("span", { class: "tag" }, statusLabel(item));
function openDialog(title: string, body: HTMLElement, actions: HTMLButtonElement[] = []): void { dialog.replaceChildren(el("div", { class: "top" }, el("h2", { id: "dialog-title" }, title), button("×", () => dialog.close(), "close")), body, el("div", { id: "dialog-error", class: "notice error", role: "alert", tabindex: -1, hidden: true }), el("div", { class: "dialogactions" }, ...actions)); dialog.querySelector("button")?.setAttribute("aria-label", "閉じる"); dialog.showModal(); }
function confirmAction(title: string, body: HTMLElement, label: string, action: () => Promise<void>): void { openDialog(title, body, [taskButton(label, async () => { await action(); dialog.close(); }, "action")]); }
async function navigate(next: Section): Promise<void> {
    if (busy)
        return;
    if (editor?.hasInputToLose && !window.confirm("保存していない入力があります。破棄して移動しますか？"))
        return;
    editor = undefined;
    section = next;
    reportTab = false;
    menu.open = false;
    await loadSection();
}
window.addEventListener("beforeunload", event => {
    if (editor?.hasInputToLose) {
        event.preventDefault();
        event.returnValue = "";
    }
});
menu.addEventListener("toggle", () => { sidebar.classList.toggle("expanded", menu.open); });
async function loadSection(): Promise<void> {
    const token = ++generation;
    navButtons.forEach((b, index) => {
        const active = sections[index][0] === section;
        b.classList.toggle("active", active);
        if (active)
            b.setAttribute("aria-current", "page");
        else
            b.removeAttribute("aria-current");
    });
    heading(sections.find(([id]) => id === section)![1]);
    main.append(el("p", { role: "status" }, "読み込み中…"));
    try {
        if (!client.authorized) {
            authBanner();
            main.replaceChildren(empty("管理者認証後に表示します。"));
            return;
        }
        if (section === "overview") {
            const data = await client.send<{
                publishedArticles: number;
                pendingReports: number;
                activeAnnouncements: number;
                activeSurveys: number;
            }>("/overview");
            if (token !== generation)
                return;
            heading("概要", el("small", {}, new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full" }).format(new Date())));
            const stats = [["公開中の記事", data.publishedArticles, "articles"], ["未確認の通報", data.pendingReports, "articles"], ["公開中のお知らせ", data.activeAnnouncements, "announcements"], ["回答募集中", data.activeSurveys, "surveys"]] as const;
            main.append(el("div", { class: "stats" }, ...stats.map(([label, value, next], i) => button("", () => {
                void navigate(next).then(() => {
                    if (i === 1 && section === "articles") {
                        reportTab = true;
                        void articlePage();
                    }
                });
            }, "statlink"))));
            main.querySelectorAll(".statlink").forEach((b, i) => b.append(card(stats[i][0], stats[i][1], "一覧へ ›")));
        }
        else if (section === "articles")
            await articlePage(token);
        else if (section === "announcements" || section === "surveys")
            await contentList(section, token);
        else
            await metricsPage(token);
        if (token === generation)
            main.querySelector<HTMLElement>("h1")?.focus();
    }
    catch (error) {
        if (token !== generation)
            return;
        heading(sections.find(([id]) => id === section)![1]);
        main.append(el("div", { class: "notice error", role: "alert" }, errorMessage(error)), taskButton("再試行", loadSection));
        if (!client.authorized)
            authBanner();
    }
}
async function articlePage(token = generation): Promise<void> {
    if (token !== generation || section !== "articles")
        return;
    heading("記事");
    const articles = new AdminPages<Article>("articles", client.send);
    const reports = new AdminPages<Report>("reports", client.send);
    const listing = el("div"), filters = el("form", { class: "filters" });
    const search = el("input", { type: "search", placeholder: "題名・投稿者・カテゴリ", "aria-label": "題名・投稿者・カテゴリで検索", maxlength: 200 });
    const visibility = el("select", { "aria-label": "公開状態" }, ...[["", "すべての状態"], ["published", "公開"], ["hidden", "非表示"], ["deleted", "作者削除"]].map(([value, text]) => el("option", { value }, text)));
    const reviewed = el("select", { "aria-label": "通報の確認状態" }, el("option", { value: "pending" }, "未確認"), el("option", { value: "reviewed" }, "確認済み"), el("option", { value: "" }, "すべて"));
    const articleTab = button("記事一覧", () => { reportTab = false; void refresh(); }, "tab"), reportsTab = button("通報", () => { reportTab = true; void refresh(); }, "tab");
    const progress = el("p", { role: "status", class: "muted" });
    const more = button("さらに読み込む", () => void refresh(true));
    let filtersForReports: boolean | undefined;
    let requestEpoch = 0;
    const current = () => token === generation && section === "articles";
    async function refresh(append = false): Promise<void> {
        const epoch = ++requestEpoch, viewingReports = reportTab;
        const pages = viewingReports ? reports : articles;
        progress.textContent = "読み込み中…";
        more.disabled = true;
        try {
            const pending = append ? pages.more() : viewingReports ? reports.reset({ status: reviewed.value }) : articles.reset({ q: search.value.trim(), visibility: visibility.value });
            if (!append)
                renderRows();
            const applied = await pending;
            if (!current() || epoch !== requestEpoch || viewingReports !== reportTab || !applied)
                return;
            renderRows();
            progress.textContent = `${pages.items.length}件を表示${pages.nextCursor ? "・続きがあります" : ""}`;
        }
        catch (error) {
            if (!current() || epoch !== requestEpoch)
                return;
            progress.replaceChildren(el("span", { role: "alert" }, errorMessage(error)), button("再試行", () => void refresh(append)));
            if (!client.authorized)
                authBanner();
        }
        finally {
            if (current() && epoch === requestEpoch) {
                more.disabled = false;
                more.hidden = !pages.nextCursor;
            }
        }
    }
    function renderRows(): void {
        articleTab.setAttribute("aria-pressed", String(!reportTab));
        reportsTab.setAttribute("aria-pressed", String(reportTab));
        if (filtersForReports !== reportTab) {
            filters.replaceChildren(...(reportTab ? [reviewed] : [search, visibility, el("button", { type: "submit", class: "linebtn" }, "検索")]));
            filtersForReports = reportTab;
        }
        if (reportTab) {
            const items = reports.items;
            listing.replaceChildren(items.length ? table(["記事 / 通報", "確認"], items.map(r => [el("div", {}, taskButton(r.articleTitle || "記事", async () => { const article = await reportArticle(r.articleId, client.send); if (current())
                    articleDetail(article); }, "textbutton"), el("small", {}, reportReason(r.reason), " · ", formatDate(r.createdAt)), el("p", { class: "bodycopy" }, r.details)), taskButton(r.status === "pending" ? "確認済みにする" : "未確認に戻す", async () => { await client.send("/reports/" + encodeURIComponent(r.id), "PATCH", { revision: r.revision, status: r.status === "pending" ? "reviewed" : "pending" }); await refresh(); })])) : reports.loading ? el("div") : empty("該当する通報はありません。"));
        }
        else {
            const items = articles.items;
            listing.replaceChildren(items.length ? table(["題名 / 投稿者", "公開状態", "閲覧 / ブックマーク"], items.map(a => [el("div", {}, button(a.title, () => articleDetail(a), "textbutton"), el("small", {}, a.authorName, " · ", a.category || "未分類")), el("span", { class: "tag" }, articleStatus(a)), `${a.viewCount} / ${a.bookmarkCount}`])) : articles.loading ? el("div") : empty("該当する記事はありません。"));
        }
        more.hidden = !(reportTab ? reports.nextCursor : articles.nextCursor);
    }
    filters.addEventListener("submit", event => { event.preventDefault(); void refresh(); });
    [visibility, reviewed].forEach(input => input.addEventListener("change", () => void refresh()));
    main.append(el("div", { class: "tabs" }, articleTab, reportsTab), filters, progress, listing, more, el("details", {}, el("summary", {}, "記事管理について"), el("p", {}, "題名・投稿者・カテゴリの検索と公開状態の絞り込みは全件を対象にします。一度に50件ずつ表示します。記事は登録後すぐに公開されます。本文は元のNotionページで管理されます。ここでの非表示はNotionページ自体を非公開にしません。")));
    await refresh();
}
function reportReason(reason: string): string { return ({ inappropriate: "不適切", incorrect: "誤情報", broken_link: "リンク不備", other: "その他" } as Record<string, string>)[reason] || reason; }
function articleStatus(a: Article): string { return a.visibility === "hidden" ? "非表示" : a.visibility === "deleted" ? "作者削除" : "公開"; }
function articleDetail(a: Article): void {
    const reason = el("textarea", { maxlength: 500, rows: 3, value: a.hiddenReason || "", required: true });
    const body = el("div", {}, el("h3", {}, a.title), el("p", {}, `${a.authorName} · ${a.category || "未分類"}`), el("p", {}, `閲覧 ${a.viewCount} / 現在のブックマーク ${a.bookmarkCount}`), el("p", {}, articleStatus(a)), el("p", { class: "bodycopy" }, a.hiddenReason), safeLink(a.publicUrl) ? el("a", { href: safeLink(a.publicUrl), target: "_blank", rel: "noopener noreferrer", class: "quietlink" }, "元のNotionページ ↗") : null);
    if (a.visibility === "deleted") {
        body.append(el("p", {}, "作者が削除した記事は再公開できません。"));
        openDialog("記事の詳細", body);
        return;
    }
    if (a.visibility === "published")
        body.append(field("非表示の理由（作者にも表示）", reason, "1〜500文字"));
    openDialog("記事の詳細", body, [button(a.visibility === "published" ? "非表示の確認へ" : "再公開の確認へ", () => {
            if (a.visibility === "published" && !reason.value.trim()) {
                reason.setCustomValidity("非表示の理由を入力してください。");
                reason.reportValidity();
                reason.setCustomValidity("");
                reason.focus();
                return;
            }
            const hidden = a.visibility === "published", text = reason.value.trim();
            let operation: VisibilityOperation;
            try {
                operation = new VisibilityOperation(a.id, a.revision, hidden ? "hidden" : "published", text);
            }
            catch (error) {
                showError(error);
                return;
            }
            dialog.close();
            confirmAction(hidden ? "この記事を非表示にしますか？" : "この記事を再公開しますか？", el("div", {}, el("h3", {}, a.title), el("p", {}, a.authorName), el("small", {}, `対象の改訂 ${operation.input.revision}`), hidden ? el("p", { class: "bodycopy" }, operation.input.reason) : el("p", {}, "一般の一覧と詳細に再び表示されます。")), hidden ? "非表示にする" : "再公開する", async () => { await operation.submit(client.send); await articlePage(); notify(hidden ? "記事を非表示にしました。" : "記事を再公開しました。"); });
        }, a.visibility === "published" ? "danger" : "action")]);
}
async function contentList(kind: "announcements" | "surveys", token: number): Promise<void> {
    const data = await client.send<Record<string, Editable[]>>("/" + kind);
    if (token !== generation)
        return;
    const items = data[kind];
    heading(kind === "announcements" ? "お知らせ" : "アンケート", button("＋ 作成", () => openEditor(kind, newContent(kind)), "action"));
    main.append(items.length ? table(["題名 / 配信期間", "状態", "操作"], items.map(item => [el("div", {}, button(item.title, () => openEditor(kind, item), "textbutton"), el("small", {}, formatDate(item.startAt), " — ", formatDate(item.endAt))), status(item), kind === "surveys" ? el("div", { class: "row" }, taskButton("結果", () => resultsPage(item.id)), button("複製", () => openEditor(kind, duplicateSurvey(item as Survey)))) : button("編集", () => openEditor(kind, item))])) : empty(kind === "announcements" ? "お知らせはまだありません。" : "アンケートはまだありません。"));
    main.append(el("details", {}, el("summary", {}, "配信の範囲"), el("p", {}, "全員向けのアプリ内表示です。開始前は予約、期限後は利用者の一覧から外れます。公開前に表示内容と期間を確認します。")));
}
function openEditor(kind: "announcements" | "surveys", item: Editable): void {
    if (editor?.hasInputToLose && !window.confirm("保存していない入力を破棄しますか？"))
        return;
    ++generation;
    editor = new EditorState(kind, item);
    renderEditor();
}
function renderEditor(): void {
    const state = editor!;
    const item = state.item, published = item.status !== "draft";
    heading(item.id ? ("body" in item ? "お知らせを編集" : "アンケートを編集") : ("body" in item ? "お知らせを作成" : "アンケートを作成"), button("一覧へ", () => void navigate(state.kind)));
    const form = el("form", { class: "editor", onsubmit: (e: Event) => e.preventDefault() });
    if (state.latest) form.append(editorRecoveryPanel(state, previewBody, () => { renderEditor(); notify("変更した項目を保持しました。内容を確認して保存してください。"); }));
    if (state.retainedInput) form.append(el("details", {}, el("summary", {}, "適用できなかった設問の入力を表示"), el("p", { class: "notice" }, "別の更新で公開されたため、設問と開始日時は変更できません。入力をこの画面に保持しています。必要な内容を控えてから一覧の複製を使ってください。"), el("fieldset", { disabled: true }, previewBody(state.retainedInput))));
    const title = el("input", { type: "text", maxlength: 80, required: true, value: item.title, oninput: (e: Event) => { item.title = (e.target as HTMLInputElement).value; } });
    const start = el("input", { type: "datetime-local", value: jstInput(item.startAt), required: true, disabled: "questions" in item && published });
    const end = el("input", { type: "datetime-local", value: jstInput(item.endAt), required: true });
    start.addEventListener("input", () => {
        try {
            item.startAt = utcInput(start.value);
        }
        catch {
            item.startAt = "";
        }
    });
    end.addEventListener("input", () => {
        try {
            item.endAt = utcInput(end.value);
        }
        catch {
            item.endAt = "";
        }
    });
    form.append(el("div", { id: "form-error", class: "notice error", role: "alert", tabindex: -1, hidden: true }), el("div", { class: "row" }, status(item), el("small", {}, item.id ? `改訂 ${item.revision}` : "未保存")), field("題名", title, "80文字まで"));
    if ("body" in item) {
        const body = el("textarea", { value: item.body, maxlength: 2000, rows: 9, required: true, oninput: (e: Event) => { item.body = (e.target as HTMLTextAreaElement).value; } });
        const link = el("input", { type: "url", value: item.link, placeholder: "https://", maxlength: 2048, oninput: (e: Event) => { item.link = (e.target as HTMLInputElement).value; } });
        form.append(field("本文", body, "2000文字まで。改行をそのまま表示します。"), field("リンク（任意・1件）", link, "httpsのみ"));
    }
    else {
        form.append(field("紹介", el("textarea", { value: item.intro, maxlength: 2000, rows: 4, oninput: (e: Event) => { item.intro = (e.target as HTMLTextAreaElement).value; } }), "2000文字まで"));
        if (published)
            form.append(el("p", { class: "notice" }, "公開後の設問・選択肢は変更できません。設問を変えるときは一覧から複製してください。"));
        const survey = item;
        const questions = el("div");
        function renderQuestions(): void {
            questions.replaceChildren(...survey.questions.map((q, index) => {
                const type = el("select", { value: q.type, disabled: published, "aria-label": `設問${index + 1}の形式` }, ...[["single", "単一選択"], ["multiple", "複数選択"], ["text", "自由記述"]].map(([value, text]) => el("option", { value, selected: q.type === value }, text)));
                type.addEventListener("change", () => {
                    q.type = type.value as typeof q.type;
                    if (q.type === "text")
                        q.options = [];
                    else if (!q.options.length)
                        q.options = question().options;
                    renderQuestions();
                });
                const required = el("input", { type: "checkbox", checked: q.required, disabled: published, onchange: (e: Event) => { q.required = (e.target as HTMLInputElement).checked; } });
                const box = el("fieldset", { class: "question-edit", disabled: published }, el("legend", {}, `設問 ${index + 1}`), field("設問", el("input", { value: q.title, maxlength: 200, required: true, oninput: (e: Event) => { q.title = (e.target as HTMLInputElement).value; } })), el("div", { class: "row" }, type, el("label", { class: "check" }, required, "必須")));
                if (q.type === "text")
                    box.append(el("small", {}, "自由記述は1000文字まで。個人情報を避ける案内を利用者に表示します。"));
                else {
                    q.options.forEach((option, i) => { const remove = button("削除", () => { q.options.splice(i, 1); renderQuestions(); }); remove.disabled = q.options.length <= 2; remove.setAttribute("aria-label", `設問${index + 1}の選択肢${i + 1}を削除`); box.append(el("div", { class: "optionrow" }, field(`選択肢 ${i + 1}`, el("input", { value: option.label, maxlength: 200, required: true, oninput: (e: Event) => { option.label = (e.target as HTMLInputElement).value; } })), !published ? remove : null)); });
                    if (!published) {
                        const add = button("＋ 選択肢", () => { q.options.push({ id: crypto.randomUUID(), label: "" }); renderQuestions(); });
                        add.disabled = q.options.length >= 10;
                        box.append(add);
                    }
                }
                if (!published) {
                    const remove = button("この設問を削除", () => { survey.questions.splice(index, 1); renderQuestions(); });
                    remove.disabled = survey.questions.length <= 1;
                    box.append(remove);
                }
                return box;
            }));
            if (!published) {
                const add = button("＋ 設問を追加", () => { survey.questions.push(question()); renderQuestions(); });
                add.disabled = survey.questions.length >= 10;
                questions.append(add, el("small", {}, ` ${survey.questions.length} / 10問`));
            }
        }
        renderQuestions();
        form.append(questions);
    }
    form.append(el("div", { class: "twocol" }, field("表示開始（日本時間）", start), field("body" in item ? "表示終了（日本時間）" : "締切（日本時間）", end)));
    const check = () => {
        if (!form.reportValidity())
            return false;
        validateContent(item);
        return true;
    };
    const actions = el("div", { class: "editorfooter" });
    if (item.id) actions.append(taskButton("最新版と比較", async () => { await state.refreshLatest(client.send); renderEditor(); }));
    if (!published)
        actions.append(taskButton("下書きを保存", async () => {
            if (!check())
                return;
            try { await state.save(client.send); } catch (error) { if (state.latest) renderEditor(); throw error; }
            notify("下書きを保存しました。");
            renderEditor();
        }));
    actions.append(button(published ? "変更をプレビュー" : "プレビュー・公開へ", () => {
        try {
            if (!check())
                return;
            if (!published && (state.dirty || !item.id)) {
                notify("先に下書きを保存してください。");
                return;
            }
            previewEditor(state);
        }
        catch (error) {
            showError(error);
        }
    }, "action"));
    if (item.id && item.status === "published")
        actions.append(button("公開を終了", () => {
            if (state.dirty) {
                notify("変更を保存するか、一覧へ戻ってから終了してください。");
                return;
            }
            confirmAction("公開を終了しますか？", el("div", {}, el("h3", {}, item.title), el("p", {}, "利用者の一覧から外れます。期限を確認して再開できます。")), "公開を終了", async () => { await state.action("end", client.send); renderEditor(); notify("公開を終了しました。"); });
        }, "danger"));
    if (item.id && item.status === "ended")
        actions.append(button("再開のプレビュー", () => {
            try {
                if (check())
                    previewEditor(state, true);
            }
            catch (error) {
                showError(error);
            }
        }));
    form.append(actions);
    main.append(form);
}
function previewBody(item: Editable): HTMLElement {
    const body = el("div", { class: "preview" }, el("small", {}, "利用者への表示プレビュー"), el("h3", {}, item.title), el("p", { class: "bodycopy" }, "body" in item ? item.body : item.intro));
    if ("body" in item) {
        if (item.link && safeLink(item.link))
            body.append(el("a", { href: safeLink(item.link), target: "_blank", rel: "noopener noreferrer" }, "関連リンク ↗"));
    }
    else
        item.questions.forEach((q, i) => {
            const inputs = q.type === "text"
                ? [el("textarea", { maxlength: 1000, "aria-label": q.title }), el("small", {}, "1000文字まで。個人名や連絡先などは入力しないでください。")]
                : q.options.map(o => el("label", { class: "check" }, el("input", { type: q.type === "single" ? "radio" : "checkbox", name: "preview-" + q.id }), o.label));
            body.append(el("fieldset", { class: "preview-question" }, el("legend", {}, `${i + 1}. ${q.title}（${q.required ? "必須" : "任意"}）`), ...inputs));
        });
    body.append(el("p", { class: "muted" }, `${formatDate(item.startAt)} — ${formatDate(item.endAt)}（日本時間）`));
    return body;
}
function previewEditor(state: EditorState, reopen = false): void {
    const item = state.item, initial = item.status === "draft", action = reopen || initial ? "公開する" : "変更を保存";
    openDialog("表示内容のプレビュー", previewBody(item), [button("確認へ", () => {
            dialog.close();
            const confirm = previewBody(item);
            confirm.append(el("p", { class: "notice" }, action === "公開する" ? "全員向けにアプリ内で表示します。開始が未来の場合は予約になります。" : "公開済みの内容を更新します。お知らせは改訂版として扱います。"));
            confirmAction(action + "前の確認", confirm, action, async () => {
                if (Date.parse(item.endAt) <= Date.now() && (initial || reopen))
                    throw Error("終了・締切が過去です。日時を変更してください。");
                if (state.dirty) {
                    try { await state.save(client.send); } catch (error) { if (state.latest) { dialog.close(); renderEditor(); } throw error; }
                }
                if (initial || reopen)
                    await state.action("publish", client.send);
                renderEditor();
                notify(action === "公開する" ? "公開を設定しました。" : "変更を保存しました。");
            });
        }, "action")]);
}
async function resultsPage(id: string): Promise<void> {
    const result = await client.send<Results>("/surveys/" + encodeURIComponent(id) + "/results");
    ++generation;
    editor = undefined;
    heading("回答の集計", button("アンケート一覧へ", () => void navigate("surveys")));
    main.append(el("h2", {}, result.survey.title), resultsSummary(result), el("p", { class: "muted" }, "複数選択の件数は選択数です。回答者数とは異なります。"));
    result.survey.questions.filter(q => q.type !== "text").forEach(q => { const counts = result.questions.find(r => r.questionId === q.id)?.counts || []; main.append(el("section", { class: "card" }, el("h3", {}, q.title), table(["選択肢", result.resultsComplete ? "選択数" : "保存期間内の選択数"], q.options.map(o => [o.label, counts.find(c => c.optionId === o.id)?.count ?? 0])))); });
    const text = el("div", { hidden: true });
    const show = button("匿名の自由記述を表示", () => { text.hidden = !text.hidden; show.textContent = text.hidden ? "匿名の自由記述を表示" : "自由記述を閉じる"; });
    const textQuestions = result.survey.questions.filter(q => q.type === "text");
    if (textQuestions.length) {
        textQuestions.forEach(q => { const answers = result.freeText.filter(a => a.questionId === q.id); text.append(el("section", { class: "card" }, el("h3", {}, q.title), ...(answers.length ? answers.map(a => el("div", { class: "answer" }, el("p", { class: "bodycopy" }, a.value), el("small", {}, formatDate(a.submittedAt)))) : [empty("自由記述はありません。")]))); });
        main.append(el("section", {}, el("h2", {}, "管理者だけの回答詳細"), show, text, taskButton("回答詳細CSVをダウンロード", () => download("/surveys/" + encodeURIComponent(id) + "/responses.csv", "survey-responses.csv")), el("small", {}, "自由記述を含みます。集計CSVとは別の操作です。")));
    }
    else
        main.append(taskButton("回答CSVをダウンロード", () => download("/surveys/" + encodeURIComponent(id) + "/responses.csv", "survey-responses.csv")));
    main.append(el("details", {}, el("summary", {}, "回答の扱い"), el("p", {}, "同じ匿名ユーザーIDにつき1回答です。別ブラウザの同一人物判定は行いません。終了後90日を過ぎた個別回答は削除され、日次集計は365日を上限に保持します。保存期限を過ぎた集計は再公開しても復元されません。")));
}
async function download(path: string, filename: string): Promise<void> { const blob = await client.csv(path), url = URL.createObjectURL(blob), a = el("a", { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function metricsPage(token: number): Promise<void> {
    validateRange(range.start, range.end);
    const query = new URLSearchParams(range).toString();
    const metrics = await client.send<Metrics>("/metrics?" + query);
    if (token !== generation)
        return;
    heading("集計", taskButton("集計CSV", () => download("/metrics.csv?" + query, "content-metrics.csv")));
    const start = el("input", { type: "date", value: range.start }), end = el("input", { type: "date", value: range.end });
    main.append(el("div", { class: "row periods" }, ...[7, 30].map(days => taskButton(`${days}日`, async () => { range = dateRange(days); await metricsPage(++generation); }))), el("form", { class: "filters", onsubmit: (event: Event) => { event.preventDefault(); void run(async () => { validateRange(start.value, end.value); range = { start: start.value, end: end.value }; await metricsPage(++generation); }); } }, field("開始日（日本時間）", start), field("終了日", end), el("button", { type: "submit", class: "linebtn" }, "期間を適用"), el("small", {}, "1〜90日")), el("p", { class: "muted" }, `集計時刻 ${formatDate(metrics.asOf)} · 集計開始 ${metrics.collectedSince || "未収集"}`), el("div", { class: "stats" }, card("期間内の記事閲覧", metrics.articleViews), card("現在のブックマーク", metrics.currentBookmarks, "期間によらない現在値"), card("期間内のアンケート回答", metrics.surveyResponses)));
    main.append(el("section", { class: "card" }, el("h2", {}, "日別の閲覧と回答"), metricsChart(metrics), table(["日付（日本時間）", "記事閲覧", "アンケート回答"], metrics.daily.map(d => [d.day, count(d.articleViews), count(d.surveyResponses)]), "日別集計の表（未収集は0件と区別）")));
    main.append(el("section", { class: "card" }, el("h2", {}, "記事別"), metrics.articles.length ? table(["記事", "期間内の閲覧", "現在のブックマーク"], metrics.articles.map(a => [a.title, count(a.views), a.bookmarks])) : empty("対象の記事はありません。")), button("アンケートの選択結果へ", () => void navigate("surveys"), "quietlink"));
    main.append(el("details", {}, el("summary", {}, "数字の定義・保持期限"), el("p", {}, "記事閲覧は既存の閲覧条件と重複除去に基づきます。人気記事の直近7日スコアとは別の期間内閲覧数です。回答は受付日時で日別に計上します。現在のブックマークは集計時点の件数で、選択した期間では変わりません。"), el("p", {}, "集計開始より前の復元できない値は未収集です。収集済みの0件、未収集、取得失敗を区別します。日次集計は日付・対象コンテンツID・件数・確定時刻のみで、利用者識別子を含みません。"), el("p", {}, "記事の閲覧明細は30日、終了したアンケートの個別回答は終了後90日、日次集計と監査は365日を上限に保持します。集計CSVはコンテンツの件数と集計時刻です。自由記述はアンケート結果から別に出力します。")));
}
function metricsChart(metrics: Metrics): HTMLElement {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 640 160");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "日別の記事閲覧とアンケート回答。正確な件数は下の表を参照してください。未収集日は線をつなぎません。");
    const values = metrics.daily.flatMap(d => [d.articleViews, d.surveyResponses]).filter((v): v is number => v !== null), max = Math.max(1, ...values);
    for (const [key, color] of [["articleViews", "#4b7055"], ["surveyResponses", "#a56d35"]] as const) {
        let path = "", connected = false;
        metrics.daily.forEach((d, i) => {
            const value = d[key];
            if (value === null) {
                connected = false;
                return;
            }
            const x = 16 + i * 608 / Math.max(1, metrics.daily.length - 1), y = 140 - value * 120 / max;
            path += `${connected ? "L" : "M"}${x},${y} `;
            connected = true;
            const circle = document.createElementNS(ns, "circle");
            circle.setAttribute("cx", String(x));
            circle.setAttribute("cy", String(y));
            circle.setAttribute("r", "2.5");
            circle.setAttribute("fill", color);
            svg.append(circle);
        });
        const line = document.createElementNS(ns, "path");
        line.setAttribute("d", path);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "2");
        svg.append(line);
    }
    return el("div", { class: "chart" }, el("p", { class: "muted" }, "緑: 記事閲覧　茶: アンケート回答"), svg);
}
void (async () => {
    heading("管理者認証を確認しています");
    try {
        await client.authenticate();
        owner.textContent = client.email;
        auth.hidden = true;
        await loadSection();
    }
    catch (error) {
        showError(error);
        heading("管理者認証が必要です");
        main.append(empty("別タブでログイン後、この画面で認証を再確認してください。"));
    }
})();
