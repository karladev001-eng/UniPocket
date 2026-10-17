import Foundation

/// Every request is enqueued synchronously, before returning to the caller. Loading, encoding,
/// atomic replacement and barriers run on one private queue; task scheduling cannot reorder writes.
public final class AsyncJSONStore: @unchecked Sendable {
  private let queue = DispatchQueue(label: "jp.personal.CampusPocket.json", qos: .userInitiated)
  private let store: JSONStore
  public init(url: URL) { store = JSONStore(url: url) }
  public func load(completion: @escaping (Result<AppData, Error>) -> Void) {
    queue.async { completion(Result { try self.store.load() }) }
  }
  public func save(_ data: AppData, completion: @escaping (Result<Void, Error>) -> Void) {
    queue.async { completion(Result { try self.store.save(data) }) }
  }
  /// A bounded transaction can prepare associated files and atomically save JSON on the same
  /// queue. Its caller owns rollback of any newly created file if the JSON write fails.
  public func perform<Value>(_ action: @escaping (JSONStore) throws -> Value,
    completion: @escaping (Result<Value, Error>) -> Void) {
    queue.async { completion(Result { try action(self.store) }) }
  }
  /// Completes after every write accepted before this call, including failed writes.
  public func flush(completion: @escaping () -> Void) { queue.async(execute: completion) }
}

/// Schedule-only inputs keep note edits and presentation updates out of event reconstruction.
public struct CombinedEventsCache {
  private struct Inputs: Equatable {
    let imports: [ImportPlan]
    let occurrence: [EventEdit]
    let course: [EventEdit]
    let added: [CampusEvent]
    let preserved: [CampusEvent]
    init(_ data: AppData) {
      imports = data.imports; occurrence = data.occurrenceEdits; course = data.courseEdits
      added = data.addedEvents; preserved = data.preservedEvents
    }
  }
  private var inputs: Inputs?
  private var external: [CampusEvent] = []
  private var result: [CampusEvent] = []
  public private(set) var rebuildCount = 0
  public init() {}
  public mutating func events(in data: AppData, external events: [CampusEvent]) -> [CampusEvent] {
    let next = Inputs(data)
    guard next != inputs || events != external else { return result }
    result = data.combined(external: events)
    inputs = next; external = events; rebuildCount += 1
    return result
  }
}
