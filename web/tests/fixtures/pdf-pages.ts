import { PageText, type TextItem } from "../../src/pdf-parser";

export function pdfPages() {
  const t: TextItem[] = [],
    a: TextItem[] = [];
  const ti = (str: string, x: number, y: number) =>
      t.push({ str, x, y, width: 20, height: 10 }),
    ai = (str: string, x: number, y: number) =>
      a.push({ str, x, y, width: 20, height: 10 });
  ti("履修登録確認票 通常講義 その他 学部 登録一覧", 600, 50);
  ti("2026年度後期", 15, 90);
  const xs = [28.44, 106.92, 185.4, 263.88, 342.36, 421.02, 499.5];
  for (let i = 0; i < 6; i++) ti("月火水木金土"[i], xs[i] + 1, 135);
  ti("通常講義", 30, 146);
  ti("数学", 30, 162);
  ti("情1", 30, 185);
  ai("令和8年度 行事予定表 後学期試験 通常課程 学年暦 学務", 20, 20);
  const cols = [844.36, 978.44, 1112.5, 1246.6, 1384.7, 1518.8],
    months = [10, 11, 12, 1, 2, 3];
  let index = 0;
  for (let c = 0; c < 6; c++) {
    ai(months[c] + "月", cols[c] + 1, 160);
    const y = months[c] < 4 ? 2027 : 2026,
      n = new Date(y, months[c], 0).getDate();
    for (let d = 1; d <= n; d++) {
      const top = 191.08 + (d - 1) * 22.115;
      ai(String(d), cols[c] + 1, top + 4);
      if (index < 90) {
        ai(
          "月火水木金土"[index % 6] + String(Math.floor(index / 6) + 1),
          cols[c] + 40,
          top + 4,
        );
        index++;
      }
    }
  }
  return { t: new PageText(842, 595, t), a: new PageText(1700.74, 1202.74, a) };
}
