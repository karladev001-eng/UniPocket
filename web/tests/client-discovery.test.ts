import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  emptyData,
  validateData,
  install,
  events,
  tokyo,
  type CampusEvent,
  type Plan,
} from "../src/domain";
import { setEventMemo, eventMemoText } from "../src/event-memos";
import { LocalStore, SaveQueue } from "../src/storage";
import { MapViewport } from "../src/map-viewport";
import {
  appendUnique,
  BookmarkRequests,
  type BookmarkState,
} from "../src/article-request";
import { mapCandidates, resolveRoom } from "../src/map";

const occurrence = (id: string): CampusEvent => ({
  id,
  title: "授業",
  start: tokyo("2026-10-20", "09:00"),
  end: tokyo("2026-10-20", "10:00"),
  location: "共12",
  kind: "lecture",
  allDay: false,
});
const plan = (entries: CampusEvent[]): Plan => ({
  key: "same-pdf",
  year: 2026,
  courses: [],
  events: entries,
  warnings: [],
  importedAt: new Date().toISOString(),
});

describe("exact occurrence memos and old data", () => {
  it("reads old data as empty, validates 5000 plain characters and only removes the explicitly cleared memo", () => {
    const data = emptyData();
    expect(data.eventMemos).toBeUndefined();
    expect(eventMemoText(data, "lesson-1")).toBe("");
    expect(() => validateData(data)).not.toThrow();
    const text = "<script>alert(1)</script>\n".padEnd(5000, "a");
    expect(text.length).toBe(5000);
    setEventMemo(data, "lesson-1", text);
    setEventMemo(data, "lesson-2", "次の回");
    expect(() => validateData(data)).not.toThrow();
    expect(() => setEventMemo(data, "lesson-1", "a".repeat(5001))).toThrow(
      "5000",
    );
    expect(eventMemoText(data, "lesson-1")).toBe(text);
    setEventMemo(data, "lesson-1", "");
    expect(Object.hasOwn(data.eventMemos!, "lesson-1")).toBe(false);
    expect(eventMemoText(data, "lesson-2")).toBe("次の回");
    for (const invalid of [
      null,
      [],
      { x: { text: "a".repeat(5001), modified: new Date().toISOString() } },
      { x: { text: "ok", modified: "bad" } },
    ]) {
      expect(() => validateData({ ...data, eventMemos: invalid })).toThrow(
        "予定メモ",
      );
    }
  });
  it("preserves exact IDs through individual edits, PDF replacement, cancellation and export without copying to a new ID", () => {
    let data = emptyData();
    data.imports = [plan([occurrence("lesson-1"), occurrence("lesson-2")])];
    data.notes.push({
      id: "normal-note",
      text: "通常メモ",
      modified: new Date().toISOString(),
      color: "green",
      images: [],
      checklist: [],
    });
    setEventMemo(data, "lesson-1", "この回だけのメモ");
    data.occurrenceEdits.push({
      id: "lesson-1",
      title: "個人タイトル",
      start: tokyo("2026-10-20", "11:00"),
      end: tokyo("2026-10-20", "12:00"),
    });
    expect(
      eventMemoText(data, events(data).find((e) => e.id === "lesson-1")!.id),
    ).toBe("この回だけのメモ");
    data = install(data, plan([occurrence("lesson-1"), occurrence("new-id")]), {
      "lesson-1": "pdf",
    });
    expect(eventMemoText(data, "lesson-1")).toBe("この回だけのメモ");
    expect(eventMemoText(data, "new-id")).toBe("");
    data = install(data, plan([]), { "lesson-1": "pdf" });
    data.occurrenceEdits.push({ id: "lesson-1", cancelled: true });
    data.addedEvents = [];
    const exported = JSON.parse(JSON.stringify(data));
    expect(exported.eventMemos["lesson-1"].text).toBe("この回だけのメモ");
    expect(exported.notes[0].text).toBe("通常メモ");
    expect(exported.imports[0].events).toEqual([]);
  });
  it("keeps uncommitted memo input for export on another-tab conflict and never overwrites the winning data", async () => {
    const winner = new LocalStore(),
      stale = new LocalStore();
    const winningData = await winner.open(),
      current = await stale.open();
    setEventMemo(winningData, "conflict", "別タブの保存");
    await winner.save(winningData);
    setEventMemo(current, "conflict", "保持する入力");
    const queue = new SaveQueue(stale, () => current);
    queue.changed();
    await expect(queue.flush()).rejects.toThrow("別タブ");
    expect(queue.dirty).toBe(true);
    expect(JSON.parse(JSON.stringify(current)).eventMemos.conflict.text).toBe(
      "保持する入力",
    );
    await expect(queue.flush()).rejects.toThrow("別タブ");
    const reader = new LocalStore();
    expect(eventMemoText(await reader.open(), "conflict")).toBe("別タブの保存");
    winner.close();
    stale.close();
    reader.close();
  });
  it("reopens saved memos and preserves them through subsequent ordinary note saves", async () => {
    const first = new LocalStore(),
      data = await first.open();
    setEventMemo(data, "retained", "予定メモ");
    await first.save(data);
    first.close();
    const next = new LocalStore(),
      restored = await next.open();
    restored.notes.push({
      id: "normal-new",
      text: "通常メモ編集",
      modified: new Date().toISOString(),
      color: "green",
      images: [],
      checklist: [],
    });
    await next.save(restored);
    next.close();
    const last = new LocalStore();
    expect(eventMemoText(await last.open(), "retained")).toBe("予定メモ");
    last.close();
  });
});

