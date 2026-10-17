import AppKit
import Foundation
import PDFKit
import Testing

@testable import CampusCore

struct CoreTests {
  @Test func testAtomicRoundTripAndReplacement() throws {
    let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      .appendingPathComponent("data.json")
    defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
    let store = JSONStore(url: path)
    var data = try store.load()
    let plan = ImportPlan(
      year: 2026, term: "autumn", courses: [], events: [], warnings: [], importedAt: Date())
    data.replace(plan)
    data.replace(plan)
    data.notes = [Note()]
    data.notes[0].text = "即時保存"
    data.facilities[0].hours = "個人設定"
    data.links.append(CampusLink("テスト", "https://example.com"))
    try store.save(data)
    equal(try store.load(), data)
    equal(data.imports.count, 1)
    let saved = try Data(contentsOf: path)
    let folder = path.deletingLastPathComponent()
    try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: folder.path)
    var changed = data
    changed.notes[0].text = "保存に失敗する変更"
    expectThrows(try store.save(changed))
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path)
    equal(try Data(contentsOf: path), saved)
    let impossible = JSONStore(url: path.appendingPathComponent("nested/data.json"))
    expectThrows(try impossible.save(data))
    equal(try Data(contentsOf: path), saved)
  }
  @Test func testRealPDF() throws {
    guard let registration = ProcessInfo.processInfo.environment["TIMETABLE_PDF"],
      let annual = ProcessInfo.processInfo.environment["SCHEDULE_PDF"]
    else { return }
    let plan = try PDFImporter.preview(
      timetableURL: URL(fileURLWithPath: registration), scheduleURL: URL(fileURLWithPath: annual))
    equal(plan.year, 2026)
    equal(plan.courses.filter { $0.weekday != nil }.count, 4)
    equal(plan.courses.filter { $0.weekday == nil }.count, 2)
    equal(plan.events.filter { $0.kind == "class" }.count, 56)
    equal(plan.events.filter { $0.kind == "exam" }.count, 4)
    let titles = plan.courses.filter { $0.weekday != nil }.map(\.title)
    print("実物PDF・通常講義:", titles)
    equal(
      titles,
      ["情報工学特論(機械工学専攻)", "画像情報処理工学特論(電気電子工学専攻)", "応用エレクトロニクス特論(電気電子工学専", "産業イノベーション特論(総研共通（浜松）)"])
    falsity(
      plan.events.contains { $0.kind == "university" && Tokyo.dayKey($0.start) == "2026-10-30" })
    let classes = plan.events.filter { $0.kind != "university" }
    func on(_ key: String) -> [CampusEvent] { classes.filter { Tokyo.dayKey($0.start) == key } }
    equal(on("2026-11-25").count, 1)
    truth(on("2026-11-25")[0].title.contains("情報工学特論"))
    truth(on("2026-11-06").isEmpty)
    truth(on("2027-01-07").isEmpty)
    equal(on("2027-01-04").count, 1)
    equal(on("2027-02-04").first?.kind, "exam")
    falsity(
      classes.contains { $0.start >= Tokyo.date(2026, 12, 22) && $0.start < Tokyo.date(2027, 1, 4) }
    )
    let expected: [Int: [String]] = [
      1: [
        "10-05", "10-19", "10-26", "11-02", "11-09", "11-16", "11-25", "11-30", "12-07", "12-14",
        "12-21", "01-04", "01-18", "01-25", "02-01",
      ],
      2: [
        "10-06", "10-13", "10-20", "10-27", "11-10", "11-17", "11-24", "12-01", "12-08", "12-15",
        "01-05", "01-12", "01-19", "01-26", "02-02",
      ],
      3: [
        "10-07", "10-14", "10-21", "10-28", "11-04", "11-11", "11-18", "12-02", "12-09", "12-16",
        "01-06", "01-13", "01-20", "01-27", "02-03",
      ],
      4: [
        "10-01", "10-08", "10-15", "10-22", "10-29", "11-05", "11-12", "11-19", "11-26", "12-03",
        "12-10", "12-17", "01-14", "01-28", "02-04",
      ],
    ]
    for c in plan.courses where c.weekday != nil {
      equal(
        classes.filter { $0.id.hasPrefix(c.id + "-") }.map {
          String(Tokyo.dayKey($0.start).suffix(5))
        }, expected[c.weekday!])
    }
    var data = AppData()
    data.replace(plan)
    data.replace(plan)
    equal(data.events.count, plan.events.count)
    let encoded = String(data: try JSONEncoder().encode(data), encoding: .utf8)!
    let rawHeader = PDFDocument(url: URL(fileURLWithPath: registration))!.page(at: 0)!.string!
    let pattern = try NSRegularExpression(pattern: "\\([0-9]{3}[A-Z][0-9]{4}\\)")
    let ns = rawHeader as NSString
    for match in pattern.matches(in: rawHeader, range: NSRange(location: 0, length: ns.length)) {
      falsity(encoded.contains(ns.substring(with: match.range)))
    }
    falsity(encoded.contains("修得単位"))
    expectThrows(
      try PDFImporter.preview(
        timetableURL: URL(fileURLWithPath: annual), scheduleURL: URL(fileURLWithPath: registration))
    )
  }
  @Test func testRejectedPDFsPreserveState() throws {
    guard let registration = ProcessInfo.processInfo.environment["TIMETABLE_PDF"],
      let annual = ProcessInfo.processInfo.environment["SCHEDULE_PDF"]
    else { return }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let corrupt = folder.appendingPathComponent("broken.pdf")
    try Data("broken".utf8).write(to: corrupt)
    let wrongYear = folder.appendingPathComponent("wrong-year.pdf")
    try makePDF("令和9年度 行事予定表 後学期試験 通常課程の年間予定表です 年度不一致", to: wrongYear)
    let unknown = folder.appendingPathComponent("unknown.pdf")
    try makePDF("令和8年度 行事予定表 後学期試験 通常課程の年間予定表です 未対応形式", to: unknown)
    let image = folder.appendingPathComponent("image.pdf")
    let bitmap = NSImage(size: NSSize(width: 842, height: 595))
    bitmap.lockFocus()
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: 842, height: 595).fill()
    bitmap.unlockFocus()
    let document = PDFDocument()
    document.insert(PDFPage(image: bitmap)!, at: 0)
    try document.dataRepresentation()!.write(to: image)
    let store = JSONStore(url: folder.appendingPathComponent("data.json"))
    var data = AppData()
    data.notes = [Note()]
    data.notes[0].text = "保持するメモ"
    try store.save(data)
    let saved = try Data(contentsOf: store.url)
    for input in [corrupt, image] {
      expectThrows(
        try PDFImporter.preview(timetableURL: input, scheduleURL: URL(fileURLWithPath: annual)))
      equal(try Data(contentsOf: store.url), saved)
    }
    do {
      _ = try PDFImporter.preview(
        timetableURL: URL(fileURLWithPath: registration), scheduleURL: wrongYear)
      Issue.record("年度不一致を検出していません")
    } catch ImportFailure.yearMismatch {} catch { Issue.record("年度不一致以外のエラー: \(error)") }
    do {
      _ = try PDFImporter.preview(timetableURL: image, scheduleURL: URL(fileURLWithPath: annual))
      Issue.record("画像PDFを検出していません")
    } catch ImportFailure.imageOnly {} catch { Issue.record("画像PDF以外のエラー: \(error)") }
    expectThrows(
      try PDFImporter.preview(
        timetableURL: URL(fileURLWithPath: registration), scheduleURL: unknown))
    equal(try Data(contentsOf: store.url), saved)
  }

}

