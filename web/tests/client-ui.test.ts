import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { emptyData, validateData } from "../src/domain";
import { LocalStore, SaveQueue } from "../src/storage";
import {
  backgrounds,
  visibleBackground,
  namedAuthor,
  noteHasContent,
} from "../src/ui-assets";

describe("UI data compatibility", () => {
  it("preserves the original uploaded background across presets, none, and reopening storage", async () => {
    const store = new LocalStore();
    const data = await store.open();
    data.background = "data:image/jpeg;base64,original";
    expect(visibleBackground(data)).toBe(data.background);
    for (const preset of backgrounds) {
      data.backgroundMode = preset.id;
      validateData(data);
      expect(visibleBackground(data)).toBe(preset.image);
      expect(preset.image).toMatch(/^data:image\/svg\+xml,/);
    }
    data.backgroundMode = "none";
    expect(visibleBackground(data)).toBe("");
    await store.save(data);
    store.close();
    const reopened = new LocalStore();
    const restored = await reopened.open();
    expect(restored.backgroundMode).toBe("none");
    restored.backgroundMode = "custom";
    expect(visibleBackground(restored)).toBe("data:image/jpeg;base64,original");
    reopened.close();
  });
  it("keeps a new note, images and checklist available to export after a tab conflict", async () => {
    const winner = new LocalStore(),
      stale = new LocalStore();
    const otherData = await winner.open(),
      current = await stale.open();
    const note = {
      id: "unsaved-new",
      text: "現在の入力",
      modified: new Date().toISOString(),
      color: "green",
      images: [{ id: "image", data: "data:image/jpeg;base64,current" }],
      checklist: [{ id: "check", text: "未保存の項目", done: true }],
    };
    current.notes.unshift(note);
    const queue = new SaveQueue(stale, () => current);
    queue.changed();
    await winner.save(otherData);
    await expect(queue.flush()).rejects.toThrow("別タブ");
    expect(queue.dirty).toBe(true);
    // exportData reads current data, not the last successfully saved snapshot.
    expect(JSON.parse(JSON.stringify(current)).notes[0]).toEqual(note);
    winner.close();
    stale.close();
  });
  it("accepts legacy data and rejects unknown background choices", () => {
    const data = emptyData();
    expect(() => validateData(data)).not.toThrow();
    data.backgroundMode = "unsupported";
    expect(() => validateData(data)).toThrow();
  });
  it("offers author filters only for a non-default display name", () => {
    for (const name of [
      null,
      undefined,
      "",
      "   ",
      "匿名ユーザー",
      " 匿名ユーザー ",
    ])
      expect(namedAuthor(name)).toBe(false);
    expect(namedAuthor("学生A")).toBe(true);
  });
  it("does not count blank checklist rows as a new note, but keeps image-only and checklist-only notes", () => {
    const note = {
      text: " \n",
      images: [] as unknown[],
      checklist: [{ text: "  " }],
    };
    expect(noteHasContent(note)).toBe(false);
    note.images.push({ data: "image" });
    expect(noteHasContent(note)).toBe(true);
    note.images = [];
    note.checklist[0].text = "課題";
    expect(noteHasContent(note)).toBe(true);
  });
});

