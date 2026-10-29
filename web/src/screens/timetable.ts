// Timetable: the weekly lecture grid and the PDF timetable import flow.
import { periods, weekPresentation } from "../schedule-presentation";
import { lectureEvents, calendarDays, nextEvent, eventKind } from "../calendar-presentation";
import { type Plan, dayKey, addDay, weekDay, timeLabel, events, onDay, difference, install, facilityHours } from "../domain";
import { action, data, navigate, page, render, setData, trackBusy, updates, view } from "../app/context";
import { changed, save } from "../app/status";
import { btn, choice, empty, esc, heading } from "../ui/html";
import { modal, val } from "../ui/modal";
import { articleFilters } from "./articles";
import { bindDatePicker, colorFor, dateTools, editEvent, eventChooser, eventDate, showEvent } from "./events";
// PDF parsing in flight (see trackBusy).
let busy = 0;
trackBusy(() => busy);
export function renderTimetable() {
  action("prev-date", () => { view.selectedDay = addDay(view.selectedDay, -7); render(); });
  action("next-date", () => { view.selectedDay = addDay(view.selectedDay, 7); render(); });
  action("today", () => { view.selectedDay = dayKey(); view.weekend = weekDay(view.selectedDay) > 5; render(); });
  action("import", openImport);
  action("weekdays", () => { view.weekend = false; render(); });
  action("weekend", () => { view.weekend = true; render(); });
  action("event-new", () => { window.addEventListener("hashchange", () => editEvent(), { once: true }); navigate("calendar"); });
  action("event-resume", () => editEvent(undefined, true));
  const all = lectureEvents(events(data)), week = weekPresentation(all, view.selectedDay, view.weekend), next = nextEvent(all);
  const courses = data.imports.flatMap(p => p.courses);
  const content = `<div class="week-surface"><div class="week-grid ${view.weekend ? "weekend" : ""}" role="group" aria-label="曜日とコマの講義専用時間割"><div></div>${week.days.map(day => `<div class="day-heading ${day === dayKey() ? "today" : ""}"><b>${"月火水木金土日"[weekDay(day) - 1]}</b><span>${Number(day.slice(-2))}</span></div>`).join("")}${periods.map(([start, end], index) => `<div class="period"><b>${index + 1}</b><small>${start}<br>${end}</small></div>${week.cells[index].map((cell, dayIndex) => {
    const e = cell[0], a = `cell-${index}-${dayIndex}`;
    if (!e) return `<div class="course-cell empty-cell" aria-label="${week.days[dayIndex]} ${index + 1}コマ 空き">—</div>`;
    action(a, () => cell.length === 1 ? showEvent(e) : eventChooser("同じコマの授業・試験", cell));
    return `<button class="course-cell ${colorFor(e)} ${cell.some(e => e.id === next?.id) ? "next-course" : ""}" data-action="${a}" aria-label="${esc(week.days[dayIndex] + ' ' + (index + 1) + 'コマ ' + cell.map(e => eventKind(e) + ' ' + e.title + ' ' + e.location).join('、'))}">${cell.length > 1 ? `<span class="overlap-count">${cell.length}件</span>` : ""}${cell.some(e => e.id === next?.id) ? '<span class="next-course-label">次の授業</span>' : ''}<span class="cell-name">${e.kind === "exam" ? "試験・要確認 " : ""}${esc(e.title)}</span><span class="cell-room">${esc(e.location || "場所未設定")}</span></button>`;
  }).join("")}`).join("")}</div></div>${week.other.length ? `<section class="other-events"><h2>コマ外の授業・試験 <span class="tag">${week.other.length}件</span></h2>${week.other.map(e => { action("event-" + e.id, () => showEvent(e)); return `<button class="other-event" data-action="${esc("event-" + e.id)}"><strong>${esc(eventKind(e))} · ${esc(e.title)}</strong><span>${esc(eventDate(e))} · ${esc(e.location || "場所未設定")}</span></button>`; }).join("")}</section>` : ""}`;
  page.innerHTML = heading("時間割", "", btn("＋ 予定", "event-new", "primary") + `<details class="schedule-menu"><summary aria-label="時間割メニュー">⋯</summary><div>${btn("PDF取込", "import")}${data.eventDraft ? btn("予定の下書きを再開", "event-resume") : ""}</div></details>`) +
    `<div class="schedule-links"><a href="#home">‹ ホームへ</a><a href="#calendar">予定表へ ›</a></div><div class="view-tools"><span class="muted">授業・試験</span><div class="week-kind"><button data-action="weekdays" aria-pressed="${!view.weekend}">平日</button><button data-action="weekend" aria-pressed="${view.weekend}">土日${week.weekendCount ? `<span class="tag">${week.weekendCount}</span>` : ""}</button></div></div>${dateTools("週")}${!all.length ? empty("講義が未登録です。時間割PDFを取り込んでください。") : !all.some(e => calendarDays(view.selectedDay, "week").some(day => onDay(e, day))) ? '<p class="muted">この週の授業・試験はありません。</p>' : ""}${content}${!courses.length ? `<p class="import-hint">${btn("時間割PDFを取り込む", "import", "smallbtn")}</p>` : ""}
    <details id="registered-courses" class="schedule-fold"><summary>登録した講義 <span class="tag">${courses.length}</span></summary><p class="muted">講義を開くと関連記事を表示します。</p><div class="stack">${courses.map(c => `<button data-course="${esc(c.id)}">${esc(c.title)} <small>${c.weekday ? "月火水木金土日"[c.weekday - 1] + " " + ((c.block ?? 0) + 1) + "コマ" : "時間未定"}</small></button>`).join("") || '<p class="muted">PDFを取り込むと講義が表示されます。</p>'}</div></details>
    ${data.showBands ? `<details id="timetable-facilities" class="schedule-fold"><summary>施設の営業時間</summary><p class="muted">通常期の目安です。臨時変更は公式情報で確認してください。</p>${week.days.map(day => `<h3>${esc(day)}</h3>${data.facilities.filter(f => f.band).map(f => `<p class="muted">${esc(f.title)} · ${esc(facilityHours(f, day) || "休業")}</p>`).join("")}`).join("")}</details>` : ""}<details id="personal-edits" class="schedule-fold"><summary>取消・個人修正の管理</summary>${[...data.courseEdits, ...data.occurrenceEdits].map(x => {
      const a = "reset-" + x.id;
      action(a, () => { data.courseEdits = data.courseEdits.filter(e => e.id !== x.id); data.occurrenceEdits = data.occurrenceEdits.filter(e => e.id !== x.id); changed(); render(); });
      return `<p>${esc(x.title || x.id)} ${x.cancelled ? "取消" : ""} ${btn("修正を解除", a, "smallbtn")}</p>`;
    }).join("") || "<p>個人修正はありません。</p>"}</details>`;
  bindDatePicker();
  page.querySelectorAll<HTMLElement>("[data-course]").forEach(b => b.onclick = () => { articleFilters.courseId = b.dataset.course!; location.hash = "articles"; });
}
export async function openImport() {
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
        const { previewPDF } = await import("../pdf");
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
        setData(install(data, p, choices));
        changed();
        if (!(await save()))
          throw Error("保存に失敗しました。差分は保持しています。");
        d.close();
        render();
      },
      "この内容を保存",
    );
}
