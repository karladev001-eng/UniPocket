import CampusCore
import SwiftUI

@main struct CampusPocketApp: App {
  @StateObject private var model = AppModel()
  @StateObject private var calendar = CalendarModel()
  @StateObject private var appearance = CampusAppearance.shared
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(model).environmentObject(calendar).environmentObject(appearance).environment(
        \.locale, Locale(identifier: "ja_JP")
      ).environment(\.timeZone, Tokyo.calendar.timeZone).tint(appearance.theme.accent)
        .foregroundStyle(appearance.theme.ink).preferredColorScheme(.light)
    }
  }
}
enum CommunitySection: String, CaseIterable { case posts = "投稿", articles = "記事" }

/// Ephemeral navigation only; timetable and saved user content stay in AppModel.
@MainActor final class CampusNavigation: ObservableObject {
  @Published var tab = 0
  @Published var homePath = NavigationPath()
  @Published private(set) var mapRequest: CampusMapRequest?
  let map = CampusMapState()
  @Published var articleRequest: CampusArticleRequest?
  @Published var communitySection: CommunitySection = .posts
  @Published private(set) var communityReturnTab: Int?
  private var communityReturnAction: (() -> Void)?
  var articleReturnTab: Int? { communityReturnTab }
  var boardReturnTab: Int? { communityReturnTab }
  private var pendingArticles: (courseID: String, title: String, onReturn: () -> Void)?
  func deferArticles(courseID: String, title: String, onReturn: @escaping () -> Void) {
    pendingArticles = (courseID, title, onReturn)
  }
  func showArticles(courseID: String, title: String, onReturn: (() -> Void)? = nil) {
    communityReturnAction = onReturn
    communityReturnTab = tab
    communitySection = .articles
    articleRequest = CampusArticleRequest(courseID: courseID, title: title)
    boardRequest = CampusArticleRequest(courseID: courseID, title: title)
    tab = 4
  }
  func returnFromArticles() { returnFromCommunity() }
  @Published var boardRequest: CampusArticleRequest?
  private var pendingBoard: (courseID: String, title: String, onReturn: () -> Void)?
  func deferBoard(courseID: String, title: String, onReturn: @escaping () -> Void) {
    pendingBoard = (courseID, title, onReturn)
  }
  func showBoard(courseID: String, title: String, onReturn: (() -> Void)? = nil) {
    communityReturnAction = onReturn
    communityReturnTab = tab
    communitySection = .posts
    boardRequest = CampusArticleRequest(courseID: courseID, title: title)
    articleRequest = CampusArticleRequest(courseID: courseID, title: title)
    tab = 4
  }
  func selectTab(_ value: Int) { tab = value }
  func returnFromBoard() { returnFromCommunity() }
  private func returnFromCommunity() {
    tab = communityReturnTab ?? 0
    communityReturnTab = nil
    let action = communityReturnAction
    communityReturnAction = nil
    action?()
  }
  private var pendingMapRequest: CampusMapRequest?

  func showMap(location: String) { reveal(CampusMapRequest(location: location)) }
  func deferMap(location: String) { pendingMapRequest = CampusMapRequest(location: location) }
  /// Called by the presenting sheet's onDismiss, after its viewing stack is gone.
  func finishMapHandoff() {
    if let request = pendingBoard {
      pendingBoard = nil
      showBoard(courseID: request.courseID, title: request.title, onReturn: request.onReturn)
      return
    }
    if let request = pendingArticles {
      pendingArticles = nil
      showArticles(courseID: request.courseID, title: request.title, onReturn: request.onReturn)
      return
    }
    guard let request = pendingMapRequest else { return }
    pendingMapRequest = nil
    reveal(request)
  }
  private func reveal(_ request: CampusMapRequest) {
    map.show(location: request.location)
    homePath = NavigationPath()
    tab = 0
    mapRequest = request
  }
}

/// Value navigation allows Home's viewing detail to be popped for a map request.
private struct CampusArticleActionKey: EnvironmentKey {
  static let defaultValue: (String, String) -> Void = { _, _ in }
}
extension EnvironmentValues {
  var showCampusArticles: (String, String) -> Void {
    get { self[CampusArticleActionKey.self] }
    set { self[CampusArticleActionKey.self] = newValue }
  }
}
private struct CampusBoardActionKey: EnvironmentKey {
  static let defaultValue: (String, String) -> Void = { _, _ in }
}
extension EnvironmentValues {
  var showCampusBoard: (String, String) -> Void {
    get { self[CampusBoardActionKey.self] }
    set { self[CampusBoardActionKey.self] = newValue }
  }
}
struct CampusArticleRequest: Equatable {
  let id = UUID()
  let courseID: String
  let title: String
}
struct CampusEventRoute: Hashable {
  let event: CampusEvent
  static func == (lhs: Self, rhs: Self) -> Bool { lhs.event.id == rhs.event.id }
  func hash(into hasher: inout Hasher) { hasher.combine(event.id) }
}
extension View {
  func campusEventDestinations() -> some View {
    navigationDestination(for: CampusEventRoute.self) { EventDetail(event: $0.event) }
  }
}

