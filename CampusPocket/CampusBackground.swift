import CampusCore
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import ImageIO

/// One retained, decoded derivative is shared by all native tab backgrounds.
@MainActor final class CampusAppearance: ObservableObject {
  static let shared = CampusAppearance()
  @Published private(set) var theme: CampusTheme
  @Published private(set) var backgroundImage: UIImage?
  @Published private(set) var candidate: UIImage?
  @Published private(set) var processing = false
  @Published private(set) var saving = false
  @Published private(set) var error: String?
  @Published private(set) var restorationNotice: String?
  private var candidateBytes: Data?
  private var generation = UUID()
  private let selectionGate = BackgroundSelectionGate()
  private var persistenceRevision = 0
  private var selectionTask: Task<Void, Never>?
  private let defaults: UserDefaults
  private let store: BackgroundImageStore
  private let queue = DispatchQueue(label: "jp.personal.CampusPocket.appearance", qos: .userInitiated)
  var hasBackground: Bool { backgroundImage != nil }
  init(defaults: UserDefaults = .standard, store: BackgroundImageStore? = nil) {
    self.defaults = defaults
    let previous = defaults.string(forKey: "campus-app-theme") ?? defaults.string(forKey: "campus-articles-theme") ?? "green"
    theme = CampusTheme(rawValue: previous) ?? .green
    self.store = store ?? BackgroundImageStore(url: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CampusPocket/Appearance/background.jpg"))
    let selected = defaults.bool(forKey: "campus-background-selected")
    queue.async { [store = self.store] in
      let result = Result { () -> UIImage? in
        guard let bytes = try store.load() else {
          if selected { throw BackgroundImageError.unreadable }; return nil
        }
        return try Self.decoded(bytes)
      }
      DispatchQueue.main.async {
        guard self.persistenceRevision == 0 else { return }
        switch result {
        case .success(let image):
          // A missing optional background already displays as nil; avoid invalidating every tab.
          if image != nil || self.backgroundImage != nil { self.backgroundImage = image }
        case .failure(let error): self.restorationNotice = error.localizedDescription
        }
      }
    }
  }
  func select(_ theme: CampusTheme) {
    self.theme = theme
    defaults.set(theme.rawValue, forKey: "campus-app-theme")
    defaults.set(theme.rawValue, forKey: "campus-articles-theme")
  }
  func cancelSelection() {
    guard !saving else { return }
    generation = UUID(); selectionGate.update(generation); selectionTask?.cancel(); selectionTask = nil
    candidate = nil; candidateBytes = nil; processing = false; error = nil
  }
  func selectionFailed(_ error: Error) {
    guard !saving else { return }; cancelSelection()
    if (error as NSError).code != NSUserCancelledError { self.error = error.localizedDescription }
  }
  func choosePhoto(_ item: PhotosPickerItem) {
    guard !saving else { return }
    cancelSelection(); processing = true
    let token = generation
    selectionTask = Task {
      do {
        guard let transfer = try await item.loadTransferable(type: BackgroundTransfer.self) else { throw BackgroundImageError.invalid }
        guard !Task.isCancelled, token == generation else { return }
        prepare(token: token) { transfer.bytes }
      } catch { if token == generation { processing = false; self.error = error.localizedDescription } }
    }
  }
  func chooseFile(_ url: URL) {
    guard !saving else { return }
    cancelSelection(); processing = true
    prepare(token: generation) { try BackgroundImageStore.readInput(url) }
  }
  private func prepare(token: UUID, read: @escaping @Sendable () throws -> Data) {
    queue.async { [selectionGate] in
      guard selectionGate.matches(token) else { return }
      let result = Result { () -> (Data, UIImage) in
        let input = try read()
        guard selectionGate.matches(token) else { throw CancellationError() }
        let bytes = try BackgroundImageStore.prepare(input)
        guard selectionGate.matches(token) else { throw CancellationError() }
        return (bytes, try Self.decoded(bytes))
      }
      DispatchQueue.main.async {
        guard token == self.generation else { return }
        self.processing = false
        switch result {
        case .success(let value): self.candidateBytes = value.0; self.candidate = value.1
        case .failure(let error): self.error = error.localizedDescription
        }
      }
    }
  }
  /// Apply is an explicit atomic commit. Picker/processing cancellation is available before it.
  func apply() {
    guard !saving, !processing, let bytes = candidateBytes, let image = candidate else { return }
    saving = true; error = nil; persistenceRevision += 1
    queue.async { [store] in
      let result = Result { try store.save(bytes) }
      DispatchQueue.main.async {
        self.saving = false
        switch result {
        case .success:
          self.backgroundImage = image; self.restorationNotice = nil
          self.defaults.set(true, forKey: "campus-background-selected")
          self.cancelSelection()
        case .failure(let error): self.error = "背景を保存できませんでした。\(error.localizedDescription)"
        }
      }
    }
  }
  func reset() {
    guard !saving else { return }
    cancelSelection(); saving = true; persistenceRevision += 1
    queue.async { [store] in
      let result = Result { try store.reset() }
      DispatchQueue.main.async {
        self.saving = false
        switch result {
        case .success:
          self.backgroundImage = nil; self.restorationNotice = nil
          self.defaults.set(false, forKey: "campus-background-selected")
        case .failure(let error): self.error = "無地に戻せませんでした。\(error.localizedDescription)"
        }
      }
    }
  }
  nonisolated private static func decoded(_ bytes: Data) throws -> UIImage {
    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { throw BackgroundImageError.invalid }
    return UIImage(cgImage: image)
  }
}

/// File transfer keeps the provider URL alive until the bounded off-main read finishes.
private struct BackgroundTransfer: Transferable, Sendable {
  let bytes: Data
  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(importedContentType: .image) { received in
      try await BackgroundInputReader.read(received.file)
    }
  }
}
private enum BackgroundInputReader {
  static let queue = DispatchQueue(label: "jp.personal.CampusPocket.background-input", qos: .userInitiated)
  static func read(_ url: URL) async throws -> BackgroundTransfer {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { continuation.resume(with: Result { BackgroundTransfer(bytes: try BackgroundImageStore.readInput(url)) }) }
    }
  }
}
struct CampusBackground: View {
  @EnvironmentObject private var appearance: CampusAppearance
  var body: some View {
    GeometryReader { geometry in
      if let image = appearance.backgroundImage {
        Image(uiImage: image).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
      } else { appearance.theme.paper }
    }.ignoresSafeArea().accessibilityHidden(true).allowsHitTesting(false)
  }
}
extension View {
  func campusBackground() -> some View { background { CampusBackground() } }
  func campusReadable() -> some View { modifier(CampusReadable()) }
}
private struct CampusReadable: ViewModifier {
  @EnvironmentObject private var appearance: CampusAppearance
  func body(content: Content) -> some View {
    content.padding(8).background(appearance.theme.paper, in: RoundedRectangle(cornerRadius: 10))
  }
}
struct AppearanceSettingsView: View {
  @EnvironmentObject private var appearance: CampusAppearance
  @State private var photos = false
  @State private var photo: PhotosPickerItem?
  @State private var files = false
  var body: some View {
    Form {
      Section("配色") {
        ForEach(CampusTheme.allCases) { theme in
          Button { appearance.select(theme) } label: {
            HStack {
              Circle().fill(theme.accent).frame(width: 24, height: 24)
              Text(theme.name); Spacer()
              if appearance.theme == theme { Image(systemName: "checkmark").accessibilityLabel("選択中") }
            }.frame(minHeight: 32)
          }.foregroundStyle(appearance.theme.ink)
        }
      }
      Section {
        if let notice = appearance.restorationNotice { Text(notice).font(.callout).foregroundStyle(.secondary) }
        if let image = appearance.candidate ?? appearance.backgroundImage {
          Image(uiImage: image).resizable().scaledToFill().frame(height: 210).frame(maxWidth: .infinity).clipped().listRowInsets(EdgeInsets())
            .accessibilityLabel(appearance.candidate == nil ? "現在の背景画像" : "未適用の背景プレビュー")
        } else {
          Text("テーマに合わせた無地").frame(maxWidth: .infinity, minHeight: 100).background(appearance.theme.paper)
        }
        Button { appearance.cancelSelection(); photo = nil; photos = true } label: { Label("写真から選ぶ", systemImage: "photo") }
        Button { appearance.cancelSelection(); files = true } label: { Label("ファイルから選ぶ", systemImage: "folder") }
        if appearance.processing {
          ProgressView("画像を処理中…")
          Button("処理を取消", role: .cancel) { appearance.cancelSelection() }
        }
        if appearance.candidate != nil {
          Button("この画像を使う") { appearance.apply() }.fontWeight(.semibold)
          Button("取消", role: .cancel) { appearance.cancelSelection() }
        }
        if appearance.saving { ProgressView("背景を保存中…") }
        if let error = appearance.error { Text(error).foregroundStyle(.red).font(.callout) }
        Button("無地に戻す") { appearance.reset() }
      } header: { Text("背景") } footer: {
        Text("JPEG・PNG・HEICの静止画（40MiB以下・縦横20,000px以下）。表示用に長辺2,560pxまで縮小し、この端末に保存します。元の写真は変更しません。プレビュー後に「この画像を使う」で適用します。")
      }.disabled(appearance.saving)
    }.navigationTitle("テーマ・背景").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
      .photosPicker(isPresented: $photos, selection: $photo, matching: .images, preferredItemEncoding: .current)
      .onChange(of: photo) { _, value in if let value { appearance.choosePhoto(value) } }
      .fileImporter(isPresented: $files, allowedContentTypes: [.jpeg, .png, .heic]) { result in
        switch result {
        case .success(let url): appearance.chooseFile(url)
        case .failure(let error): appearance.selectionFailed(error)
        }
      }
      .onDisappear { appearance.cancelSelection() }
  }
}

/// Cancels queued decoding before it consumes memory, without crossing the main actor.
private final class BackgroundSelectionGate: @unchecked Sendable {
  private let lock = NSLock()
  private var token = UUID()
  func update(_ token: UUID) { lock.lock(); self.token = token; lock.unlock() }
  func matches(_ token: UUID) -> Bool { lock.lock(); defer { lock.unlock() }; return self.token == token }
}
