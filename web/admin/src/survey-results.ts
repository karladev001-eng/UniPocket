import { type Results } from "./model";
import { el, button, table } from "./dom";
import { resultsSummary } from "./results";
import { download, empty, formatDate, heading, main, taskButton } from "./shell";
import { client, navigation, ui } from "./state";
// Survey results screen: choice counts, anonymous free text and CSV downloads.
export async function resultsPage(id: string): Promise<void> {
    const result = await client.send<Results>("/surveys/" + encodeURIComponent(id) + "/results");
    ++ui.generation;
    ui.editor = undefined;
    heading("回答の集計", button("アンケート一覧へ", () => void navigation.go("surveys")));
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
