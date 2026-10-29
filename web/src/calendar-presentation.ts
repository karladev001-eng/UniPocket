import {
  addDay,
  dayKey,
  onDay,
  tokyo,
  weekDay,
  type CampusEvent,
} from "./domain";

export type CalendarMode = "day" | "three" | "week" | "month";
export const minutePixels = 1.5;
export const lectureEvents = (all: CampusEvent[]) =>
  all.filter((e) => e.kind === "class" || e.kind === "exam");
export const initialCalendarMode = (width: number): CalendarMode =>
  width <= 350 ? "day" : width < 768 ? "three" : "week";
export function shiftCalendarDay(
  day: string,
  mode: CalendarMode,
  direction: number,
) {
  if (mode !== "month")
    return addDay(
      day,
      direction * (mode === "week" ? 7 : mode === "three" ? 3 : 1),
    );
  const d = new Date(tokyo(day.slice(0, 7) + "-01", "12:00"));
  d.setUTCMonth(d.getUTCMonth() + direction);
  return dayKey(d);
}
export function calendarDays(day: string, mode: CalendarMode) {
  const first = mode === "month" ? day.slice(0, 7) + "-01" : day;
  const start =
    mode === "week" || mode === "month"
      ? addDay(first, 1 - weekDay(first))
      : first;
  return Array.from(
    {
      length:
        mode === "month" ? 42 : mode === "week" ? 7 : mode === "three" ? 3 : 1,
    },
    (_, i) => addDay(start, i),
  );
}
export interface DaySegment {
  event: CampusEvent;
  day: string;
  start: number;
  end: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
// Half-open Tokyo days: an event ending at midnight never appears on the next day.
export function daySegments(all: CampusEvent[], day: string): DaySegment[] {
  const from = Date.parse(tokyo(day)),
    to = Date.parse(tokyo(addDay(day, 1)));
  return all
    .filter((e) => !e.allDay && onDay(e, day))
    .map((event) => {
      const start = Date.parse(event.start),
        end = Date.parse(event.end);
      return {
        event,
        day,
        start: (Math.max(start, from) - from) / 60000,
        end: (Math.min(end, to) - from) / 60000,
        continuesBefore: start < from,
        continuesAfter: end > to,
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.event.id.localeCompare(b.event.id),
    );
}
export interface LayoutSegment extends DaySegment {
  column: number;
}
export interface OverlapGroup {
  start: number;
  end: number;
  columns: number;
  segments: LayoutSegment[];
}
// Hit targets participate in overlap layout too. A five-minute entry therefore cannot
// cover the next entry's only detail button even though its real-duration marker is short.
export function overlapGroups(segments: DaySegment[]): OverlapGroup[] {
  const groups: OverlapGroup[] = [];
  let group: OverlapGroup | undefined,
    ends: number[] = [];
  for (const segment of [...segments].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (!group || segment.start >= Math.max(...ends)) {
      group = {
        start: segment.start,
        end: segment.end,
        columns: 0,
        segments: [],
      };
      groups.push(group);
      ends = [];
    }
    let column = ends.findIndex((end) => end <= segment.start);
    if (column < 0) column = ends.length;
    ends[column] = Math.max(segment.end, segment.start + 44 / minutePixels);
    group.segments.push({ ...segment, column });
    group.columns = Math.max(group.columns, ends.length);
    group.end = Math.max(group.end, segment.end);
  }
  return groups;
}
export function nextEvent(all: CampusEvent[], now = Date.now()) {
  return all
    .filter((e) => !e.allDay && Date.parse(e.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
}
export function eventKind(e: CampusEvent): string {
  switch (e.kind) {
    case "class":
      return "授業";
    case "exam":
      return "試験・要確認";
    case "personal":
      return "個人予定";
    case "university":
      return "大学行事";
    default:
      return "予定";
  }
}

export function initialScrollMinute(
  all: CampusEvent[],
  days: string[],
  now: number,
  fallbackHour: number,
) {
  const today = dayKey(new Date(now));
  if (days.includes(today)) return (now - Date.parse(tokyo(today))) / 60000;
  const starts = days.flatMap((day) =>
    daySegments(all, day).map((s) => s.start),
  );
  return starts.length ? Math.min(...starts) : fallbackHour * 60;
}