describe("map movement and ranking pagination boundaries", () => {
  it("starts at 1.6, bounds pinch/button zoom to 1–4 and resets all map bounds", () => {
    const viewport = new MapViewport([10, 20, 1000, 800]);
    expect(viewport.zoom).toBe(1.6);
    viewport.scale(100);
    expect(viewport.zoom).toBe(4);
    viewport.center([510, 420]);
    expect(viewport.box).toEqual([385, 320, 250, 200]);
    viewport.pan(100000, -100000, 400, 500);
    expect(viewport.box).toEqual([10, 620, 250, 200]);
    viewport.scale(-1);
    expect(viewport.zoom).toBe(1);
    viewport.reset();
    expect(viewport.box).toEqual([10, 20, 1000, 800]);
  });
  it("deduplicates rank shifts across 50+ cards while preserving visible objects and order after bookmark changes", () => {
    const first = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      bookmarked: false,
    }));
    first[0].bookmarked = true;
    const second = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 18),
      bookmarked: false,
    }));
    const last = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 36),
      bookmarked: false,
    }));
    const all = appendUnique(appendUnique(first, second), last);
    expect(all.map((a) => a.id)).toEqual(
      Array.from({ length: 56 }, (_, i) => String(i)),
    );
    expect(all[0]).toBe(first[0]);
    expect(all[0].bookmarked).toBe(true);
    expect(appendUnique([], [first[0], first[0]])).toEqual([first[0]]);
  });
});

describe("discovery review regressions", () => {
  it("uses every resolved building for multiple registered room names, without guessing unknown rooms", () => {
    for (const query of ["情13/共11", "情1、工1"]) {
      const resolved = resolveRoom(query);
      expect(resolved.kind).toBe("ambiguous");
      expect(
        mapCandidates(query)
          .map((b) => b.id)
          .sort(),
      ).toEqual(resolved.ids);
    }
    expect(
      mapCandidates("情13/共11")
        .map((b) => b.id)
        .sort(),
    ).toEqual(["102", "811"]);
    expect(
      mapCandidates("情1、工1")
        .map((b) => b.id)
        .sort(),
    ).toEqual(["101", "201"]);
    for (const query of ["", "  ", "オンライン", "未知999", "情13/未知999"])
      expect(mapCandidates(query)).toEqual([]);
    expect(mapCandidates("情13").map((b) => b.id)).toContain("102");
    expect(mapCandidates("工").length).toBeGreaterThan(1);
  });
  it("applies a bookmark response to replacement card state and controls, retaining the pending lock across redraws", async () => {
    const requests = new BookmarkRequests();
    let resolve!: (state: BookmarkState) => void;
    const original = { id: "one", bookmarked: false, bookmarkCount: 2 };
    let cards = [original, { id: "two", bookmarked: false, bookmarkCount: 1 }];
    type Control = {
      disabled: boolean;
      pressed: string;
      count: number;
      label: string;
    };
    const control = (): Control => ({
      disabled: requests.has("one"),
      pressed: String(cards[0].bookmarked),
      count: cards[0].bookmarkCount,
      label: "",
    });
    let button = control();
    const sync = () => {
      button.disabled = requests.has("one");
      button.pressed = String(cards[0].bookmarked);
      button.count = cards[0].bookmarkCount;
      button.label = `ブックマーク${cards[0].bookmarkCount}件、${cards[0].bookmarked ? "解除する" : "登録する"}`;
    };
    const running = requests.update(
      "one",
      () =>
        new Promise((done) => {
          resolve = done;
        }),
      (state) => {
        Object.assign(original, state);
        Object.assign(
          cards.find((card) => card.id === "one")!,
          state,
        );
      },
      sync,
    );
    expect(button.disabled).toBe(true);
    const detachedButton = button;
    // A list request redraws the DOM and may even replace the article objects.
    cards = cards.map((card) => ({ ...card }));
    button = control();
    expect(button.disabled).toBe(true);
    let duplicateRequests = 0;
    await requests.update(
      "one",
      async () => {
        duplicateRequests++;
        return { bookmarked: false, bookmarkCount: 1 };
      },
      () => {},
      sync,
    );
    expect(duplicateRequests).toBe(0);
    resolve({ bookmarked: true, bookmarkCount: 3 });
    await running;
    expect(button).not.toBe(detachedButton);
    expect(button).toEqual({
      disabled: false,
      pressed: "true",
      count: 3,
      label: "ブックマーク3件、解除する",
    });
    expect(cards.map((card) => card.id)).toEqual(["one", "two"]);
    expect(cards[0]).toMatchObject({ bookmarked: true, bookmarkCount: 3 });
  });
  it("protects a completed bookmark response from an older list GET, and releases replacement controls on failure", async () => {
    const requests = new BookmarkRequests(),
      requestRevision = requests.revision;
    const state = { id: "one", bookmarked: false, bookmarkCount: 4 };
    await requests.update(
      "one",
      async () => ({ bookmarked: true, bookmarkCount: 5 }),
      (next) => Object.assign(state, next),
      () => {},
    );
    expect(
      requests.reconcile(
        [{ id: "one", bookmarked: false, bookmarkCount: 4 }],
        requestRevision,
      )[0],
    ).toMatchObject({ bookmarked: true, bookmarkCount: 5 });
    // A later GET remains authoritative for new changes made elsewhere.
    expect(
      requests.reconcile(
        [{ id: "one", bookmarked: false, bookmarkCount: 3 }],
        requests.revision,
      )[0],
    ).toMatchObject({ bookmarked: false, bookmarkCount: 3 });
    let disabled = false;
    await expect(
      requests.update(
        "one",
        async () => {
          throw Error("network");
        },
        () => {},
        () => {
          disabled = requests.has("one");
        },
      ),
    ).rejects.toThrow("network");
    expect(disabled).toBe(false);
    expect(requests.has("one")).toBe(false);
    expect(state).toMatchObject({ bookmarked: true, bookmarkCount: 5 });
  });
});
