export interface Course {
  id: string;
  title: string;
  weekday: number | null;
  block: number | null;
  room: string;
}
export interface CampusEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  kind: string;
  allDay: boolean;
}
export interface Plan {
  key: string;
  year: number;
  courses: Course[];
  events: CampusEvent[];
  warnings: string[];
  importedAt: string;
}
export interface Edit {
  id: string;
  title?: string;
  location?: string;
  start?: string;
  end?: string;
  cancelled?: boolean;
  allDay?: boolean;
}
export interface Note {
  id: string;
  text: string;
  color: string;
  modified: string;
  images: { id: string; data: string }[];
  checklist: { id: string; text: string; done: boolean }[];
}
export interface Facility {
  id: string;
  title: string;
  weekdays: Record<string, string>;
  exceptions: Record<string, string>;
  source: string;
  band: boolean;
}
export interface Link {
  id: string;
  title: string;
  url: string;
  favorite: boolean;
}
export interface Data {
  schema: 1;
  imports: Plan[];
  occurrenceEdits: Edit[];
  courseEdits: Edit[];
  addedEvents: CampusEvent[];
  preservedEvents: CampusEvent[];
  notes: Note[];
  pinned: string[];
  facilities: Facility[];
  links: Link[];
  theme: string;
  background: string;
  backgroundMode?: string;
  showBands: boolean;
  startHour: number;
  endHour: number;
  articleDraft: Record<string, string>;
  eventDraft?: { event: CampusEvent; values: Record<string, string> };
}
export const uid = () => crypto.randomUUID();
export function emptyData(): Data {
  return {
    schema: 1,
    imports: [],
    occurrenceEdits: [],
    courseEdits: [],
    addedEvents: [],
    preservedEvents: [],
    notes: [],
    pinned: [],
    facilities: [
      ["北館ショップ", "10:00–17:00"],
      ["北館食堂", "11:00–14:00"],
      ["みなっぷ", "10:00–15:00"],
      ["南館食堂", "11:00–14:30 / 17:00–19:00（L.O.18:45）"],
      ["トラベルセンター", "10:00–16:15"],
      ["住まい・総務", "11:00–16:15"],
    ].map(([title, hours], i) => ({
      id: `facility-${i}`,
      title,
      weekdays: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, hours])),
      exceptions: {},
      source: "https://www.univcoop-tokai.jp/sucoop/coop/coop_604.html",
      band: i === 0 || i === 3,
    })),
    links: [
      ["学務情報", "https://gakujo.shizuoka.ac.jp/lcu-web/"],
      [
        "大学行事・時限",
        "https://www.shizuoka.ac.jp/education/affairs/schedule/",
      ],
      ["静大生協", "https://www.univcoop-tokai.jp/sucoop/coop/coop_604.html"],
    ].map(([title, url], i) => ({
      id: `link-${i}`,
      title,
      url,
      favorite: false,
    })),
    theme: "green",
    background: "",
    showBands: true,
    startHour: 8,
    endHour: 19,
    articleDraft: {},
  };
}
export const dayKey = (d = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
export const minute = (d: string) => {
  const t = new Date(d);
  return (
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(t)
        .slice(0, 2),
    ) *
      60 +
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        minute: "2-digit",
      }).format(t),
    )
  );
};
export const tokyo = (day: string, time = "00:00") =>
  new Date(`${day}T${time}:00+09:00`).toISOString();
export const addDay = (day: string, n: number) =>
  dayKey(new Date(new Date(tokyo(day)).getTime() + n * 86400000));
export const weekDay = (day: string) =>
  ((new Date(`${day}T12:00:00+09:00`).getUTCDay() + 6) % 7) + 1;
