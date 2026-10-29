import Foundation

public enum Tokyo {
  public static var calendar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    c.firstWeekday = 2
    return c
  }
  public static func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
    calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
  }
  public static func time(_ d: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "ja_JP")
    f.timeZone = calendar.timeZone
    f.dateFormat = "HH:mm"
    return f.string(from: d)
  }
  public static func dayKey(_ d: Date) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
  }
  public static func minute(_ d: Date) -> Int {
    let c = calendar.dateComponents([.hour, .minute], from: d)
    return c.hour! * 60 + c.minute!
  }
  public static func weekday(_ d: Date) -> Int {
    (calendar.component(.weekday, from: d) + 5) % 7 + 1
  }
  public static func week(_ d: Date) -> [Date] {
    let start = calendar.dateInterval(of: .weekOfYear, for: d)!.start
    return (0..<7).map { calendar.date(byAdding: .day, value: $0, to: start)! }
  }
}
/// EventKit reads a bounded device range. Day coverage must include both midnight boundaries.
public enum CalendarCoverage {
  public static func range(around date: Date) -> ClosedRange<Date> {
    let day = Tokyo.calendar.startOfDay(for: date)
    return Tokyo.calendar.date(byAdding: .day, value: -40, to: day)!...Tokyo.calendar.date(
      byAdding: .day, value: 41, to: day)!
  }
  public static func contains(day date: Date, in range: ClosedRange<Date>?) -> Bool {
    guard let range else { return false }
    let day = Tokyo.calendar.startOfDay(for: date)
    let end = Tokyo.calendar.date(byAdding: .day, value: 1, to: day)!
    return range.lowerBound <= day && range.upperBound >= end
  }
}
public struct FacilitySelection: Identifiable, Equatable {
  public let facilityID: UUID
  public let date: Date
  public var id: String { "\(facilityID.uuidString)-\(Tokyo.dayKey(date))" }
  public init(facilityID: UUID, date: Date) {
    self.facilityID = facilityID
    self.date = Tokyo.calendar.startOfDay(for: date)
  }
}
/// A registered course from the imported timetable.
public struct Course: Codable, Identifiable, Equatable {
  public var id: String
  public var title: String
  public var weekday: Int?
  public var block: Int?
  public var room: String
  public init(id: String, title: String, weekday: Int?, block: Int?, room: String = "") {
    self.id = id
    self.title = title
    self.weekday = weekday
    self.block = block
    self.room = room
  }
  public var slot: String {
    guard let weekday, let block else { return "時間未定" }
    return "\(Array("月火水木金土日")[max(0,min(6,weekday-1))]) \(block*2+1)・\(block*2+2)時限"
  }
}
/// A single dated event (class, exam or academic-calendar entry) shown in the agenda.
public struct CampusEvent: Codable, Identifiable, Equatable {
  public var id: String
  public var title: String
  public var start: Date
  public var end: Date
  public var location: String
  public var kind: String
  public var allDay: Bool
  public var marker: String { "campuspocket://event/\(id)" }
  public init(
    id: String, title: String, start: Date, end: Date, location: String = "",
    kind: String = "class", allDay: Bool = false
  ) {
    self.id = id
    self.title = title
    self.start = start
    self.end = end
    self.location = location
    self.kind = kind
    self.allDay = allDay
  }
  public func occurs(on date: Date) -> Bool {
    let day = Tokyo.calendar.startOfDay(for: date)
    let next = Tokyo.calendar.date(byAdding: .day, value: 1, to: day)!
    return start < next && end > day
  }
  public func extendsOutside(on date: Date, startMinute: Int, endMinute: Int) -> Bool {
    guard occurs(on: date) else { return false }
    let day = Tokyo.calendar.startOfDay(for: date)
    let windowStart = day.addingTimeInterval(TimeInterval(startMinute * 60))
    let windowEnd = day.addingTimeInterval(TimeInterval(endMinute * 60))
    return allDay || start < windowStart || end > windowEnd
  }
  public func timing(at now: Date) -> String {
    if now >= end { return "終了" }
    let seconds = (now < start ? start : end).timeIntervalSince(now)
    let minutes = max(1, Int(ceil(seconds / 60)))
    let duration =
      minutes >= 1440
      ? "\(minutes/1440)日\((minutes%1440)/60)時間\(minutes%60)分"
      : minutes >= 120 ? "\(minutes/60)時間\(minutes%60)分" : "\(minutes)分"
    return now < start ? "開始まで\(duration)" : "授業中・終了まで\(duration)"
  }
}
/// The result of parsing the PDFs, previewed before it is merged into `AppData`.
public struct ImportPlan: Codable, Equatable {
  public var year: Int
  public var term: String
  public var courses: [Course]
  public var events: [CampusEvent]
  public var warnings: [String]
  public var importedAt: Date
  public var key: String { "\(year)-\(term)" }
  public init(
    year: Int, term: String, courses: [Course], events: [CampusEvent], warnings: [String],
    importedAt: Date
  ) {
    self.year = year
    self.term = term
    self.courses = courses
    self.events = events
    self.warnings = warnings
    self.importedAt = importedAt
  }
}
public struct ImageAttachment: Codable, Identifiable, Equatable {
  public var id: UUID
  public var filename: String
  public var width: Int
  public var height: Int
  public var format: String
  public init(id: UUID = UUID(), filename: String, width: Int, height: Int, format: String) {
    self.id = id
    self.filename = filename
    self.width = width
    self.height = height
    self.format = format
  }
}
public enum NoteColor: String, Codable, CaseIterable, Identifiable {
  case `default`, yellow, green, pink, blue
  public var id: String { rawValue }
}
public struct NoteChecklistItem: Codable, Identifiable, Equatable {
  public var id: UUID
  public var text: String
  public var isCompleted: Bool
  public init(id: UUID = UUID(), text: String = "", isCompleted: Bool = false) {
    self.id = id
    self.text = text
    self.isCompleted = isCompleted
  }
}
/// A user note with optional checklist, color and image attachments.
public struct Note: Codable, Identifiable, Equatable {
  public var id = UUID()
  public var text = ""
  public var modified = Date()
  public var images: [ImageAttachment] = []
  public var color: NoteColor = .default
  public var checklist: [NoteChecklistItem] = []
  public init() {}
  enum CodingKeys: String, CodingKey { case id, text, modified, images, color, checklist }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    id = try c.decode(UUID.self, forKey: .id)
    text = try c.decode(String.self, forKey: .text)
    modified = try c.decode(Date.self, forKey: .modified)
    images = try c.decodeIfPresent([ImageAttachment].self, forKey: .images) ?? []
    color = try c.decodeIfPresent(NoteColor.self, forKey: .color) ?? .default
    checklist = try c.decodeIfPresent([NoteChecklistItem].self, forKey: .checklist) ?? []
  }
  public var title: String {
    if let first = text.split(separator: "\n").first { return String(first.prefix(50)) }
    if let first = checklist.first(where: { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { return String(first.text.prefix(50)) }
    return images.isEmpty ? "新しいメモ" : "画像メモ"
  }
  public var isEmpty: Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty
      && checklist.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }
  public func matches(_ query: String) -> Bool {
    query.isEmpty || text.localizedCaseInsensitiveContains(query)
      || checklist.contains { $0.text.localizedCaseInsensitiveContains(query) }
  }
}
public struct CampusLink: Codable, Identifiable, Equatable {
  public var id = UUID()
  public var title: String
  public var url: String
  public var favorite = false
  public init(_ title: String, _ url: String) {
    self.title = title
    self.url = url
  }
  enum CodingKeys: String, CodingKey { case id, title, url, favorite }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    id = try c.decode(UUID.self, forKey: .id)
    title = try c.decode(String.self, forKey: .title)
    url = try c.decode(String.self, forKey: .url)
    favorite = try c.decodeIfPresent(Bool.self, forKey: .favorite) ?? false
  }
}
public struct OpeningInterval: Codable, Equatable, Identifiable {
  public var id = UUID()
  public var start: Int
  public var end: Int
  public var lastOrder: Int?
  public init(start: Int, end: Int, lastOrder: Int? = nil) {
    self.start = start
    self.end = end
    self.lastOrder = lastOrder
  }
  public var label: String {
    "\(Self.time(start))–\(Self.time(end))" + (lastOrder.map { "（L.O.\(Self.time($0))）" } ?? "")
  }
  public static func time(_ m: Int) -> String { String(format: "%02d:%02d", m / 60, m % 60) }
  public static func validate(_ intervals: [Self]) -> Bool {
    let a = intervals.sorted { $0.start < $1.start }
    return a.allSatisfy {
      $0.start >= 0 && $0.end <= 1440 && $0.end > $0.start
        && ($0.lastOrder == nil || ($0.lastOrder! >= $0.start && $0.lastOrder! <= $0.end))
    } && zip(a, a.dropFirst()).allSatisfy { $0.end <= $1.start }
  }
  public static func parse(_ s: String) throws -> [Self] {
    if s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return [] }
    let chunks = s.split(separator: "/")
    let regex = try NSRegularExpression(pattern: "(\\d{1,2}):(\\d{2})")
    var result: [Self] = []
    for chunk in chunks {
      let ns = String(chunk) as NSString
      let matches = regex.matches(in: String(chunk), range: NSRange(location: 0, length: ns.length))
      guard matches.count == 2 || matches.count == 3 else { throw ValidationError.interval }
      guard
        matches.allSatisfy({
          let h = Int(ns.substring(with: $0.range(at: 1)))!
          let m = Int(ns.substring(with: $0.range(at: 2)))!
          return h >= 0 && h <= 24 && m >= 0 && m < 60 && (h < 24 || m == 0)
        })
      else { throw ValidationError.interval }
      let minutes = matches.map {
        Int(ns.substring(with: $0.range(at: 1)))! * 60 + Int(ns.substring(with: $0.range(at: 2)))!
      }
      result.append(
        Self(start: minutes[0], end: minutes[1], lastOrder: minutes.count == 3 ? minutes[2] : nil))
    }
    guard validate(result) else { throw ValidationError.interval }
    return result
  }
}
public enum ValidationError: LocalizedError {
  case interval, conflict, image
  public var errorDescription: String? {
    switch self {
    case .interval: return "時間は開始–終了 / 開始–終了（L.O.時刻）の形式で、前後・重複のない区間を入力してください。空欄は休業です。"
    case .conflict: return "個人修正との競合をすべて選択してください。"
    case .image: return "静止画像の形式または容量が対応範囲外です。"
    }
  }
}
public struct FacilityException: Codable, Equatable {
  public var day: String
  public var intervals: [OpeningInterval]
  public init(day: String, intervals: [OpeningInterval]) {
    self.day = day
    self.intervals = intervals
  }
}
/// A campus facility with its opening hours and exceptions.
public struct Facility: Codable, Identifiable, Equatable {
  public var id = UUID()
  public var title: String
  public var hours: String
  public var updated: String
  public var weekdays: [Int: [OpeningInterval]]
  public var exceptions: [FacilityException] = []
  public var source = "https://www.univcoop-tokai.jp/sucoop/coop/coop_604.html"
  public var band = false
  public init(_ title: String, _ hours: String, updated: String = "2026-10-07") {
    self.title = title
    self.hours = hours
    self.updated = updated
    let intervals = (try? OpeningInterval.parse(hours)) ?? []
    weekdays = Dictionary(uniqueKeysWithValues: (1...5).map { ($0, intervals) })
    band = title == "南館食堂" || title == "北館ショップ"
  }
  enum CodingKeys: String, CodingKey {
    case id, title, hours, updated, weekdays, exceptions, source, band
  }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    id = try c.decode(UUID.self, forKey: .id)
    title = try c.decode(String.self, forKey: .title)
    hours = try c.decode(String.self, forKey: .hours)
    updated = try c.decode(String.self, forKey: .updated)
    let intervals = (try? OpeningInterval.parse(hours)) ?? []
    weekdays =
      try c.decodeIfPresent([Int: [OpeningInterval]].self, forKey: .weekdays)
      ?? Dictionary(uniqueKeysWithValues: (1...5).map { ($0, intervals) })
    exceptions = try c.decodeIfPresent([FacilityException].self, forKey: .exceptions) ?? []
    source =
      try c.decodeIfPresent(String.self, forKey: .source)
      ?? "https://www.univcoop-tokai.jp/sucoop/coop/coop_604.html"
    band = try c.decodeIfPresent(Bool.self, forKey: .band) ?? (title == "南館食堂" || title == "北館ショップ")
  }
  public func intervals(on date: Date) -> [OpeningInterval] {
    exceptions.first { $0.day == Tokyo.dayKey(date) }?.intervals ?? weekdays[Tokyo.weekday(date)]
      ?? []
  }
  public func label(on date: Date) -> String {
    if !exceptions.contains(where: { $0.day == Tokyo.dayKey(date) }),
      (try? OpeningInterval.parse(hours)) == nil, weekdays.values.allSatisfy({ $0.isEmpty })
    {
      return "未確認：旧設定「\(hours)」。曜日別時間を設定してください。"
    }
    let a = intervals(on: date)
    return (exceptions.contains { $0.day == Tokyo.dayKey(date) } ? "個人設定・" : "通常期の目安・")
      + (a.isEmpty ? "休業" : a.map(\.label).joined(separator: " / "))
  }
}
public struct EventEdit: Codable, Equatable, Identifiable {
  public var id: String
  public var title: String?
  public var location: String?
  public var start: Date?
  public var end: Date?
  public var cancelled = false
  public init(
    id: String, title: String? = nil, location: String? = nil, start: Date? = nil, end: Date? = nil,
    cancelled: Bool = false
  ) {
    self.id = id
    self.title = title
    self.location = location
    self.start = start
    self.end = end
    self.cancelled = cancelled
  }
  public func applying(to original: CampusEvent, course: Bool = false) -> CampusEvent {
    var e = original
    e.title = title ?? e.title
    e.location = location ?? e.location
    if let start, let end {
      if course {
        let shift = TimeInterval(Tokyo.minute(start) - Tokyo.minute(original.start)) * 60
        e.start = original.start.addingTimeInterval(shift)
        e.end = e.start.addingTimeInterval(end.timeIntervalSince(start))
      } else {
        e.start = start
        e.end = end
      }
    }
    return e
  }
}
public struct ImportDifference: Identifiable {
  public var id: String
  public var before: CampusEvent?
  public var after: CampusEvent?
  public var conflict: Bool
  public var label: String { before == nil ? "追加" : after == nil ? "削除" : "変更" }
}
public enum ConflictChoice: String, Codable { case personal, pdf }
/// The persisted root document holding all user and imported data.
public struct AppData: Codable, Equatable {
  public var schema = 2
  public var imports: [ImportPlan] = []
  public var notes: [Note] = []
  public var selectedCalendarIDs: [String] = []
  public var facilities = [
    Facility("北館ショップ", "10:00–17:00"), Facility("北館食堂", "11:00–14:00"),
    Facility("みなっぷ", "10:00–15:00"), Facility("南館食堂", "11:00–14:30 / 17:00–19:00（夕 L.O.18:45）"),
    Facility("トラベルセンター", "10:00–16:15"), Facility("住まい・総務", "11:00–16:15"),
  ]
  public var links = [
    CampusLink("学務情報", "https://gakujo.shizuoka.ac.jp/lcu-web/"),
    CampusLink("大学行事・時限", "https://www.shizuoka.ac.jp/education/affairs/schedule/"),
    CampusLink("静大生協", "https://www.univcoop-tokai.jp/sucoop/coop/coop_604.html"),
    CampusLink("Outlook", "https://outlook.office.com/calendar/"),
  ]
  public var occurrenceEdits: [EventEdit] = []
  public var courseEdits: [EventEdit] = []
  public var addedEvents: [CampusEvent] = []
  public var preservedEvents: [CampusEvent] = []
  public var pinnedNoteIDs: [UUID] = []
  public var showBands = true
  public var startHour = 8
  public var endHour = 19
  public init() {}
  enum CodingKeys: String, CodingKey {
    case schema, imports, notes, selectedCalendarIDs, facilities, links, occurrenceEdits,
      courseEdits, addedEvents, preservedEvents, pinnedNoteIDs, showBands, startHour, endHour
  }
  public init(from d: Decoder) throws {
    self.init()
    let c = try d.container(keyedBy: CodingKeys.self)
    schema = try c.decode(Int.self, forKey: .schema)
    guard schema == 1 || schema == 2 else { throw JSONStore.StoreError.unsupported }
    imports = try c.decode([ImportPlan].self, forKey: .imports)
    notes = try c.decode([Note].self, forKey: .notes)
    selectedCalendarIDs = try c.decode([String].self, forKey: .selectedCalendarIDs)
    facilities = try c.decode([Facility].self, forKey: .facilities)
    links = try c.decode([CampusLink].self, forKey: .links)
    occurrenceEdits = try c.decodeIfPresent([EventEdit].self, forKey: .occurrenceEdits) ?? []
    courseEdits = try c.decodeIfPresent([EventEdit].self, forKey: .courseEdits) ?? []
    addedEvents = try c.decodeIfPresent([CampusEvent].self, forKey: .addedEvents) ?? []
    preservedEvents = try c.decodeIfPresent([CampusEvent].self, forKey: .preservedEvents) ?? []
    pinnedNoteIDs = try c.decodeIfPresent([UUID].self, forKey: .pinnedNoteIDs) ?? []
    showBands = try c.decodeIfPresent(Bool.self, forKey: .showBands) ?? true
    startHour = try c.decodeIfPresent(Int.self, forKey: .startHour) ?? 8
    endHour = try c.decodeIfPresent(Int.self, forKey: .endHour) ?? 19
  }
  public func courseID(for e: CampusEvent) -> String? {
    imports.flatMap(\.courses).sorted { $0.id.count > $1.id.count }.first {
      e.id.hasPrefix($0.id + "-")
    }?.id
      ?? (e.id.hasPrefix("manual:")
        ? e.id.split(separator: ":").dropFirst().first.map(String.init) : nil)
  }
  public var originalEvents: [CampusEvent] {
    preservedEvents + imports.flatMap(\.events) + addedEvents
  }
  public var events: [CampusEvent] {
    var seen = Set<String>()
    return originalEvents.compactMap { original in
      guard seen.insert(original.id).inserted else { return nil }
      let course = courseID(for: original).flatMap { id in courseEdits.first { $0.id == id } }
      let occurrence = occurrenceEdits.first { $0.id == original.id }
      guard !(occurrence?.cancelled ?? course?.cancelled ?? false) else { return nil }
      let e = course?.applying(to: original, course: true) ?? original
      return occurrence?.applying(to: e) ?? e
    }.sorted { $0.start < $1.start }
  }
  public func validate() throws {
    func unique<T: Hashable>(_ values: [T]) -> Bool { Set(values).count == values.count }
    guard startHour >= 0, endHour <= 24, startHour < endHour,
      unique(imports.map(\.key)), unique(notes.map(\.id)), unique(links.map(\.id)),
      unique(facilities.map(\.id)),
      imports.allSatisfy({ unique($0.events.map(\.id)) && unique($0.courses.map(\.id)) }),
      unique(addedEvents.map(\.id)), unique(preservedEvents.map(\.id)),
      unique(occurrenceEdits.map(\.id)), unique(courseEdits.map(\.id)), unique(pinnedNoteIDs),
      originalEvents.allSatisfy({ $0.end > $0.start }),
      facilities.allSatisfy({
        $0.weekdays.keys.allSatisfy { (1...7).contains($0) }
          && $0.weekdays.values.allSatisfy(OpeningInterval.validate)
          && $0.exceptions.allSatisfy { OpeningInterval.validate($0.intervals) }
      }),
      notes.allSatisfy({
        unique($0.checklist.map(\.id)) && unique($0.images.map(\.id))
          && $0.images.allSatisfy {
            $0.width > 0 && $0.height > 0 && !$0.filename.contains("/")
              && !$0.filename.contains("..")
          }
      })
    else { throw JSONStore.StoreError.invalid }
  }
  /// External IDs carry an ownership marker only when CalendarModel has verified it.
  /// Suppress that old external copy even when its current local occurrence is cancelled.
  public func combined(external: [CampusEvent]) -> [CampusEvent] {
    let owned = Set(originalEvents.map(\.id))
    return (events + external.filter { !owned.contains($0.id) }).sorted { $0.start < $1.start }
  }
  public mutating func replace(_ plan: ImportPlan) {
    imports.removeAll { $0.key == plan.key }
    imports.append(plan)
  }
  public func difference(_ plan: ImportPlan) -> [ImportDifference] {
    let old = imports.first { $0.key == plan.key }?.events ?? []
    let a = Dictionary(uniqueKeysWithValues: old.map { ($0.id, $0) })
    let b = Dictionary(uniqueKeysWithValues: plan.events.map { ($0.id, $0) })
    return Set(a.keys).union(b.keys).sorted().compactMap { id in
      guard a[id] != b[id] else { return nil }
      let e = a[id] ?? b[id]!
      let conflict =
        occurrenceEdits.contains { $0.id == id }
        || courseID(for: e).map { cid in courseEdits.contains { $0.id == cid } } == true
      return ImportDifference(id: id, before: a[id], after: b[id], conflict: conflict)
    }
  }
  public mutating func install(_ plan: ImportPlan, choices: [String: ConflictChoice]) throws {
    let diff = difference(plan)
    guard diff.filter(\.conflict).allSatisfy({ choices[$0.id] != nil }) else {
      throw ValidationError.conflict
    }
    let effective = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
    let originals = originalEvents
    func personalEdit(_ original: CampusEvent) -> EventEdit {
      let value = effective[original.id] ?? original
      return EventEdit(
        id: original.id, title: value.title, location: value.location, start: value.start,
        end: value.end, cancelled: effective[original.id] == nil)
    }
    let affectedCourses = Set(
      diff.filter { $0.conflict && choices[$0.id] == .pdf }.compactMap { d in
        (d.before ?? d.after).flatMap { courseID(for: $0) }
      })
    // A per-occurrence PDF choice splits a course edit into explicit occurrence edits,
    // so adopting one changed PDF occurrence cannot alter the other personal changes.
    for original in originals
    where courseID(for: original).map({ affectedCourses.contains($0) }) == true {
      occurrenceEdits.removeAll { $0.id == original.id }
      occurrenceEdits.append(personalEdit(original))
    }
    courseEdits.removeAll { affectedCourses.contains($0.id) }
    for d in diff {
      preservedEvents.removeAll { $0.id == d.id }
      if d.conflict && choices[d.id] == .personal, let original = d.before {
        preservedEvents.append(original)
        occurrenceEdits.removeAll { $0.id == d.id }
        occurrenceEdits.append(personalEdit(original))
      }
      if d.conflict && choices[d.id] == .pdf { occurrenceEdits.removeAll { $0.id == d.id } }
    }
    replace(plan)

  }
}
/// Synchronous JSON persistence for `AppData`.
public struct JSONStore {
  public let url: URL
  public init(url: URL) { self.url = url }
  public func load() throws -> AppData {
    guard FileManager.default.fileExists(atPath: url.path) else { return AppData() }
    let original = try Data(contentsOf: url)
    var value = try JSONDecoder().decode(AppData.self, from: original)
    try value.validate()
    if value.schema == 1 {
      // Legacy images, if any, must be readable before a migration can replace JSON.
      for attachment in value.notes.flatMap(\.images) {
        _ = try Data(
          contentsOf: url.deletingLastPathComponent().appendingPathComponent("Images")
            .appendingPathComponent(attachment.filename))
      }
      let backup = url.appendingPathExtension("schema1-original")
      if !FileManager.default.fileExists(atPath: backup.path) {
        try original.write(to: backup, options: [.atomic, .completeFileProtectionUnlessOpen])
      }
      value.schema = 2
      try save(value)
    }
    return value
  }
  public func save(_ v: AppData) throws {
    let encoded = try JSONEncoder().encode(v)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try encoded.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
  }
  public enum StoreError: LocalizedError {
    case unsupported, invalid
    public var errorDescription: String? {
      self == .unsupported ? "保存データの版が未対応です。既存ファイルは保持しました。" : "保存データの内容が破損しています。原本は保持しました。"
    }
  }
}
/// Stores note image attachments on disk.
public struct ImageStore {
  public let root: URL
  public init(root: URL) { self.root = root }
  public func url(_ attachment: ImageAttachment) -> URL {
    root.appendingPathComponent(attachment.filename)
  }
  public func save(_ data: Data, width: Int, height: Int, format: String) throws -> ImageAttachment
  {
    guard data.count <= 40 * 1024 * 1024, width > 0, height > 0, width <= 20000, height <= 20000,
      ["jpeg", "png", "heic"].contains(format)
    else { throw ValidationError.image }
    let id = UUID()
    let a = ImageAttachment(
      id: id, filename: "\(id.uuidString).\(format)", width: width, height: height, format: format)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try data.write(to: url(a), options: [.atomic, .completeFileProtectionUnlessOpen])
    return a
  }
  public func remove(_ a: ImageAttachment) throws { try FileManager.default.removeItem(at: url(a)) }
}
