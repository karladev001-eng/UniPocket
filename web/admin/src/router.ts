import { el } from "./dom";
import { errorMessage } from "./model";
import { sections, client, ui, type Section } from "./state";
import { articlePage } from "./articles";
import { contentList } from "./content-pages";
import { metricsPage } from "./metrics-page";
import { overviewPage } from "./overview";
import { authBanner, empty, heading, main, menu, navButtons, taskButton } from "./shell";
// Section routing: leave-guard for unsaved input, then load the chosen screen.
export async function navigate(next: Section): Promise<void> {
    if (ui.busy)
        return;
    if ((ui.editor?.hasInputToLose || ui.articleEditor?.hasInputToLose) && !window.confirm("保存していない入力があります。破棄して移動しますか？"))
        return;
    ui.editor = undefined;
    ui.articleEditor = undefined;
    ui.section = next;
    ui.reportTab = false;
    menu.open = false;
    await loadSection();
}
export async function loadSection(): Promise<void> {
    const token = ++ui.generation;
    navButtons.forEach((b, index) => {
        const active = sections[index][0] === ui.section;
        b.classList.toggle("active", active);
        if (active)
            b.setAttribute("aria-current", "page");
        else
            b.removeAttribute("aria-current");
    });
    heading(sections.find(([id]) => id === ui.section)![1]);
    main.append(el("p", { role: "status" }, "読み込み中…"));
    try {
        if (!client.authorized) {
            authBanner();
            main.replaceChildren(empty("管理者認証後に表示します。"));
            return;
        }
        if (ui.section === "overview")
            await overviewPage(token);
        else if (ui.section === "articles")
            await articlePage(token);
        else if (ui.section === "announcements" || ui.section === "surveys")
            await contentList(ui.section, token);
        else
            await metricsPage(token);
        if (token === ui.generation)
            main.querySelector<HTMLElement>("h1")?.focus();
    }
    catch (error) {
        if (token !== ui.generation)
            return;
        heading(sections.find(([id]) => id === ui.section)![1]);
        main.append(el("div", { class: "notice error", role: "alert" }, errorMessage(error)), taskButton("再試行", loadSection));
        if (!client.authorized)
            authBanner();
    }
}
