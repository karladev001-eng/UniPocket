// Home: date line, next/today events, pinned notes, campus map and favorite links.
import { icon } from "../ui-assets";
import { nextEvent } from "../calendar-presentation";
import {
  type CampusEvent,
  dayKey,
  weekDay,
  timeLabel,
  events,
  onDay,
  facilityHours,
} from "../domain";
import { action, data, navigate, page, view } from "../app/context";
import { btn, empty, esc, heading } from "../ui/html";
import { focusPendingMap, homeMap } from "./campus-map";
import { community } from "./articles";
import { editEvent, locationControl, showEvent } from "./events";
import { noteCard } from "./notes";
import { openImport } from "./timetable";
function compactEvent(e: CampusEvent) {
  action("event-" + e.id, () => showEvent(e));
  return `<div class="home-event"><span class="when">${e.allDay ? "終日" : timeLabel(e.start)}<small>${e.allDay ? "" : timeLabel(e.end) + " まで"}</small></span><div class="event-body"><button class="eventtitle" data-action="${esc("event-" + e.id)}"><strong>${esc(e.title)}</strong></button>${locationControl(e.location, "today-" + e.id)}${e.kind === "exam" ? '<span class="tag exam">試験・要確認</span>' : ""}</div></div>`;
}
export function renderHome() {
  const today = dayKey(),
    all = events(data),
    todayEvents = all.filter((e) => onDay(e, today)),
    now = new Date(),
    next = nextEvent(all, now.getTime());
  action("home-import", openImport);
  action("event-new", () => {
    view.selectedDay = today;
    editEvent();
  });
  action("home-timetable", () => {
    view.selectedDay = today;
    view.weekend = weekDay(today) > 5;
    navigate("timetable");
  });
  if (next) action("event-" + next.id, () => showEvent(next));
  page.innerHTML =
    heading(
      "ホーム",
      "",
      `<span id="home-notice-bell">${community.homeBell()}</span>` +
        btn("＋ 予定", "event-new", "timetable-entry"),
    ) +
    `<div class="date-line"><strong>${esc(new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Tokyo" }).format(now))}</strong>${btn(icon("clock") + " 時間割を見る", "home-timetable", "timetable-entry")}</div>` +
    (next
      ? `<section class="next-preview"><button class="next-main" data-action="${esc("event-" + next.id)}"><span class="next-caption">${Date.parse(next.start) <= now.getTime() ? "いまの予定" : "次の予定"} · ${esc(dayKey(new Date(next.start)) === today ? "今日" : dayKey(new Date(next.start)))}</span><span class="next-time">${esc(timeLabel(next.start))}<small>–${esc(timeLabel(next.end))}</small></span><strong>${esc(next.title)}</strong></button>${locationControl(next.location, "next-" + next.id)}</section>`
      : `<p class="next-preview no-next">次の予定はありません。</p>`) +
    `<section class="today-schedule"><div class="sectiontitle"><h2>今日の予定 <span class="tag">${todayEvents.length}件</span></h2></div><div class="home-events">${todayEvents.map(compactEvent).join("") || empty("今日の予定はありません。")}</div>${!all.length ? `<p class="import-hint">${btn("時間割PDFを取り込む", "home-import")}</p>` : ""}</section>
    <div id="home-community-line">${community.homeLine()}</div>
    <details id="home-facilities" class="home-extra"><summary>キャンパスの営業時間</summary><p class="muted">通常期の目安です。臨時変更は公式情報で確認してください。</p>${data.facilities
      .slice(0, 4)
      .map(
        (f) =>
          `<p><b>${esc(f.title)}</b> · ${esc(facilityHours(f, today) || "休業")}</p>`,
      )
      .join("")}<a href="#more">施設を設定 →</a></details>
    <section class="section"><h2>固定したメモ</h2><div class="cards">${
      data.notes
        .filter((n) => data.pinned.includes(n.id))
        .map(noteCard)
        .join("") || empty("メモを固定するとここに表示されます。")
    }</div></section>
    ${homeMap()}
    <section class="section"><h2>よく使うリンク</h2><div class="row">${
      data.links
        .filter((l) => l.favorite)
        .map(
          (l) =>
            `<a class="card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ↗</a>`,
        )
        .join("") || '<a href="#more">リンクのお気に入りを設定 →</a>'
    }</div></section>`;
  focusPendingMap();
}
