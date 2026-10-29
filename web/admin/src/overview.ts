import { el, button } from "./dom";
import { articlePage } from "./articles";
import { card, heading, main } from "./shell";
import { client, navigation, ui } from "./state";
// Overview screen: four headline counters that link to their sections.
export async function overviewPage(token: number): Promise<void> {
    const data = await client.send<{
        publishedArticles: number;
        pendingReports: number;
        activeAnnouncements: number;
        activeSurveys: number;
    }>("/overview");
    if (token !== ui.generation)
        return;
    heading("概要", el("small", {}, new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full" }).format(new Date())));
    const stats = [["公開中の記事", data.publishedArticles, "articles"], ["未確認の通報", data.pendingReports, "articles"], ["公開中のお知らせ", data.activeAnnouncements, "announcements"], ["回答募集中", data.activeSurveys, "surveys"]] as const;
    main.append(el("div", { class: "stats" }, ...stats.map(([label, value, next], i) => button("", () => {
        void navigation.go(next).then(() => {
            if (i === 1 && ui.section === "articles") {
                ui.reportTab = true;
                void articlePage();
            }
        });
    }, "statlink"))));
    main.querySelectorAll(".statlink").forEach((b, i) => b.append(card(stats[i][0], stats[i][1], "一覧へ ›")));
}
