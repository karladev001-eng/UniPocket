import Foundation
import Testing
@testable import CampusCore

struct PerformanceRegressionTests {
  private func makeNote(_ text: String) -> Note { var note = Note(); note.text = text; return note }
  @Test func testAsyncStoreOrdersSnapshotsAndFlush() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("data.json")
    let store = AsyncJSONStore(url: url)
    for number in 0..<80 {
      var data = AppData()
      data.notes = [makeNote("revision \(number)")]
      store.save(data) { result in
        if case .failure(let error) = result { Issue.record("Save failed: \(error)") }
        #expect(!Thread.isMainThread)
      }
    }
    await withCheckedContinuation { continuation in store.flush { continuation.resume() } }
    let result = try JSONStore(url: url).load()
    #expect(result.notes.first?.text == "revision 79")
  }

  @Test func testAsyncLoadFailureDoesNotReplaceOriginalAndCanRetrySave() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("data.json")
    let broken = Data("{broken".utf8)
    try broken.write(to: url)
    let store = AsyncJSONStore(url: url)
    let loaded: Result<AppData, Error> = await withCheckedContinuation { continuation in
      store.load { continuation.resume(returning: $0) }
    }
    #expect(throws: (any Error).self) { try loaded.get() }
    #expect(try Data(contentsOf: url) == broken)
    // A blocked filesystem fails without replacing another file. A later explicit retry succeeds.
    let blocked = directory.appendingPathComponent("blocker")
    try Data("keep".utf8).write(to: blocked)
    let retryStore = AsyncJSONStore(url: blocked.appendingPathComponent("data.json"))
    let failed: Result<Void, Error> = await withCheckedContinuation { continuation in
      retryStore.save(AppData()) { continuation.resume(returning: $0) }
    }
    #expect(throws: (any Error).self) { try failed.get() }
    #expect(try String(contentsOf: blocked) == "keep")
    try FileManager.default.removeItem(at: blocked)
    let saved: Result<Void, Error> = await withCheckedContinuation { continuation in
      retryStore.save(AppData()) { continuation.resume(returning: $0) }
    }
    try saved.get()
    #expect(try JSONStore(url: blocked.appendingPathComponent("data.json")).load().schema == 2)
  }

  @Test func testCombinedCacheIgnoresNotesAndTracksCancellationAndExternalDuplicates() {
    var data = AppData()
    let event = CampusEvent(id: "owned", title: "class", start: Date(timeIntervalSince1970: 100),
      end: Date(timeIntervalSince1970: 200), location: "A", kind: "class")
    data.addedEvents = [event]
    var cache = CombinedEventsCache()
    #expect(cache.events(in: data, external: [event]) == [event])
    #expect(cache.rebuildCount == 1)
    data.notes = [makeNote("unrelated edit")]
    data.startHour = 7
    #expect(cache.events(in: data, external: [event]) == [event])
    #expect(cache.rebuildCount == 1)
    data.occurrenceEdits = [EventEdit(id: event.id, cancelled: true)]
    #expect(cache.events(in: data, external: [event]).isEmpty)
    #expect(cache.rebuildCount == 2)
    data.occurrenceEdits = [EventEdit(id: event.id, title: "personal")]
    #expect(cache.events(in: data, external: [event]).first?.title == "personal")
    var other = event; other.id = "external:other"
    #expect(cache.events(in: data, external: [event, other]).count == 2)
    #expect(cache.rebuildCount == 4)
  }
}