private func equal<T: Equatable>(
  _ left: T, _ right: T, sourceLocation: SourceLocation = #_sourceLocation
) { #expect(left == right, sourceLocation: sourceLocation) }
private func truth(_ value: Bool, sourceLocation: SourceLocation = #_sourceLocation) {
  #expect(value, sourceLocation: sourceLocation)
}
private func falsity(_ value: Bool, sourceLocation: SourceLocation = #_sourceLocation) {
  #expect(!value, sourceLocation: sourceLocation)
}
private func expectThrows<T>(
  _ value: @autoclosure () throws -> T, sourceLocation: SourceLocation = #_sourceLocation
) {
  do {
    _ = try value()
    Issue.record("Expected error", sourceLocation: sourceLocation)
  } catch {}
}

private func makePDF(_ text: String, to url: URL) throws {
  var box = CGRect(x: 0, y: 0, width: 1700.74, height: 1202.74)
  let consumer = CGDataConsumer(url: url as CFURL)!
  let context = CGContext(consumer: consumer, mediaBox: &box, nil)!
  context.beginPDFPage(nil)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
  (text as NSString).draw(
    at: NSPoint(x: 754, y: 1100), withAttributes: [.font: NSFont.systemFont(ofSize: 16)])
  NSGraphicsContext.restoreGraphicsState()
  context.endPDFPage()
  context.closePDF()
}

struct VersionFourTests {
  @Test func migrationAndCorruptionProtectOriginal() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = JSONStore(url: root.appendingPathComponent("data.json"))
    var legacy = AppData()
    legacy.schema = 1
    legacy.notes = [Note()]
    legacy.notes[0].text = "既存本文"
    legacy.facilities[0].hours = "個人設定・未定"
    try store.save(legacy)
    // Produce actual schema=1 shape, without new fields in nested records.
    var object =
      try JSONSerialization.jsonObject(with: Data(contentsOf: store.url)) as! [String: Any]
    for key in [
      "occurrenceEdits", "courseEdits", "addedEvents", "preservedEvents", "pinnedNoteIDs",
      "showBands", "startHour", "endHour",
    ] { object.removeValue(forKey: key) }
    var notes = object["notes"] as! [[String: Any]]
    notes[0].removeValue(forKey: "images")
    object["notes"] = notes
    var facilities = object["facilities"] as! [[String: Any]]
    for i in facilities.indices {
      for key in ["weekdays", "exceptions", "source", "band"] {
        facilities[i].removeValue(forKey: key)
      }
    }
    object["facilities"] = facilities
    let bytes = try JSONSerialization.data(withJSONObject: object)
    try bytes.write(to: store.url)
    let migrated = try store.load()
    equal(migrated.schema, 2)
    equal(migrated.notes[0].text, "既存本文")
    truth(migrated.facilities[0].label(on: Tokyo.date(2026, 10, 9)).contains("未確認"))
    equal(try Data(contentsOf: store.url.appendingPathExtension("schema1-original")), bytes)
    equal(try store.load(), migrated)
    let corrupt = Data("{broken".utf8)
    try corrupt.write(to: store.url)
    expectThrows(try store.load())
    equal(try Data(contentsOf: store.url), corrupt)
  }
  @Test func migrationFailureDoesNotOverwriteOriginal() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer {
      try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
      try? FileManager.default.removeItem(at: root)
    }
    let store = JSONStore(url: root.appendingPathComponent("data.json"))
    var old = AppData()
    old.schema = 1
    try store.save(old)
    let bytes = try Data(contentsOf: store.url)
    try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: root.path)
    expectThrows(try store.load())
    equal(try Data(contentsOf: store.url), bytes)
  }
  @Test func intervalsAndTimeBoundaries() throws {
    expectThrows(try OpeningInterval.parse("10:99–17:00"))
    expectThrows(try OpeningInterval.parse("11:00–14:00 / 13:00–17:00"))
    expectThrows(try OpeningInterval.parse("11:00–14:00（L.O.10:00）"))
    var f = Facility("南館食堂", "11:00–14:30 / 17:00–19:00（L.O.18:45）")
    let d = Tokyo.date(2026, 10, 9)
    equal(f.intervals(on: d).count, 2)
    f.exceptions = [FacilityException(day: Tokyo.dayKey(d), intervals: [])]
    truth(f.intervals(on: d).isEmpty)
    truth(f.label(on: d).contains("個人設定・休業"))
    f.exceptions = []
    equal(f.intervals(on: d).count, 2)
    truth(f.intervals(on: Tokyo.date(2026, 10, 10)).isEmpty)
    let e = CampusEvent(
      id: "c-1", title: "授業", start: d.addingTimeInterval(3600), end: d.addingTimeInterval(7200))
    equal(e.timing(at: e.start), "授業中・終了まで60分")
    equal(e.timing(at: e.end), "終了")
    truth(e.timing(at: e.start.addingTimeInterval(-1)).contains("開始まで1分"))
    equal(Tokyo.week(d).count, 7)
    equal(Tokyo.week(d).first, Tokyo.date(2026, 10, 5))
  }
  @Test func editsImportConflictsAndRemovedPersonalOccurrence() throws {
    let c = Course(id: "c", title: "正式名称", weekday: 1, block: 0)
    let a = CampusEvent(
      id: "c-1", title: c.title, start: Tokyo.date(2026, 10, 5, 8, 40),
      end: Tokyo.date(2026, 10, 5, 10, 10))
    let b = CampusEvent(
      id: "c-2", title: c.title, start: Tokyo.date(2026, 10, 12, 8, 40),
      end: Tokyo.date(2026, 10, 12, 10, 10))
    let p = ImportPlan(
      year: 2026, term: "autumn", courses: [c], events: [a, b], warnings: [], importedAt: Date())
    var data = AppData()
    data.replace(p)
    data.courseEdits = [
      EventEdit(
        id: "c", title: "個人名", location: "個人教室", start: Tokyo.date(2026, 10, 5, 9),
        end: Tokyo.date(2026, 10, 5, 10))
    ]
    equal(data.events[0].title, "個人名")
    equal(Tokyo.time(data.events[1].start), "09:00")
    data.occurrenceEdits = [EventEdit(id: a.id, cancelled: true)]
    equal(data.events.count, 1)
    data.occurrenceEdits = []
    var next = p
    next.events = [b]
    equal(data.difference(next).filter(\.conflict).count, 1)
    let snapshot = data
    expectThrows(try data.install(next, choices: [:]))
    equal(data, snapshot)
    try data.install(next, choices: [a.id: .personal])
    equal(data.events.count, 2)
    equal(data.imports[0].events.count, 1)
    equal(data.events.first { $0.id == a.id }?.title, "個人名")
    try data.install(next, choices: [:])
    equal(data.events.count, 2)
    var changed = next
    changed.events[0].location = "新PDF教室"
    truth(data.difference(changed)[0].conflict)
    try data.install(changed, choices: [b.id: .pdf])
    equal(data.events.first { $0.id == b.id }?.location, "新PDF教室")
    equal(data.events.first { $0.id == a.id }?.location, "個人教室")
    data.addedEvents = [
      CampusEvent(
        id: "manual:c:one", title: "日程追加", start: Tokyo.date(2026, 10, 9),
        end: Tokyo.date(2026, 10, 9, 1))
    ]
    equal(data.courseID(for: data.addedEvents[0]), "c")
  }
  @Test func imagesSaveFailureAndReferencesRoundTrip() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = ImageStore(root: root.appendingPathComponent("Images"))
    let bytes = Data([1, 2, 3])
    let a = try store.save(bytes, width: 1200, height: 800, format: "png")
    equal(try Data(contentsOf: store.url(a)), bytes)
    expectThrows(try store.save(bytes, width: 0, height: 1, format: "png"))
    expectThrows(try store.save(bytes, width: 1, height: 1, format: "gif"))
    let blocker = root.appendingPathComponent("blocker")
    try bytes.write(to: blocker)
    expectThrows(try ImageStore(root: blocker).save(bytes, width: 2, height: 2, format: "png"))
    var d = AppData()
    var n = Note()
    n.images = [a]
    d.notes = [n]
    d.pinnedNoteIDs = [n.id]
    let json = JSONStore(url: root.appendingPathComponent("data.json"))
    try json.save(d)
    equal(try json.load(), d)
    d.pinnedNoteIDs = []
    try json.save(d)
    truth(FileManager.default.fileExists(atPath: store.url(a).path))
    d.notes = []
    try json.save(d)
    truth(FileManager.default.fileExists(atPath: store.url(a).path))
  }
  @Test func qaSeedWhenRequested() throws {
    guard ProcessInfo.processInfo.environment["QA_SEED"] == "1",
      let a = ProcessInfo.processInfo.environment["TIMETABLE_PDF"],
      let b = ProcessInfo.processInfo.environment["SCHEDULE_PDF"]
    else { return }
    var data = AppData()
    data.replace(
      try PDFImporter.preview(
        timetableURL: URL(fileURLWithPath: a), scheduleURL: URL(fileURLWithPath: b)))
    try JSONEncoder().encode(data).write(
      to: URL(fileURLWithPath: "/tmp/univ-v4-qa-data.json"), options: .atomic)
  }
}

