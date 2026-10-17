import Foundation

/// The seven blocks used by the imported Hamamatsu timetable. Only exact bounds receive a block label.
public enum TimetablePresentation {
  public static let periods: [(start: Int, end: Int)] = [
    (520, 610), (620, 710), (765, 855), (865, 955), (965, 1055), (1070, 1160), (1170, 1260)
  ]
  public static func period(of event: CampusEvent) -> Int? {
    guard !event.allDay, ["class", "exam"].contains(event.kind),
      Tokyo.calendar.component(.second, from: event.start) == 0,
      Tokyo.calendar.component(.second, from: event.end) == 0,
      Tokyo.calendar.isDate(event.start, inSameDayAs: event.end),
      let index = periods.firstIndex(where: { $0.start == Tokyo.minute(event.start) && $0.end == Tokyo.minute(event.end) })
    else { return nil }
    return index + 1
  }
  /// Events absent from the five-by-five overview remain available in the day's complete list.
  public static func overviewEvents(on day: Date, period: Int, events: [CampusEvent]) -> [CampusEvent] {
    events.filter { $0.occurs(on: day) && self.period(of: $0) == period }
  }
  public static func additionalEvents(on day: Date, events: [CampusEvent]) -> [CampusEvent] {
    events.filter { $0.occurs(on: day) && !(period(of: $0).map { (1...5).contains($0) } ?? false) }
  }
}
