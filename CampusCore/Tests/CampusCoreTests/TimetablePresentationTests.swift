import Foundation
import Testing
@testable import CampusCore

struct TimetablePresentationTests {
  @Test func onlyExactImportedBoundsReceivePeriods() {
    let lesson = CampusEvent(id: "lesson", title: "講義", start: Tokyo.date(2026, 10, 19, 8, 40), end: Tokyo.date(2026, 10, 19, 10, 10))
    #expect(TimetablePresentation.period(of: lesson) == 1)
    var changed = lesson
    changed.start = changed.start.addingTimeInterval(60)
    #expect(TimetablePresentation.period(of: changed) == nil)
    changed = lesson
    changed.start = changed.start.addingTimeInterval(30)
    #expect(TimetablePresentation.period(of: changed) == nil)
    changed = lesson
    changed.end = Tokyo.date(2026, 10, 20, 10, 10)
    #expect(TimetablePresentation.period(of: changed) == nil)
    changed = lesson
    changed.kind = "external"
    #expect(TimetablePresentation.period(of: changed) == nil)
    changed = lesson
    changed.allDay = true
    #expect(TimetablePresentation.period(of: changed) == nil)
  }
  @Test func overviewAndAdditionalListsKeepEveryEventAndOverlap() {
    let day = Tokyo.date(2026, 10, 19)
    let first = CampusEvent(id: "first", title: "A", start: Tokyo.date(2026, 10, 19, 8, 40), end: Tokyo.date(2026, 10, 19, 10, 10))
    var overlap = first; overlap.id = "overlap"
    var evening = first; evening.id = "evening"; evening.start = Tokyo.date(2026, 10, 19, 17, 50); evening.end = Tokyo.date(2026, 10, 19, 19, 20)
    var short = first; short.id = "short"; short.end = short.start.addingTimeInterval(300)
    var external = first; external.id = "external"; external.kind = "external"
    var allDay = first; allDay.id = "allDay"; allDay.allDay = true; allDay.start = day; allDay.end = day.addingTimeInterval(86400)
    let events = [first, overlap, evening, short, external, allDay]
    #expect(TimetablePresentation.overviewEvents(on: day, period: 1, events: events).map(\.id) == ["first", "overlap"])
    #expect(TimetablePresentation.period(of: evening) == 6)
    #expect(Set(TimetablePresentation.additionalEvents(on: day, events: events).map(\.id)) == Set(["evening", "short", "external", "allDay"]))
    let shown = (1...5).flatMap { TimetablePresentation.overviewEvents(on: day, period: $0, events: events) }
    #expect(Set((shown + TimetablePresentation.additionalEvents(on: day, events: events)).map(\.id)) == Set(events.map(\.id)))
    #expect(TimetablePresentation.additionalEvents(on: day.addingTimeInterval(86400), events: events).isEmpty)
  }
}
