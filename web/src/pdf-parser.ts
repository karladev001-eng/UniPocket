import {
  tokyo,
  addDay,
  type Plan,
  type Course,
  type CampusEvent,
} from "./domain";
const norm = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export class PageText {
  constructor(
    public width: number,
    public height: number,
    public items: TextItem[],
  ) {}
  lines(
    x: number,
    y: number,
    w: number,
    h: number,
    baseW: number,
    baseH: number,
  ) {
    const a = this.items
      .filter((i) => {
        const xx = (i.x / this.width) * baseW,
          yy = (i.y / this.height) * baseH;
        return xx + w * 0.001 >= x && xx < x + w && yy >= y - 1.5 && yy < y + h;
      })
      .sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));
    const lines: { y: number; items: TextItem[] }[] = [];
    for (const i of a) {
      let l = lines.find((l) => Math.abs(l.y - i.y) < 2);
      if (!l) {
        l = { y: i.y, items: [] };
        lines.push(l);
      }
      l.items.push(i);
    }
    return lines
      .map((l) =>
        l.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join("")
          .trim(),
      )
      .filter(Boolean);
  }
  text(x: number, y: number, w: number, h: number, bw: number, bh: number) {
    return this.lines(x, y, w, h, bw, bh).join(" ");
  }
  get all() {
    return this.items.map((x) => x.str).join(" ");
  }
}
export function parsePages(t: PageText, a: PageText): Plan {
  const tt = norm(t.all),
    at = norm(a.all);
  if (tt.length < 30 || at.length < 30)
    throw Error(
      "画像のみのPDF・OCRは未対応です。文字を含む原本を選択してください。",
    );
  if (
    !tt.includes("履修登録確認票") ||
    !tt.includes("通常講義") ||
    !tt.includes("その他") ||
    !at.includes("行事予定表") ||
    at.includes("夜間主コース") ||
    !at.includes("後学期試験")
  )
    throw Error("通常課程の履修登録確認票・年間行事予定表を選択してください。");
  const grid = (x: number, y: number, w: number, h: number) =>
      t.text(x, y, w, h, 842, 595),
    annual = (x: number, y: number, w: number, h: number) =>
      a.text(x, y, w, h, 1700.74, 1202.74);
  const year = Number(
      norm(grid(14, 86, 80, 17)).match(/(20\d{2})年度後期/)?.[1],
    ),
    era = Number(at.match(/令和(\d+)年度/)?.[1]);
  if (!year || !era)
    throw Error("後期の登録票・令和年度表記が必要です（前期は未対応）。");
  if (year !== era + 2018) throw Error("2つのPDFの年度が一致しません。");
  if (
    Math.abs(t.width / t.height - 842 / 595) > 0.03 ||
    Math.abs(a.width / a.height - 1700.74 / 1202.74) > 0.03
  )
    throw Error("既知の原本と縦横比が異なります。");
  const dayX = [28.44, 106.92, 185.4, 263.88, 342.36, 421.02, 499.5],
    days = "月火水木金土";
  for (let i = 0; i < 6; i++)
    if (!grid(dayX[i], 130, dayX[i + 1] - dayX[i], 13).includes(days[i]))
      throw Error("曜日見出しの座標が異なります。");
  const courses: Course[] = [];
  for (let wd = 1; wd <= 6; wd++)
    for (let block = 0; block < 7; block++) {
      const x = dayX[wd - 1],
        y = 143.74 + block * 60.48,
        w = dayX[wd] - x;
      if (!grid(x, y, w, 60.48).trim()) continue;
      const title = t.lines(x, y + 14, w, 16, 842, 595).join("");
      if (!title) throw Error("科目名を認識できません。");
      courses.push({
        id: `${year}-autumn-${wd}-${block}`,
        title,
        weekday: wd,
        block,
        room: grid(x, y + 38, w, 10),
      });
    }
  for (let row = 0; row < 7; row++) {
    const title = t
      .lines(503.1, 143.74 + row * 21.24, 172, 21.24, 842, 595)
      .join("");
    if (title)
      courses.push({
        id: `${year}-autumn-unscheduled-${row}`,
        title,
        weekday: null,
        block: null,
        room: "",
      });
  }
  if (!courses.some((c) => c.weekday))
    throw Error("通常講義が見つかりません。");
  const columns = [844.36, 978.44, 1112.5, 1246.6, 1384.7, 1518.8],
    months = [10, 11, 12, 1, 2, 3],
    times = [
      ["08:40", "10:10"],
      ["10:20", "11:50"],
      ["12:45", "14:15"],
      ["14:25", "15:55"],
      ["16:05", "17:35"],
      ["17:50", "19:20"],
      ["19:30", "21:00"],
    ],
    counts = new Map<number, Set<number>>(),
    events: CampusEvent[] = [];
  for (let col = 0; col < 6; col++) {
    const m = months[col],
      y = m < 4 ? year + 1 : year,
      left = columns[col],
      right = columns[col + 1] ?? 1653.69;
    if (!norm(annual(left, 152, right - left, 18)).includes(`${m}月`))
      throw Error("月見出しの座標が異なります。");
    const n = new Date(y, m, 0).getDate();
    for (let d = 1; d <= n; d++) {
      const top = 191.08 + (d - 1) * 22.115;
      if (Number(norm(annual(left, top, 19.5, 22.115))) !== d)
        throw Error(`${m}月${d}日のセル位置が異なります。`);
      const cell = norm(annual(left + 36, top, right - left - 36, 22.115)),
        markers = [...cell.matchAll(/([月火水木金土])([0-9]{1,2})(?![0-9])/g)],
        day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (markers.length > 1)
        throw Error("同じ日から複数の授業回を検出しました。");
      const marker = markers[0];
      if (
        marker &&
        !cell.includes("浜松休講") &&
        !cell.includes("対面授業等なし")
      ) {
        const wd = days.indexOf(marker[1]) + 1,
          number = Number(marker[2]);
        const set = counts.get(wd) ?? new Set();
        if (number < 1 || number > 15 || set.has(number))
          throw Error("授業回が重複または不正です。");
        set.add(number);
        counts.set(wd, set);
        for (const c of courses.filter((c) => c.weekday === wd)) {
          const time = times[c.block!],
            exam = cell.includes("試験") || number === 15;
          events.push({
            id: `${c.id}-${m}-${d}`,
            title:
              c.title + (exam ? "｜試験・第15回（要確認）" : `｜第${number}回`),
            start: tokyo(day, time[0]),
            end: tokyo(day, time[1]),
            location: c.room,
            kind: exam ? "exam" : "class",
            allDay: false,
          });
        }
      }
      let label = cell;
      for (const marker of markers) label = label.replace(marker[0], "");
      label = label.replace("月曜授業", "");
      if (cell.includes("大学祭") && cell.includes("静岡休講")) label = "";
      if (
        label &&
        !(label.includes("静岡") && !label.includes("浜松")) &&
        label !== "※5" &&
        label.length > 2
      )
        events.push({
          id: `${year}-autumn-university-${m}-${d}`,
          title: label,
          start: tokyo(day),
          end: tokyo(addDay(day, 1)),
          location: "",
          kind: "university",
          allDay: true,
        });
    }
  }
  for (const c of courses.filter((c) => c.weekday))
    if (counts.get(c.weekday!)?.size !== 15)
      throw Error(
        `${days[c.weekday! - 1]}曜の第1〜15回が揃いません。年度・形式を確認してください。`,
      );
  return {
    key: `${year}-autumn`,
    year,
    courses,
    events: events.sort((a, b) => a.start.localeCompare(b.start)),
    warnings: [
      "PDF原文の欠けた科目名はそのまま表示します。教室・授業内容は学務情報で確認してください。",
      "試験・第15回は候補です。非同期回、個別補講、研究・セミナーの日時は自動確定しません。",
      "通常課程1ページ目の浜松に適用する予定のみ使用します。集中講義・補講日は通常授業を追加しません。",
    ],
    importedAt: new Date().toISOString(),
  };
}
