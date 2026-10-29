// Calendar: day / 3-day / week time grids with overlap handling, and the month view.
import {
  type CalendarMode,
  minutePixels,
  shiftCalendarDay,
  calendarDays,
  daySegments,
  overlapGroups,
  eventKind,
  initialScrollMinute,
} from "../calendar-presentation";
import { dayKey, weekDay, timeLabel, tokyo, events, onDay } from "../domain";
import { action, data, page, render, view } from "../app/context";
import { btn, esc, heading } from "../ui/html";
import {
  bindDatePicker,
  colorFor,
  dateTools,
  editEvent,
  eventChooser,
  eventDate,
  showEvent,
} from "./events";
export function renderCalendar() {
  const mode = view.calendarMode,
    all = events(data),
    days = calendarDays(view.selectedDay, mode);
  action("prev-date", () => {
    view.selectedDay = shiftCalendarDay(view.selectedDay, mode, -1);
    render();
  });
  action("next-date", () => {
    view.selectedDay = shiftCalendarDay(view.selectedDay, mode, 1);
    render();
  });
  action("today", () => {
    view.selectedDay = dayKey();
    render();
  });
  action("event-new", () => editEvent());
  action("event-resume", () => editEvent(undefined, true));
  for (const v of ["day", "three", "week", "month"] as CalendarMode[])
    action("calendar-" + v, () => {
      view.calendarMode = v;
      render();
    });
  const labels: Record<CalendarMode, string> = {
    day: "日",
    three: "3日",
    week: "週",
    month: "月",
  };
  let content: string;
  if (mode === "month") {
    content = `<div class="month-calendar" role="group" aria-label="${esc(view.selectedDay.slice(0, 7))}の月予定表">${[..."月火水木金土日"].map((d) => `<div class="month-weekday">${d}</div>`).join("")}${days
      .map((day) => {
        const current = all.filter((e) => onDay(e, day)),
          a = "month-" + day,
          c = "month-list-" + day;
        action(a, () => {
          view.selectedDay = day;
          view.calendarMode = "day";
          render();
        });
        action(c, () => eventChooser(day + " の予定", current));
        return `<div class="month-day ${day.slice(0, 7) !== view.selectedDay.slice(0, 7) ? "outside-month" : ""} ${day === dayKey() ? "today" : ""}"><button class="month-date" data-action="${a}" aria-label="${day}の時間軸を開く">${Number(day.slice(-2))}</button>${
          current.length
            ? `<button class="month-count" data-action="${c}" aria-label="${day}の${current.length}件をすべて確認">${current.length}件<span>${current
                .slice(0, 2)
                .map(
                  (e) =>
                    `<small>${esc((e.allDay ? "終日 " : timeLabel(e.start) + " ") + e.title)}</small>`,
                )
                .join("")}</span></button>`
            : '<span class="month-empty">予定なし</span>'
        }</div>`;
      })
      .join("")}</div>`;
  } else {
    const estimatedWidth = Math.max(
      84,
      ((page.clientWidth || window.innerWidth - 24) - 46) / days.length,
    );
    const columnWidth =
      mode === "week" ? Math.max(120, estimatedWidth) : estimatedWidth;
    const maxColumns = Math.max(1, Math.floor(columnWidth / 48));
    content = `<div class="timeline-scroll" tabindex="0" aria-label="00時から24時の予定表。縦に時間、横に日付。"><div class="timeline ${mode === "week" ? "full-week" : ""}" style="--day-count:${days.length}"><div class="timeline-top"><div class="timeline-head"><span class="time-corner">時刻</span>${days.map((day) => `<div class="timeline-date ${day === dayKey() ? "today" : ""}" data-day="${day}"><b>${Number(day.slice(5, 7))}/${Number(day.slice(-2))}</b><span>${"月火水木金土日"[weekDay(day) - 1]}</span></div>`).join("")}</div><div class="all-day-row"><span class="all-day-label">終日</span>${days
      .map(
        (day) =>
          `<div>${
            all
              .filter((e) => e.allDay && onDay(e, day))
              .map((e) => {
                const a = "event-" + e.id;
                action(a, () => showEvent(e));
                return `<button class="all-day-event ${colorFor(e)}" data-action="${esc(a)}">${esc(eventKind(e))} · ${esc(e.title)}</button>`;
              })
              .join("") || '<span aria-label="終日予定なし">—</span>'
          }</div>`,
      )
      .join(
        "",
      )}</div></div><div class="timeline-body"><div class="time-axis">${Array.from({ length: 49 }, (_, i) => `<span style="top:${i * 30 * minutePixels}px">${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}</span>`).join("")}</div>${days
      .map((day) => {
        const groups = overlapGroups(daySegments(all, day));
        return `<div class="timeline-day" data-day="${day}">${Array.from(
          { length: 48 },
          (_, i) => {
            const a = `slot-${day}-${i}`,
              time =
                String(Math.floor(i / 2)).padStart(2, "0") +
                (i % 2 ? ":30" : ":00");
            action(a, () => {
              view.selectedDay = day;
              editEvent(undefined, false, tokyo(day, time));
            });
            return `<button class="time-slot" data-action="${a}" style="top:${i * 30 * minutePixels}px" aria-label="${day} ${time}に個人予定を追加"></button>`;
          },
        ).join("")}${groups
          .map((group, index) => {
            if (group.columns > maxColumns) {
              const a = `density-${day}-${index}`;
              action(a, () =>
                eventChooser(
                  day + " この時間の予定",
                  group.segments.map((s) => s.event),
                ),
              );
              return `<button class="dense-events" data-action="${a}" style="top:${group.start * minutePixels}px;height:${Math.max(44, (group.end - group.start) * minutePixels)}px"><b>この時間に${group.segments.length}件</b><small>${minuteLabel(group.start)}–${minuteLabel(group.end)}</small></button>`;
            }
            return group.segments
              .map((s) => {
                const a = "event-" + s.event.id;
                action(a, () => showEvent(s.event));
                const duration = (s.end - s.start) * minutePixels;
                return `<button class="timeline-event ${colorFor(s.event)} ${duration < 44 ? "short-event" : ""}" data-action="${esc(a)}" style="top:${s.start * minutePixels}px;height:${Math.max(44, duration)}px;left:calc(${(100 * s.column) / group.columns}% + 2px);width:calc(${100 / group.columns}% - 4px);--real-height:${duration}px" aria-label="${esc(eventKind(s.event) + " " + s.event.title + " " + eventDate(s.event) + " " + s.event.location)}"><span class="duration-marker" aria-hidden="true"></span><small>${s.continuesBefore ? "前日から " : ""}${minuteLabel(s.start)}–${minuteLabel(s.end)}${s.continuesAfter ? " 翌日へ" : ""}</small><strong>${esc(s.event.title)}</strong><span class="timeline-kind">${esc(eventKind(s.event))}${s.event.location ? " · " + esc(s.event.location) : ""}</span></button>`;
              })
              .join("");
          })
          .join(
            "",
          )}${day === dayKey() ? `<div class="now-line" style="top:${((Date.now() - Date.parse(tokyo(day))) / 60000) * minutePixels}px" aria-label="現在時刻"></div>` : ""}</div>`;
      })
      .join("")}</div></div></div>`;
  }
  page.innerHTML =
    heading(
      "予定表",
      "",
      btn("＋ 予定", "event-new", "primary") +
        `<details class="schedule-menu"><summary aria-label="予定表メニュー">⋯</summary><div><a href="#timetable">時間割を開く</a>${data.eventDraft ? btn("予定の下書きを再開", "event-resume") : ""}</div></details>`,
    ) +
    `<div class="view-tools"><div class="seg">${(["day", "three", "week", "month"] as CalendarMode[]).map((v) => `<button data-action="calendar-${v}" class="${v === mode ? "selected" : ""}" aria-pressed="${v === mode}">${labels[v]}</button>`).join("")}</div></div>${dateTools(labels[mode])}${mode === "week" ? '<p class="calendar-hint">横にスクロールして全曜日を表示</p>' : ""}${content}`;
  bindDatePicker();
  const scroller = page.querySelector<HTMLElement>(".timeline-scroll");
  if (scroller) {
    const minute = initialScrollMinute(all, days, Date.now(), data.startHour);
    scroller.scrollTop = Math.max(0, (minute - 60) * minutePixels);
  }
}
function minuteLabel(value: number) {
  return (
    String(Math.floor(value / 60)).padStart(2, "0") +
    ":" +
    String(Math.floor(value % 60)).padStart(2, "0")
  );
}
