// Uni Pocket PWA entry point: renders the app shell, routes the location hash to
// screen modules and wires global listeners, local saving and the in-app updater.
import "./style.css";
import { refreshCurrentTime } from "./calendar-now-line";
import { enhanceControls, dismissPicker } from "./ui-controls";
import { icon, namedAuthor } from "./ui-assets";
import { api, type User } from "./api";
import { installUpdates } from "./update";
import {
  actions,
  action,
  attachShell,
  composing,
  data,
  errorBox,
  frozen,
  isBusy,
  page,
  pageEpoch,
  render,
  root,
  route,
  saves,
  setComposing,
  setData,
  setFrozen,
  setRenderer,
  setUpdates,
  store,
  updates,
} from "./app/context";
import { error, reportSaveFailure, save, statusText } from "./app/status";
import { dialog, submitting } from "./ui/modal";
import { renderHome } from "./screens/home";
import { renderTimetable } from "./screens/timetable";
import { renderCalendar } from "./screens/calendar";
import { renderNotes } from "./screens/notes";
import { community, loadArticles, renderArticles, renderArticleDetail, setUser, user } from "./screens/articles";
import { noticeUpdate, renderMore, reportUpdateFailure, theme } from "./screens/more";
import { editEvent } from "./screens/events";
let loadFailed = false;
async function flushOrThrow() {
  if (loadFailed)
    throw Error(
      "保存データを読み込めないため更新できません。原本を保護しています。",
    );
  if (isBusy() || submitting || composing || community.dirty)
    throw Error(
      "文字変換・画像処理・PDF取込・送信を終えてから更新してください。",
    );
  try {
    await saves.flush();
  } catch (e) {
    reportSaveFailure(e);
    throw e;
  }
  if (saves.dirty)
    throw Error("保存中に入力が変わりました。もう一度保存してください。");
}
function renderRoute() {
  const openDetails = [...page.querySelectorAll<HTMLDetailsElement>("details[id][open]")].map(d => d.id);
  const previousRoute = root.dataset.route;
  dismissPicker();
  pageEpoch.advance();
  actions.clear();
  action("dismiss-error", () => (errorBox.hidden = true));
  action("update", async () => {
    try {
      await updates.apply();
    } catch (e) {
      reportUpdateFailure(e);
    }
  });
  const r = route();
  root.dataset.route = r;
  document
    .querySelectorAll(".nav a")
    .forEach((a) => {
      const active = a.getAttribute("href") === "#" + r;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  page.innerHTML = "";
  if (r === "timetable") renderTimetable();
  else if (r === "calendar") renderCalendar();
  else if (r === "notes") renderNotes();
  else if (r === "articles") renderArticles();
  else if (r === "announcements") {
    const id = location.hash.split("/")[1];
    if (id) void community.renderAnnouncement(decodeURIComponent(id)); else void community.renderFeed();
  }
  else if (r === "surveys") void community.renderSurvey(decodeURIComponent(location.hash.split("/")[1] ?? ""));
  else if (r === "my-articles") void community.renderOwnArticles();
  else if (r === "more") renderMore();
  else renderHome();
  if (previousRoute === r) for (const id of openDetails) {
    const details = page.querySelector<HTMLDetailsElement>(`#${id}`);
    if (details) details.open = true;
  }
  theme();
  enhanceControls(page);
}
root.innerHTML = `<div class="background"></div><header class="top"><a href="#home" class="brand mutedlink">▣ Uni Pocket</a><span class="online" id="connection"></span></header><div id="error" class="notice error" role="alert" hidden></div><div class="page"><div class="statusline row between"><span id="save-status" role="status" aria-live="polite">データを読み込んでいます…</span><button id="save-retry" data-action="save-global" class="smallbtn" hidden>再試行</button></div><main id="page"></main></div><nav class="nav" aria-label="メインナビゲーション">${[
  ["home", "ホーム"],
  ["calendar", "予定表"],
  ["articles", "記事"],
  ["notes", "メモ"],
  ["more", "その他"],
]
  .map(
    ([id, t]) =>
      `<a href="#${id}"><span class="symbol" aria-hidden="true">${icon(id === "calendar" ? "timetable" : id)}</span>${t}</a>`,
  )
  .join("")}</nav>`;
attachShell();
setRenderer(renderRoute);
root.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  if (!button || frozen) return;
  const key = button.dataset.action!;
  if (key === "save-global") {
    void save();
    return;
  }
  const fn = actions.get(key);
  if (fn) Promise.resolve().then(fn).catch(error);
});
document.addEventListener("compositionstart", () => setComposing(true));
document.addEventListener("compositionend", () => {
  setComposing(false);
  updates?.activity();
});
document.addEventListener("focusout", () => updates?.activity());
let renderedHash = location.hash;
window.addEventListener("hashchange", () => {
  if (!community.leave()) { history.replaceState(null, "", renderedHash || "#home"); return; }
  if (dialog) {
    if (!dialog.dispatchEvent(new Event("requestclose", { cancelable: true }))) { history.replaceState(null, "", renderedHash || "#home"); return; }
    dialog.close();
  }
  renderedHash = location.hash;
  render();
});
let calendarResizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  clearTimeout(calendarResizeTimer);
  calendarResizeTimer = setTimeout(() => {
    if (route() !== "calendar") return;
    const previous = page.querySelector<HTMLElement>(".timeline-scroll");
    const top = previous?.scrollTop, left = previous?.scrollLeft;
    render();
    const current = page.querySelector<HTMLElement>(".timeline-scroll");
    if (current && top !== undefined) { current.scrollTop = top; current.scrollLeft = left ?? 0; }
  }, 100);
});
setInterval(() => {
  refreshCurrentTime(page, Date.now());
  if (route() === "home" && !dialog?.open) { render(); void community.refresh(); }
  else if (route() === "announcements" && !dialog?.open) render();
}, 60000);
window.addEventListener("beforeunload", (e) => {
  if (saves.dirty || isBusy() || submitting || community.dirty) {
    e.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && saves.dirty) void save();
  if (!document.hidden) {
    if (route() !== "announcements") void community.refresh();
    if (route() === "articles") {
      const id = location.hash.split("/")[1];
      if (id) void renderArticleDetail(id); else void loadArticles();
    } else if (!dialog?.open && !community.dirty && ["announcements", "my-articles"].includes(route())) render();
  }
});
const connection = () => {
  root.querySelector("#connection")!.textContent = navigator.onLine
    ? "オンライン"
    : "オフライン · 個人データは利用可能";
};
window.addEventListener("online", () => { connection(); if (route() === "announcements" && !dialog?.open) render(); else void community.refresh(); });
window.addEventListener("offline", connection);
connection();
async function boot() {
  try {
    setData(await store.open());
    statusText("この端末に保存済み");
  } catch (e) {
    loadFailed = true;
    error(e);
    statusText("保存データを保護中 · 再読み込みで再試行");
  }
  setUpdates(installUpdates({
    isIdle: () => !isBusy() && !submitting && !composing && !community.dirty && !dialog?.open &&
      !document.querySelector("dialog[open]") &&
      !document.activeElement?.matches("input, textarea, select, [contenteditable]:not([contenteditable=false])"),
    prepare: async () => {
      if (dialog?.open)
        throw Error(
          "開いている編集画面を保存するか閉じてから更新してください。",
        );
      await flushOrThrow();
    },
    freeze: (v) => {
      setFrozen(v);
      root.inert = v;
      if (dialog) dialog.inert = v;
    },
    notice: (message, ready) => {
      noticeUpdate(message, ready);
    },
    error: reportUpdateFailure,
  }));
  render();
  if (route() !== "announcements") void community.refresh();
  if (loadFailed) {
    page.inert = true;
  }
  if (data.eventDraft) editEvent(undefined, true);
  try {
    setUser((await api<{ user: User | null }>("/session")).user);
    const label = page.querySelector("#profile-name");
    if (label) label.textContent = namedAuthor(user?.displayName) ? user!.displayName : "未設定";
  } catch {
    /* Shared API availability never blocks personal features. */
  }
}
void boot();
