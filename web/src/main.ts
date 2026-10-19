import { MapViewport } from "./map-viewport";
import { setEventMemo, eventMemoText } from "./event-memos";
import { ViewEpoch, updateBookmark, appendUnique, BookmarkRequests } from "./article-request";
import { commitEvent } from "./event-editor";
import { submitNewArticle } from "./article-submit";
import "./style.css";
import { periods, weekPresentation, courseColor, updatePresentation } from "./schedule-presentation";
import { type CalendarMode, minutePixels, lectureEvents, initialCalendarMode, shiftCalendarDay, calendarDays, daySegments, overlapGroups, nextEvent, eventKind, initialScrollMinute } from "./calendar-presentation";
import { refreshCurrentTime } from "./calendar-now-line";
import { enhanceControls, dismissPicker } from "./ui-controls";
import { icon, backgrounds, visibleBackground, namedAuthor, noteHasContent } from "./ui-assets";
import {
  type Data,
  type Note,
  type CampusEvent,
  type Plan,
  type Facility,
  emptyData,
  uid,
  dayKey,
  addDay,
  weekDay,
  timeLabel,
  tokyo,
  events,
  onDay,
  courseID,
  originals,
  difference,
  install,
  parseHours,
  facilityHours,
} from "./domain";
import { LocalStore, SaveQueue } from "./storage";
import {
  api,
  session,
  notionURL,
  embedSource,
  type Article,
  type User,
} from "./api";
import { catalog, resolveRoom, mapCandidates } from "./map";
import { installUpdates } from "./update";
const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const btn = (label: string, action: string, cls = "") =>
  `<button type="button" class="${cls}" data-action="${esc(action)}">${label}</button>`;
