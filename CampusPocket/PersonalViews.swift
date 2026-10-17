import CampusCore
import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct FacilitiesView: View {
  @EnvironmentObject var model: AppModel
  var body: some View {
    List {
      Section("保存した通常時間・個人例外") {
        Text("通常期の目安です。祝日・休講期間は公式案内を確認してください。").font(.caption)
        ForEach(model.data.facilities) { f in
          NavigationLink {
            FacilityEditor(id: f.id)
          } label: {
            VStack(alignment: .leading) {
              Text(f.title)
              Text(f.label(on: Date())).font(.caption)
              Text("確認日 \(f.updated)").font(.caption2).foregroundStyle(.secondary)
            }
          }
        }
      }
    }.campusListStyle().navigationTitle("施設")
  }
}
struct FacilityEditor: View {
  @EnvironmentObject var model: AppModel
  var id: UUID
  @State var weekday = 1
  @State var hours = ""
  @State var date = Date()
  @State var exception = ""
  @State var updated = ""
  @State var failure: String?
  init(id: UUID, date: Date = Date()) {
    self.id = id
    _date = State(initialValue: Tokyo.calendar.startOfDay(for: date))
    _weekday = State(initialValue: Tokyo.weekday(date))
  }
  var facility: Facility? { model.data.facilities.first { $0.id == id } }
  var body: some View {
    Form {
      if let f = facility {
        Section("選択日の計算結果") {
          Text(Tokyo.dayKey(date)).font(.headline)
          Text(f.label(on: date))
          Text("確認日 \(f.updated)")
          Link("公式案内", destination: URL(string: f.source)!)
        }
        Section("通常曜日") {
          Picker("曜日", selection: $weekday) {
            ForEach(1...7, id: \.self) { Text(String(Array("月火水木金土日")[$0 - 1])).tag($0) }
          }
          TextField("11:00–14:30 / 17:00–19:00（L.O.18:45）", text: $hours)
          Text("空欄は休業。昼夜は / で分けます。").font(.caption)
          TextField("確認日（未確認なら空欄）", text: $updated)
          Button("この曜日の通常時間を保存") {
            do {
              let a = try OpeningInterval.parse(hours)
              model.update { d in
                if let i = d.facilities.firstIndex(where: { $0.id == id }) {
                  d.facilities[i].weekdays[weekday] = a
                  d.facilities[i].updated = updated.isEmpty ? "未確認" : updated
                }
              }
              self.failure = nil
            } catch { self.failure = error.localizedDescription }
          }
        }
        Section("日付例外・個人設定") {
          DatePicker("例外の日", selection: $date, displayedComponents: .date)
          TextField("臨時の時間（空欄で休業）", text: $exception)
          Button("この日を個人設定として保存") {
            do {
              let a = try OpeningInterval.parse(exception)
              model.update { d in
                if let i = d.facilities.firstIndex(where: { $0.id == id }) {
                  d.facilities[i].exceptions.removeAll { $0.day == Tokyo.dayKey(date) }
                  d.facilities[i].exceptions.append(
                    FacilityException(day: Tokyo.dayKey(date), intervals: a))
                }
              }
              self.failure = nil
            } catch { self.failure = error.localizedDescription }
          }
          Button("この日の例外を解除") {
            model.update { d in
              if let i = d.facilities.firstIndex(where: { $0.id == id }) {
                d.facilities[i].exceptions.removeAll { $0.day == Tokyo.dayKey(date) }
              }
            }
            reloadException()
          }
          ForEach(f.exceptions, id: \.day) { e in
            Text(
              "\(e.day)：\(e.intervals.isEmpty ? "休業" : e.intervals.map(\.label).joined(separator:" / "))"
            ).font(.caption)
          }
        }
        if let failure { Text(failure).foregroundStyle(.red) }
      }
    }.campusListStyle().navigationTitle(facility?.title ?? "施設").onAppear {
      updated = facility?.updated ?? ""
      reloadHours()
      reloadException()
    }.onChange(of: weekday) { _, _ in reloadHours() }.onChange(of: date) { _, _ in reloadException()
    }
  }
  func reloadHours() {
    hours = facility?.weekdays[weekday]?.map(\.label).joined(separator: " / ") ?? ""
  }
  func reloadException() {
    exception =
      facility?.exceptions.first { $0.day == Tokyo.dayKey(date) }?.intervals.map(\.label).joined(
        separator: " / ") ?? ""
  }
}
extension NoteColor {
  var label: String {
    switch self { case .default: "無色"; case .yellow: "イエロー"; case .green: "グリーン"; case .pink: "ピンク"; case .blue: "ブルー" }
  }
  var background: Color {
    switch self { case .default: .white; case .yellow: Color(hex: 0xf8efcc); case .green: Color(hex: 0xe7efd9); case .pink: Color(hex: 0xf5e2e6); case .blue: Color(hex: 0xe1ecf8) }
  }
}
struct NotesView: View {
  @EnvironmentObject var model: AppModel
  @EnvironmentObject private var appearance: CampusAppearance
  @Environment(\.dynamicTypeSize) private var typeSize
  @State var search = ""
  @State var note: UUID?
  @State var deletion: UUID?
  private var filtered: [Note] { model.data.notes.filter { $0.matches(search) }.sorted { $0.modified > $1.modified } }
  private var pinned: [Note] { model.data.pinnedNoteIDs.compactMap { id in filtered.first { $0.id == id } } }
  private var others: [Note] { filtered.filter { !model.data.pinnedNoteIDs.contains($0.id) } }
  private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: typeSize.isAccessibilitySize ? 1 : 2) }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        CampusPageHeader(title: "メモ", subtitle: "自分だけの、小さなノート")
        HStack(spacing: 10) {
          Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
          TextField("メモを検索", text: $search).accessibilityLabel("本文とチェック項目を検索")
          if !search.isEmpty { Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("検索を消去") }
        }.padding(14).background(appearance.theme.soft, in: RoundedRectangle(cornerRadius: 14))
        if model.canUndoDeletion { Button("メモ削除を取消（30秒以内）") { Task { await model.undoDeletion() } }.frame(minHeight: 44).campusReadable() }
        if filtered.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: search.isEmpty ? "note.text" : "magnifyingglass").font(.largeTitle)
            Text(search.isEmpty ? "思いついたことを、ここに。" : "一致するメモはありません").font(.headline)
            Text(search.isEmpty ? "本文・チェックリスト・画像を端末に保存できます。" : "本文やチェック項目の言葉で探せます。")
              .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
          }.frame(maxWidth: .infinity).padding(.vertical, 60).campusReadable()
        } else {
          if !pinned.isEmpty { CampusSectionTitle(title: "固定したメモ"); cards(pinned) }
          if !others.isEmpty { CampusSectionTitle(title: pinned.isEmpty ? "すべてのメモ" : "その他のメモ"); cards(others) }
        }
        Label("この端末だけに保存 · \(model.saveLabel)", systemImage: "lock.shield").font(.caption2).foregroundStyle(.secondary).campusReadable()
      }.padding(18).padding(.bottom, 75)
    }.campusBackground().navigationTitle("メモ").toolbar(.hidden, for: .navigationBar)
      .overlay(alignment: .bottomTrailing) {
        Button { note = model.newNote() } label: {
          Image(systemName: "plus").font(.title2.weight(.medium)).frame(width: 60, height: 60)
            .foregroundStyle(.white).background(appearance.theme.accent, in: RoundedRectangle(cornerRadius: 20))
            .shadow(color: appearance.theme.accent.opacity(0.18), radius: 12, y: 5)
        }.accessibilityLabel("メモを追加").disabled(model.readOnly).padding(22)
      }
      .sheet(item: $note) { id in NavigationStack { NoteEditor(id: id) } }
      .confirmationDialog("メモと添付画像の参照を削除します。30秒以内は戻せます。", isPresented: Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
        Button("メモを削除", role: .destructive) { if let id = deletion { Task { await model.deleteNote(id) } }; deletion = nil }
        Button("取消", role: .cancel) { deletion = nil }
      }
  }
  private func cards(_ notes: [Note]) -> some View {
    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
      ForEach(notes) { n in
        Button { note = n.id } label: {
          VStack(alignment: .leading, spacing: 10) {
            if let attachment = n.images.first { AttachmentThumbnail(attachment: attachment).frame(maxWidth: .infinity).frame(height: 100).clipped() }
            HStack(alignment: .top, spacing: 4) {
              Text(n.title).font(.headline).lineLimit(3)
              Spacer(minLength: 0)
              if model.data.pinnedNoteIDs.contains(n.id) { Image(systemName: "pin.fill").font(.caption) }
            }
            let preview = n.text.split(separator: "\n").dropFirst().joined(separator: "\n")
            if !preview.isEmpty { Text(preview).font(.subheadline).lineLimit(5) }
            ForEach(n.checklist.prefix(4)) { item in
              HStack(alignment: .top, spacing: 5) {
                Image(systemName: item.isCompleted ? "checkmark.square" : "square")
                Text(item.text.isEmpty ? "項目" : item.text).strikethrough(item.isCompleted).lineLimit(2)
              }.font(.caption).foregroundStyle(item.isCompleted ? .secondary : .primary)
            }
            if n.checklist.count > 4 { Text("ほか\(n.checklist.count - 4)項目").font(.caption2).foregroundStyle(.secondary) }
            Text(n.modified, format: .dateTime.month().day()).font(.caption2).foregroundStyle(.secondary)
          }.frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading).padding(15)
            .background(n.color.background, in: RoundedRectangle(cornerRadius: 19))
            .overlay(RoundedRectangle(cornerRadius: 19).stroke(appearance.theme.accent.opacity(0.09)))
        }.buttonStyle(.plain).contextMenu {
          Button { togglePin(n.id) } label: { Label(model.data.pinnedNoteIDs.contains(n.id) ? "固定解除" : "固定", systemImage: "pin") }.disabled(model.readOnly)
          Button("削除", role: .destructive) { deletion = n.id }.disabled(model.readOnly)
        }
      }
    }
  }
  private func togglePin(_ id: UUID) {
    if model.data.pinnedNoteIDs.contains(id) { model.update { $0.pinnedNoteIDs.removeAll { $0 == id } } } else { model.pin(id) }
  }
}
struct NoteEditor: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  var id: UUID
  @FocusState var textFocused: Bool
  @FocusState private var checklistFocus: UUID?
  @State var imageTask: Task<Void, Never>?
  @State var generation = UUID()
  @State var photo: PhotosPickerItem?
  @State var file = false
  @State var selectedImage: ImageAttachment?
  @State var removing: ImageAttachment?
  @State var undoImage: ImageAttachment?
  @State var undoIndex = 0
  @State var undoUntil = Date.distantPast
  @State var busy = false
  @State var failure: String?
  @State private var imageTools = false
  @State private var deletingNote = false
  @State var retryData: Data?
  @State var retryPhoto: PhotosPickerItem?
  var note: Note? { model.data.notes.first { $0.id == id } }
  var body: some View {
    Form {
      if let n = note {
        Section {
          TextEditor(
            text: Binding(
              get: { note?.text ?? "" },
              set: { v in
                model.update { d in
                  if let i = d.notes.firstIndex(where: { $0.id == id }) {
                    d.notes[i].text = v
                    d.notes[i].modified = Date()
                  }
                }
              })
          ).frame(minHeight: 180).focused($textFocused).accessibilityLabel("メモ本文")
          HStack {
            Text(model.saveLabel).font(.caption).foregroundStyle(model.saveLabel == "保存失敗" ? .red : .secondary)
            Spacer()
            if model.saveLabel == "保存失敗" { Button("再保存") { model.save() }.font(.caption) }
          }
        }.listRowBackground(n.color.background)
        if !n.checklist.isEmpty {
          Section("チェックリスト") {
            ForEach(n.checklist) { item in
              HStack(spacing: 10) {
                Button { editNote { note in if let i = note.checklist.firstIndex(where: { $0.id == item.id }) { note.checklist[i].isCompleted.toggle() } } } label: {
                  Image(systemName: item.isCompleted ? "checkmark.square.fill" : "square").font(.title3).frame(width: 36, height: 44)
                }.buttonStyle(.borderless).accessibilityLabel(item.isCompleted ? "未完了に戻す" : "完了にする")
                TextField("項目", text: Binding(get: { note?.checklist.first { $0.id == item.id }?.text ?? "" }, set: { value in
                  editNote { note in if let i = note.checklist.firstIndex(where: { $0.id == item.id }) { note.checklist[i].text = value } }
                }), axis: .vertical).focused($checklistFocus, equals: item.id).strikethrough(item.isCompleted)
                  .foregroundStyle(item.isCompleted ? .secondary : .primary).accessibilityLabel("チェック項目")
                Button { editNote { $0.checklist.removeAll { $0.id == item.id } } } label: { Image(systemName: "minus.circle").frame(width: 36, height: 44) }
                  .buttonStyle(.borderless).accessibilityLabel("項目を削除")
              }
            }
            Button { addChecklistItem() } label: { Label("項目を追加", systemImage: "plus") }.frame(minHeight: 44)
          }.listRowBackground(n.color.background)
        }
        Section {
          HStack(spacing: 8) {
            ForEach(NoteColor.allCases) { color in
              Button { editNote { $0.color = color } } label: {
                Circle().fill(color.background).frame(width: 34, height: 34)
                  .overlay(Circle().strokeBorder(n.color == color ? Color.primary : Color.secondary.opacity(0.3), lineWidth: n.color == color ? 2 : 1))
                  .overlay { if n.color == color { Image(systemName: "checkmark").font(.caption) } }
                  .frame(maxWidth: .infinity, minHeight: 44)
              }.buttonStyle(.borderless).accessibilityLabel("背景色：\(color.label)").accessibilityAddTraits(n.color == color ? [.isSelected] : [])
            }
          }
        } header: { Text("色") }
        Section {
          DisclosureGroup("画像を追加・表示（\(n.images.count)枚）", isExpanded: $imageTools) {
          if let a = undoImage {
            Button("画像の削除を取消（30秒以内）") {
              guard Date() < undoUntil else {
                undoImage = nil
                return
              }
              Task {
                do {
                  try await model.restoreImage(a, at: undoIndex, to: id)
                  undoImage = nil
                } catch { self.failure = "画像を戻せません。\(error.localizedDescription)" }
              }
            }
          }
          Text("JPEG・PNG・HEIC静止画、1枚40MB・各辺20,000pxまで。画像を縮小せず保存します。クラウドの写真は取得に通信が必要です。").font(
            .caption)
          PhotosPicker(selection: $photo, matching: .images) {
            Label("写真を選択", systemImage: "photo")
          }.disabled(busy)
          Button("画像ファイルを選択") { file = true }.disabled(busy)
          if busy {
            ProgressView("画像を取得・保存中")
            Button("画像追加を取消") {
              imageTask?.cancel()
              generation = UUID()
              busy = false
              photo = nil
              retryPhoto = nil
              retryData = nil
            }
          }
          if let failure {
            Text(failure).foregroundStyle(.red)
            Button("再試行") {
              if let bytes = retryData {
                attach(bytes)
              } else if let item = retryPhoto {
                load(item)
              }
            }
            Button("追加を取消") {
              self.failure = nil
              retryData = nil
              retryPhoto = nil
            }
          }
          ForEach(Array(n.images.enumerated()), id: \.element.id) { i, a in
            VStack {
              Button {
                selectedImage = a
              } label: {
                AttachmentThumbnail(attachment: a).frame(height: 180)
              }
              HStack {
                Text("\(a.width)×\(a.height) \(a.format)").font(.caption)
                Spacer()
                Button("↑") { move(a, -1) }.disabled(i == 0)
                Button("↓") { move(a, 1) }.disabled(i == n.images.count - 1)
                Button("削除", role: .destructive) { removing = a }
              }
            }
          }
        }
          }
        Section {
          Text("先頭行がタイトルになります。内容は自動保存され、この端末でだけ使えます。").font(.caption).foregroundStyle(.secondary)
        }
      } else {
        Text("このメモは削除されました")
      }
    }.campusListStyle().navigationTitle("メモ").onAppear {
      if note?.isEmpty == true { textFocused = true }
    }.onDisappear {
      imageTask?.cancel()
      generation = UUID()
      model.discardEmptyNewNote(id)
    }.toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Button { togglePin() } label: { Image(systemName: model.data.pinnedNoteIDs.contains(id) ? "pin.fill" : "pin") }
          .accessibilityLabel(model.data.pinnedNoteIDs.contains(id) ? "固定解除" : "ホームとメモに固定")
      }
      ToolbarItemGroup(placement: .topBarTrailing) {
        Menu { Button("メモを削除", role: .destructive) { deletingNote = true } } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("メモの操作")
        Button("完了") { dismiss() }
      }
      ToolbarItemGroup(placement: .bottomBar) {
        Button { imageTools = true; textFocused = false; checklistFocus = nil } label: { Image(systemName: "photo.badge.plus") }.accessibilityLabel("画像を追加・表示")
        Spacer()
        Button { addChecklistItem() } label: { Image(systemName: "checklist") }.accessibilityLabel("チェック項目を追加")
        Spacer()
        Text("自動保存").font(.caption).foregroundStyle(.secondary)
      }
    }.confirmationDialog("メモと添付画像の参照を削除します。30秒以内は戻せます。", isPresented: $deletingNote, titleVisibility: .visible) {
      Button("メモを削除", role: .destructive) { Task { await model.deleteNote(id); if note == nil { dismiss() } } }
      Button("取消", role: .cancel) {}
    }.sheet(item: $selectedImage) { a in
      ImageViewer(attachment: a)
    }.fileImporter(isPresented: $file, allowedContentTypes: [.jpeg, .png, .heic]) { result in
      switch result {
      case .success(let url):
        loadFile(url)
      case .failure(let error): self.failure = "画像選択に失敗：\(error.localizedDescription)"
      }
    }.onChange(of: photo) { _, item in if let item { load(item) } }.confirmationDialog(
      "この画像の添付を削除します",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("画像を削除", role: .destructive) {
        if let a = removing {
          let index = note?.images.firstIndex(where: { $0.id == a.id }) ?? 0
          Task {
            do {
              try await model.removeImage(a, from: id)
              undoImage = a
              undoIndex = index
              undoUntil = Date().addingTimeInterval(30)
            } catch { self.failure = "削除保存に失敗：\(error.localizedDescription)" }
          }
        }
        removing = nil
      }
      Button("取消", role: .cancel) { removing = nil }
    }.disabled(model.readOnly)
  }
  private func editNote(_ action: (inout Note) -> Void) {
    model.update { data in
      guard let index = data.notes.firstIndex(where: { $0.id == id }) else { return }
      action(&data.notes[index])
      data.notes[index].modified = Date()
    }
  }
  private func addChecklistItem() {
    let item = NoteChecklistItem()
    editNote { $0.checklist.append(item) }
    textFocused = false
    checklistFocus = item.id
  }
  private func togglePin() {
    if model.data.pinnedNoteIDs.contains(id) { model.update { $0.pinnedNoteIDs.removeAll { $0 == id } } } else { model.pin(id) }
  }
  func move(_ a: ImageAttachment, _ delta: Int) {
    model.update { d in
      guard let n = d.notes.firstIndex(where: { $0.id == id }),
        let i = d.notes[n].images.firstIndex(where: { $0.id == a.id }),
        d.notes[n].images.indices.contains(i + delta)
      else { return }
      d.notes[n].images.swapAt(i, i + delta)
      d.notes[n].modified = Date()
    }
  }
  func attach(_ bytes: Data) {
    imageTask?.cancel()
    generation = UUID()
    let token = generation
    busy = true
    retryData = bytes
    imageTask = Task {
      do {
        try Task.checkCancellation()
        try await model.attach(bytes, to: id)
        guard token == generation else { return }
        self.failure = nil
        retryData = nil
        retryPhoto = nil
      } catch {
        guard token == generation else { return }
        self.failure = "画像保存に失敗。本文と既存画像は保持しています。\(error.localizedDescription)"
      }
      busy = false
      photo = nil
    }
  }
  private func loadFile(_ url: URL) {
    imageTask?.cancel()
    generation = UUID()
    let token = generation
    busy = true
    failure = nil
    imageTask = Task {
      do {
        let bytes = try await Task.detached(priority: .userInitiated) {
          let access = url.startAccessingSecurityScopedResource()
          defer { if access { url.stopAccessingSecurityScopedResource() } }
          let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
          guard size <= 40 * 1024 * 1024 else { throw ValidationError.image }
          return try Data(contentsOf: url)
        }.value
        guard !Task.isCancelled, token == generation else { return }
        attach(bytes)
      } catch {
        guard !Task.isCancelled, token == generation else { return }
        failure = "画像を取得できません。本文と既存画像は保持しています。\(error.localizedDescription)"
        busy = false
      }
    }
  }
  func load(_ item: PhotosPickerItem) {
    imageTask?.cancel()
    generation = UUID()
    let token = generation
    busy = true
    self.failure = nil
    retryPhoto = item
    imageTask = Task {
      do {
        guard let bytes = try await item.loadTransferable(type: Data.self) else {
          throw ValidationError.image
        }
        guard !Task.isCancelled, token == generation else { return }
        attach(bytes)
      } catch {
        guard !Task.isCancelled, token == generation else { return }
        self.failure = "写真を取得できません。クラウド写真は通信を確認して再試行してください。\(error.localizedDescription)"
        busy = false
        photo = nil
      }
    }
  }
}
/// ImageIO decodes one bounded derivative at a time. The 24 MiB / 64-entry LRU contains
/// decoded pixels only; the original attachment files are never rewritten.
final class AttachmentThumbnailCache: @unchecked Sendable {
  static let shared = AttachmentThumbnailCache()
  static let byteLimit = 24 * 1024 * 1024
  private let queue = DispatchQueue(label: "jp.personal.CampusPocket.thumbnails", qos: .userInitiated)
  private struct Entry { let key: String; let image: UIImage; let cost: Int }
  private var entries: [Entry] = []
  private var cost = 0
  private var observer: NSObjectProtocol?
  private init() {
    observer = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil, queue: nil) { [weak self] _ in self?.removeAll() }
  }
  deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
  func removeAll() { queue.async { self.entries.removeAll(); self.cost = 0 } }
  func image(at url: URL, maxPixel: Int = 1024) async -> UIImage? {
    await withCheckedContinuation { continuation in
      queue.async {
        let size = max(1, min(maxPixel, 1024))
        let key = "\(url.path):\(size)"
        if let i = self.entries.firstIndex(where: { $0.key == key }) {
          let hit = self.entries.remove(at: i)
          self.entries.append(hit)
          continuation.resume(returning: hit.image)
          return
        }
        let image: UIImage? = autoreleasepool {
          guard let source = CGImageSourceCreateWithURL(url as CFURL,
            [kCGImageSourceShouldCache: false] as CFDictionary),
            let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: size,
              kCGImageSourceShouldCacheImmediately: true,
            ] as CFDictionary) else { return nil }
          let image = UIImage(cgImage: cg)
          let bytes = cg.bytesPerRow * cg.height
          while self.cost + bytes > Self.byteLimit || self.entries.count >= 64 {
            guard !self.entries.isEmpty else { break }
            self.cost -= self.entries.removeFirst().cost
          }
          if bytes <= Self.byteLimit {
            self.entries.append(Entry(key: key, image: image, cost: bytes))
            self.cost += bytes
          }
          return image
        }
        continuation.resume(returning: image)
      }
    }
  }
}
struct AttachmentThumbnail: View {
  @EnvironmentObject var model: AppModel
  var attachment: ImageAttachment
  @State private var image: UIImage?
  @State private var finished = false
  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("保存画像")
      } else if finished {
        Label("画像ファイルが見つかりません。本文は保持しています。", systemImage: "exclamationmark.triangle")
          .font(.caption).foregroundStyle(.orange)
      } else { ProgressView("画像を読み込み中").font(.caption) }
    }.task(id: attachment.id) {
      image = nil; finished = false
      let loaded = await AttachmentThumbnailCache.shared.image(at: model.images.url(attachment))
      guard !Task.isCancelled else { return }
      image = loaded; finished = true
    }.onDisappear { image = nil; finished = false }
  }
}
struct ImageViewer: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  var attachment: ImageAttachment
  var body: some View {
    NavigationStack {
      ZoomImage(url: model.images.url(attachment)).navigationTitle("保存画像")
        .navigationBarTitleDisplayMode(.inline).toolbar { Button("閉じる") { dismiss() } }
    }
  }
}
struct ZoomImage: UIViewRepresentable {
  var url: URL
  class Coordinator: NSObject, UIScrollViewDelegate {
    let image = UIImageView()
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { image }
  }
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> UIScrollView {
    let s = UIScrollView()
    s.delegate = context.coordinator
    s.minimumZoomScale = 1
    s.maximumZoomScale = 8
    s.backgroundColor = .systemBackground
    context.coordinator.image.contentMode = .scaleAspectFit
    s.addSubview(context.coordinator.image)
    return s
  }
  func updateUIView(_ s: UIScrollView, context: Context) {
    let image = context.coordinator.image
    if image.image == nil { image.image = UIImage(contentsOfFile: url.path) }
    DispatchQueue.main.async {
      if s.zoomScale == 1 {
        image.frame = s.bounds
        s.contentSize = s.bounds.size
      }
    }
  }
}
struct LinksView: View {
  @EnvironmentObject var model: AppModel
  @State var edit: CampusLink?
  @State var adding = false
  var body: some View {
    List {
      Section("お気に入り") { ForEach(model.data.links.filter(\.favorite)) { l in linkRow(l) } }
      Section("すべてのリンク・Webには通信が必要") {
        ForEach(model.data.links) { l in linkRow(l) }.onMove { a, b in
          model.update { $0.links.move(fromOffsets: a, toOffset: b) }
        }.onDelete { indices in model.update { $0.links.remove(atOffsets: indices) } }
      }
    }.campusListStyle().navigationTitle("リンク").toolbar {
      EditButton()
      Button {
        adding = true
      } label: {
        Image(systemName: "plus")
      }
    }.sheet(item: $edit) { l in LinkEditor(link: l) }.sheet(isPresented: $adding) {
      LinkEditor(link: CampusLink("", "https://"), adding: true)
    }
  }
  func linkRow(_ l: CampusLink) -> some View {
    HStack {
      if let url = URL(string: l.url) { Link(l.title, destination: url) }
      Spacer()
      Button {
        model.update { d in
          if let i = d.links.firstIndex(where: { $0.id == l.id }) { d.links[i].favorite.toggle() }
        }
      } label: {
        Image(systemName: l.favorite ? "star.fill" : "star")
      }.buttonStyle(.borderless).accessibilityLabel("お気に入りを切替")
      Button {
        edit = l
      } label: {
        Image(systemName: "pencil")
      }.buttonStyle(.borderless).accessibilityLabel("リンクを編集")
    }
  }
}
struct LinkEditor: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  var link: CampusLink
  var adding = false
  @State var title = ""
  @State var url = ""
  @State var favorite = false
  @State var failure: String?
  var body: some View {
    NavigationStack {
      Form {
        TextField("名前", text: $title)
        TextField("URL", text: $url).textInputAutocapitalization(.never).keyboardType(.URL)
        Toggle("お気に入り", isOn: $favorite)
        if let failure { Text(failure).foregroundStyle(.red) }
        Button("保存") {
          guard !title.isEmpty, let u = URL(string: url),
            ["https", "http"].contains(u.scheme?.lowercased() ?? ""), u.host != nil, u.user == nil,
            u.password == nil
          else {
            self.failure = "認証情報を含まないhttp(s) URLと名前を入力してください"
            return
          }
          var l = link
          l.title = title
          l.url = url
          l.favorite = favorite
          model.update { d in
            if adding {
              d.links.append(l)
            } else if let i = d.links.firstIndex(where: { $0.id == l.id }) {
              d.links[i] = l
            }
          }
          dismiss()
        }
      }.campusListStyle().navigationTitle("リンク編集").toolbar { Button("取消") { dismiss() } }.onAppear {
        title = link.title
        url = link.url
        favorite = link.favorite
      }
    }
  }
}