struct DeduplicationTests {
  @Test func ownedCopiesNeverHideCurrentLocalRevision() {
    let original = CampusEvent(
      id: "course-1", title: "同じ件名", start: Tokyo.date(2026, 10, 9, 9),
      end: Tokyo.date(2026, 10, 9, 10))
    var data = AppData()
    data.addedEvents = [original]
    data.occurrenceEdits = [EventEdit(id: original.id, title: "修正版", location: "新教室")]
    var owned = original
    owned.kind = "external"
    var ordinary = original
    ordinary.id = "external:unowned"
    ordinary.kind = "external"
    let merged = data.combined(external: [owned, ordinary])
    equal(merged.count, 2)
    truth(merged.contains { $0.title == "修正版" && $0.location == "新教室" })
    truth(merged.contains { $0.id == ordinary.id })
    data.occurrenceEdits = [EventEdit(id: original.id, cancelled: true)]
    equal(data.combined(external: [owned, ordinary]).map(\.id), [ordinary.id])
  }
}

struct InvalidDataTests {
  @Test func malformedSchemaAndMissingLegacyImageDoNotOverwrite() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = JSONStore(url: root.appendingPathComponent("data.json"))
    var d = AppData()
    d.endHour = d.startHour
    try store.save(d)
    let bytes = try Data(contentsOf: store.url)
    expectThrows(try store.load())
    equal(try Data(contentsOf: store.url), bytes)
    d = AppData()
    d.schema = 1
    var n = Note()
    n.images = [ImageAttachment(filename: "missing.png", width: 10, height: 10, format: "png")]
    d.notes = [n]
    try store.save(d)
    let original = try Data(contentsOf: store.url)
    expectThrows(try store.load())
    equal(try Data(contentsOf: store.url), original)
  }
}