import { tokyo, type CampusEvent } from "../src/domain";
import {
  periods,
  eventPeriod,
  weekPresentation,
  courseColor,
  updatePresentation,
} from "../src/schedule-presentation";
const scheduled = (
  id: string,
  day: string,
  start = "08:40",
  end = "10:10",
): CampusEvent => ({
  id,
  title: "情報デザインの基礎と実践",
  start: tokyo(day, start),
  end: tokyo(day, end),
  location: "共12",
  kind: "personal",
  allDay: false,
});
describe("week presentation without losing exceptions", () => {
  it("places exact local periods and retains every overlapping event in a cell", () => {
    const all = periods.map(([start, end], i) =>
      scheduled("period-" + i, "2026-10-19", start, end),
    );
    all.push(scheduled("overlap", "2026-10-19"));
    const week = weekPresentation(all, "2026-10-21", false);
    expect(week.days).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(week.cells[0][0].map((e) => e.id)).toEqual(["period-0", "overlap"]);
    expect(week.cells.map((row) => row[0].length)).toEqual([2, 1, 1, 1, 1]);
    expect(week.other).toEqual([]);
  });
  it("keeps all-day, shifted, multi-period, night and cross-midnight events in the other list", () => {
    const all = [
      { ...scheduled("all-day", "2026-10-19", "00:00", "23:59"), allDay: true },
      scheduled("shifted", "2026-10-19", "08:50", "10:20"),
      scheduled("multi-period", "2026-10-20", "08:40", "11:50"),
      scheduled("night", "2026-10-21", "19:00", "20:00"),
      {
        ...scheduled("midnight", "2026-10-22", "23:00"),
        end: tokyo("2026-10-23"),
      },
      {
        ...scheduled("same-wall-times-next-day", "2026-10-20"),
        end: tokyo("2026-10-21", "10:10"),
      },
    ];
    expect(all.map(eventPeriod)).toEqual([-1, -1, -1, -1, -1, -1]);
    const week = weekPresentation(all, "2026-10-19", false);
    expect(week.other.map((e) => e.id)).toEqual(all.map((e) => e.id));
    expect(week.cells.flat(2)).toEqual([]);
  });
  it("counts weekend occurrences and gives both weekend days access to every exact period", () => {
    const all = [
      scheduled("saturday", "2026-10-24"),
      scheduled("sunday", "2026-10-25"),
      { ...scheduled("sunday-outside", "2026-10-25", "19:00", "20:00") },
      {
        ...scheduled("friday-night", "2026-10-23", "23:00"),
        end: tokyo("2026-10-24", "01:00"),
      },
    ];
    const weekdays = weekPresentation(all, "2026-10-19", false);
    const weekend = weekPresentation(all, "2026-10-25", true);
    expect(weekdays.weekendCount).toBe(4);
    expect(weekend.days).toEqual(["2026-10-24", "2026-10-25"]);
    expect(weekend.cells[0].flat().map((e) => e.id)).toEqual([
      "saturday",
      "sunday",
    ]);
    expect(weekdays.other.map((e) => e.id)).toEqual([
      "sunday-outside",
      "friday-night",
    ]);
    expect(weekend.other).toEqual(weekdays.other);
  });
  it("uses half-open week boundaries without duplicating midnight endings in the following week", () => {
    const endingAtWeek = {
      ...scheduled("previous", "2026-10-18", "23:00"),
      end: tokyo("2026-10-19"),
    };
    const crossingIntoWeek = {
      ...endingAtWeek,
      id: "crossing",
      end: tokyo("2026-10-19", "01:00"),
    };
    const nextWeek = scheduled("next", "2026-10-26");
    expect(
      weekPresentation(
        [endingAtWeek, crossingIntoWeek, nextWeek],
        "2026-10-19",
        false,
      ).other.map((e) => e.id),
    ).toEqual(["crossing"]);
  });
  it("keeps empty 5 by 5 and 2 by 5 grids and uses a bounded stable subject palette", () => {
    expect(
      weekPresentation([], "2026-10-19", false).cells.map((row) => row.length),
    ).toEqual([5, 5, 5, 5, 5]);
    expect(
      weekPresentation([], "2026-10-19", true).cells.map((row) => row.length),
    ).toEqual([2, 2, 2, 2, 2]);
    const title = "情報デザイン";
    expect(courseColor(title)).toBe(courseColor(" 情報 デザイン "));
    const sameSubject = ["2026-10-19", "2026-10-20", "2026-10-26"].map((day) =>
      scheduled(day, day),
    );
    expect(new Set(sameSubject.map((e) => courseColor(e.title))).size).toBe(1);
    const colors = Array.from({ length: 100 }, (_, i) =>
      courseColor("科目" + i),
    );
    expect(new Set(colors).size).toBeLessThanOrEqual(6);
    expect(colors.every((c) => /^course-color-[0-5]$/.test(c))).toBe(true);
  });
});
describe("compact update presentation", () => {
  it("keeps editing wait and install action without changing the automatic update handshake", () => {
    expect(
      updatePresentation(
        "新版を取得しました。全タブの編集・処理・保存が終わると自動で更新します。",
        true,
      ),
    ).toEqual({ label: "編集後に更新します", install: true, detail: "" });
    expect(updatePresentation("最新バージョンです。", false).label).toBe(
      "最新です",
    );
    expect(updatePresentation("更新を確認しています…", false).label).toBe(
      "確認中…",
    );
    expect(
      updatePresentation("新版をダウンロードしています。", false).label,
    ).toBe("新版を取得中…");
  });
  it("retains actionable failure and offline instructions without offering an unavailable installation", () => {
    const message =
      "更新前の保存に失敗しました。入力を保持しています。保存後に再試行してください。";
    expect(updatePresentation(message, true)).toEqual({
      label: "更新できませんでした",
      install: false,
      detail: message,
    });
    const offline = "オフラインです。通信が戻ると更新を確認します。";
    expect(updatePresentation(offline, false)).toEqual({
      label: offline,
      install: false,
      detail: "",
    });
  });
});
