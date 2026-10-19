import { addDay, dayKey, onDay, tokyo, weekDay, type CampusEvent } from "./domain";

export const periods = [
  ["08:40", "10:10"], ["10:20", "11:50"], ["12:45", "14:15"],
  ["14:25", "15:55"], ["16:05", "17:35"],
] as const;

// An exact single period is the only representation that does not hide time changes.
export function eventPeriod(event: CampusEvent): number {
  if (event.allDay) return -1;
  const day = dayKey(new Date(event.start));
  return periods.findIndex(([start, end]) =>
    Date.parse(event.start) === Date.parse(tokyo(day, start)) &&
    Date.parse(event.end) === Date.parse(tokyo(day, end)));
}
export function weekPresentation(all: CampusEvent[], selectedDay: string, weekend: boolean) {
  const start = addDay(selectedDay, 1 - weekDay(selectedDay));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDay(start, i));
  const inWeek = all.filter(e => weekDays.some(day => onDay(e, day)));
  const days = weekDays.slice(weekend ? 5 : 0, weekend ? 7 : 5);
  return {
    start, days,
    cells: periods.map((_, period) => days.map(day => inWeek.filter(e =>
      dayKey(new Date(e.start)) === day && eventPeriod(e) === period))),
    other: inWeek.filter(e => eventPeriod(e) < 0),
    weekendCount: inWeek.filter(e => weekDays.slice(5).some(day => onDay(e, day))).length,
  };
}

// Text hashing is independent of event order, weekday and occurrence date.
export function courseColor(title: string) {
  let hash = 2166136261;
  for (const char of title.normalize("NFKC").replace(/\s+/g, "").trim()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `course-color-${(hash >>> 0) % 6}`;
}

export function updatePresentation(message: string, ready: boolean) {
  const waiting = /新版を取得|全タブの編集/.test(message);
  const failed = /失敗|できません|タイムアウト|応答がありません/.test(message);
  return {
    label: waiting ? "編集後に更新します" : /最新バージョン/.test(message) ? "最新です" :
      /確認しています/.test(message) ? "確認中…" : /ダウンロード/.test(message) ? "新版を取得中…" :
      /保存を確認/.test(message) ? "保存して更新中…" : failed ? "更新できませんでした" : message,
    install: ready && !failed,
    detail: failed ? message : "",
  };
}