const field = (
  name: string,
  label: string,
  value = "",
  type = "text",
  extra = "",
) =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const choice = (
  name: string,
  label: string,
  options: [string, string][],
  value: string,
) =>
  `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
const textfield = (name: string, label: string, value = "", max = 10000) =>
  `<label>${label}<textarea name="${name}" maxlength="${max}">${esc(value)}</textarea></label>`;
const empty = (s: string) => `<div class="empty">${esc(s)}</div>`;
const actions = new Map<string, () => unknown>();
const action = (name: string, fn: () => unknown) => actions.set(name, fn);
let data: Data = emptyData(),
  loadFailed = false,
  busy = 0,
  submitting = 0,
  composing = false,
  frozen = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  selectedDay = dayKey(),
  calendarMode: CalendarMode = initialCalendarMode(window.innerWidth),
  weekend = weekDay(selectedDay) > 5,
  user: User | null = null;
let page = document.createElement("main"),
  status: HTMLElement,
  errorBox: HTMLElement,
  dialog: HTMLDialogElement | undefined;
let memoSaveStatus: ((state: string, reason?: unknown) => void) | undefined;
let lastSaveError: unknown;
const store = new LocalStore();
const saves = new SaveQueue(store, () => data);
function error(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  errorBox.innerHTML = `${esc(message)} ${btn("閉じる", "dismiss-error", "smallbtn")}`;
  errorBox.hidden = false;
}
function statusText(s: string) {
  status.textContent = s;
  status.parentElement!.hidden = !/できません|保護中/.test(s);
}
function changed() {
  if (frozen) throw Error("更新の保存中です。少し待ってください。");
  saves.changed();
  memoSaveStatus?.("保存中");
  statusText("保存中…");
  root.querySelector<HTMLElement>("#save-retry")!.hidden = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 500);
}
async function save() {
  clearTimeout(saveTimer);
  try {
    statusText("保存中…");
    memoSaveStatus?.("保存中");
    await saves.flush();
    statusText(saves.dirty ? "保存中…" : "この端末に保存済み");
    memoSaveStatus?.(saves.dirty ? "保存中" : "保存済み");
    lastSaveError = undefined;
    root.querySelector<HTMLElement>("#save-retry")!.hidden = true;
    updates?.activity(true);
    return !saves.dirty;
  } catch (e) {
    reportSaveFailure(e);
    return false;
  }
}
function reportSaveFailure(e: unknown) {
  lastSaveError = e;
  memoSaveStatus?.("保存できません", e);
  statusText("保存できませんでした · 入力は保持しています");
  root.querySelector<HTMLElement>("#save-retry")!.hidden = false;
  const recovery = dialog?.querySelector<HTMLElement>("#note-save-recovery");
  if (recovery) recovery.hidden = false;
  error(e);
}
async function flushOrThrow() {
  if (loadFailed)
    throw Error(
      "保存データを読み込めないため更新できません。原本を保護しています。",
    );
  if (busy || submitting || composing)
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
function theme() {
  const themes: Record<string, string[]> = {
    green: ["#163e35", "#f6f7f2", "#223830", "#edf0e7", "#dceab9"],
    blue: ["#233f63", "#f2f5f9", "#22374d", "#e8eef6", "#d7e6fa"],
    rose: ["#663e50", "#faf4f6", "#493540", "#f3e8ed", "#f4dce7"],
    mono: ["#2e3339", "#f5f5f4", "#2e343b", "#e9ebed", "#e0e4ea"],
  };
  const [accent, paper, ink, soft, light] = themes[data.theme] ?? themes.green;
  for (const [k, v] of Object.entries({ accent, paper, soft, light }))
    document.documentElement.style.setProperty("--" + k, v);
  document.body.style.color = ink;
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute("content", accent);
  const bg = document.querySelector<HTMLElement>(".background")!;
  const image = visibleBackground(data);
  bg.style.backgroundImage = image ? `url("${image}")` : "";
}
function route() {
  return location.hash.slice(1).split("/")[0] || "home";
}
const pageEpoch = new ViewEpoch();
function render() {
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
  else if (r === "more") renderMore();
  else renderHome();
  if (previousRoute === r) for (const id of openDetails) {
    const details = page.querySelector<HTMLDetailsElement>(`#${id}`);
    if (details) details.open = true;
  }
  theme();
  enhanceControls(page);
}
function heading(title: string, sub = "静岡大学 · 浜松キャンパス", right = "") {
  return `<div class="heading"><div>${sub ? `<div class="eyebrow">${esc(sub)}</div>` : ""}<h1>${esc(title)}</h1></div><div class="row">${right}</div></div>`;
}
function navigate(destination: string) {
  if (route() === destination) render();
  else location.hash = destination;
}
function colorFor(e: CampusEvent) {
  const c = data.imports.flatMap(p => p.courses).find(c => c.id === courseID(data, e));
  return courseColor(c?.title || e.title);
}
function locationControl(location: string, key: string) {
  const r = resolveRoom(location);
  if (r.kind === "missing" || r.kind === "online") return `<span class="room">${esc(location || "場所未設定")}</span>`;
  const a = "location-" + key;
  action(a, () => showLocation(location));
  return btn(`${esc(location)} <span aria-hidden="true">↗</span>`, a, "room location-link");
}
function eventDate(e: CampusEvent) {
  const start = dayKey(new Date(e.start)), end = dayKey(new Date(e.end));
  return `${start}${e.allDay && dayKey(new Date(Date.parse(e.end) - 1)) !== start ? "–" + dayKey(new Date(Date.parse(e.end) - 1)) : ""} ${e.allDay ? "終日" : timeLabel(e.start) + "–" + (end === start ? "" : end + " ") + timeLabel(e.end)}`;
}
function compactEvent(e: CampusEvent) {
  action("event-" + e.id, () => showEvent(e));
  return `<div class="home-event"><span class="when">${e.allDay ? "終日" : timeLabel(e.start)}<small>${e.allDay ? "" : timeLabel(e.end) + " まで"}</small></span><div class="event-body"><button class="eventtitle" data-action="${esc("event-" + e.id)}"><strong>${esc(e.title)}</strong></button>${locationControl(e.location, "today-" + e.id)}${e.kind === "exam" ? '<span class="tag exam">試験・要確認</span>' : ''}</div></div>`;
}
let mapLocation = "", mapBuilding = "", mapFocusPending = false;
function showLocation(location: string) {
  const r = resolveRoom(location);
  if (["missing", "online"].includes(r.kind)) return;
  mapLocation = location;
  mapBuilding = r.kind === "matched" ? r.ids[0] : "";
  mapFocusPending = true;
  dialog?.close();
  navigate("home");
}
function homeMap() {
  const r = resolveRoom(mapLocation), b = catalog.buildings.find(b => b.id === mapBuilding);
  action("home-map", () => openMap());
  action("map-search", () => openMap(mapLocation));
  const candidates = r.kind === "ambiguous" ? r.ids.map(id => {
    const candidate = catalog.buildings.find(b => b.id === id)!;
    const a = "map-select-" + id;
    action(a, () => { mapBuilding = id; mapFocusPending = true; render(); });
    return btn(esc(candidate.name), a, id === mapBuilding ? "primary" : "");
  }).join("") : "";
  return `<section class="section card home-map"><div class="sectiontitle"><h2 id="campus-map-heading" tabindex="-1">キャンパスマップ</h2>${btn("拡大・検索", "home-map", "smallbtn")}</div>${mapLocation ? `<div class="map-result" role="status"><b>${esc(mapLocation)}</b><p>${b ? `${esc(b.name)} · 建物の位置` : r.kind === "ambiguous" ? "複数候補があります。建物を選択してください。" : "場所を特定できません。元の場所名を確認し、建物を検索してください。"}</p>${candidates ? `<div class="row">${candidates}</div>` : ""}${!b && r.kind !== "ambiguous" ? btn("建物を検索", "map-search", "smallbtn") : ""}</div>` : ""}<div class="mapwrap home-map-image"><button class="map-preview" data-action="home-map" aria-label="キャンパスマップを拡大して建物・教室を検索"><img src="/campus-map.png" alt="浜松キャンパスの地図" loading="lazy"></button><svg viewBox="${catalog.viewBox.join(" ")}" role="img" aria-label="${esc(b ? b.name + 'の建物の位置' : '建物の選択なし')}">${b ? `${b.mapPolygon.length ? `<polygon points="${b.mapPolygon.map(p => p.join(",")).join(" ")}"/>` : ""}<circle cx="${b.mapCenter[0]}" cy="${b.mapCenter[1]}" r="13"/>` : ""}</svg></div>${mapLocation ? `<p class="muted">建物座標による概略位置です。教室内の位置は示していません。</p>` : ""}</section>`;
}
function renderHome() {
  const today = dayKey(), all = events(data), todayEvents = all.filter(e => onDay(e, today)), now = new Date(), next = nextEvent(all, now.getTime());
  action("home-import", openImport);
  action("event-new", () => { selectedDay = today; editEvent(); });
  action("home-timetable", () => { selectedDay = today; weekend = weekDay(today) > 5; navigate("timetable"); });
  if (next) action("event-" + next.id, () => showEvent(next));
  page.innerHTML = heading("ホーム", "", btn("＋ 予定", "event-new", "timetable-entry")) +
    `<div class="date-line"><strong>${esc(new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Tokyo" }).format(now))}</strong>${btn(icon('clock') + ' 時間割を見る', "home-timetable", "timetable-entry")}</div>` +
    (next ? `<section class="next-preview"><button class="next-main" data-action="${esc("event-" + next.id)}"><span class="next-caption">${Date.parse(next.start) <= now.getTime() ? "いまの予定" : "次の予定"} · ${esc(dayKey(new Date(next.start)) === today ? "今日" : dayKey(new Date(next.start)))}</span><span class="next-time">${esc(timeLabel(next.start))}<small>–${esc(timeLabel(next.end))}</small></span><strong>${esc(next.title)}</strong></button>${locationControl(next.location, "next-" + next.id)}</section>` : `<p class="next-preview no-next">次の予定はありません。</p>`) +
    `<section class="today-schedule"><div class="sectiontitle"><h2>今日の予定 <span class="tag">${todayEvents.length}件</span></h2></div><div class="home-events">${todayEvents.map(compactEvent).join("") || empty("今日の予定はありません。")}</div>${!all.length ? `<p class="import-hint">${btn("時間割PDFを取り込む", "home-import")}</p>` : ""}</section>
    <details id="home-facilities" class="home-extra"><summary>キャンパスの営業時間</summary><p class="muted">通常期の目安です。臨時変更は公式情報で確認してください。</p>${data.facilities.slice(0, 4).map(f => `<p><b>${esc(f.title)}</b> · ${esc(facilityHours(f, today) || "休業")}</p>`).join("")}<a href="#more">施設を設定 →</a></details>
    <section class="section"><h2>固定したメモ</h2><div class="cards">${data.notes.filter(n => data.pinned.includes(n.id)).map(noteCard).join("") || empty("メモを固定するとここに表示されます。")}</div></section>
    ${homeMap()}
    <section class="section"><h2>よく使うリンク</h2><div class="row">${data.links.filter(l => l.favorite).map(l => `<a class="card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ↗</a>`).join("") || '<a href="#more">リンクのお気に入りを設定 →</a>'}</div></section>`;
  if (mapFocusPending) {
    mapFocusPending = false;
    requestAnimationFrame(() => {
      const target = page.querySelector<HTMLElement>("#campus-map-heading");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  }
}
function showEvent(e: CampusEvent) {
  const canMap = !["missing", "online"].includes(resolveRoom(e.location).kind);
  const d = modal(e.title, `<div class="event-meta">${esc(eventDate(e))}<div class="detail-location">${canMap ? `<button type="button" id="detail-map" class="location-link">${esc(e.location)} ↗</button>` : esc(e.location || "場所未設定")}</div></div><label class="event-memo-label" for="event-memo">この予定のメモ</label><textarea id="event-memo" maxlength="5000" rows="10">${esc(eventMemoText(data, e.id))}</textarea><div class="memo-save-line"><span id="event-memo-status" role="status" aria-live="polite">保存済み</span><span id="event-memo-count">${eventMemoText(data, e.id).length} / 5000</span></div><div id="event-memo-recovery" class="notice error" hidden><p id="event-memo-error"></p><button type="button" id="event-memo-retry">再試行</button><button type="button" id="event-memo-export">入力を書き出す</button></div><button type="button" id="detail-edit" class="text-action">予定を編集</button>`, undefined, "保存", { singleClose: true, className: "event-detail" });
  const form = d.querySelector("form")!, input = d.querySelector<HTMLTextAreaElement>("#event-memo")!;
  const status = (state: string, reason?: unknown) => {
    d.querySelector("#event-memo-status")!.textContent = state;
    const recovery = d.querySelector<HTMLElement>("#event-memo-recovery")!;
    recovery.hidden = state !== "保存できません";
    if (reason) d.querySelector("#event-memo-error")!.textContent = reason instanceof Error ? reason.message : String(reason);
  };
  memoSaveStatus = status;
  if (saves.dirty) status(lastSaveError ? "保存できません" : "保存中", lastSaveError);
  input.oninput = () => {
    setEventMemo(data, e.id, input.value);
    d.querySelector("#event-memo-count")!.textContent = `${input.value.length} / 5000`;
    changed();
  };
  let leaving = false;
  const leave = async (next: () => void = () => { d.close(); render(); }) => {
    if (leaving || composing || frozen) return;
    leaving = true;
    form.inert = true;
    submitting++;
    try {
      if (await save()) next();
    } finally {
      submitting--;
      form.inert = false;
      leaving = false;
      updates?.activity();
    }
  };
  d.addEventListener("requestclose", ev => { ev.preventDefault(); void leave(); });
  d.addEventListener("cancel", ev => { ev.preventDefault(); void leave(); });
  d.addEventListener("close", () => { if (memoSaveStatus === status) memoSaveStatus = undefined; });
  d.querySelector("#detail-map")?.addEventListener("click", () => void leave(() => showLocation(e.location)));
  d.querySelector("#detail-edit")!.addEventListener("click", () => void leave(() => editEvent(e)));
  d.querySelector<HTMLButtonElement>("#event-memo-retry")!.onclick = () => void save();
  d.querySelector<HTMLButtonElement>("#event-memo-export")!.onclick = exportData;
}

function eventChooser(title: string, all: CampusEvent[]) {
  const d = modal(title, `<div class="stack">${all.map((e, i) => `<button type="button" data-choose="${i}"><b>${esc(e.title)}</b><br><small>${esc(eventKind(e))} · ${esc(eventDate(e))}<br>${esc(e.location || "場所未設定")}</small></button>`).join("")}</div>`);
  d.querySelectorAll<HTMLButtonElement>("[data-choose]").forEach(b => b.onclick = () => showEvent(all[Number(b.dataset.choose)]));
}
function dateTools(label: string) {
  return `<div class="date-tools"><button data-action="prev-date" aria-label="前の${label}">‹</button><label class="date-picker"><span>${esc(label === "月" ? selectedDay.slice(0, 7) : label === "週" ? addDay(selectedDay, 1 - weekDay(selectedDay)).slice(5) + "–" + addDay(selectedDay, 7 - weekDay(selectedDay)).slice(5) : selectedDay)}</span><input type="date" id="selected-day" value="${selectedDay}" aria-label="表示日を選ぶ"></label><button data-action="next-date" aria-label="次の${label}">›</button>${btn("今日", "today", "smallbtn")}</div>`;
}
function bindDatePicker() {
  page.querySelector("#selected-day")?.addEventListener("change", e => {
    const value = (e.target as HTMLInputElement).value;
    if (value) { selectedDay = value; weekend = weekDay(value) > 5; render(); }
  });
}
function renderTimetable() {
  action("prev-date", () => { selectedDay = addDay(selectedDay, -7); render(); });
  action("next-date", () => { selectedDay = addDay(selectedDay, 7); render(); });
  action("today", () => { selectedDay = dayKey(); weekend = weekDay(selectedDay) > 5; render(); });
  action("import", openImport);
  action("weekdays", () => { weekend = false; render(); });
  action("weekend", () => { weekend = true; render(); });
  action("event-new", () => { window.addEventListener("hashchange", () => editEvent(), { once: true }); navigate("calendar"); });
  action("event-resume", () => editEvent(undefined, true));
  const all = lectureEvents(events(data)), week = weekPresentation(all, selectedDay, weekend), next = nextEvent(all);
  const courses = data.imports.flatMap(p => p.courses);
  const content = `<div class="week-surface"><div class="week-grid ${weekend ? "weekend" : ""}" role="group" aria-label="曜日とコマの講義専用時間割"><div></div>${week.days.map(day => `<div class="day-heading ${day === dayKey() ? "today" : ""}"><b>${"月火水木金土日"[weekDay(day) - 1]}</b><span>${Number(day.slice(-2))}</span></div>`).join("")}${periods.map(([start, end], index) => `<div class="period"><b>${index + 1}</b><small>${start}<br>${end}</small></div>${week.cells[index].map((cell, dayIndex) => {
    const e = cell[0], a = `cell-${index}-${dayIndex}`;
    if (!e) return `<div class="course-cell empty-cell" aria-label="${week.days[dayIndex]} ${index + 1}コマ 空き">—</div>`;
    action(a, () => cell.length === 1 ? showEvent(e) : eventChooser("同じコマの授業・試験", cell));
    return `<button class="course-cell ${colorFor(e)} ${cell.some(e => e.id === next?.id) ? "next-course" : ""}" data-action="${a}" aria-label="${esc(week.days[dayIndex] + ' ' + (index + 1) + 'コマ ' + cell.map(e => eventKind(e) + ' ' + e.title + ' ' + e.location).join('、'))}">${cell.length > 1 ? `<span class="overlap-count">${cell.length}件</span>` : ""}${cell.some(e => e.id === next?.id) ? '<span class="next-course-label">次の授業</span>' : ''}<span class="cell-name">${e.kind === "exam" ? "試験・要確認 " : ""}${esc(e.title)}</span><span class="cell-room">${esc(e.location || "場所未設定")}</span></button>`;
  }).join("")}`).join("")}</div></div>${week.other.length ? `<section class="other-events"><h2>コマ外の授業・試験 <span class="tag">${week.other.length}件</span></h2>${week.other.map(e => { action("event-" + e.id, () => showEvent(e)); return `<button class="other-event" data-action="${esc("event-" + e.id)}"><strong>${esc(eventKind(e))} · ${esc(e.title)}</strong><span>${esc(eventDate(e))} · ${esc(e.location || "場所未設定")}</span></button>`; }).join("")}</section>` : ""}`;
  page.innerHTML = heading("時間割", "", btn("＋ 予定", "event-new", "primary") + `<details class="schedule-menu"><summary aria-label="時間割メニュー">⋯</summary><div>${btn("PDF取込", "import")}${data.eventDraft ? btn("予定の下書きを再開", "event-resume") : ""}</div></details>`) +
    `<div class="schedule-links"><a href="#home">‹ ホームへ</a><a href="#calendar">予定表へ ›</a></div><div class="view-tools"><span class="muted">授業・試験</span><div class="week-kind"><button data-action="weekdays" aria-pressed="${!weekend}">平日</button><button data-action="weekend" aria-pressed="${weekend}">土日${week.weekendCount ? `<span class="tag">${week.weekendCount}</span>` : ""}</button></div></div>${dateTools("週")}${!all.length ? empty("講義が未登録です。時間割PDFを取り込んでください。") : !all.some(e => calendarDays(selectedDay, "week").some(day => onDay(e, day))) ? '<p class="muted">この週の授業・試験はありません。</p>' : ""}${content}${!courses.length ? `<p class="import-hint">${btn("時間割PDFを取り込む", "import", "smallbtn")}</p>` : ""}
    <details id="registered-courses" class="schedule-fold"><summary>登録した講義 <span class="tag">${courses.length}</span></summary><p class="muted">講義を開くと関連記事を表示します。</p><div class="stack">${courses.map(c => `<button data-course="${esc(c.id)}">${esc(c.title)} <small>${c.weekday ? "月火水木金土日"[c.weekday - 1] + " " + ((c.block ?? 0) + 1) + "コマ" : "時間未定"}</small></button>`).join("") || '<p class="muted">PDFを取り込むと講義が表示されます。</p>'}</div></details>
    ${data.showBands ? `<details id="timetable-facilities" class="schedule-fold"><summary>施設の営業時間</summary><p class="muted">通常期の目安です。臨時変更は公式情報で確認してください。</p>${week.days.map(day => `<h3>${esc(day)}</h3>${data.facilities.filter(f => f.band).map(f => `<p class="muted">${esc(f.title)} · ${esc(facilityHours(f, day) || "休業")}</p>`).join("")}`).join("")}</details>` : ""}<details id="personal-edits" class="schedule-fold"><summary>取消・個人修正の管理</summary>${[...data.courseEdits, ...data.occurrenceEdits].map(x => {
      const a = "reset-" + x.id;
      action(a, () => { data.courseEdits = data.courseEdits.filter(e => e.id !== x.id); data.occurrenceEdits = data.occurrenceEdits.filter(e => e.id !== x.id); changed(); render(); });
      return `<p>${esc(x.title || x.id)} ${x.cancelled ? "取消" : ""} ${btn("修正を解除", a, "smallbtn")}</p>`;
    }).join("") || "<p>個人修正はありません。</p>"}</details>`;
  bindDatePicker();
  page.querySelectorAll<HTMLElement>("[data-course]").forEach(b => b.onclick = () => { articleFilters.courseId = b.dataset.course!; location.hash = "articles"; });
}
function renderCalendar() {
  const mode = calendarMode, all = events(data), days = calendarDays(selectedDay, mode);
  action("prev-date", () => { selectedDay = shiftCalendarDay(selectedDay, mode, -1); render(); });
  action("next-date", () => { selectedDay = shiftCalendarDay(selectedDay, mode, 1); render(); });
  action("today", () => { selectedDay = dayKey(); render(); });
  action("event-new", () => editEvent());
  action("event-resume", () => editEvent(undefined, true));
  for (const v of ["day", "three", "week", "month"] as CalendarMode[]) action("calendar-" + v, () => { calendarMode = v; render(); });
  const labels: Record<CalendarMode, string> = { day: "日", three: "3日", week: "週", month: "月" };
  let content: string;
  if (mode === "month") {
    content = `<div class="month-calendar" role="group" aria-label="${esc(selectedDay.slice(0, 7))}の月予定表">${[..."月火水木金土日"].map(d => `<div class="month-weekday">${d}</div>`).join("")}${days.map(day => {
      const current = all.filter(e => onDay(e, day)), a = "month-" + day, c = "month-list-" + day;
      action(a, () => { selectedDay = day; calendarMode = "day"; render(); });
      action(c, () => eventChooser(day + " の予定", current));
      return `<div class="month-day ${day.slice(0, 7) !== selectedDay.slice(0, 7) ? "outside-month" : ""} ${day === dayKey() ? "today" : ""}"><button class="month-date" data-action="${a}" aria-label="${day}の時間軸を開く">${Number(day.slice(-2))}</button>${current.length ? `<button class="month-count" data-action="${c}" aria-label="${day}の${current.length}件をすべて確認">${current.length}件<span>${current.slice(0, 2).map(e => `<small>${esc((e.allDay ? "終日 " : timeLabel(e.start) + " ") + e.title)}</small>`).join("")}</span></button>` : '<span class="month-empty">予定なし</span>'}</div>`;
    }).join("")}</div>`;
  } else {
    const estimatedWidth = Math.max(84, ((page.clientWidth || window.innerWidth - 24) - 46) / days.length);
    const columnWidth = mode === "week" ? Math.max(120, estimatedWidth) : estimatedWidth;
    const maxColumns = Math.max(1, Math.floor(columnWidth / 48));
    content = `<div class="timeline-scroll" tabindex="0" aria-label="00時から24時の予定表。縦に時間、横に日付。"><div class="timeline ${mode === "week" ? "full-week" : ""}" style="--day-count:${days.length}"><div class="timeline-top"><div class="timeline-head"><span class="time-corner">時刻</span>${days.map(day => `<div class="timeline-date ${day === dayKey() ? "today" : ""}" data-day="${day}"><b>${Number(day.slice(5, 7))}/${Number(day.slice(-2))}</b><span>${"月火水木金土日"[weekDay(day) - 1]}</span></div>`).join("")}</div><div class="all-day-row"><span class="all-day-label">終日</span>${days.map(day => `<div>${all.filter(e => e.allDay && onDay(e, day)).map(e => { const a = "event-" + e.id; action(a, () => showEvent(e)); return `<button class="all-day-event ${colorFor(e)}" data-action="${esc(a)}">${esc(eventKind(e))} · ${esc(e.title)}</button>`; }).join("") || '<span aria-label="終日予定なし">—</span>'}</div>`).join("")}</div></div><div class="timeline-body"><div class="time-axis">${Array.from({ length: 49 }, (_, i) => `<span style="top:${i * 30 * minutePixels}px">${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}</span>`).join("")}</div>${days.map(day => {
      const groups = overlapGroups(daySegments(all, day));
      return `<div class="timeline-day" data-day="${day}">${Array.from({ length: 48 }, (_, i) => {
        const a = `slot-${day}-${i}`, time = String(Math.floor(i / 2)).padStart(2, "0") + (i % 2 ? ":30" : ":00");
        action(a, () => { selectedDay = day; editEvent(undefined, false, tokyo(day, time)); });
        return `<button class="time-slot" data-action="${a}" style="top:${i * 30 * minutePixels}px" aria-label="${day} ${time}に個人予定を追加"></button>`;
      }).join("")}${groups.map((group, index) => {
        if (group.columns > maxColumns) {
          const a = `density-${day}-${index}`;
          action(a, () => eventChooser(day + " この時間の予定", group.segments.map(s => s.event)));
          return `<button class="dense-events" data-action="${a}" style="top:${group.start * minutePixels}px;height:${Math.max(44, (group.end - group.start) * minutePixels)}px"><b>この時間に${group.segments.length}件</b><small>${minuteLabel(group.start)}–${minuteLabel(group.end)}</small></button>`;
        }
        return group.segments.map(s => {
          const a = "event-" + s.event.id;
          action(a, () => showEvent(s.event));
          const duration = (s.end - s.start) * minutePixels;
          return `<button class="timeline-event ${colorFor(s.event)} ${duration < 44 ? "short-event" : ""}" data-action="${esc(a)}" style="top:${s.start * minutePixels}px;height:${Math.max(44, duration)}px;left:calc(${100 * s.column / group.columns}% + 2px);width:calc(${100 / group.columns}% - 4px);--real-height:${duration}px" aria-label="${esc(eventKind(s.event) + ' ' + s.event.title + ' ' + eventDate(s.event) + ' ' + s.event.location)}"><span class="duration-marker" aria-hidden="true"></span><small>${s.continuesBefore ? "前日から " : ""}${minuteLabel(s.start)}–${minuteLabel(s.end)}${s.continuesAfter ? " 翌日へ" : ""}</small><strong>${esc(s.event.title)}</strong><span class="timeline-kind">${esc(eventKind(s.event))}${s.event.location ? ' · ' + esc(s.event.location) : ''}</span></button>`;
        }).join("");
      }).join("")}${day === dayKey() ? `<div class="now-line" style="top:${((Date.now() - Date.parse(tokyo(day))) / 60000) * minutePixels}px" aria-label="現在時刻"></div>` : ""}</div>`;
    }).join("")}</div></div></div>`;
  }
  page.innerHTML = heading("予定表", "", btn("＋ 予定", "event-new", "primary") + `<details class="schedule-menu"><summary aria-label="予定表メニュー">⋯</summary><div><a href="#timetable">時間割を開く</a>${data.eventDraft ? btn("予定の下書きを再開", "event-resume") : ""}</div></details>`) + `<div class="view-tools"><div class="seg">${(["day", "three", "week", "month"] as CalendarMode[]).map(v => `<button data-action="calendar-${v}" class="${v === mode ? "selected" : ""}" aria-pressed="${v === mode}">${labels[v]}</button>`).join("")}</div></div>${dateTools(labels[mode])}${mode === "week" ? '<p class="calendar-hint">横にスクロールして全曜日を表示</p>' : ""}${content}`;
  bindDatePicker();
  const scroller = page.querySelector<HTMLElement>(".timeline-scroll");
  if (scroller) {
    const minute = initialScrollMinute(all, days, Date.now(), data.startHour);
    scroller.scrollTop = Math.max(0, (minute - 60) * minutePixels);
  }
}
function minuteLabel(value: number) {
  return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(Math.floor(value % 60)).padStart(2, "0");
}
function modal(
  title: string,
  content: string,
  submit?: (form: HTMLFormElement) => Promise<void> | void,
  submitText = "保存",
  options: { singleClose?: boolean; className?: string } = {},
) {
  if (dialog) {
    dialog.close();
    dialog.remove();
  }
  dialog = document.createElement("dialog");
  dialog.className = "modal " + (options.className ?? "");
  dialog.innerHTML = `<form><div class="modal-heading"><h2>${esc(title)}</h2><button type="button" data-close aria-label="${options.className === "map-modal" ? "地図を閉じる" : "閉じる"}">×</button></div>${content}<div role="alert" class="modal-error error notice" hidden></div>${options.singleClose ? "" : `<div class="footer"><button type="button" data-close>閉じる</button>${submit ? `<button class="primary" type="submit">${esc(submitText)}</button>` : ""}</div>`}</form>`;
  document.body.append(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => {
      if (current.dispatchEvent(new Event("requestclose", { cancelable: true }))) current.close();
    }));
  const current = dialog;
  if (!submit) current.querySelector("form")!.onsubmit = e => e.preventDefault();
  current.addEventListener("close", () => {
    current.remove();
    if (dialog === current) dialog = undefined;
    updates?.activity();
  });
  if (submit)
    dialog.querySelector("form")!.onsubmit = async (e) => {
      e.preventDefault();
      if (frozen) return;
      const form = e.currentTarget as HTMLFormElement,
        button = form.querySelector<HTMLButtonElement>("[type=submit]")!;
      if (button.disabled) return;
      button.disabled = true;
      form.inert = true;
      submitting++;
      try {
        await submit(form);
      } catch (e) {
        const box = form.querySelector<HTMLElement>(".modal-error")!;
        box.hidden = false;
        box.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        submitting--;
        updates?.activity();
        button.disabled = false;
        form.inert = false;
      }
    };
  enhanceControls(dialog);
  dialog.showModal();
  return dialog;
}
const val = (f: HTMLFormElement, key: string) =>
  String(new FormData(f).get(key) ?? "");
function dateTimeValue(iso: string) {
  return dayKey(new Date(iso)) + "T" + timeLabel(iso);
}
function editEvent(event?: CampusEvent, resume = false, initialStart?: string) {
  if (
    !resume &&
    data.eventDraft &&
    data.eventDraft.event.id !== event?.id &&
    !confirm("保存済みの予定下書きを新しい編集に切り替えますか？")
  )
    return;
  if (resume && data.eventDraft) event = data.eventDraft.event;
  const existing = event
    ? originals(data).some((x) => x.id === event!.id)
    : false;
  const e = event ?? {
      id: "manual:" + uid(),
      title: "",
      start: initialStart ?? tokyo(selectedDay, "09:00"),
      end: initialStart ? new Date(Date.parse(initialStart) + 3600000).toISOString() : tokyo(selectedDay, "10:00"),
      location: "",
      kind: "personal",
      allDay: false,
    },
    cid = event ? courseID(data, e) : undefined;
  const d = modal(
    existing ? "予定の個人修正" : "個人予定を追加",
    field("title", "タイトル", e.title, "text", 'required maxlength="200"') +
      field(
        "start",
        "開始",
        dateTimeValue(e.start),
        "datetime-local",
        "required",
      ) +
      field("end", "終了", dateTimeValue(e.end), "datetime-local", "required") +
      field("location", "教室・場所", e.location) +
      `<label class="check"><input name="allDay" type="checkbox" ${e.allDay ? "checked" : ""}>終日</label>` +
      (cid
        ? choice(
            "scope",
            "適用範囲",
            [
              ["occurrence", "この1回"],
              ["course", "この講義の全日程"],
            ],
            "occurrence",
          )
        : "") +
      (existing
        ? '<label class="check"><input name="cancelled" type="checkbox">この範囲を取消</label>'
        : "") +
      `<div class="row">${btn("教室を地図で確認", "event-map")}${event ? btn("関連記事", "event-articles") : ""}</div><p class="muted">PDF原本は保持し、個人修正を重ねます。講義全体の時刻修正は各日の時刻に適用します。</p>`,
    async (form) => {
      const start = tokyo(
          val(form, "start").slice(0, 10),
          val(form, "start").slice(11),
        ),
        end = tokyo(val(form, "end").slice(0, 10), val(form, "end").slice(11));
      await commitEvent(
        data,
        e,
        existing,
        cid,
        {
          title: val(form, "title"),
          location: val(form, "location"),
          start,
          end,
          allDay: new FormData(form).has("allDay"),
          cancelled: new FormData(form).has("cancelled"),
          scope: val(form, "scope") === "course" ? "course" : "occurrence",
        },
        { changed, save },
      );
      d.close();
      render();
    },
  );
  d.dataset.draft = "true";
  const form = d.querySelector("form")!;
  if (resume && data.eventDraft) {
    for (const [name, value] of Object.entries(data.eventDraft.values)) {
      const input = form.elements.namedItem(name) as
        | HTMLInputElement
        | HTMLSelectElement
        | null;
      if (input) {
        if (input instanceof HTMLInputElement && input.type === "checkbox")
          input.checked = value === "true";
        else input.value = value;
        if (input instanceof HTMLSelectElement) input.dispatchEvent(new Event("change"));
      }
    }
  }
  const capture = () => {
    const values: Record<string, string> = {};
    for (const input of form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("[name]"))
      values[input.name] =
        input instanceof HTMLInputElement && input.type === "checkbox"
          ? String(input.checked)
          : input.value;
    data.eventDraft = { event: structuredClone(e), values };
    changed();
  };
  form.addEventListener("input", capture);
  form.addEventListener("change", capture);
  d.querySelector("[data-action=event-map]")?.addEventListener("click", () => {
    const room = (d.querySelector("[name=location]") as HTMLInputElement).value;
    capture();
    showLocation(room);
  });
  d.querySelector("[data-action=event-articles]")?.addEventListener(
    "click",
    () => {
      d.close();
      articleFilters.courseId = cid ?? "";
      location.hash = "articles";
    },
  );
}
async function openImport() {
  const d = modal(
    "PDFから時間割を取り込む",
    `<p>既知の後期「履修登録確認票」と通常課程「年間行事予定表」の文字を含む原本が対象です。PDFはこのブラウザ内だけで解析します。</p><label>履修登録確認票<input name="registration" type="file" accept="application/pdf,.pdf" required></label><label>年間行事予定表<input name="annual" type="file" accept="application/pdf,.pdf" required></label><p class="muted">前期・夜間主・画像PDF・未知形式は未対応です。取込前に差分と個人修正の競合を確認します。</p>`,
    async (form) => {
      const r = (form.elements.namedItem("registration") as HTMLInputElement)
          .files?.[0],
        a = (form.elements.namedItem("annual") as HTMLInputElement).files?.[0];
      if (!r || !a) throw Error("2つのPDFを選択してください。");
      busy++;
      try {
        const { previewPDF } = await import("./pdf");
        const p = await previewPDF(r, a);
        d.close();
        showImport(p);
      } finally {
        busy--;
        updates?.activity();
      }
    },
    "解析して差分を確認",
  );
}
function showImport(p: Plan) {
  const diffs = difference(data, p),
    d = modal(
      "取込内容の確認",
      `<p>${p.year}年度 後期 · 講義 ${p.courses.length}件 · 予定 ${p.events.length}件 · 差分 ${diffs.length}件</p>${p.warnings.map((s) => `<p class="muted">${esc(s)}</p>`).join("")}<div class="stack">${
        diffs
          .map(
            (x) =>
              `<div class="card"><span class="tag">${x.before ? (x.after ? "変更" : "削除") : "追加"}</span><b> ${esc((x.after ?? x.before)!.title)}</b><p class="muted">${esc(x.before ? dayKey(new Date(x.before.start)) + " " + timeLabel(x.before.start) + " " + x.before.location : "新規")} → ${esc(x.after ? dayKey(new Date(x.after.start)) + " " + timeLabel(x.after.start) + " " + x.after.location : "原本から削除")}</p>${
                x.conflict
                  ? choice(
                      x.id,
                      "個人修正と競合しています",
                      [
                        ["", "選択してください"],
                        ["personal", "個人修正を保持"],
                        ["pdf", "PDF原本を採用"],
                      ],
                      "",
                    )
                  : ""
              }</div>`,
          )
          .join("") || empty("原本の変更はありません。")
      }</div>`,
      async (form) => {
        const choices: Record<string, "personal" | "pdf"> = {};
        for (const x of diffs.filter((x) => x.conflict)) {
          const value = val(form, x.id);
          if (value !== "personal" && value !== "pdf")
            throw Error("競合をすべて選択してください。");
          choices[x.id] = value;
        }
        data = install(data, p, choices);
        changed();
        if (!(await save()))
          throw Error("保存に失敗しました。差分は保持しています。");
        d.close();
        render();
      },
      "この内容を保存",
    );
}
function noteCard(n: Note) {
  const a = "note-" + n.id;
  action(a, () => editNote(n.id));
  return `<article class="card note ${esc(n.color)}"><div class="row between"><button class="article-title" data-action="${esc(a)}">${data.pinned.includes(n.id) ? '<span class="pin">◆ </span>' : ""}${esc(n.text.split("\n")[0] || n.checklist.find((c) => c.text)?.text || "画像メモ")}</button><span class="muted">${dayKey(new Date(n.modified)).slice(5)}</span></div><p>${esc(n.text.split("\n").slice(1).join("\n").slice(0, 200))}</p>${n.checklist
    .slice(0, 4)
    .map(
      (c) =>
        `<div class="check ${c.done ? "done" : ""}"><span>${c.done ? "☑" : "☐"} ${esc(c.text)}</span></div>`,
    )
    .join("")}<div class="thumbs">${n.images
    .slice(0, 3)
    .map(
      (i) => `<img src="${esc(i.data)}" alt="メモの添付画像" loading="lazy">`,
    )
    .join("")}</div></article>`;
}
let noteQuery = "";
function renderNotes() {
  action("note-new", () => {
    const n: Note = {
      id: uid(),
      text: "",
      color: "default",
      modified: new Date().toISOString(),
      images: [],
      checklist: [],
    };
    editNote(n.id, n);
  });
  const q = noteQuery.toLocaleLowerCase(),
    notes = data.notes
      .filter((n) =>
        (n.text + " " + n.checklist.map((c) => c.text).join(" "))
          .toLocaleLowerCase()
          .includes(q),
      )
      .sort(
        (a, b) =>
          Number(data.pinned.includes(b.id)) -
            Number(data.pinned.includes(a.id)) ||
          b.modified.localeCompare(a.modified),
      );
  page.innerHTML =
    heading("メモ", "MY NOTES", btn("＋ 新しいメモ", "note-new", "primary")) +
    `<div class="toolbar"><input id="note-search" type="search" placeholder="メモとチェック項目を検索" value="${esc(noteQuery)}" aria-label="メモ検索"></div><div class="cards">${notes.map(noteCard).join("") || empty(noteQuery ? "該当するメモはありません。" : "メモはまだありません。文章、写真、チェックリストを保存できます。")}</div>`;
  page.querySelector("#note-search")!.addEventListener("input", (e) => {
    noteQuery = (e.target as HTMLInputElement).value;
    const position = (e.target as HTMLInputElement).selectionStart;
    render();
    const input = page.querySelector<HTMLInputElement>("#note-search")!;
    input.focus();
    input.setSelectionRange(position, position);
  });
}
async function imageData(file: File): Promise<string> {
  if (file.size > 40 * 1024 * 1024)
    throw Error("画像は40MB以内で選択してください。");
  if (
    !/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type) &&
    !/\.(heic|heif)$/i.test(file.name)
  )
    throw Error("PNG・JPEG・WebP、対応ブラウザのHEICを選択してください。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw Error(
        "このブラウザでは画像を読み取れません。HEICはJPEG・PNGに変換して選択してください。",
      );
    });
    if (!img.width || !img.height || img.width > 20000 || img.height > 20000)
      throw Error("画像のサイズが対応範囲外です。");
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
function editNote(id: string, fresh?: Note) {
  const n = fresh ?? data.notes.find((n) => n.id === id)!;
  let notePinned = data.pinned.includes(id);
  const d = modal(
    "メモ",
    `<div class="note-top"><button type="button" id="note-pin" class="icon-button" aria-label="ホームに固定" aria-pressed="${data.pinned.includes(id)}">${icon("pin")}</button></div><textarea name="text" class="note-body" aria-label="メモ本文" placeholder="メモを入力…" maxlength="10000">${esc(n.text)}</textarea><div class="checks stack"></div><div class="thumbs attachments"></div><div id="note-palette" class="note-palette" role="group" aria-label="メモの色" hidden>${[["default", "標準"], ["yellow", "イエロー"], ["green", "グリーン"], ["pink", "ピンク"], ["blue", "ブルー"]].map(([value, label]) => `<button type="button" data-color="${value}" class="swatch ${value}" aria-label="${label}" aria-pressed="${value === n.color}"></button>`).join("")}</div><div id="note-more-menu" class="note-more-menu" hidden><button type="button" id="delete-note" class="danger">このメモを削除</button><p class="muted">入力は端末内に自動保存します。HEICはブラウザにより変換が必要です。</p></div><input id="note-images" class="file-native" data-toolbar="true" tabindex="-1" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" multiple><span id="note-file-name" class="muted" role="status"></span><div id="note-save-recovery" class="notice error" hidden><p>入力はこの画面に保持しています。再試行しても保存できない場合は、入力データを書き出してからブラウザを再読み込みしてください。書き出しには現在のメモ・画像・チェック項目も含まれます。</p><button type="button" id="note-export-data">入力データを書き出す</button></div><div class="note-tools"><button type="button" id="add-image" class="icon-button" aria-label="画像を追加">${icon("image")}</button><button type="button" id="add-check" class="icon-button" aria-label="チェック項目を追加">${icon("check")}</button><button type="button" id="note-color" class="icon-button" aria-label="色を選ぶ" aria-expanded="false">${icon("color")}</button><button type="button" id="note-more" class="icon-button" aria-label="その他の操作" aria-expanded="false">${icon("more")}</button></div>`,
    async () => {
      if (busy || composing) throw Error("文字変換・画像処理を終えてから完了してください。");
      if (!(await save())) throw Error("保存できませんでした。入力を保持しています。もう一度完了してください。");
      d.close();
      render();
    },
    "完了",
  );
  d.dataset.draft = "true";
  d.classList.add("note-editor", n.color);
  d.querySelector("h2")!.classList.add("sr-only");
  d.querySelectorAll("[data-close]").forEach(b => (b as HTMLElement).hidden = true);
  d.querySelector(".note-tools")!.append(d.querySelector(".footer [type=submit]")!);
  const form = d.querySelector("form")!;
  d.querySelector<HTMLButtonElement>("#note-export-data")!.onclick = exportData;
  d.addEventListener("cancel", e => { e.preventDefault(); if (!composing) form.requestSubmit(); });
  d.addEventListener("requestclose", e => { e.preventDefault(); form.requestSubmit(); });
  const showPanel = (buttonID: string, panelID: string) => {
    const button = d.querySelector<HTMLButtonElement>(buttonID)!;
    const panel = d.querySelector<HTMLElement>(panelID)!;
    button.onclick = () => { panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden)); };
  };
  showPanel("#note-color", "#note-palette");
  showPanel("#note-more", "#note-more-menu");
  d.querySelector<HTMLButtonElement>("#add-image")!.onclick = () => d.querySelector<HTMLInputElement>("#note-images")!.click();
  const touch = () => {
    n.modified = new Date().toISOString();
    if (fresh) {
      const present = data.notes.some(note => note.id === id);
      if (noteHasContent(n) && !present) data.notes.unshift(n);
      if (!noteHasContent(n) && present) data.notes = data.notes.filter(note => note.id !== id);
    }
    data.pinned = data.pinned.filter(x => x !== id);
    if (notePinned && (!fresh || noteHasContent(n))) data.pinned.push(id);
    changed();
  };
  d.querySelector("[name=text]")!.addEventListener("input", (e) => {
    n.text = (e.target as HTMLTextAreaElement).value;
    touch();
  });
  d.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(button => button.onclick = () => {
    d.classList.remove(n.color);
    n.color = button.dataset.color!;
    d.classList.add(n.color);
    d.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
    touch();
  });
  d.querySelector<HTMLButtonElement>("#note-pin")!.onclick = e => {
    notePinned = !notePinned;
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(notePinned));
    touch();
  };
  const checks = () => {
    const parent = d.querySelector(".checks")!;
    parent.innerHTML = n.checklist
      .map(
        (c) =>
          `<div class="check"><input data-done="${c.id}" type="checkbox" aria-label="完了" ${c.done ? "checked" : ""}><input data-check="${c.id}" type="text" value="${esc(c.text)}" aria-label="チェック項目"><button type="button" data-remove-check="${c.id}" aria-label="チェック項目を削除">×</button></div>`,
      )
      .join("");
    parent.querySelectorAll<HTMLInputElement>("[data-check]").forEach(
      (i) =>
        (i.oninput = () => {
          n.checklist.find((c) => c.id === i.dataset.check)!.text = i.value;
          touch();
        }),
    );
    parent.querySelectorAll<HTMLInputElement>("[data-done]").forEach(
      (i) =>
        (i.onchange = () => {
          n.checklist.find((c) => c.id === i.dataset.done)!.done = i.checked;
          touch();
        }),
    );
    parent.querySelectorAll<HTMLButtonElement>("[data-remove-check]").forEach(
      (b) =>
        (b.onclick = () => {
          n.checklist = n.checklist.filter(
            (c) => c.id !== b.dataset.removeCheck,
          );
          touch();
          checks();
        }),
    );
  };
  checks();
  d.querySelector<HTMLButtonElement>("#add-check")!.onclick = () => {
    n.checklist.push({ id: uid(), text: "", done: false });
    touch();
    checks();
    const inputs = d.querySelectorAll<HTMLInputElement>("[data-check]");
    inputs[inputs.length - 1].focus();
  };
  const images = () => {
    const p = d.querySelector(".attachments")!;
    p.innerHTML = n.images
      .map(
        (i) =>
          `<div><a href="${esc(i.data)}" target="_blank" rel="noopener"><img src="${esc(i.data)}" alt="メモの添付画像"></a><button type="button" data-remove-image="${i.id}" class="smallbtn">削除</button></div>`,
      )
      .join("");
    p.querySelectorAll<HTMLButtonElement>("[data-remove-image]").forEach(
      (b) =>
        (b.onclick = () => {
          n.images = n.images.filter((i) => i.id !== b.dataset.removeImage);
          touch();
          images();
        }),
    );
  };
  images();
  d.querySelector<HTMLInputElement>("#note-images")!.onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    d.querySelector("#note-file-name")!.textContent = [...input.files ?? []].map(f => f.name).join("、");
    busy++;
    try {
      for (const f of input.files ?? []) {
        n.images.push({ id: uid(), data: await imageData(f) });
        touch();
      }
      images();
    } catch (e) {
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false; box.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      images();
      input.value = "";
      busy--;
      updates?.activity();
    }
  };
  d.querySelector<HTMLButtonElement>("#delete-note")!.onclick = async () => {
    if (busy || composing) return;
    if (!confirm("このメモを削除しますか？")) return;
    const notes = [...data.notes], pins = [...data.pinned];
    data.notes = data.notes.filter((n) => n.id !== id);
    data.pinned = data.pinned.filter((x) => x !== id);
    changed();
    form.inert = true;
    const deleted = await save();
    form.inert = false;
    if (!deleted) {
      data.notes = notes; data.pinned = pins;
      saves.changed();
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false; box.textContent = "削除を保存できませんでした。メモを保持しています。";
      return;
    }
    d.close();
    render();
  };
  d.addEventListener("close", () => render());
  d.querySelector<HTMLTextAreaElement>("[name=text]")!.focus();
}
const bookmarkRequests = new BookmarkRequests();
const articleFilters = {
  q: "",
  category: "",
  courseId: "",
  authorId: "",
  bookmarked: "",
};
let articleSort: "popular" | "newest" = "popular";
let priorFilters: typeof articleFilters | undefined,
  articles: Article[] = [],
  nextCursor: string | null = null,
  articleLoading = false,
  articleError = "",
  articleRequest = 0,
  articleFetched = "",
  lastFilterKey = "",
  searchTimer: ReturnType<typeof setTimeout> | undefined;
