import { pdfPages } from "./fixtures/pdf-pages";
import { ViewEpoch, updateBookmark } from "../src/article-request";
import { commitEvent } from "../src/event-editor";
import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  emptyData,
  validateData,
  events,
  install,
  difference,
  parseHours,
  facilityHours,
  tokyo,
  type CampusEvent,
  type Plan,
} from "../src/domain";
import { LocalStore, SaveQueue } from "../src/storage";
import { notionURL } from "../src/api";
import { resolveRoom, catalog } from "../src/map";
import { PageText, parsePages } from "../src/pdf-parser";
const event = (id = "2026-autumn-1-0-10-1", title = "数学"): CampusEvent => ({
  id,
  title,
  start: tokyo("2026-10-01", "08:40"),
  end: tokyo("2026-10-01", "10:10"),
  kind: "class",
  location: "情1",
  allDay: false,
});
const plan = (es = [event()]): Plan => ({
  key: "2026-autumn",
  year: 2026,
  courses: [
    { id: "2026-autumn-1-0", title: "数学", weekday: 1, block: 0, room: "情1" },
  ],
  events: es,
  warnings: [],
  importedAt: "2026-10-01T00:00:00Z",
});
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    value: new (fakeIndexedDB.constructor as { new (): IDBFactory })(),
    configurable: true,
  });
});
describe("personal timetable / import protection", () => {
  it("starts with no personal demo data", () => {
    const d = emptyData();
    expect(d.imports).toEqual([]);
    expect(d.notes).toEqual([]);
    expect(events(d)).toEqual([]);
  });
  it("applies course time shifts then occurrence edits and cancellations", () => {
    const d = emptyData();
    d.imports = [plan()];
    d.courseEdits = [
      {
        id: "2026-autumn-1-0",
        title: "個人タイトル",
        start: tokyo("2026-09-01", "09:00"),
        end: tokyo("2026-09-01", "10:00"),
      },
    ];
    expect(events(d)[0].start).toBe(tokyo("2026-10-01", "09:00"));
    d.occurrenceEdits = [{ id: event().id, cancelled: true }];
    expect(events(d)).toEqual([]);
  });
  it("refuses unresolved import conflicts and keeps personal removed events", () => {
    const d = emptyData();
    d.imports = [plan()];
    d.occurrenceEdits = [{ id: event().id, title: "個人の数学" }];
    const p = plan([]);
    expect(difference(d, p)[0].conflict).toBe(true);
    expect(() => install(d, p, {})).toThrow("競合");
    const out = install(d, p, { [event().id]: "personal" });
    expect(events(out)[0].title).toBe("個人の数学");
    expect(d.imports[0].events).toHaveLength(1);
  });
  it("PDF choice splits a course edit without losing other personal occurrences", () => {
    const one = event(),
      two = {
        ...event("2026-autumn-1-0-10-8"),
        start: tokyo("2026-10-08", "08:40"),
        end: tokyo("2026-10-08", "10:10"),
      };
    const d = emptyData();
    d.imports = [plan([one, two])];
    d.courseEdits = [{ id: "2026-autumn-1-0", title: "個人タイトル" }];
    const out = install(d, plan([{ ...one, title: "PDF変更" }, two]), {
      [one.id]: "pdf",
    });
    expect(events(out).find((x) => x.id === one.id)?.title).toBe("PDF変更");
    expect(events(out).find((x) => x.id === two.id)?.title).toBe(
      "個人タイトル",
    );
    expect(out.courseEdits).toHaveLength(0);
  });
  it("validates hours and holiday overrides in JST", () => {
    expect(parseHours("11:00–14:30 / 17:00–19:00（L.O.18:45）")).toHaveLength(
      2,
    );
    expect(() => parseHours("10:00–12:00 / 11:30–13:00")).toThrow("重複");
    expect(() => parseHours("24:30–25:00")).toThrow();
    const f = emptyData().facilities[0];
    expect(facilityHours(f, "2026-10-19")).toBe("10:00–17:00");
    expect(facilityHours(f, "2026-10-18")).toBe("");
    f.exceptions["2026-10-19"] = "";
    expect(facilityHours(f, "2026-10-19")).toBe("");
  });
});
describe("IndexedDB durable and conservative saves", () => {
  it("persists notes including images and rejects stale tab writes", async () => {
    const a = new LocalStore(),
      b = new LocalStore(),
      d = await a.open();
    await b.open();
    d.notes = [
      {
        id: "n",
        text: "saved",
        modified: new Date().toISOString(),
        images: [{ id: "i", data: "data:image/jpeg;base64,AA" }],
        checklist: [],
        color: "blue",
      },
    ];
    await a.save(d);
    await expect(b.save(emptyData())).rejects.toThrow("別タブ");
    const c = new LocalStore(),
      restored = await c.open();
    expect(restored.notes[0].images[0].data).toContain("base64");
    a.close();
    b.close();
    c.close();
  });
  it("serializes snapshots and retains dirty state on failure", async () => {
    const s = new LocalStore(),
      d = await s.open(),
      queue = new SaveQueue(s, () => d);
    queue.changed();
    const first = queue.flush();
    d.notes.push({
      id: "a",
      text: "new",
      modified: new Date().toISOString(),
      color: "default",
      images: [],
      checklist: [],
    });
    queue.changed();
    await first;
    expect(queue.dirty).toBe(true);
    await queue.flush();
    expect(queue.dirty).toBe(false);
    s.close();
    queue.changed();
    await expect(queue.flush()).rejects.toThrow();
  });
  it("preserves corrupt stored data instead of replacing with defaults", async () => {
    const a = new LocalStore();
    await a.open();
    a.close();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("shizudai-pocket", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(
        { revision: 7, data: { schema: 999 } },
        "personal",
      );
      tx.oncomplete = () => resolve();
    });
    const b = new LocalStore();
    await expect(b.open()).rejects.toThrow("原本");
    await expect(b.save(emptyData())).rejects.toThrow("保護");
    const row = await new Promise<any>((resolve) => {
      const r = db.transaction("state").objectStore("state").get("personal");
      r.onsuccess = () => resolve(r.result);
    });
    expect(row.revision).toBe(7);
    expect(row.data.schema).toBe(999);
    b.close();
    db.close();
  });
});
describe("event submission retry after a failed save", () => {
  it("retains the draft and upserts the same manual event exactly once", async () => {
    const store = new LocalStore(),
      data = await store.open(),
      original = event("manual:retry");
    data.eventDraft = { event: original, values: { title: "入力中の予定" } };
    const draft = structuredClone(data.eventDraft),
      queue = new SaveQueue(store, () => data);
    let attempts = 0;
    const persistence = {
      changed: () => queue.changed(),
      save: async () => {
        attempts++;
        validateData(data);
        if (attempts === 1) return false;
        await queue.flush();
        return true;
      },
    };
    const values = {
      title: "入力中の予定",
      location: "情1",
      start: original.start,
      end: original.end,
      allDay: false,
      cancelled: false,
      scope: "occurrence" as const,
    };
    await expect(
      commitEvent(data, original, false, undefined, values, persistence),
    ).rejects.toThrow("保存に失敗");
    expect(data.addedEvents).toHaveLength(1);
    expect(data.eventDraft).toEqual(draft);
    values.title = "再試行で変更した予定";
    await expect(
      commitEvent(data, original, false, undefined, values, persistence),
    ).resolves.toBeUndefined();
    expect(data.addedEvents).toHaveLength(1);
    expect(data.eventDraft).toBeUndefined();
    const reopened = new LocalStore(),
      restored = await reopened.open();
    expect(restored.addedEvents).toHaveLength(1);
    expect(restored.addedEvents[0].title).toBe(values.title);
    store.close();
    reopened.close();
  });
});
describe("Notion and room boundaries", () => {
  it("rejects credentialed, fake and nonstandard host URLs", () => {
    for (const url of [
      "http://notion.so/a",
      "https://notion.so.evil.test/a",
      "https://evilnotion.site/a",
      "https://user@notion.so/a",
      "https://notion.so:444/a",
      "javascript:alert(1)",
    ])
      expect(() => notionURL(url)).toThrow();
    expect(notionURL("https://campus.notion.site/page#section")).toBe(
      "https://campus.notion.site/page",
    );
  });
  it("resolves only exact registered rooms and preserves ambiguous/missing states", () => {
    expect(resolveRoom("")).toEqual({ kind: "missing", ids: [] });
    expect(resolveRoom("Zoom").kind).toBe("online");
    expect(resolveRoom("情1").kind).toBe("matched");
    expect(resolveRoom("情199999").kind).toBe("unknown");
    expect(resolveRoom(catalog.buildings[0].id).kind).toBe("unknown");
  });
});
describe("known PDF coordinate parser", () => {
  it("ports course cells and all 15 sessions including exam candidates", () => {
    const { t, a } = pdfPages(),
      p = parsePages(t, a);
    expect(p.courses).toHaveLength(1);
    expect(p.events.filter((e) => e.kind === "class")).toHaveLength(14);
    expect(p.events.find((e) => e.kind === "exam")?.title).toContain("第15回");
    expect(p.courses[0].room).toBe("情1");
  });
  it("fails safely on year mismatch, unknown layout and incomplete annual schedule", () => {
    const { t, a } = pdfPages();
    const wrong = new PageText(
      a.width,
      a.height,
      a.items.map((i) => ({ ...i, str: i.str.replace("令和8", "令和9") })),
    );
    expect(() => parsePages(t, wrong)).toThrow("年度");
    expect(() => parsePages(new PageText(595, 842, t.items), a)).toThrow();
    const missing = new PageText(
      a.width,
      a.height,
      a.items.filter((i) => i.str !== "月15"),
    );
    expect(() => parsePages(t, missing)).toThrow("揃いません");
  });
});

