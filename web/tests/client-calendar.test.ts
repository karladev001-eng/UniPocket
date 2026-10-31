import { describe, expect, it } from "vitest";
import {
  addDay,
  emptyData,
  events,
  onDay,
  tokyo,
  type CampusEvent,
} from "../src/domain";
import { commitEvent } from "../src/event-editor";
import {
  calendarDays,
  daySegments,
  eventKind,
  initialCalendarMode,
  initialScrollMinute,
  lectureEvents,
  minutePixels,
  nextEvent,
  overlapGroups,
  shiftCalendarDay,
} from "../src/calendar-presentation";
const event = (
  id: string,
  day: string,
  start = "08:40",
  end = "10:10",
  kind = "class",
): CampusEvent => ({
  id,
  title: id,
  location: "共12",
  kind,
  allDay: false,
  start: tokyo(day, start),
  end: tokyo(day, end),
});

describe("calendar dates in Tokyo", () => {
  it("proposes a mobile mode once, with contiguous three days and Monday through Sunday weeks", () => {
    expect([320, 350, 390, 767, 1280].map(initialCalendarMode)).toEqual([
      "day",
      "day",
      "three",
      "three",
      "week",
    ]);
    expect(calendarDays("2026-12-31", "three")).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(calendarDays("2026-10-25", "week")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
  it("moves by the chosen unit and never skips a short month from the 31st", () => {
    expect(shiftCalendarDay("2026-12-31", "three", 1)).toBe("2027-01-03");
    expect(shiftCalendarDay("2026-12-31", "week", 1)).toBe("2027-01-07");
    expect(shiftCalendarDay("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(shiftCalendarDay("2026-12-31", "month", 1)).toBe("2027-01-01");
    expect(shiftCalendarDay("2026-01-01", "month", -1)).toBe("2025-12-01");
  });
  it("makes every month date reachable, including leap day and a six-row month", () => {
    const leap = calendarDays("2028-02-18", "month");
    expect(leap).toHaveLength(42);
    expect(leap).toContain("2028-02-29");
    expect(calendarDays("2026-03-31", "month")).toContain("2026-03-01");
    expect(calendarDays("2026-03-31", "month")).toContain("2026-03-31");
  });
});

describe("half-open real-minute event segments", () => {
  it("splits across day/week/month boundaries while retaining the original event and ID", () => {
    const crossing = {
      ...event("crossing", "2026-05-31", "23:57"),
      end: tokyo("2026-06-01", "00:05"),
    };
    const previous = daySegments([crossing], "2026-05-31")[0];
    const next = daySegments([crossing], "2026-06-01")[0];
    expect(previous).toMatchObject({
      start: 1437,
      end: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(next).toMatchObject({
      start: 0,
      end: 5,
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(previous.event).toBe(crossing);
    expect(next.event).toBe(crossing);
    expect(daySegments([crossing], "2026-06-02")).toEqual([]);
  });
  it("does not create a ghost occurrence on an exclusive midnight ending", () => {
    const ending = {
      ...event("midnight", "2026-10-18", "23:30"),
      end: tokyo("2026-10-19"),
    };
    expect(daySegments([ending], "2026-10-18")[0]).toMatchObject({
      start: 1410,
      end: 1440,
      continuesAfter: false,
    });
    expect(daySegments([ending], "2026-10-19")).toEqual([]);
    const allDay = { ...ending, allDay: true, start: tokyo("2026-10-17") };
    expect(
      ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].filter((day) =>
        onDay(allDay, day),
      ),
    ).toEqual(["2026-10-17", "2026-10-18"]);
    expect(daySegments([allDay], "2026-10-18")).toEqual([]);
  });
  it("uses Tokyo boundaries for UTC input and retains dawn and late-night events", () => {
    const utc = {
      ...event("utc", "2026-10-19"),
      start: "2026-10-18T15:03:00.000Z",
      end: "2026-10-18T15:08:00.000Z",
    };
    const late = event("late", "2026-10-19", "23:50", "23:59");
    expect(
      daySegments([utc, late], "2026-10-19").map((s) => [s.start, s.end]),
    ).toEqual([
      [3, 8],
      [1430, 1439],
    ]);
  });
});

describe("overlap and detail target layout", () => {
  it("keeps three or more overlaps and chain overlaps in one complete group", () => {
    const all = [
      event("a", "2026-10-19", "09:00", "10:00"),
      event("b", "2026-10-19", "09:10", "09:40"),
      event("c", "2026-10-19", "09:20", "10:10"),
      event("d", "2026-10-19", "10:00", "11:00"),
    ];
    const groups = overlapGroups(daySegments(all, "2026-10-19"));
    expect(groups).toHaveLength(1);
    expect(groups[0].columns).toBe(3);
    expect(groups[0].segments.map((s) => s.event.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(groups[0].segments[3].column).toBe(0);
    expect(groups[0]).toMatchObject({ start: 540, end: 660 });
  });
  it("separates adjacent real intervals but protects the 44px target of a five-minute entry", () => {
    const adjacent = [
      event("a", "2026-10-19", "09:00", "10:00"),
      event("b", "2026-10-19", "10:00", "11:00"),
    ];
    expect(overlapGroups(daySegments(adjacent, "2026-10-19"))).toHaveLength(2);
    const short = [
      event("five", "2026-10-19", "09:03", "09:08"),
      event("after", "2026-10-19", "09:10", "10:00"),
    ];
    const group = overlapGroups(daySegments(short, "2026-10-19"))[0];
    expect(group.columns).toBe(2);
    expect(group.segments[0].end - group.segments[0].start).toBe(5);
    expect(
      (group.segments[0].end - group.segments[0].start) * minutePixels,
    ).toBeLessThan(44);
    expect(group.segments[0].column).not.toBe(group.segments[1].column);
    expect(overlapGroups([])).toEqual([]);
  });
});

describe("one effective event source for home, timetable and calendar", () => {
  it("keeps personal, university, preserved and unknown kinds in the calendar; only lectures and exams enter the timetable", async () => {
    const data = emptyData();
    data.imports = [
      {
        key: "pdf",
        year: 2026,
        importedAt: tokyo("2026-10-19"),
        courses: [
          { id: "course", title: "講義", weekday: 1, block: 0, room: "共12" },
        ],
        warnings: [],
        events: [
          event("course-1", "2026-10-19"),
          event("exam", "2026-10-19", "10:20", "11:50", "exam"),
          event("uni", "2026-10-19", "12:00", "13:00", "university"),
        ],
      },
    ];
    data.preservedEvents = [
      event("lost-course", "2026-10-19"),
      event("future-kind", "2026-10-19", "07:00", "07:30", "new-kind"),
    ];
    data.addedEvents = [
      event("manual", "2026-10-19", "18:00", "19:00", "personal"),
    ];
    expect(events(data)).toHaveLength(6);
    expect(lectureEvents(events(data)).map((e) => e.id)).toEqual([
      "lost-course",
      "course-1",
      "exam",
    ]);
    expect(eventKind(data.preservedEvents[1])).toBe("予定");
    expect(eventKind({ ...data.preservedEvents[1], kind: "constructor" })).toBe(
      "予定",
    );
    await commitEvent(
      data,
      data.imports[0].events[0],
      true,
      "course",
      {
        title: "変更後",
        location: "情1",
        start: tokyo("2026-10-19", "09:03"),
        end: tokyo("2026-10-19", "09:08"),
        allDay: false,
        cancelled: false,
        scope: "occurrence",
      },
      {
        changed() {},
        async save() {
          return true;
        },
      },
    );
    const updated = events(data).find((e) => e.id === "course-1")!;
    expect(updated).toMatchObject({ title: "変更後", location: "情1" });
    expect(lectureEvents(events(data))).toContainEqual(updated);
    expect(
      daySegments(events(data), "2026-10-19").find(
        (s) => s.event.id === updated.id,
      ),
    ).toMatchObject({ start: 543, end: 548 });
    data.occurrenceEdits.push({ id: "exam", cancelled: true });
    expect(lectureEvents(events(data)).map((e) => e.id)).not.toContain("exam");
    expect(
      daySegments(events(data), "2026-10-19").map((s) => s.event.id),
    ).not.toContain("exam");
    expect(JSON.stringify(data)).not.toContain("column");
  });
  it("selects the earliest unfinished timed event, including in-progress overlaps, without treating an all-day entry as next", () => {
    const all = [
      event("ended", "2026-10-19", "07:00", "08:00"),
      { ...event("all-day", "2026-10-19", "00:00", "23:59"), allDay: true },
      event("current", "2026-10-19", "08:00", "10:00"),
      event("overlap", "2026-10-19", "08:30", "09:00"),
      event("tomorrow", addDay("2026-10-19", 1)),
    ];
    expect(nextEvent(all, Date.parse(tokyo("2026-10-19", "08:40")))?.id).toBe(
      "current",
    );
    expect(nextEvent(all, Date.parse(tokyo("2026-10-19", "10:00")))?.id).toBe(
      "tomorrow",
    );
    expect(nextEvent([], 0)).toBeUndefined();
  });
});

describe("initial timeline position", () => {
  it("uses now only when today is displayed and otherwise includes early events in every visible day", () => {
    const now = Date.parse(tokyo("2026-10-19", "16:07"));
    const all = [
      event("early", "2026-10-21", "03:07", "04:00"),
      event("late", "2026-10-20", "20:00", "21:00"),
    ];
    expect(
      initialScrollMinute(all, calendarDays("2026-10-19", "three"), now, 8),
    ).toBe(967);
    expect(
      initialScrollMinute(all, calendarDays("2026-10-20", "three"), now, 8),
    ).toBe(187);
    expect(
      initialScrollMinute([], calendarDays("2026-10-20", "three"), now, 8),
    ).toBe(480);
  });
});

import { refreshCurrentTime } from "../src/calendar-now-line";
describe("current-time marker across Tokyo midnight without rerendering", () => {
  // Minimal DOM adapter, deliberately without innerHTML/replacement support.
  // This test exercises the real DOM update helper over multiple clock ticks.
  class Marker {
    className = "";
    hidden = false;
    style = { top: "" };
    parentElement: Column | null = null;
    setAttribute() {}
    remove() {
      if (this.parentElement) this.parentElement.marker = undefined;
      this.parentElement = null;
    }
  }
  class Column {
    marker?: Marker;
    constructor(readonly dataset: { day: string }) {}
    append(marker: Marker) {
      marker.remove();
      this.marker = marker;
      marker.parentElement = this;
    }
  }
  function fixture(days: string[]) {
    const columns = days.map((day) => new Column({ day }));
    const headings = days.map((day) => ({
      dataset: { day },
      today: false,
      classList: {
        toggle(_name: string, active: boolean) {
          headings.find((h) => h.dataset.day === day)!.today = active;
        },
      },
    }));
    return {
      columns,
      headings,
      scrollTop: 1370,
      scrollLeft: 120,
      editor: { value: "未保存の入力", selectionStart: 4 },
      ownerDocument: { createElement: () => new Marker() },
      querySelector: () =>
        columns.flatMap((c) => (c.marker ? [c.marker] : []))[0] ?? null,
      querySelectorAll: (selector: string) =>
        selector === ".timeline-day" ? columns : headings,
    };
  }
  it("moves an existing marker into the next visible day at 00:00 and keeps editor and scroll state", () => {
    const root = fixture(["2026-12-31", "2027-01-01", "2027-01-02"]);
    const dom = root as unknown as HTMLElement;
    refreshCurrentTime(dom, Date.parse(tokyo("2026-12-31", "23:59")));
    const marker = root.columns[0].marker!;
    expect(marker.style.top).toBe(1439 * minutePixels + "px");
    expect(root.headings.map((h) => h.today)).toEqual([true, false, false]);
    refreshCurrentTime(dom, Date.parse(tokyo("2027-01-01")));
    expect(root.columns.map((c) => !!c.marker)).toEqual([false, true, false]);
    expect(root.columns[1].marker).toBe(marker);
    expect(marker.style.top).toBe("0px");
    expect(marker.hidden).toBe(false);
    expect(root.headings.map((h) => h.today)).toEqual([false, true, false]);
    refreshCurrentTime(dom, Date.parse(tokyo("2027-01-01", "00:01")));
    expect(root.columns[1].marker?.style.top).toBe(minutePixels + "px");
    expect(root.scrollTop).toBe(1370);
    expect(root.scrollLeft).toBe(120);
    expect(root.editor).toEqual({ value: "未保存の入力", selectionStart: 4 });
  });
  it("removes a marker when today leaves the visible range and creates one when today enters it", () => {
    const root = fixture(["2026-10-19"]);
    const dom = root as unknown as HTMLElement;
    refreshCurrentTime(dom, Date.parse(tokyo("2026-10-18", "23:59")));
    expect(root.columns[0].marker).toBeUndefined();
    refreshCurrentTime(dom, Date.parse(tokyo("2026-10-19")));
    expect(root.columns[0].marker?.style.top).toBe("0px");
    refreshCurrentTime(dom, Date.parse(tokyo("2026-10-20")));
    expect(root.columns[0].marker).toBeUndefined();
    expect(root.headings[0].today).toBe(false);
  });
});