struct ReviewRegressionTests {
  @Test func coverageTracksViewedDayAndHomeDayAcrossResume() {
    let today = Tokyo.date(2026, 10, 9, 12)
    let future = Tokyo.date(2027, 1, 9)
    let viewed = CalendarCoverage.range(around: future)
    truth(CalendarCoverage.contains(day: future, in: viewed))
    falsity(CalendarCoverage.contains(day: today, in: viewed))
    let home = CalendarCoverage.range(around: today)
    truth(CalendarCoverage.contains(day: today, in: home))
    truth(CalendarCoverage.contains(day: Tokyo.date(2026, 10, 10), in: home))
    truth(CalendarCoverage.contains(day: Tokyo.date(2026, 9, 29), in: home))
    truth(CalendarCoverage.contains(day: home.lowerBound, in: home))
    falsity(CalendarCoverage.contains(day: home.upperBound, in: home))
    falsity(CalendarCoverage.contains(day: today, in: nil))
    let partial = Tokyo.date(2026, 10, 9, 12)...Tokyo.date(2026, 10, 10)
    falsity(CalendarCoverage.contains(day: today, in: partial))
  }
  @Test func midnightCrossingOutsideEventsRemainCounted() {
    let day = Tokyo.date(2026, 10, 9)
    let evening = CampusEvent(
      id: "evening", title: "夜を跨ぐ", start: Tokyo.date(2026, 10, 9, 20),
      end: Tokyo.date(2026, 10, 10, 9))
    let morning = CampusEvent(
      id: "morning", title: "前日から朝まで", start: Tokyo.date(2026, 10, 8, 16),
      end: Tokyo.date(2026, 10, 9, 7))
    let inside = CampusEvent(
      id: "inside", title: "表示範囲内", start: Tokyo.date(2026, 10, 9, 8),
      end: Tokyo.date(2026, 10, 9, 19))
    let boundary = CampusEvent(
      id: "boundary", title: "日境界で終了", start: Tokyo.date(2026, 10, 8, 23), end: day)
    equal([evening, morning, inside, boundary].filter { $0.occurs(on: day) }.count, 3)
    equal(
      [evening, morning, inside, boundary].filter {
        $0.extendsOutside(on: day, startMinute: 480, endMinute: 1140)
      }.map(\.id), [evening.id, morning.id])
    truth(evening.extendsOutside(on: Tokyo.date(2026, 10, 10), startMinute: 480, endMinute: 1140))
    falsity(boundary.occurs(on: day))
  }
  @Test func selectedFacilityDayKeepsFutureException() {
    let today = Tokyo.date(2026, 10, 9)
    let future = Tokyo.date(2026, 10, 12)
    var facility = Facility("食堂", "11:00–14:00")
    facility.exceptions = [
      FacilityException(
        day: Tokyo.dayKey(future), intervals: [OpeningInterval(start: 720, end: 780)])
    ]
    let selection = FacilitySelection(
      facilityID: facility.id, date: future.addingTimeInterval(12 * 3600))
    equal(selection.facilityID, facility.id)
    equal(selection.date, future)
    equal(facility.intervals(on: selection.date).map(\.label), ["12:00–13:00"])
    truth(facility.label(on: selection.date).contains("個人設定"))
    falsity(facility.label(on: today).contains("個人設定"))
  }
}
