import CampusCore
import EventKit
import SwiftUI

/// EventKit objects remain on the worker queue. Only immutable display values reach SwiftUI.
struct CalendarOption: Identifiable {
  let calendarIdentifier: String
  let title: String
  var id: String { calendarIdentifier }
}
private struct CalendarSnapshot {
  var calendars: [CalendarOption] = []
  var events: [CampusEvent] = []
  var range: ClosedRange<Date>?
}
private final class CalendarReader {
  let queue = DispatchQueue(label: "jp.personal.CampusPocket.eventkit", qos: .userInitiated)
  private lazy var store = EKEventStore()
  func request(completion: @escaping (Error?) -> Void) {
    queue.async {
      self.store.requestFullAccessToEvents { _, error in completion(error) }
    }
  }
  func fetch(selected: [String], coverage: ClosedRange<Date>, completion: @escaping (CalendarSnapshot) -> Void) {
    queue.async {
      guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
        completion(CalendarSnapshot()); return
      }
      let calendars = self.store.calendars(for: .event).sorted { $0.title < $1.title }
      let options = calendars.map { CalendarOption(calendarIdentifier: $0.calendarIdentifier, title: $0.title) }
      let chosen = calendars.filter { selected.contains($0.calendarIdentifier) }
      guard !chosen.isEmpty else { completion(CalendarSnapshot(calendars: options)); return }
      let events = self.store.events(matching: self.store.predicateForEvents(
        withStart: coverage.lowerBound, end: coverage.upperBound, calendars: chosen)
      ).map { e in
        let marker = e.url?.absoluteString
        let owned = marker?.hasPrefix("campuspocket://event/") == true
        let id = owned ? String(marker!.dropFirst("campuspocket://event/".count))
          : "external:\(e.eventIdentifier ?? e.calendarItemIdentifier):\(e.startDate.timeIntervalSince1970)"
        return CampusEvent(id: id, title: e.title ?? "外部予定", start: e.startDate, end: e.endDate,
          location: e.location ?? "", kind: "external", allDay: e.isAllDay)
      }.sorted { $0.start < $1.start }
      completion(CalendarSnapshot(calendars: options, events: events, range: coverage))
    }
  }
}
@MainActor final class CalendarModel: ObservableObject {
  @Published var calendars: [CalendarOption] = []
  @Published var events: [CampusEvent] = []
  @Published var message = "未許可：標準カレンダーの読み取りを設定してください。"
  @Published var refreshedAt: Date?
  @Published var range: ClosedRange<Date>?
  @Published var authorized = false
  private let reader = CalendarReader()
  private var observer: NSObjectProtocol?
  private var selection: [String] = []
  private var focus = Date()
  private struct Request: Equatable { let selected: [String]; let coverage: ClosedRange<Date>; let revision: Int }
  private var revision = 0
  private var pending: Request?
  private var inFlight: Request?
  private var combinedCache = CombinedEventsCache()
  init() {
    observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in
        guard let self else { return }
        self.refresh(selected: self.selection, date: self.focus, force: true)
      }
    }
  }
  deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
  func request(selected: [String], date: Date) async {
    let error: Error? = await withCheckedContinuation { continuation in
      reader.request { continuation.resume(returning: $0) }
    }
    if let error {
      clearUnauthorized()
      message = "アクセス要求に失敗：\(error.localizedDescription)"
    } else { refresh(selected: selected, date: date) }
  }
  func refresh(selected: [String], date: Date, force: Bool = false) {
    let changedSelection = Set(selection) != Set(selected)
    selection = selected; focus = date
    let status = EKEventStore.authorizationStatus(for: .event)
    let canRead = status == .fullAccess
    if authorized != canRead { authorized = canRead }
    guard canRead else { clearUnauthorized(); return }
    if changedSelection { events = []; range = nil; refreshedAt = nil }
    let coverage = CalendarCoverage.range(around: date)
    let ids = selected.sorted()
    // Simultaneous Root/Home/scene requests for identical data share one in-flight fetch.
    if !force, let request = pending ?? inFlight, request.revision == revision, request.selected == ids, request.coverage == coverage { return }
    revision += 1
    pending = Request(selected: ids, coverage: coverage, revision: revision)
    startPending()
  }
  private func clearUnauthorized() {
    revision += 1; pending = nil
    // Always invalidate stale requests, but publish only values that actually change.
    if authorized { authorized = false }
    if !events.isEmpty { events = [] }
    if !calendars.isEmpty { calendars = [] }
    if refreshedAt != nil { refreshedAt = nil }
    if range != nil { range = nil }
    let status = EKEventStore.authorizationStatus(for: .event)
    let nextMessage = status == .denied || status == .restricted
      ? "権限拒否・取消し：外部予定を非表示にしています。ローカル情報は使えます。"
      : "未許可：OSのフルアクセスは読み取りに必要ですが、このアプリは表示のみです。"
    if message != nextMessage { message = nextMessage }
  }
  private func startPending() {
    guard inFlight == nil, let request = pending else { return }
    pending = nil; inFlight = request
    message = "端末の予定を取得中…"
    reader.fetch(selected: request.selected, coverage: request.coverage) { [weak self] snapshot in
      Task { @MainActor in
        guard let self else { return }
        self.inFlight = nil
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
          self.clearUnauthorized(); return
        }
        if request.revision == self.revision {
          self.calendars = snapshot.calendars; self.events = snapshot.events; self.range = snapshot.range
          self.refreshedAt = snapshot.range == nil ? nil : Date()
          self.message = snapshot.range != nil
            ? "端末から取得済み・最新のOutlook同期は未確認（オフラインでも端末の取得済み予定を表示）"
            : snapshot.calendars.isEmpty ? "対象なし：標準カレンダーに利用できるアカウントがありません。"
            : "未選択：表示するカレンダーを設定してください。"
        }
        self.startPending()
      }
    }
  }
  func resume(selected: [String], date: Date? = nil) { refresh(selected: selected, date: date ?? focus) }
  func covers(_ day: Date) -> Bool { CalendarCoverage.contains(day: day, in: range) }
  func displayMessage(on day: Date) -> String {
    if authorized && !selection.isEmpty && !covers(day) { return "未取得：この日の外部予定は取得範囲外です。再取得してください。" }
    return message
  }
  func combined(_ data: AppData) -> [CampusEvent] { combinedCache.events(in: data, external: events) }
}