function articleKey() {
  return JSON.stringify({ ...articleFilters, sort: articleFilters.bookmarked ? "newest" : articleSort });
}
async function loadArticles(more = false) {
  if (more && (articleLoading || !nextCursor)) return;
  const key = articleKey(), request = ++articleRequest, filter = { ...articleFilters },
    sort = filter.bookmarked ? "newest" : articleSort, cursor = more ? nextCursor : null, bookmarkRevision = bookmarkRequests.revision;
  const isCurrent = pageEpoch.scope(location.hash, () => location.hash);
  const current = () => request === articleRequest && key === articleKey() && isCurrent() && route() === "articles" && !location.hash.split("/")[1];
  articleLoading = true; articleError = "";
  if (!more) nextCursor = null;
  if (!more && key !== lastFilterKey) { articles = []; articleFetched = ""; }
  lastFilterKey = key;
  updateArticleList();
  try {
    if (filter.bookmarked) user = await session();
    if (!current()) return;
    const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    params.set("sort", sort); params.set("limit", "20");
    if (cursor) params.set("cursor", cursor);
    const result = await api<{ articles: Article[]; nextCursor: string | null }>("/articles?" + params);
    if (!current()) return;
    articles = appendUnique(more ? articles : [], bookmarkRequests.reconcile(result.articles, bookmarkRevision));
    nextCursor = result.nextCursor; articleFetched = new Date().toISOString();
  } catch (e) {
    if (!current()) return;
    articleError = e instanceof Error ? e.message : String(e);
  } finally {
    if (current()) { articleLoading = false; updateArticleList(); }
  }
}
function articleStats(a: Article, actionName: string, pending = false) {
  return `<div class="article-stats"><span class="view-count" role="img" aria-label="閲覧${esc(a.viewCount)}回">${icon("eye")}<span aria-hidden="true">${esc(a.viewCount)}</span></span><button type="button" class="bookmark-toggle" data-action="${esc(actionName)}" ${pending ? "disabled" : ""} aria-pressed="${a.bookmarked}" aria-label="ブックマーク${esc(a.bookmarkCount)}件、${a.bookmarked ? "解除する" : "登録する"}">${icon("bookmark")}<span aria-hidden="true">${esc(a.bookmarkCount)}</span></button></div>`;
}
function articleCard(a: Article) {
  action("article-" + a.id, () => (location.hash = "articles/" + a.id));
  if (namedAuthor(a.authorName)) action("author-" + a.id, () => filterAuthor(a.authorId));
  action("bookmark-" + a.id, async () => {
    if (bookmarkRequests.has(a.id)) return;
    const isCurrent = pageEpoch.scope(location.hash, () => location.hash);
    const sync = () => {
      if (route() !== "articles" || location.hash.split("/")[1]) return;
      const current = articles.find(article => article.id === a.id);
      const button = page.querySelector<HTMLButtonElement>(`[data-action="bookmark-${CSS.escape(a.id)}"]`);
      if (!current || !button) return;
      button.disabled = bookmarkRequests.has(a.id);
      button.setAttribute("aria-pressed", String(current.bookmarked));
      button.setAttribute("aria-label", `ブックマーク${current.bookmarkCount}件、${current.bookmarked ? "解除する" : "登録する"}`);
      button.querySelector("span")!.textContent = String(current.bookmarkCount);
    };
    busy++;
    try {
      await bookmarkRequests.update(a.id, async () => {
        user = await session();
        return api<{ bookmarked: boolean; bookmarkCount: number }>("/articles/" + encodeURIComponent(a.id) + "/bookmark", a.bookmarked ? "DELETE" : "PUT", a.bookmarked ? undefined : {});
      }, state => {
        Object.assign(a, state);
        const current = articles.find(article => article.id === a.id);
        if (current) Object.assign(current, state);
      }, sync);
    } catch (e) { if (isCurrent()) error(e); }
    finally { busy--; updates?.activity(); }
  });
  return `<article class="card article-card"><span class="tag">${esc(a.category || "未分類")}</span><h3><button class="article-title" data-action="article-${esc(a.id)}">${esc(a.title)}</button></h3><p class="article-summary">${esc(a.summary)}</p><div class="article-byline">${namedAuthor(a.authorName) ? `<button class="author" data-action="author-${esc(a.id)}">${esc(a.authorName)}</button>` : '<span class="muted">匿名ユーザー</span>'}</div>${articleStats(a, "bookmark-" + a.id, bookmarkRequests.has(a.id))}</article>`;
}