export const timeLabel = (s: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s));
export function courseID(data: Data, e: CampusEvent): string | undefined {
  return data.imports
    .flatMap((p) => p.courses)
    .sort((a, b) => b.id.length - a.id.length)
    .find((c) => e.id.startsWith(c.id + "-"))?.id;
}
export const originals = (d: Data) => [
  ...d.preservedEvents,
  ...d.imports.flatMap((p) => p.events),
  ...d.addedEvents,
];
export function applyEdit(
  e: CampusEvent,
  x: Edit | undefined,
  course = false,
): CampusEvent {
  if (!x) return e;
  let result = {
    ...e,
    title: x.title ?? e.title,
    location: x.location ?? e.location,
    allDay: x.allDay ?? e.allDay,
  };
  if (x.start && x.end) {
    if (course) {
      const shift = (minute(x.start) - minute(e.start)) * 60000;
      const start = new Date(e.start).getTime() + shift;
      result = {
        ...result,
        start: new Date(start).toISOString(),
        end: new Date(
          start + new Date(x.end).getTime() - new Date(x.start).getTime(),
        ).toISOString(),
      };
    } else result = { ...result, start: x.start, end: x.end };
  }
  return result;
}
export function events(d: Data): CampusEvent[] {
  const seen = new Set<string>();
  return originals(d)
    .flatMap((e) => {
      if (seen.has(e.id)) return [];
      seen.add(e.id);
      const c = d.courseEdits.find((x) => x.id === courseID(d, e)),
        o = d.occurrenceEdits.find((x) => x.id === e.id);
      if (o?.cancelled ?? c?.cancelled) return [];
      return [applyEdit(applyEdit(e, c, true), o)];
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function onDay(e: CampusEvent, day: string) {
  return e.start < tokyo(addDay(day, 1)) && e.end > tokyo(day);
}
export interface Difference {
  id: string;
  before?: CampusEvent;
  after?: CampusEvent;
  conflict: boolean;
}
export function difference(d: Data, p: Plan): Difference[] {
  const a = new Map(
      d.imports.find((x) => x.key === p.key)?.events.map((e) => [e.id, e]) ??
        [],
    ),
    b = new Map(p.events.map((e) => [e.id, e]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((id) => {
    if (JSON.stringify(a.get(id)) === JSON.stringify(b.get(id))) return [];
    const e = a.get(id) ?? b.get(id)!;
    return [
      {
        id,
        before: a.get(id),
        after: b.get(id),
        conflict:
          d.occurrenceEdits.some((x) => x.id === id) ||
          d.courseEdits.some((x) => x.id === courseID(d, e)),
      },
    ];
  });
}
export function install(
  d: Data,
  p: Plan,
  choices: Record<string, "personal" | "pdf">,
): Data {
  const diffs = difference(d, p);
  if (diffs.some((x) => x.conflict && !choices[x.id]))
    throw Error("個人修正との競合をすべて選択してください。");
  const out = structuredClone(d),
    effective = new Map(events(d).map((e) => [e.id, e]));
  const personal = (e: CampusEvent): Edit => ({
    ...(effective.get(e.id) ?? e),
    cancelled: !effective.has(e.id),
  });
  const affected = new Set(
    diffs
      .filter((x) => x.conflict && choices[x.id] === "pdf")
      .map((x) => courseID(d, (x.before ?? x.after)!)),
  );
  for (const e of originals(d))
    if (affected.has(courseID(d, e)) && courseID(d, e)) {
      out.occurrenceEdits = out.occurrenceEdits.filter((x) => x.id !== e.id);
      out.occurrenceEdits.push(personal(e));
    }
  out.courseEdits = out.courseEdits.filter((x) => !affected.has(x.id));
  for (const diff of diffs) {
    out.preservedEvents = out.preservedEvents.filter((x) => x.id !== diff.id);
    if (diff.conflict && choices[diff.id] === "personal" && diff.before) {
      out.preservedEvents.push(diff.before);
      out.occurrenceEdits = out.occurrenceEdits.filter((x) => x.id !== diff.id);
      out.occurrenceEdits.push(personal(diff.before));
    }
    if (diff.conflict && choices[diff.id] === "pdf")
      out.occurrenceEdits = out.occurrenceEdits.filter((x) => x.id !== diff.id);
  }
  out.imports = out.imports.filter((x) => x.key !== p.key).concat(p);
  return out;
}
export function parseHours(
  s: string,
): { start: number; end: number; lastOrder?: number }[] {
  if (!s.trim()) return [];
  const result = s
    .split("/")
    .map((part) => {
      const m = [...part.matchAll(/(\d{1,2}):(\d{2})/g)];
      if (m.length < 2 || m.length > 3)
        throw Error(
          "時間は 10:00–17:00 / 18:00–19:00（L.O.18:45）の形式です。",
        );
      const times = m.map((x) => {
        const h = Number(x[1]),
          m = Number(x[2]);
        if (h > 24 || m > 59 || (h === 24 && m !== 0))
          throw Error("時刻が不正です。");
        return h * 60 + m;
      });
      if (
        times[1] <= times[0] ||
        (times[2] != null && (times[2] < times[0] || times[2] > times[1]))
      )
        throw Error("時間の前後関係が不正です。");
      return { start: times[0], end: times[1], lastOrder: times[2] };
    })
    .sort((a, b) => a.start - b.start);
  if (result.some((x, i) => i > 0 && result[i - 1].end > x.start))
    throw Error("営業時間が重複しています。");
  return result;
}
export function facilityHours(f: Facility, day: string) {
  return f.exceptions[day] ?? f.weekdays[weekDay(day)] ?? "";
}
export function validateData(v: unknown): asserts v is Data {
  const d = v as Data;
  if (
    !d ||
    d.schema !== 1 ||
    !Array.isArray(d.imports) ||
    !Array.isArray(d.notes) ||
    !Array.isArray(d.facilities) ||
    !Array.isArray(d.links) ||
    !Array.isArray(d.occurrenceEdits) ||
    !Array.isArray(d.courseEdits) ||
    !Array.isArray(d.preservedEvents) ||
    !Array.isArray(d.addedEvents) ||
    !Array.isArray(d.pinned) ||
    typeof d.articleDraft !== "object" ||
    !["green", "blue", "rose", "mono"].includes(d.theme) ||
    typeof d.background !== "string" ||
    (d.backgroundMode !== undefined && !["none", "custom", "forest", "sea", "sky", "sunset", "paper", "shape"].includes(d.backgroundMode)) ||
    d.startHour < 0 ||
    d.endHour > 24 ||
    d.startHour >= d.endHour
  )
    throw Error(
      "保存データの版または内容が未対応です。原本を保護して読込を中止しました。",
    );
  const unique = (a: { id: string }[]) => {
    if (new Set(a.map((x) => x.id)).size !== a.length)
      throw Error("保存データのIDが重複しています。");
  };
  [
    d.notes,
    d.facilities,
    d.links,
    d.courseEdits,
    d.occurrenceEdits,
    d.preservedEvents,
    d.addedEvents,
  ].forEach(unique);
  for (const p of d.imports) {
    if (!Array.isArray(p.courses) || !Array.isArray(p.events))
      throw Error("PDFの保存データが破損しています。");
    unique(p.events);
    unique(p.courses);
  }
  for (const e of originals(d))
    if (
      !Number.isFinite(Date.parse(e.start)) ||
      !Number.isFinite(Date.parse(e.end)) ||
      e.start >= e.end
    )
      throw Error("予定の保存データが破損しています。");
  for (const n of d.notes) {
    if (
      typeof n.text !== "string" ||
      !Array.isArray(n.images) ||
      !Array.isArray(n.checklist)
    )
      throw Error("メモの保存データが破損しています。");
    unique(n.images);
    unique(n.checklist);
  }
  for (const f of d.facilities) {
    Object.values(f.weekdays).forEach(parseHours);
    Object.values(f.exceptions).forEach(parseHours);
  }
}
