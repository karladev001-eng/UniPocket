import CampusCore
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

@MainActor final class AppModel: ObservableObject {
  @Published private(set) var data = AppData()
  @Published var error: String?
  @Published var saving = false
  @Published var saveLabel = "保存済み"
  @Published var editingNoteID: UUID?
  private let store: AsyncJSONStore
  let images: ImageStore
  @Published private(set) var loading = true
  @Published private(set) var committing = false
  private var loadFailed = false
  private var saveRevision = 0
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  @Published private var deleted: (Note, Int, Int?)?
  private var undoTask: Task<Void, Never>?
  init(root: URL? = nil) {
    let root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("CampusPocket", isDirectory: true)
    store = AsyncJSONStore(url: root.appendingPathComponent("data.json"))
    images = ImageStore(root: root.appendingPathComponent("Images", isDirectory: true))
    saveLabel = "読み込み中"
    store.load { [weak self] result in
      Task { @MainActor in
        guard let self else { return }
        switch result {
        case .success(let value):
          self.data = value
          self.saveLabel = "保存済み"
        case .failure(let error):
          self.loadFailed = true
          self.saveLabel = "読み込み失敗・編集停止"
          self.error = "保存データを読み込めません。原本を保持し上書きを停止しています。\(error.localizedDescription)"
        }
        self.loading = false
      }
    }
  }
  var readOnly: Bool { loading || loadFailed || committing }
  func update(_ action: (inout AppData) -> Void) {
    guard !readOnly else { return }
    action(&data)
    save()
  }
  func save() {
    guard !readOnly else { return }
    saveRevision += 1
    let revision = saveRevision
    saving = true
    saveLabel = "保存中"
    store.save(data) { [weak self] result in
      Task { @MainActor in
        guard let self, revision == self.saveRevision else { return }
        self.finishSave(result)
      }
    }
  }
  private func finishSave(_ result: Result<Void, Error>) {
    saving = false
    switch result {
    case .success:
      error = nil
      saveLabel = "保存済み"
    case .failure(let error):
      self.error = "保存失敗。編集内容は画面に保持しています。再保存してください。\(error.localizedDescription)"
      saveLabel = "保存失敗"
    }
  }
  /// A transaction publishes only after its atomic save succeeds. While suspended, later
  /// edits are disabled so no snapshot can overwrite an edit accepted during the await.
  private func commit(_ candidate: AppData) async throws {
    try await transaction { store in try store.save(candidate); return candidate }
  }
  private func transaction(_ action: @escaping (JSONStore) throws -> AppData) async throws {
    guard !readOnly else { throw JSONStore.StoreError.unsupported }
    committing = true
    saving = true
    saveLabel = "保存中"
    saveRevision += 1
    let result: Result<AppData, Error> = await withCheckedContinuation { continuation in
      store.perform(action) { continuation.resume(returning: $0) }
    }
    committing = false
    finishSave(result.map { _ in () })
    data = try result.get()
  }
  /// iOS grants a bounded opportunity to complete queued writes when leaving the foreground.
  /// The label remains pending/failed until the actual write result arrives.
  func flushForBackground() {
    guard saving, backgroundTask == .invalid else { return }
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "CampusPocket保存") { [weak self] in
      Task { @MainActor in self?.endBackgroundFlush() }
    }
    waitForBackgroundWrites()
  }
  private func waitForBackgroundWrites() {
    let revision = saveRevision
    store.flush { [weak self] in
      Task { @MainActor in
        guard let self, self.backgroundTask != .invalid else { return }
        if revision != self.saveRevision { self.waitForBackgroundWrites() }
        else { self.endBackgroundFlush() }
      }
    }
  }
  private func endBackgroundFlush() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }
  func install(_ plan: ImportPlan, choices: [String: ConflictChoice] = [:]) async throws {
    guard !readOnly else { throw JSONStore.StoreError.unsupported }
    let snapshot = data
    try await transaction { store in
      var candidate = snapshot
      try candidate.install(plan, choices: choices)
      try store.save(candidate)
      return candidate
    }
  }
  private var newNoteIDs = Set<UUID>()
  func newNote() -> UUID {
    let n = Note()
    newNoteIDs.insert(n.id)
    update { $0.notes.insert(n, at: 0) }
    return n.id
  }
  /// Only untouched notes created in this session are discarded; old empty notes keep their IDs.
  func discardEmptyNewNote(_ id: UUID) {
    guard newNoteIDs.contains(id), let note = data.notes.first(where: { $0.id == id }) else { return }
    guard note.isEmpty, !data.pinnedNoteIDs.contains(id), note.color == .default else {
      newNoteIDs.remove(id)
      return
    }
    update { $0.notes.removeAll { $0.id == id } }
    newNoteIDs.remove(id)
  }
  func attach(_ bytes: Data, to id: UUID) async throws {
    guard !readOnly, let index = data.notes.firstIndex(where: { $0.id == id }) else {
      throw ValidationError.image
    }
    let snapshot = data
    let images = images
    try await transaction { store in
      guard bytes.count <= 40 * 1024 * 1024,
        let source = CGImageSourceCreateWithData(bytes as CFData, nil),
        CGImageSourceGetCount(source) == 1, let type = CGImageSourceGetType(source) as String?,
        let ut = UTType(type),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let w = properties[kCGImagePropertyPixelWidth] as? Int,
        let h = properties[kCGImagePropertyPixelHeight] as? Int
      else { throw ValidationError.image }
      let format = ut.conforms(to: .jpeg) ? "jpeg"
        : ut.conforms(to: .png) ? "png" : ut.conforms(to: .heic) ? "heic" : "unsupported"
      let attachment = try images.save(bytes, width: w, height: h, format: format)
      var candidate = snapshot
      candidate.notes[index].images.append(attachment)
      candidate.notes[index].modified = Date()
      do { try store.save(candidate); return candidate }
      catch { try? images.remove(attachment); throw error }
    }
  }
  func removeImage(_ a: ImageAttachment, from id: UUID) async throws {
    guard !readOnly else { throw JSONStore.StoreError.unsupported }
    var candidate = data
    guard let index = candidate.notes.firstIndex(where: { $0.id == id }) else { return }
    candidate.notes[index].images.removeAll { $0.id == a.id }
    try await commit(candidate)  // Retain unreferenced image for undo/session safety.
  }
  func restoreImage(_ a: ImageAttachment, at position: Int, to id: UUID) async throws {
    guard !readOnly, FileManager.default.fileExists(atPath: images.url(a).path),
      let index = data.notes.firstIndex(where: { $0.id == id })
    else { throw ValidationError.image }
    var candidate = data
    guard !candidate.notes[index].images.contains(where: { $0.id == a.id }) else { return }
    candidate.notes[index].images.insert(a, at: min(position, candidate.notes[index].images.count))
    try await commit(candidate)
  }
  func pin(_ id: UUID) {
    update { if !$0.pinnedNoteIDs.contains(id) { $0.pinnedNoteIDs.append(id) } }
  }
  func deleteNote(_ id: UUID) async {
    guard !readOnly, let i = data.notes.firstIndex(where: { $0.id == id }) else { return }
    finishDeletion()
    let n = data.notes[i]
    let p = data.pinnedNoteIDs.firstIndex(of: id)
    var candidate = data
    candidate.notes.remove(at: i)
    candidate.pinnedNoteIDs.removeAll { $0 == id }
    do {
      try await commit(candidate)
      deleted = (n, i, p)
      undoTask = Task {
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled else { return }
        finishDeletion()
      }
    } catch { self.error = "メモを削除できません。\(error.localizedDescription)" }
  }
  var canUndoDeletion: Bool { deleted != nil }
  func undoDeletion() async {
    guard !readOnly, let (n, i, p) = deleted else { return }
    var candidate = data
    candidate.notes.insert(n, at: min(i, candidate.notes.count))
    if let p { candidate.pinnedNoteIDs.insert(n.id, at: min(p, candidate.pinnedNoteIDs.count)) }
    do {
      try await commit(candidate)
      deleted = nil
      undoTask?.cancel()
    } catch { self.error = "削除を戻せません。\(error.localizedDescription)" }
  }
  private func finishDeletion() {
    undoTask?.cancel()
    deleted = nil  // Files retained: deletion undo and interrupted sessions cannot destroy original images.
  }
  func edit(_ edit: EventEdit, course: Bool) {
    update {
      if course {
        $0.courseEdits.removeAll { $0.id == edit.id }
        $0.courseEdits.append(edit)
      } else {
        $0.occurrenceEdits.removeAll { $0.id == edit.id }
        $0.occurrenceEdits.append(edit)
      }
    }
  }
}