function filterAuthor(id: string) {
  priorFilters = { ...articleFilters };
  articleFilters.authorId = id;
  render();
}
function updateArticleList() {
  const el = page.querySelector("#article-list");
  if (!el || route() !== "articles" || location.hash.split("/")[1]) return;
  el.innerHTML = `${articleError ? `<div class="notice error" role="alert">取得できませんでした。${esc(articleError)} ${btn("再試行", "articles-retry", "smallbtn")}</div>` : ""}${articleError && articles.length ? `<p class="muted">前回取得 ${esc(new Date(articleFetched).toLocaleString("ja-JP"))} の値です。最新の集計は未取得です。</p>` : ""}${articleLoading ? '<p role="status" class="progress">記事を取得しています…</p>' : ""}<div class="cards">${articles.map(articleCard).join("") || (!articleLoading && !articleError ? empty(articleFilters.bookmarked ? "ブックマークはまだありません。" : Object.values(articleFilters).some(Boolean) ? "条件に一致する記事はありません。" : "記事はまだありません。Notionの公開ページを登録できます。") : "")}</div>${nextCursor ? `<div class="toolbar">${btn("さらに読み込む", "articles-more")}</div>` : ""}`;
  action("articles-retry", () => loadArticles());
  action("articles-more", () => loadArticles(true));
}
function filterCount() { return [articleFilters.category, articleFilters.courseId, articleFilters.authorId].filter(Boolean).length; }
function clearArticleConditions() {
  articleFilters.category = articleFilters.courseId = articleFilters.authorId = "";
  priorFilters = undefined;
}
function articleFilterSheet() {
  const draft = { ...articleFilters }, courses = data.imports.flatMap(p => p.courses);
  const categories = [...new Set(["授業", "学生生活", "学習", "その他", articleFilters.category].filter(Boolean))];
  const options = (name: string, items: string[][], value: string) => items.map(([id, label]) => `<label class="filter-option"><span>${esc(label)}</span><input type="radio" name="${name}" value="${esc(id)}" ${id === value ? "checked" : ""}><span class="filter-check" aria-hidden="true">✓</span></label>`).join("");
  const d = modal("記事を絞り込む", `<fieldset><legend>カテゴリ</legend>${options("category", [["", "すべて"], ...categories.map(c => [c, c])], draft.category)}</fieldset><fieldset><legend>講義</legend>${options("courseId", [["", "すべて"], ...courses.map(c => [c.id, c.title]), ...(draft.courseId && !courses.some(c => c.id === draft.courseId) ? [[draft.courseId, "現在の講義条件"]] : [])], draft.courseId)}</fieldset>${draft.authorId ? '<label class="filter-option"><span>選択中の投稿者で絞り込む</span><input type="checkbox" name="keepAuthor" checked></label>' : ""}<button type="button" id="article-filter-reset" class="text-action">条件を解除</button>`, form => {
    articleFilters.category = val(form, "category");
    articleFilters.courseId = val(form, "courseId");
    articleFilters.authorId = new FormData(form).has("keepAuthor") ? draft.authorId : "";
    d.close(); render();
  }, "適用", { className: "article-filter" });
  d.querySelector<HTMLButtonElement>("#article-filter-reset")!.onclick = () => { clearArticleConditions(); d.close(); render(); };
}
function renderArticles() {
  const id = location.hash.split("/")[1];
  if (id) { void renderArticleDetail(id); return; }
  action("article-new", () => articleForm());
  action("article-filters", articleFilterSheet);
  action("article-clear-filters", () => { clearArticleConditions(); render(); });
  action("author-back", () => {
    if (priorFilters) Object.assign(articleFilters, priorFilters); else articleFilters.authorId = "";
    priorFilters = undefined; render();
  });
  const tab = articleFilters.bookmarked ? "bookmarks" : articleSort, count = filterCount();
  page.innerHTML = heading("記事", "", btn("＋ 登録", "article-new", "text-action")) +
    `<div class="article-search-row"><input id="article-query" type="search" placeholder="タイトル・紹介文で検索" value="${esc(articleFilters.q)}" aria-label="記事検索"><button type="button" class="article-filter-button" data-action="article-filters" aria-label="記事を絞り込む、${count}件適用">${icon("sliders")}<span>${count || ""}</span></button></div><div class="article-tabs" role="group" aria-label="記事の並びと対象">${[["popular", "人気"], ["newest", "新着"], ["bookmarks", "ブックマーク"]].map(([value, label]) => `<button type="button" data-action="articles-${value}" aria-pressed="${tab === value}" class="${tab === value ? "selected" : ""}">${label}</button>`).join("")}</div>${count ? `<div class="article-filter-state">${count}件の条件を適用 ${btn("解除", "article-clear-filters", "text-action")}${articleFilters.authorId && priorFilters ? btn("元の検索へ", "author-back", "text-action") : ""}</div>` : ""}<div id="article-list"></div>`;
  for (const value of ["popular", "newest", "bookmarks"] as const) action("articles-" + value, () => {
    articleFilters.bookmarked = value === "bookmarks" ? "1" : "";
    if (value !== "bookmarks") articleSort = value;
    clearTimeout(searchTimer); render();
  });
  page.querySelector<HTMLInputElement>("#article-query")!.oninput = e => {
    articleFilters.q = (e.target as HTMLInputElement).value;
    // Invalidate now, before the debounce, so an older in-flight result cannot flash.
    articleRequest++; articleLoading = false; nextCursor = null; articles = []; articleError = "";
    updateArticleList(); clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (route() === "articles" && !location.hash.split("/")[1]) void loadArticles(); }, 350);
  };
  clearTimeout(searchTimer);
  updateArticleList(); void loadArticles();
}

