import { EditorState, duplicateSurvey, jstInput, newContent, question, safeLink, statusLabel, utcInput, validateContent, type Content, type Editable, type Survey } from "./model";
import { el, button, field, table } from "./dom";
import { editorRecoveryPanel } from "./editor-recovery";
import { resultsPage } from "./survey-results";
import { confirmAction, dialog, empty, formatDate, heading, main, notify, openDialog, showError, taskButton } from "./shell";
import { client, navigation, ui } from "./state";
// Announcements and surveys: list, editor form, preview and publish confirmation.
const status = (item: Content) => el("span", { class: "tag" }, statusLabel(item));
export async function contentList(kind: "announcements" | "surveys", token: number): Promise<void> {
    const data = await client.send<Record<string, Editable[]>>("/" + kind);
    if (token !== ui.generation)
        return;
    const items = data[kind];
    heading(kind === "announcements" ? "お知らせ" : "アンケート", button("＋ 作成", () => openEditor(kind, newContent(kind)), "action"));
    main.append(items.length ? table(["題名 / 配信期間", "状態", "操作"], items.map(item => [el("div", {}, button(item.title, () => openEditor(kind, item), "textbutton"), el("small", {}, formatDate(item.startAt), " — ", formatDate(item.endAt))), status(item), kind === "surveys" ? el("div", { class: "row" }, taskButton("結果", () => resultsPage(item.id)), button("複製", () => openEditor(kind, duplicateSurvey(item as Survey)))) : button("編集", () => openEditor(kind, item))])) : empty(kind === "announcements" ? "お知らせはまだありません。" : "アンケートはまだありません。"));
    main.append(el("details", {}, el("summary", {}, "配信の範囲"), el("p", {}, "全員向けのアプリ内表示です。開始前は予約、期限後は利用者の一覧から外れます。公開前に表示内容と期間を確認します。")));
}
function openEditor(kind: "announcements" | "surveys", item: Editable): void {
    if ((ui.editor?.hasInputToLose || ui.articleEditor?.hasInputToLose) && !window.confirm("保存していない入力を破棄しますか？"))
        return;
    ++ui.generation;
    ui.editor = new EditorState(kind, item);
    renderEditor();
}
function renderEditor(): void {
    const state = ui.editor!;
    const item = state.item, published = item.status !== "draft";
    heading(item.id ? ("body" in item ? "お知らせを編集" : "アンケートを編集") : ("body" in item ? "お知らせを作成" : "アンケートを作成"), button("一覧へ", () => void navigation.go(state.kind)));
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
