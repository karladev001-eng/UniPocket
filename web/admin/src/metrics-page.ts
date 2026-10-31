import { dateRange, validateRange, type Metrics } from "./model";
import { el, button, field, table } from "./dom";
import {
  card,
  download,
  empty,
  formatDate,
  heading,
  main,
  run,
  taskButton,
} from "./shell";
import { client, navigation, ui } from "./state";
// Metrics screen: period selection, summary cards, daily SVG chart and per-article table.
const count = (value: number | null) =>
  value === null ? "未収集" : value.toLocaleString("ja-JP");
export async function metricsPage(token: number): Promise<void> {
  validateRange(ui.range.start, ui.range.end);
  const query = new URLSearchParams(ui.range).toString();
  const metrics = await client.send<Metrics>("/metrics?" + query);
  if (token !== ui.generation) return;
  heading(
    "集計",
    taskButton("集計CSV", () =>
      download("/metrics.csv?" + query, "content-metrics.csv"),
    ),
  );
  const start = el("input", { type: "date", value: ui.range.start }),
    end = el("input", { type: "date", value: ui.range.end });
  main.append(
    el(
      "div",
      { class: "row periods" },
      ...[7, 30].map((days) =>
        taskButton(`${days}日`, async () => {
          ui.range = dateRange(days);
          await metricsPage(++ui.generation);
        }),
      ),
    ),
    el(
      "form",
      {
        class: "filters",
        onsubmit: (event: Event) => {
          event.preventDefault();
          void run(async () => {
            validateRange(start.value, end.value);
            ui.range = { start: start.value, end: end.value };
            await metricsPage(++ui.generation);
          });
        },
      },
      field("開始日（日本時間）", start),
      field("終了日", end),
      el("button", { type: "submit", class: "linebtn" }, "期間を適用"),
      el("small", {}, "1〜90日"),
    ),
    el(
      "p",
      { class: "muted" },
      `集計時刻 ${formatDate(metrics.asOf)} · 集計開始 ${metrics.collectedSince || "未収集"}`,
    ),
    el(
      "div",
      { class: "stats" },
      card("期間内の記事閲覧", metrics.articleViews),
      card(
        "現在のブックマーク",
        metrics.currentBookmarks,
        "期間によらない現在値",
      ),
      card("期間内のアンケート回答", metrics.surveyResponses),
    ),
  );
  main.append(
    el(
      "section",
      { class: "card" },
      el("h2", {}, "日別の閲覧と回答"),
      metricsChart(metrics),
      table(
        ["日付（日本時間）", "記事閲覧", "アンケート回答"],
        metrics.daily.map((d) => [
          d.day,
          count(d.articleViews),
          count(d.surveyResponses),
        ]),
        "日別集計の表（未収集は0件と区別）",
      ),
    ),
  );
  main.append(
    el(
      "section",
      { class: "card" },
      el("h2", {}, "記事別"),
      metrics.articles.length
        ? table(
            ["記事", "期間内の閲覧", "現在のブックマーク"],
            metrics.articles.map((a) => [a.title, count(a.views), a.bookmarks]),
          )
        : empty("対象の記事はありません。"),
    ),
    button(
      "アンケートの選択結果へ",
      () => void navigation.go("surveys"),
      "quietlink",
    ),
  );
  main.append(
    el(
      "details",
      {},
      el("summary", {}, "数字の定義・保持期限"),
      el(
        "p",
        {},
        "記事閲覧は既存の閲覧条件と重複除去に基づきます。人気記事の直近7日スコアとは別の期間内閲覧数です。回答は受付日時で日別に計上します。現在のブックマークは集計時点の件数で、選択した期間では変わりません。",
      ),
      el(
        "p",
        {},
        "集計開始より前の復元できない値は未収集です。収集済みの0件、未収集、取得失敗を区別します。日次集計は日付・対象コンテンツID・件数・確定時刻のみで、利用者識別子を含みません。",
      ),
      el(
        "p",
        {},
        "記事の閲覧明細は30日、終了したアンケートの個別回答は終了後90日、日次集計と監査は365日を上限に保持します。集計CSVはコンテンツの件数と集計時刻です。自由記述はアンケート結果から別に出力します。",
      ),
    ),
  );
}
function metricsChart(metrics: Metrics): HTMLElement {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 640 160");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "日別の記事閲覧とアンケート回答。正確な件数は下の表を参照してください。未収集日は線をつなぎません。",
  );
  const values = metrics.daily
      .flatMap((d) => [d.articleViews, d.surveyResponses])
      .filter((v): v is number => v !== null),
    max = Math.max(1, ...values);
  for (const [key, color] of [
    ["articleViews", "#4b7055"],
    ["surveyResponses", "#a56d35"],
  ] as const) {
    let path = "",
      connected = false;
    metrics.daily.forEach((d, i) => {
      const value = d[key];
      if (value === null) {
        connected = false;
        return;
      }
      const x = 16 + (i * 608) / Math.max(1, metrics.daily.length - 1),
        y = 140 - (value * 120) / max;
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
  return el(
    "div",
    { class: "chart" },
    el("p", { class: "muted" }, "緑: 記事閲覧　茶: アンケート回答"),
    svg,
  );
}