struct RootView: View {
  @EnvironmentObject var model: AppModel
  @EnvironmentObject var calendar: CalendarModel
  @EnvironmentObject private var appearance: CampusAppearance
  @Environment(\.scenePhase) var phase
  @StateObject private var navigation = CampusNavigation()
  var body: some View {
    VStack(spacing: 0) {
      if let error = model.error {
        HStack {
          Text(error).font(.caption).lineLimit(3)
          Button("再保存") { model.save() }.disabled(model.readOnly)
        }.padding(8).background(.red.opacity(0.12))
      }
      if model.loading {
        ProgressView("保存データを読み込み中…").frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
      TabView(selection: Binding(get: { navigation.tab }, set: navigation.selectTab)) {
        NavigationStack(path: $navigation.homePath) {
          HomeView(tab: $navigation.tab).campusEventDestinations()
        }.tabItem { Label("ホーム", systemImage: "house") }.tag(
          0)
        NavigationStack { AgendaView().campusEventDestinations() }.tabItem { Label("時間割", systemImage: "calendar") }.tag(1)
        NavigationStack { CommunityView() }.tabItem { Label("掲示板", systemImage: "bubble.left.and.bubble.right") }.tag(4)
        NavigationStack { NotesView() }.tabItem { Label("メモ", systemImage: "note.text") }.tag(2)
        NavigationStack { MoreView() }.tabItem { Label("その他", systemImage: "square.grid.2x2") }.tag(3)
      }
      }
    }.overlay { if model.committing { ProgressView("保存中…").padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
      .allowsHitTesting(!model.committing)
      .campusBackground().toolbarBackground(appearance.theme.paper, for: .navigationBar, .tabBar).toolbarBackground(.visible, for: .navigationBar, .tabBar)
      .environmentObject(navigation).environmentObject(navigation.map)
      .environment(\.showCampusLocation, navigation.showMap)
      .environment(\.showCampusArticles, { navigation.showArticles(courseID: $0, title: $1) })
      .environment(\.showCampusBoard, { navigation.showBoard(courseID: $0, title: $1) })
      .onChange(of: phase) { _, p in
      if p == .active && !model.loading {
        calendar.resume(selected: model.data.selectedCalendarIDs, date: navigation.tab == 0 ? Date() : nil)
      } else if p != .active { model.flushForBackground() }
    }.task { if !model.loading { calendar.refresh(selected: model.data.selectedCalendarIDs, date: Date()) } }
      .onChange(of: model.loading) { _, loading in
        if !loading { calendar.refresh(selected: model.data.selectedCalendarIDs, date: Date()) }
      }
  }
}
struct HomeView: View {
  @EnvironmentObject private var navigation: CampusNavigation
  @EnvironmentObject private var mapState: CampusMapState
  @EnvironmentObject private var appearance: CampusAppearance
  @EnvironmentObject var model: AppModel
  @EnvironmentObject var calendar: CalendarModel
  @State private var lastScrolledRequest: UUID?
  @State private var isVisible = false
  private let mapAnchor = "home-campus-map"
  @Binding var tab: Int
  @State var importing = false
  @State var note: UUID?
  @State var image: ImageAttachment?
  @State private var editingFacility: UUID?
  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let now = context.date
      let events = calendar.combined(model.data)
      let today = events.filter { $0.occurs(on: now) }
      let lessons = today.filter { ["class", "exam"].contains($0.kind) }
      let next = events.first { $0.end > now && ["class", "exam"].contains($0.kind) }
      ScrollViewReader { scroll in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            CampusPageHeader(title: now.formatted(.dateTime.month().day().weekday()))
            hero(next: next, lessons: lessons, now: now)
            HStack {
              CampusSectionTitle(title: "今日の予定")
              Spacer()
              Button("すべて見る") { tab = 1 }.font(.caption).frame(minHeight: 44).campusReadable()
            }
            CampusCard {
              VStack(alignment: .leading, spacing: 12) {
                if today.isEmpty {
                  Label(calendar.covers(now) ? "今日の予定はありません" : "今日のローカル予定はありません", systemImage: "sun.max")
                    .font(.subheadline).padding(.vertical, 12)
                }
                ForEach(today) { event in
                  HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                      if let period = TimetablePresentation.period(of: event) {
                        Text("\(period) コマ").font(.subheadline.weight(.semibold))
                      }
                      Text(event.allDay ? "終日" : Tokyo.time(event.start)).font(.caption).monospacedDigit()
                      if !event.allDay { Text(Tokyo.time(event.end)).font(.caption2).foregroundStyle(.secondary) }
                      Text(event.end <= now ? "終了" : event.start <= now ? "予定中" : "これから")
                        .font(.caption2).foregroundStyle(.secondary)
                    }.frame(width: 58, alignment: .leading)
                    Rectangle().fill(appearance.theme.accent.opacity(event.end <= now ? 0.15 : 0.7)).frame(width: 2)
                    EventNavigationRow(event: event)
                  }.fixedSize(horizontal: false, vertical: true)
                  if event.id != today.last?.id { Divider() }
                }
                Text(calendar.displayMessage(on: now)).font(.caption2).foregroundStyle(.secondary)
              }
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
              quickButton("すぐメモ", icon: "square.and.pencil") { note = model.newNote() }.disabled(model.readOnly)
              quickButton("PDF取り込み", icon: "doc.badge.plus") { importing = true }
              NavigationLink { FacilitiesView() } label: { quickLabel("施設の時間", icon: "fork.knife") }
              NavigationLink { LinksView() } label: { quickLabel("リンク", icon: "link") }
            }
            CampusSectionTitle(title: "キャンパスマップ").id(mapAnchor)
            CampusCard { CampusMapView() }
            if !model.data.facilities.filter(\.band).isEmpty {
              CampusSectionTitle(title: "今日の営業時間")
              CampusCard {
                VStack(alignment: .leading, spacing: 8) {
                  ForEach(model.data.facilities.filter(\.band)) { facility in
                    Button { editingFacility = facility.id } label: {
                      HStack {
                        Image(systemName: "clock").frame(width: 28)
                        VStack(alignment: .leading, spacing: 5) {
                          Text(facility.title).font(.subheadline.weight(.medium))
                          Text(facility.label(on: now)).font(.caption).foregroundStyle(.secondary)
                          Text("確認 \(facility.updated)").font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 3)
                        Image(systemName: "chevron.right").font(.caption)
                      }.frame(minHeight: 44).padding(.vertical, 5)
                    }.buttonStyle(.plain)
                  }
                }
              }
            }
            if !model.data.pinnedNoteIDs.isEmpty {
              CampusSectionTitle(title: "固定メモ・画像")
              ForEach(model.data.pinnedNoteIDs, id: \.self) { id in
                if let n = model.data.notes.first(where: { $0.id == id }) {
                  CampusCard {
                    VStack(alignment: .leading, spacing: 8) {
                      if let a = n.images.first {
                        Button { image = a } label: { AttachmentThumbnail(attachment: a).frame(height: 180) }
                      }
                      Button(n.title) { note = id }.frame(minHeight: 44)
                      HStack {
                        Button("上へ") { movePin(id, -1) }.frame(minHeight: 44)
                        Button("下へ") { movePin(id, 1) }.frame(minHeight: 44)
                        Spacer()
                        Button("固定解除") { model.update { $0.pinnedNoteIDs.removeAll { $0 == id } } }.frame(minHeight: 44)
                      }.font(.caption)
                    }
                  }
                }
              }
            }
            Label("端末に保存 · \(model.saveLabel)", systemImage: "checkmark.shield")
              .font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity).campusReadable().padding(.vertical, 8)
          }.padding(.horizontal, 18).padding(.bottom, 24)
        }.campusBackground().navigationTitle("").navigationBarTitleDisplayMode(.inline)
          .toolbar(.hidden, for: .navigationBar)
          .onChange(of: navigation.mapRequest) { _, request in
            guard isVisible, navigation.tab == 0, navigation.homePath.isEmpty, let request else { return }
            scroll.scrollTo(mapAnchor, anchor: .top)
            lastScrolledRequest = request.id
          }
          .onChange(of: mapState.selectionRequest) { _, request in
            guard isVisible, request != nil else { return }
            scroll.scrollTo(mapAnchor, anchor: .top)
          }
          .onAppear {
            isVisible = true
            if let request = navigation.mapRequest, request.id != lastScrolledRequest {
              scroll.scrollTo(mapAnchor, anchor: .top)
              lastScrolledRequest = request.id
            }
            calendar.refresh(selected: model.data.selectedCalendarIDs, date: Date())
          }.onDisappear { isVisible = false }
          .sheet(isPresented: $importing) { ImportView() }
          .sheet(item: $note) { id in NavigationStack { NoteEditor(id: id) } }
          .sheet(item: $image) { a in ImageViewer(attachment: a) }
          .sheet(item: $editingFacility) { id in
            NavigationStack {
              FacilityEditor(id: id).toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { editingFacility = nil } } }
            }
          }
      }
    }
  }
  @ViewBuilder private func hero(next: CampusEvent?, lessons: [CampusEvent], now: Date) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      if let next {
        let isToday = Tokyo.calendar.isDate(next.start, inSameDayAs: now)
        HStack(alignment: .top) {
          Text(next.start <= now ? "いまの講義" : isToday ? "次の講義" : "次回の講義").font(.subheadline)
          Spacer()
          Text(next.timing(at: now)).font(.caption.weight(.medium)).padding(.horizontal, 10).padding(.vertical, 6)
            .background(appearance.theme.light, in: Capsule()).foregroundStyle(appearance.theme.accent)
        }
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .firstTextBaseline, spacing: 20) { heroTime(next) }
          VStack(alignment: .leading, spacing: 6) { heroTime(next) }
        }
        Text("終了 \(Tokyo.time(next.end))").font(.caption).foregroundStyle(.white.opacity(0.7))
        NavigationLink(value: CampusEventRoute(event: next)) {
          HStack { Text(next.title).font(.headline); Spacer(); Image(systemName: "chevron.right").font(.caption) }.frame(minHeight: 44)
        }.buttonStyle(.plain)
        Divider().overlay(.white.opacity(0.2))
        Button { navigation.showMap(location: next.location) } label: {
          HStack(spacing: 12) {
            Image(systemName: "mappin.and.ellipse").foregroundStyle(appearance.theme.light)
            VStack(alignment: .leading, spacing: 5) {
              Text("場所 · タップして地図へ").font(.caption).foregroundStyle(.white.opacity(0.72))
              Text(next.location.isEmpty ? "場所未登録" : next.location).font(.title3.weight(.semibold))
            }
            Spacer(minLength: 2)
            Image(systemName: "arrow.up.right").font(.subheadline)
          }.frame(minHeight: 50)
        }.buttonStyle(.plain).accessibilityLabel("\(next.location.isEmpty ? "場所未登録" : next.location)。キャンパスマップを開く")
        if !isToday {
          Text(lessons.isEmpty ? "今日は講義のない日です" : "今日の講義は終了しました").font(.caption)
          Text(next.start, format: .dateTime.month().day().weekday()).font(.caption).foregroundStyle(.white.opacity(0.72))
        }
      } else {
        Image(systemName: model.data.imports.isEmpty ? "doc.badge.plus" : "sun.max").font(.title2).foregroundStyle(appearance.theme.light)
        Text(model.data.imports.isEmpty ? "時間割を、ここに。" : lessons.isEmpty ? "今日は講義のない日です" : "今日の講義は終了しました")
          .font(.title2.weight(.medium))
        Text(model.data.imports.isEmpty ? "履修登録確認票と年間行事予定表の2つのPDFから、あなたの予定を取り込みます。" : "今後の講義は登録されていません。予定は時間割から確認できます。")
          .font(.subheadline).foregroundStyle(.white.opacity(0.76))
        Button { importing = true } label: {
          Label("PDFから予定を取り込む", systemImage: "plus").font(.subheadline.weight(.medium)).padding(12)
            .background(appearance.theme.light, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(appearance.theme.accent)
        }.frame(minHeight: 44)
      }
    }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
      .foregroundStyle(.white).background(appearance.theme.accent, in: RoundedRectangle(cornerRadius: 26))
  }
  @ViewBuilder private func heroTime(_ event: CampusEvent) -> some View {
    if let period = TimetablePresentation.period(of: event) {
      HStack(alignment: .firstTextBaseline, spacing: 3) { Text("\(period)").font(.system(.largeTitle, design: .rounded).weight(.medium)); Text("コマ目").font(.caption) }
    }
    Text(Tokyo.time(event.start)).font(.system(size: 50, weight: .medium, design: .rounded)).monospacedDigit().minimumScaleFactor(0.7)
  }
  private func quickButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
    Button(action: action) { quickLabel(title, icon: icon) }.buttonStyle(.plain)
  }
  private func quickLabel(_ title: String, icon: String) -> some View {
    Label(title, systemImage: icon).font(.caption.weight(.medium)).frame(maxWidth: .infinity, minHeight: 48)
      .padding(.horizontal, 6).background(appearance.theme.soft, in: RoundedRectangle(cornerRadius: 14))
  }
  func movePin(_ id: UUID, _ delta: Int) {
    model.update { d in
      guard let i = d.pinnedNoteIDs.firstIndex(of: id), d.pinnedNoteIDs.indices.contains(i + delta) else { return }
      d.pinnedNoteIDs.swapAt(i, i + delta)
    }
  }
}
struct MoreView: View {
  @EnvironmentObject private var appearance: CampusAppearance
  @EnvironmentObject var model: AppModel
  @State private var importing = false
  @State private var settings = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        CampusPageHeader(title: "キャンパスの道具")
        Text("いつもの大学生活を、少し身軽に。").font(.subheadline).foregroundStyle(.secondary).campusReadable()
        CampusCard {
          VStack(spacing: 4) {
            NavigationLink { FacilitiesView() } label: { moreRow("施設", subtitle: "営業時間と自分用の例外", icon: "fork.knife") }
            Divider()
            NavigationLink { LinksView() } label: { moreRow("リンク", subtitle: "大学のサイトとお気に入り", icon: "link") }
          }.buttonStyle(.plain)
        }
        CampusSectionTitle(title: "時間割と設定")
        CampusCard {
          VStack(spacing: 4) {
            Button { importing = true } label: { moreRow("PDF取り込み", subtitle: "2つのPDFから授業予定を追加", icon: "doc.badge.plus") }
            Divider()
            NavigationLink { CourseList() } label: { moreRow("科目と個人修正", subtitle: "授業の編集・休講・日時未定の科目", icon: "list.bullet.rectangle") }
            Divider()
            Button { settings = true } label: { moreRow("表示とカレンダー", subtitle: "Outlookなど端末の予定を読み取る", icon: "gearshape") }
            Divider()
            NavigationLink { AppearanceSettingsView() } label: { moreRow("テーマ・背景", subtitle: "配色と背景画像を自分好みに", icon: "paintpalette") }
          }.buttonStyle(.plain)
        }
        Label("この端末に保存 · \(model.saveLabel)", systemImage: "lock.shield").font(.caption).foregroundStyle(.secondary).campusReadable()
      }.padding(18)
    }.campusBackground().navigationTitle("").navigationBarTitleDisplayMode(.inline)
      .toolbar(.hidden, for: .navigationBar)
      .sheet(isPresented: $importing) { ImportView() }
      .sheet(isPresented: $settings) { CalendarSettingsView(date: Date()) }
  }
  private func moreRow(_ title: String, subtitle: String, icon: String) -> some View {
    HStack(spacing: 14) {
      Image(systemName: icon).font(.title3).frame(width: 42, height: 44).background(appearance.theme.soft, in: RoundedRectangle(cornerRadius: 14))
      VStack(alignment: .leading, spacing: 6) { Text(title).font(.headline); Text(subtitle).font(.caption).foregroundStyle(.secondary) }
      Spacer(minLength: 0)
      Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
    }.frame(maxWidth: .infinity, minHeight: 70, alignment: .leading).contentShape(Rectangle())
  }
}
extension UUID: @retroactive Identifiable { public var id: UUID { self } }
struct EventNavigationRow: View {
  var event: CampusEvent
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      NavigationLink(value: CampusEventRoute(event: event)) {
        EventSummary(event: event).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }.buttonStyle(.borderless)
      CampusLocationButton(location: event.location)
    }
  }
}
struct EventRow: View {
  var event: CampusEvent
  var allowsMapNavigation = true
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      EventSummary(event: event)
      if allowsMapNavigation {
        CampusLocationButton(location: event.location)
      } else {
        Label(event.location.isEmpty ? "場所未登録" : event.location, systemImage: "mappin.and.ellipse")
          .font(.subheadline).foregroundStyle(.secondary)
      }
    }
  }
}
struct EventSummary: View {
  var event: CampusEvent
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(event.title).font(.body.weight(.medium))
      Text(event.allDay ? "終日" : "\(Tokyo.time(event.start))–\(Tokyo.time(event.end))").font(
        .caption)
      Text(
        event.kind == "exam"
          ? "試験候補・要確認"
          : event.kind == "external" ? "外部予定・表示のみ" : event.kind == "university" ? "大学行事" : "授業"
      ).font(.caption2).foregroundStyle(eventColor(event))
    }.accessibilityElement(children: .combine)
  }
}
@MainActor func eventColor(_ e: CampusEvent) -> Color {
  e.kind == "external"
    ? .purple : e.kind == "exam" ? .orange : e.kind == "university" ? .blue : CampusAppearance.shared.theme.accent
}