async function renderArticleDetail(id: string) {
  const isCurrent = pageEpoch.scope("#articles/" + id, () => location.hash);
  page.innerHTML =
    heading("記事を開いています") + '<p role="status">読み込み中…</p>';
  let a: Article;
  try {
    user = await session();
    a = (await api<{ article: Article }>("/articles/" + encodeURIComponent(id)))
      .article;
  } catch (e) {
    if (!isCurrent()) return;
    page.innerHTML =
      heading("記事を表示できません") +
      `<div class="notice error" role="alert">${esc(e instanceof Error ? e.message : e)}<p>記事が削除されたか、通信できない可能性があります。</p></div><a href="#articles">記事一覧へ戻る</a>`;
    return;
  }
  if (!isCurrent()) return;
  const draw = () => {
    if (!isCurrent()) return;
    action("detail-bookmark", async () => {
      const b = page.querySelector<HTMLButtonElement>(
        "[data-action=detail-bookmark]",
      );
      if (b) b.disabled = true;
      busy++;
      try {
        await updateBookmark(
          a,
          async () => {
            user = await session();
            return api<{ bookmarked: boolean; bookmarkCount: number }>(
              "/articles/" + encodeURIComponent(id) + "/bookmark",
              a.bookmarked ? "DELETE" : "PUT",
              a.bookmarked ? undefined : {},
            );
          },
          isCurrent,
          draw,
        );
      } catch (e) {
        if (isCurrent()) {
          error(e);
          if (b) b.disabled = false;
        }
      } finally {
        busy--;
        updates?.activity();
      }
    });
    if (namedAuthor(a.authorName)) action("detail-author", () => {
      location.hash = "articles";
      filterAuthor(a.authorId);
    });
    action("detail-edit", () => articleForm(a));
    action("detail-delete", async () => {
      if (
        !confirm("登録した記事情報を削除しますか？Notion本文は削除されません。")
      )
        return;
      busy++;
      try {
        await api("/articles/" + encodeURIComponent(id), "DELETE");
        location.hash = "articles";
      } catch (e) {
        error(e);
      } finally {
        busy--;
        updates?.activity();
      }
    });
    action("frame-retry", () => {
      const frame = page.querySelector<HTMLIFrameElement>("iframe");
      if (frame) frame.src = frame.src;
    });
    let publicURL = "",
      embedURL = "";
    try {
      publicURL = notionURL(a.publicUrl);
      embedURL = a.embedUrl ? notionURL(a.embedUrl) : "";
    } catch {
      error(Error("保存されたNotion URLを安全に表示できません。"));
    }
    page.innerHTML =
      heading(a.title, "NOTION ARTICLE") +
      `<div class="row"><a href="#articles">‹ 元の一覧・検索へ</a><span class="tag">${esc(a.category || "未分類")}</span></div><section class="card section"><p>${esc(a.summary)}</p><div class="row between">${namedAuthor(a.authorName) ? `<button class="author" data-action="detail-author">${esc(a.authorName)}</button>` : '<span class="muted">匿名ユーザー</span>'}</div>${articleStats(a, "detail-bookmark")}<p class="muted">閲覧はこのアプリ内で開いた記録（日本時間1日1回）。保存は匿名ブラウザID単位の件数です。</p>${a.canEdit ? `<hr><div class="row">${btn("登録情報を編集", "detail-edit")}${btn("登録を削除", "detail-delete", "danger")}</div>` : ""}</section><div class="notice"><p>${navigator.onLine ? "Notionの読込には通信が必要です。公開・表示できるかをここで確認してください。" : "オフラインです。通信が戻ってから再読み込みしてください。"}</p><div class="row">${embedURL ? btn("再読み込み", "frame-retry") : ""}${publicURL ? `<a href="${esc(publicURL)}" target="_blank" rel="noopener noreferrer">Notionで開く ↗</a>` : ""}</div><p class="muted">非公開化・削除・表示制限で読めない場合は元ページを開いてください。読込完了イベントから公開状態は判定しません。</p></div>${embedURL ? `<iframe class="article-frame" title="${esc(a.title)} — Notion本文" src="${esc(embedURL)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen"></iframe>` : empty("公式埋め込みURLが未登録です。「Notionで開く」から本文を読めます。")}`;
  };
  draw();
  try {
    const value = await api<{ viewCount: number }>(
      "/articles/" + encodeURIComponent(id) + "/view",
      "POST",
      {},
    );
    a.viewCount = value.viewCount;
    draw();
  } catch (e) {
    if (!isCurrent()) return;
    error(
      Error(
        "閲覧記録を送信できませんでした。表示中の件数は前回取得値です。" +
          (e instanceof Error ? e.message : ""),
      ),
    );
  }
}
const anonymousNotice =
  "このブラウザの匿名ユーザーとして保存・投稿します。別ブラウザ・別端末は別ユーザーです。ブラウザデータやセッションを消すと、以前の保存と投稿の編集権限は復元できません。";