describe("delayed bookmark requests respect the active view", () => {
  it.each(["#notes", "#articles", "#articles/other"])(
    "updates server state without redrawing after navigation to %s",
    async (destination) => {
      const epoch = new ViewEpoch();
      epoch.advance();
      let hash = "#articles/test",
        draws = 0;
      const isCurrent = epoch.scope(hash, () => hash),
        article = { bookmarked: false, bookmarkCount: 2 };
      let complete!: (value: typeof article) => void;
      const pending = updateBookmark(
        article,
        () => new Promise((resolve) => (complete = resolve)),
        isCurrent,
        () => draws++,
      );
      hash = destination;
      epoch.advance();
      complete({ bookmarked: true, bookmarkCount: 3 });
      await pending;
      expect(article).toEqual({ bookmarked: true, bookmarkCount: 3 });
      expect(draws).toBe(0);
    },
  );
  it("does not redraw an earlier request after revisiting the same article", async () => {
    const epoch = new ViewEpoch();
    epoch.advance();
    let hash = "#articles/test",
      draws = 0;
    const current = epoch.scope(hash, () => hash),
      article = { bookmarked: false, bookmarkCount: 0 };
    let complete!: (value: typeof article) => void;
    const pending = updateBookmark(
      article,
      () => new Promise((resolve) => (complete = resolve)),
      current,
      () => draws++,
    );
    hash = "#notes";
    epoch.advance();
    hash = "#articles/test";
    epoch.advance();
    complete({ bookmarked: true, bookmarkCount: 1 });
    await pending;
    expect(draws).toBe(0);
    await updateBookmark(
      article,
      async () => ({ bookmarked: false, bookmarkCount: 0 }),
      epoch.scope(hash, () => hash),
      () => draws++,
    );
    expect(draws).toBe(1);
  });
});