function articleForm(article?: Article) {
  const kind = article?.id ?? "new";
  if (
    data.articleDraft.kind !== kind &&
    Object.values(data.articleDraft).some(Boolean) &&
    !confirm("保存中の別の登録下書きがあります。新しい入力に切り替えますか？")
  )
    return;
  if (data.articleDraft.kind !== kind) {
    data.articleDraft = {
      kind,
      title: article?.title ?? "",
      publicUrl: article?.publicUrl ?? "",
      embedUrl: article?.embedUrl ?? "",
      summary: article?.summary ?? "",
      category: article?.category ?? "",
      courseId: article?.courseId ?? "",
      key: uid(),
    };
    changed();
  }
  const draft = data.articleDraft;
  const d = modal(
    article ? "記事の登録情報を編集" : "Notion記事を登録",
    `<p class="muted">${anonymousNotice}</p>${field("title", "タイトル", draft.title, "text", 'required maxlength="120"')}${field("publicUrl", "Notionの公開URL", draft.publicUrl, "url", "required")}<p class="muted">HTTPSの notion.site / notion.so とそのサブドメインが対象です。独自ドメインは未対応です。</p>${textfield("summary", "紹介文（280字まで）", draft.summary, 280)}${field("category", "カテゴリ", draft.category, "text", 'maxlength="40"')}${choice("courseId", "関連する講義", [["", "指定なし"], ...data.imports.flatMap((p) => p.courses).map((c) => [c.id, c.title] as [string, string])], draft.courseId)}<section class="card"><h3>公式の埋め込みURL・コード（任意）</h3><p class="muted">Notionの公開ページで「このページを埋め込む」から取得したiframeコード、またはそのsrcを入力してください。HTML自体は実行しません。通常URLからの変換は行いません。</p>${textfield("embedUrl", "埋め込みコードまたはURL", draft.embedUrl, 4000)}</section><button type="button" id="preview-article">プレビューを確認</button><div id="article-preview"></div><label class="check"><input name="confirmed" type="checkbox" required>元ページ・プレビューがログイン不要で読めることを確認しました</label>`,
    async (form) => {
      if (composing) throw Error("文字変換を確定してください。");
      const title = val(form, "title").trim();
      if (!title || Array.from(title).length > 120)
        throw Error("タイトルは1〜120字です。");
      const body = {
        title,
        publicUrl: notionURL(val(form, "publicUrl")),
        embedUrl: embedSource(val(form, "embedUrl")),
        summary: val(form, "summary").trim(),
        category: val(form, "category").trim(),
        courseId: val(form, "courseId"),
      };
      if (Array.from(body.summary).length > 280)
        throw Error("紹介文は280字以内です。");
      busy++;
      try {
        user = await session();
        const result = article
          ? await api<{ article: Article }>("/articles/" + encodeURIComponent(article.id), "PATCH", body)
          : await submitNewArticle(draft, body, api, async () => {
              changed();
              if (!(await save())) throw Error("送信前の下書き保存に失敗しました。入力を保持して再試行してください。");
            });
        data.articleDraft = {};
        changed();
        await save();
        d.close();
        location.hash = "articles/" + result.article.id;
      } finally {
        busy--;
        updates?.activity();
      }
    },
    article ? "変更を保存" : "登録",
  );
  d.dataset.draft = "true";
  d.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[name]").forEach((input) => {
    if (input.name === "confirmed") return;
    input.addEventListener("input", () => {
      draft[input.name] = input.value;
      const confirmed = d.querySelector<HTMLInputElement>("[name=confirmed]");
      if (confirmed) confirmed.checked = false;
      changed();
    });
  });
  d.querySelector<HTMLButtonElement>("#preview-article")!.onclick = () => {
    const f = d.querySelector("form")!;
    try {
      const publicURL = notionURL(val(f, "publicUrl")),
        embed = embedSource(val(f, "embedUrl"));
      d.querySelector("#article-preview")!.innerHTML =
        `<div class="notice"><p>実際の公開状態はご本人が確認してください。</p><a href="${esc(publicURL)}" target="_blank" rel="noopener noreferrer">元ページを開いて確認 ↗</a></div>${embed ? `<iframe title="Notion記事の投稿前プレビュー" class="article-frame" src="${esc(embed)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>` : empty("埋め込みURLが未入力です。元ページを開いて確認できます。")}`;
    } catch (e) {
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false;
      box.textContent = e instanceof Error ? e.message : String(e);
    }
  };
}
let updateState = { message: "更新を確認しています…", ready: false };
function renderUpdateState() {
  const box = page.querySelector<HTMLElement>("#more-update-state");
  if (!box) return;
  const state = updatePresentation(updateState.message, updateState.ready);
  box.innerHTML = `<p class="update-label" role="status">${esc(state.label)}</p>${state.detail ? `<p class="muted">${esc(state.detail)}</p>` : ""}<div class="update-actions">${btn("更新を確認", "check-update", "smallbtn")}${state.install ? btn("最新版をインストール", "update", "primary smallbtn") : ""}</div>`;
}
function reportUpdateFailure(e: unknown) {
  updateState = { message: "更新できませんでした。通信・保存状態を確認して再試行してください。 " + (e instanceof Error ? e.message : String(e)), ready: false };
  renderUpdateState();
}
function renderMore() {
  action("map", () => openMap());
  action("facilities", editFacilities);
  action("links", editLinks);
  action("export-data", exportData);
  action("check-update", () => updates.check());
  action("clear-bg", () => { data.backgroundMode = "none"; changed(); render(); });
  action("custom-bg", () => { data.backgroundMode = "custom"; changed(); render(); });
  action("profile", async () => {
    try {
      user = await session();
      const d = modal("ユーザー名", field("displayName", "記事に表示する名前", namedAuthor(user.displayName) ? user.displayName : "", "text", 'required maxlength="40"') +
        `<p class="muted">${anonymousNotice}</p>`, async f => {
          user = (await api<{ user: User }>("/session", "PATCH", { displayName: val(f, "displayName") })).user;
          d.close(); render();
        });
    } catch (e) { error(e); }
  });
  const backgroundName = backgrounds.find(b => b.id === data.backgroundMode)?.name || (data.backgroundMode !== "none" && data.background ? "自分の画像" : "背景なし");
  const activeCustom = data.backgroundMode === "custom" || (!data.backgroundMode && !!data.background);
  page.innerHTML = heading("その他", "") +
    `<section class="settings-update"><h2>アプリの更新</h2><div id="more-update-state"></div></section><div class="settings-list">
    <details id="appearance-settings" class="setting"><summary><span>背景・テーマ<small>${esc(backgroundName)}</small></span><span aria-hidden="true">›</span></summary><div class="setting-content">${choice("theme", "テーマ", [["green", "グリーン"], ["blue", "ブルー"], ["rose", "ローズ"], ["mono", "モノトーン"]], data.theme)}<h3>背景</h3><div class="background-samples">${backgrounds.map(b => `<button type="button" data-background="${b.id}" aria-pressed="${data.backgroundMode === b.id}"><span class="background-thumb"><img src="${esc(b.image)}" alt=""><span class="selection-check" aria-hidden="true">✓</span></span><span>${b.name}</span></button>`).join("")}${data.background ? `<button type="button" data-action="custom-bg" aria-pressed="${activeCustom}"><span class="background-thumb"><img src="${esc(data.background)}" alt="自分の背景画像"><span class="selection-check" aria-hidden="true">✓</span></span><span>自分の画像</span></button>` : ""}</div><p id="background-state" class="muted" role="status">${data.background ? "自分の画像を選択できます。" : "自分の画像はまだありません。"}</p><div class="row"><button type="button" id="change-background">${data.background ? "画像を変更" : "画像を選ぶ"}</button>${btn("背景なし", "clear-bg")}</div><input id="background" type="file" data-toolbar="true" class="file-native" tabindex="-1" accept="image/png,image/jpeg,image/webp,image/heic,.heic" aria-label="自分の背景画像を変更"><p class="muted">画像はこのブラウザに保存します。</p></div></details>
    <details id="display-settings" class="setting"><summary><span>時間割の表示<small>${data.startHour}:00–${data.endHour}:00</small></span><span aria-hidden="true">›</span></summary><div class="setting-content stack">${field("startHour", "日表示の開始時刻", String(data.startHour), "number", 'min="0" max="23"')}${field("endHour", "日表示の終了時刻", String(data.endHour), "number", 'min="1" max="24"')}<label class="check"><input name="bands" type="checkbox" ${data.showBands ? "checked" : ""}>施設の営業時間を表示</label><p class="muted">週間は1〜5コマ表示。終日・コマ外の予定も一覧で確認できます。</p></div></details>
    <details id="campus-settings" class="setting"><summary><span>施設・リンク<small>営業時間・地図・お気に入り</small></span><span aria-hidden="true">›</span></summary><div class="setting-content"><div class="row">${btn("施設の営業時間", "facilities")}${btn("キャンパスマップ", "map")}</div><p class="muted">営業時間は通常期の目安です。臨時変更は公式情報で確認してください。</p><div class="stack">${data.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.favorite ? "★ " : ""}${esc(l.title)} ↗</a>`).join("")}</div><p>${btn("リンクを編集", "links")}</p></div></details>
    <div class="setting"><button class="setting-profile" data-action="profile"><span>ユーザー名<small id="profile-name">${esc(namedAuthor(user?.displayName) ? user!.displayName : "未設定")}</small></span><span aria-hidden="true">›</span></button></div>
    <details id="data-settings" class="setting"><summary><span>データ<small>書き出し・保存について</small></span><span aria-hidden="true">›</span></summary><div class="setting-content">${btn("入力データを書き出す", "export-data")}<p class="muted">保存に失敗したときや別タブと競合したときは、現在の入力を書き出してから再読み込みできます。メモ・画像も含まれます。</p><p class="muted">${anonymousNotice}</p></div></details></div>
    <details id="install-information" class="settings-information"><summary>ホーム画面に追加</summary><p class="muted">iPhone: Safariの共有から「ホーム画面に追加」。Android/PC: ブラウザのメニューから「アプリをインストール」を選びます。HTTPSの公開URLで利用できます。</p></details>
    <details id="diagnostic-information" class="settings-information"><summary>詳細情報</summary><p class="muted">この画面のビルド ${esc(__APP_BUILD_ID__)}</p><div id="version" class="muted">配信情報を読み込み中…</div></details>`;
  renderUpdateState();
  page.querySelectorAll<HTMLButtonElement>("[data-background]").forEach(button => button.onclick = () => { data.backgroundMode = button.dataset.background!; changed(); render(); });
  page.querySelector<HTMLSelectElement>("[name=theme]")!.onchange = e => { data.theme = (e.target as HTMLSelectElement).value; changed(); theme(); };
  for (const name of ["startHour", "endHour"] as const)
    page.querySelector<HTMLInputElement>(`[name=${name}]`)!.onchange = e => {
      const value = Number((e.target as HTMLInputElement).value), start = name === "startHour" ? value : data.startHour, end = name === "endHour" ? value : data.endHour;
      if (!Number.isInteger(value) || start < 0 || end > 24 || start >= end) { error(Error("表示時間は0〜24時で、終了を開始より後にしてください。")); return; }
      data[name] = value; changed();
    };
  page.querySelector<HTMLInputElement>("[name=bands]")!.onchange = e => { data.showBands = (e.target as HTMLInputElement).checked; changed(); };
  page.querySelector<HTMLButtonElement>("#change-background")!.onclick = () => page.querySelector<HTMLInputElement>("#background")!.click();
  page.querySelector<HTMLInputElement>("#background")!.onchange = async e => {
    const input = e.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    busy++;
    const box = page.querySelector<HTMLElement>("#background-state");
    if (box) box.textContent = "画像を読み込んでいます…";
    try {
      const image = await imageData(file);
      data.background = image; data.backgroundMode = "custom";
      changed(); render();
    } catch (e) {
      if (box?.isConnected) box.textContent = "画像を読み込めませんでした。前の画像と選択を保持しています。";
      error(e);
    } finally {
      input.value = "";
      busy--; updates?.activity();
    }
  };
  const version = page.querySelector("#version")!;
  void fetch("/version.json", { cache: "no-store" }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(v => {
    if (version.isConnected) version.innerHTML = `<p>配信中のビルド ${esc(v.id)} · ${esc(v.builtAt)}</p>${Array.isArray(v.changes) ? "<ul>" + v.changes.map((s: string) => `<li>${esc(s)}</li>`).join("") + "</ul>" : ""}`;
  }).catch(() => { if (version.isConnected) version.textContent = "配信情報を取得できません。"; });
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "uni-pocket-" + dayKey() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openMap(room = "") {
  let query = room || mapLocation, selected = mapBuilding;
  if (!selected) { const r = resolveRoom(query); selected = r.kind === "matched" ? r.ids[0] : ""; }
  let suggestions = false, active = -1;
  const viewport = new MapViewport(catalog.viewBox);
  const initial = catalog.buildings.find(b => b.id === selected);
  if (initial) viewport.center(initial.mapCenter);
  const [mx, my, mw, mh] = catalog.viewBox;
  const d = modal("キャンパスマップ", `<div class="map-search"><input id="map-query" type="text" inputmode="search" value="${esc(query)}" placeholder="建物・登録済み教室" aria-label="建物・登録済み教室を検索" role="combobox" aria-controls="map-suggestions" aria-expanded="false" autocomplete="off"><button type="button" id="map-clear" aria-label="検索語を消す" ${query ? "" : "hidden"}>×</button><div id="map-suggestions" class="map-suggestions" role="listbox" aria-label="建物の候補" hidden></div></div><p id="map-state" class="map-state" role="status" hidden></p><div class="sr-only" id="map-announcement" aria-live="polite"></div><div class="map-viewport"><svg class="map-canvas" viewBox="${viewport.box.join(" ")}" tabindex="0" role="img" aria-label="浜松キャンパスの地図"><image href="/campus-map.png" x="${mx}" y="${my}" width="${mw}" height="${mh}"/><g id="map-highlight"></g></svg><div class="map-zoom"><button type="button" id="map-plus" aria-label="地図を拡大">＋</button><button type="button" id="map-minus" aria-label="地図を縮小">−</button><button type="button" id="map-reset">全体</button></div><div id="building-info" class="map-selected" hidden></div></div>`, undefined, "保存", { singleClose: true, className: "map-modal" });
  const input = d.querySelector<HTMLInputElement>("#map-query")!, list = d.querySelector<HTMLElement>("#map-suggestions")!, canvas = d.querySelector<SVGSVGElement>(".map-canvas")!;
  const paintViewport = () => canvas.setAttribute("viewBox", viewport.box.join(" "));
  const matches = () => mapCandidates(query);
  const choose = (id: string) => {
    selected = id; mapBuilding = id; mapLocation = query;
    suggestions = false; active = -1;
    const b = catalog.buildings.find(b => b.id === id)!;
    viewport.center(b.mapCenter);
    input.blur(); paint();
    d.querySelector("#map-announcement")!.textContent = b.name + "を選択しました。";
  };
  const paint = () => {
    const found = matches(), b = catalog.buildings.find(b => b.id === selected), open = suggestions && !!query.trim() && !!found.length;
    list.hidden = !open;
    list.innerHTML = open ? found.map((b, i) => `<button type="button" role="option" id="map-option-${i}" data-building="${b.id}" aria-selected="${i === active}">${esc(b.name)}</button>`).join("") : "";
    input.setAttribute("aria-expanded", String(open));
    if (open && active >= 0) input.setAttribute("aria-activedescendant", "map-option-" + active);
    else input.removeAttribute("aria-activedescendant");
    d.querySelector<HTMLButtonElement>("#map-clear")!.hidden = !query;
    const state = d.querySelector<HTMLElement>("#map-state")!;
    state.textContent = query.trim() && !b ? resolveRoom(query).kind === "online" ? "オンライン" : !found.length ? "見つかりません" : "" : "";
    state.hidden = !state.textContent;
    d.querySelector("#map-highlight")!.innerHTML = b ? `${b.mapPolygon.length ? `<polygon points="${b.mapPolygon.map(p => p.join(",")).join(" ")}"/>` : ""}<circle cx="${b.mapCenter[0]}" cy="${b.mapCenter[1]}" r="13"/>` : "";
    const info = d.querySelector<HTMLElement>("#building-info")!;
    info.textContent = b?.name ?? ""; info.hidden = !b;
    list.querySelectorAll<HTMLButtonElement>("[data-building]").forEach(button => button.onclick = () => choose(button.dataset.building!));
    list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    d.querySelector<HTMLButtonElement>("#map-minus")!.disabled = viewport.zoom <= 1;
    d.querySelector<HTMLButtonElement>("#map-plus")!.disabled = viewport.zoom >= 4;
    paintViewport();
  };
  input.oninput = () => {
    query = input.value; selected = ""; mapBuilding = ""; mapLocation = query;
    suggestions = !!query.trim(); active = -1; paint();
    d.querySelector("#map-announcement")!.textContent = matches().length ? `${matches().length}件の候補。矢印キーで選びEnterで決定します。` : "";
  };
  input.onkeydown = ev => {
    if (ev.isComposing) return;
    const found = matches();
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && found.length) {
      ev.preventDefault(); suggestions = true;
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + found.length) % found.length; paint();
    } else if (ev.key === "Enter" && suggestions && found.length && !ev.isComposing) {
      ev.preventDefault(); choose(found[Math.max(0, active)].id);
    }
  };
  d.addEventListener("cancel", ev => {
    if (!list.hidden) { ev.preventDefault(); suggestions = false; active = -1; paint(); }
  });
  d.querySelector<HTMLButtonElement>("#map-clear")!.onclick = () => {
    input.value = query = selected = mapBuilding = mapLocation = "";
    d.querySelector("#map-announcement")!.textContent = "";
    suggestions = false; active = -1; paint(); input.focus();
  };
  d.querySelector<HTMLButtonElement>("#map-plus")!.onclick = () => { viewport.scale(viewport.zoom * 1.25); paint(); };
  d.querySelector<HTMLButtonElement>("#map-minus")!.onclick = () => { viewport.scale(viewport.zoom / 1.25); paint(); };
  d.querySelector<HTMLButtonElement>("#map-reset")!.onclick = () => { viewport.reset(); paint(); };
  const pointers = new Map<number, { x: number; y: number }>();
  canvas.onpointerdown = ev => {
    if (ev.button && ev.pointerType === "mouse") return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); canvas.setPointerCapture(ev.pointerId);
  };
  canvas.onpointermove = ev => {
    const previous = pointers.get(ev.pointerId); if (!previous) return;
    const before = [...pointers.values()];
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const after = [...pointers.values()], rect = canvas.getBoundingClientRect(), fit = Math.min(rect.width / mw, rect.height / mh);
    if (before.length === 2) {
      const distance = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const oldDistance = distance(before); if (oldDistance) viewport.scale(viewport.zoom * distance(after) / oldDistance);
      viewport.pan(((after[0].x + after[1].x) - (before[0].x + before[1].x)) / 2, ((after[0].y + after[1].y) - (before[0].y + before[1].y)) / 2, mw * fit, mh * fit);
    } else if (before.length === 1) viewport.pan(ev.clientX - previous.x, ev.clientY - previous.y, mw * fit, mh * fit);
    paintViewport();
  };
  const release = (ev: PointerEvent) => { pointers.delete(ev.pointerId); if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId); paint(); };
  canvas.onpointerup = release; canvas.onpointercancel = release; canvas.onlostpointercapture = ev => pointers.delete(ev.pointerId);
  canvas.onkeydown = ev => {
    if (["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(ev.key)) {
      ev.preventDefault();
      if (ev.key === "Home") viewport.reset();
      else if (["+", "=", "-"].includes(ev.key)) viewport.scale(viewport.zoom * (ev.key === "-" ? 0.8 : 1.25));
      else { const r = canvas.getBoundingClientRect(), fit = Math.min(r.width / mw, r.height / mh); viewport.pan(ev.key === "ArrowLeft" ? 40 : ev.key === "ArrowRight" ? -40 : 0, ev.key === "ArrowUp" ? 40 : ev.key === "ArrowDown" ? -40 : 0, mw * fit, mh * fit); }
      paint();
    }
  };
  d.addEventListener("close", () => { if (route() === "home") render(); });
  paint();
  // Keep the keyboard closed when opening the map on touch devices.
  canvas.focus({ preventScroll: true });
}

function editFacilities() {
  const d = modal(
    "施設の営業時間",
    `<p class="muted">空欄は休業。開始–終了 / 開始–終了（L.O.時刻）。通常期の目安を個人設定として変更できます。</p><div class="stack">${data.facilities
      .map(
        (f) =>
          `<section class="card"><h3>${esc(f.title)}</h3><a href="${esc(f.source)}" target="_blank" rel="noopener noreferrer">公式の営業案内 ↗</a><div class="stack">${[1, 2, 3, 4, 5, 6, 7].map((w) => field(f.id + "-" + w, "月火水木金土日"[w - 1] + "曜", f.weekdays[w] ?? "")).join("")}</div><hr>${field(f.id + "-day", "特定日の例外（日付）", "", "date")}${field(f.id + "-hours", "その日の時間（空欄は休業）")}<p class="muted">設定中の例外</p>${
            Object.entries(f.exceptions)
              .map(
                ([day, h]) =>
                  `<label class="check"><input name="${f.id}-remove-${day}" type="checkbox">${esc(day)} ${esc(h || "休業")} を解除</label>`,
              )
              .join("") || '<p class="muted">なし</p>'
          }<label class="check"><input name="${f.id}-band" type="checkbox" ${f.band ? "checked" : ""}>時間割に帯を表示</label></section>`,
      )
      .join("")}</div>`,
    async (form) => {
      const next: Facility[] = structuredClone(data.facilities);
      for (const f of next) {
        for (let w = 1; w <= 7; w++) {
          const h = val(form, f.id + "-" + w);
          parseHours(h);
          f.weekdays[w] = h;
        }
        for (const day of Object.keys(f.exceptions))
          if (new FormData(form).has(f.id + "-remove-" + day))
            delete f.exceptions[day];
        const day = val(form, f.id + "-day"),
          hours = val(form, f.id + "-hours");
        if (day) {
          parseHours(hours);
          f.exceptions[day] = hours;
        }
        f.band = new FormData(form).has(f.id + "-band");
      }
      data.facilities = next;
      changed();
      if (!(await save())) throw Error("保存に失敗しました。");
      d.close();
      render();
    },
  );
}
function safeLink(s: string) {
  const u = new URL(s.trim());
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("認証情報を含まないHTTPS URLを指定してください。");
  return u.href;
}
function editLinks() {
  const draft = structuredClone(data.links);
  const d = modal(
    "リンク・お気に入り",
    `<div id="link-rows" class="stack"></div><button type="button" id="add-link">＋ リンク</button>`,
    async () => {
      for (const l of draft) {
        if (!l.title.trim()) throw Error("リンク名を入力してください。");
        l.url = safeLink(l.url);
      }
      data.links = draft;
      changed();
      if (!(await save())) throw Error("保存に失敗しました。");
      d.close();
      render();
    },
  );
  const draw = () => {
    d.querySelector("#link-rows")!.innerHTML = draft
      .map(
        (l) =>
          `<section class="card stack">${field("title-" + l.id, "リンク名", l.title)}${field("url-" + l.id, "URL", l.url, "url")}<label class="check"><input data-favorite="${l.id}" type="checkbox" ${l.favorite ? "checked" : ""}>ホームのお気に入り</label><div class="row"><button type="button" data-up-link="${l.id}" aria-label="${esc(l.title)}を上へ">↑</button><button type="button" data-down-link="${l.id}" aria-label="${esc(l.title)}を下へ">↓</button><button type="button" data-delete-link="${l.id}" class="danger">削除</button></div></section>`,
      )
      .join("");
    for (const l of draft) {
      for (const direction of ["up", "down"])
        d.querySelector<HTMLButtonElement>(
          `[data-${direction}-link="${l.id}"]`,
        )!.onclick = () => {
          const index = draft.indexOf(l),
            next = index + (direction === "up" ? -1 : 1);
          if (next >= 0 && next < draft.length) {
            draft.splice(index, 1);
            draft.splice(next, 0, l);
            draw();
          }
        };
      d.querySelector<HTMLInputElement>(`[name="title-${l.id}"]`)!.oninput = (
        e,
      ) => (l.title = (e.target as HTMLInputElement).value);
      d.querySelector<HTMLInputElement>(`[name="url-${l.id}"]`)!.oninput = (
        e,
      ) => (l.url = (e.target as HTMLInputElement).value);
      d.querySelector<HTMLInputElement>(`[data-favorite="${l.id}"]`)!.onchange =
        (e) => (l.favorite = (e.target as HTMLInputElement).checked);
      d.querySelector<HTMLButtonElement>(
        `[data-delete-link="${l.id}"]`,
      )!.onclick = () => {
        draft.splice(draft.indexOf(l), 1);
        draw();
      };
    }
  };
  draw();
  d.querySelector<HTMLButtonElement>("#add-link")!.onclick = () => {
    draft.push({ id: uid(), title: "", url: "https://", favorite: false });
    draw();
  };
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
page = root.querySelector("#page")!;
status = root.querySelector("#save-status")!;
errorBox = root.querySelector("#error")!;
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
document.addEventListener("compositionstart", () => (composing = true));
document.addEventListener("compositionend", () => {
  composing = false;
  updates?.activity();
});
document.addEventListener("focusout", () => updates?.activity());
window.addEventListener("hashchange", () => {
  if (dialog) {
    if (!dialog.dispatchEvent(new Event("requestclose", { cancelable: true }))) return;
    dialog.close();
  }
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
  if (route() === "home" && !dialog?.open) render();
}, 60000);
window.addEventListener("beforeunload", (e) => {
  if (saves.dirty || busy || submitting) {
    e.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && saves.dirty) void save();
});
const connection = () => {
  root.querySelector("#connection")!.textContent = navigator.onLine
    ? "オンライン"
    : "オフライン · 個人データは利用可能";
};
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
connection();
let updates: ReturnType<typeof installUpdates>;
async function boot() {
  try {
    data = await store.open();
    statusText("この端末に保存済み");
  } catch (e) {
    loadFailed = true;
    error(e);
    statusText("保存データを保護中 · 再読み込みで再試行");
  }
  updates = installUpdates({
    isIdle: () => !busy && !submitting && !composing && !dialog?.open &&
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
      frozen = v;
      root.inert = v;
      if (dialog) dialog.inert = v;
    },
    notice: (message, ready) => {
      updateState = { message, ready };
      renderUpdateState();
    },
    error: reportUpdateFailure,
  });
  render();
  if (loadFailed) {
    page.inert = true;
  }
  if (data.eventDraft) editEvent(undefined, true);
  try {
    user = (await api<{ user: User | null }>("/session")).user;
    const label = page.querySelector("#profile-name");
    if (label) label.textContent = namedAuthor(user?.displayName) ? user!.displayName : "未設定";
  } catch {
    /* Shared API availability never blocks personal features. */
  }
}
void boot();
