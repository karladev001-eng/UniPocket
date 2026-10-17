import CampusCore
import SwiftUI
import UIKit

/// A unique request also makes a second tap on the same location scroll Home again.
struct CampusMapRequest: Equatable {
  var id = UUID()
  var location: String
}

private struct CampusLocationActionKey: EnvironmentKey {
  static let defaultValue: (String) -> Void = { _ in }
}
extension EnvironmentValues {
  var showCampusLocation: (String) -> Void {
    get { self[CampusLocationActionKey.self] }
    set { self[CampusLocationActionKey.self] = newValue }
  }
}

/// Selection lives above the lazy Home row so scrolling it offscreen cannot lose it.
@MainActor final class CampusMapState: ObservableObject {
  @Published var location = ""
  @Published var selectedID: String?
  @Published var manuallySelected = false
  @Published var expanded = false
  @Published var query = ""
  @Published private(set) var selectionRequest: UUID?
  @Published fileprivate var command = MapCommand()

  func show(location: String) {
    self.location = location
    if case .success(let catalog) = CampusMapCatalog.bundled {
      selectedID = catalog.resolve(location).buildingID
    } else { selectedID = nil }
    manuallySelected = false
    command = MapCommand(action: .reset)
  }
  func select(_ id: String) {
    selectedID = id
    manuallySelected = true
    command = MapCommand(action: .reset)
    selectionRequest = UUID()
  }
}

/// Separate from the title's navigation control to keep the two tap targets independent.
struct CampusLocationButton: View {
  var location: String
  @Environment(\.showCampusLocation) private var showLocation
  var body: some View {
    Button { showLocation(location) } label: {
      Label(location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "場所未登録・ホームの地図へ" : location,
            systemImage: "mappin.and.ellipse")
        .font(.subheadline).multilineTextAlignment(.leading)
        .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
    }.buttonStyle(.borderless)
      .accessibilityLabel("場所：\(location.isEmpty ? "未登録" : location)。ホームのキャンパスマップで確認")
  }
}

struct CampusMapView: View {
  @EnvironmentObject private var state: CampusMapState
  @FocusState private var searchFocused: Bool
  var body: some View {
    switch CampusMapCatalog.bundled {
    case .success(let catalog): content(catalog)
    case .failure:
      ContentUnavailableView("地図を読み込めません", systemImage: "map",
        description: Text("同梱の地図データを確認できませんでした。アプリを開き直してください。"))
    }
  }

  private func content(_ catalog: CampusMapCatalog) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("浜松キャンパス・34施設・オフライン対応").font(.caption).foregroundStyle(.secondary)
      CampusZoomMap(catalog: catalog, selectedID: state.selectedID, command: state.command,
                    select: select)
        .frame(height: 300).clipShape(RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("北が上の浜松キャンパス概略図。\(catalog.building(state.selectedID).map { "選択：" + $0.name } ?? "建物未選択")")
        .accessibilityHint("下の建物一覧と検索を展開して建物を選べます")
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) { zoomButtons }
        VStack(alignment: .leading, spacing: 4) { zoomButtons }
      }
      Text("全体表示では上下にスクロール。拡大すると地図を移動できます。")
        .font(.caption).foregroundStyle(.secondary)
      if !state.location.isEmpty {
        Text("予定の場所：\(state.location)").font(.subheadline)
      }
      if let b = catalog.building(state.selectedID) {
        Text(state.manuallySelected ? "手動で選択した建物" : "予定の場所に対応する建物")
          .font(.caption).foregroundStyle(.secondary)
        Label(b.name, systemImage: "mappin.circle.fill").font(.headline)
        Text(b.mapPolygon.isEmpty ? "琥珀色の丸印が位置の目安です。建物の輪郭は資料にありません。" : "琥珀色の面と輪郭が選択した建物です。")
          .font(.caption).foregroundStyle(.secondary)
      } else {
        Text(resolutionMessage(catalog.resolve(state.location))).font(.subheadline)
      }
      DisclosureGroup(isExpanded: $state.expanded) {
        VStack(alignment: .leading, spacing: 8) {
          TextField("建物名・施設番号・登録済み教室", text: $state.query)
            .textFieldStyle(.roundedBorder).frame(minHeight: 44).focused($searchFocused)
            .submitLabel(.search).accessibilityLabel("建物を検索")
          let buildings = catalog.search(state.query)
          Text("\(buildings.count)件").font(.caption).foregroundStyle(.secondary)
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
              ForEach(buildings) { b in
                Button { select(b.id) } label: {
                  HStack {
                    VStack(alignment: .leading, spacing: 5) {
                      Text(b.name).foregroundStyle(.primary)
                      Text("\(b.id) ・ \(b.category)").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    if b.id == state.selectedID { Image(systemName: "checkmark.circle.fill") }
                  }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.vertical, 4)
                }.buttonStyle(.borderless)
                  .accessibilityLabel("\(b.name)、施設番号\(b.id)\(b.id == state.selectedID ? "、選択中" : "")")
                Divider()
              }
              if buildings.isEmpty { Text("一致する建物はありません").padding(.vertical) }
            }
          }.frame(maxHeight: 260)
        }.padding(.top, 8)
      } label: {
        Label("建物一覧と検索（34施設）", systemImage: "list.bullet")
          .frame(minHeight: 44)
      }
      Text("北が上・提供構内図 \(catalog.sourceDate) 現在\n形状・位置は概略です。現地の案内も確認してください。")
        .font(.caption).foregroundStyle(.secondary)
    }.padding(.vertical, 4)
  }

  private func select(_ id: String) {
    searchFocused = false
    state.select(id)
  }

  @ViewBuilder private var zoomButtons: some View {
    Button { state.command = MapCommand(action: .zoomOut) } label: {
      Image(systemName: "minus.magnifyingglass").frame(minWidth: 44, minHeight: 44)
    }.accessibilityLabel("地図を縮小").buttonStyle(.borderless)
    Button { state.command = MapCommand(action: .zoomIn) } label: {
      Image(systemName: "plus.magnifyingglass").frame(minWidth: 44, minHeight: 44)
    }.accessibilityLabel("地図を拡大").buttonStyle(.borderless)
    Button("全体に戻す") { state.command = MapCommand(action: .reset) }
      .frame(minHeight: 44).buttonStyle(.borderless)
  }

  private func resolutionMessage(_ result: CampusLocationResolution) -> String {
    switch result {
    case .missing: return "建物一覧から建物を選んでください。"
    case .online: return "オンラインの場所です。建物は自動選択していません。"
    case .unknown: return "この場所に対応する建物は未登録です。建物一覧から選べます。"
    case .ambiguous: return "複数の建物が候補です。建物一覧から選んでください。"
    case .matched: return "建物一覧から建物を選んでください。"
    }
  }
}

fileprivate struct MapCommand: Equatable {
  enum Action { case reset, zoomIn, zoomOut }
  var id = UUID()
  var action: Action = .reset
}

/// UIKit owns pinch and pan, including clamping/centering when bounds or text size change.
private struct CampusZoomMap: UIViewRepresentable {
  var catalog: CampusMapCatalog
  var selectedID: String?
  var command: MapCommand
  var select: (String) -> Void
  func makeUIView(context: Context) -> CampusMapScrollView {
    let view = CampusMapScrollView()
    view.configure(catalog: catalog)
    return view
  }
  func updateUIView(_ view: CampusMapScrollView, context: Context) {
    view.onSelect = select
    view.highlight(catalog.building(selectedID))
    if view.lastCommand != command.id {
      view.lastCommand = command.id
      view.perform(command.action)
    }
  }
}

private final class CampusMapScrollView: UIScrollView, UIScrollViewDelegate {
  private let canvas = UIImageView()
  private let highlightLayer = CAShapeLayer()
  private var mapSize = CGSize.zero
  private var previousSize = CGSize.zero
  private var selected: CampusBuilding?
  private var buildings: [CampusBuilding] = []
  var onSelect: ((String) -> Void)?
  var lastCommand: UUID?

  override init(frame: CGRect) {
    super.init(frame: frame)
    delegate = self
    backgroundColor = .secondarySystemBackground
    bouncesZoom = false
    bounces = false
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(selectBuilding(_:))))
    contentInsetAdjustmentBehavior = .never
    canvas.isUserInteractionEnabled = false
    addSubview(canvas)
    canvas.layer.addSublayer(highlightLayer)
    highlightLayer.fillColor = UIColor.systemYellow.withAlphaComponent(0.52).cgColor
    highlightLayer.strokeColor = UIColor(red: 0.65, green: 0.34, blue: 0, alpha: 1).cgColor
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func configure(catalog: CampusMapCatalog) {
    buildings = catalog.buildings
    mapSize = CGSize(width: catalog.viewBox[2], height: catalog.viewBox[3])
    canvas.frame = CGRect(origin: .zero, size: mapSize)
    if let url = CampusMapCatalog.overviewURL { canvas.image = UIImage(contentsOfFile: url.path) }
    canvas.contentMode = .scaleToFill
    contentSize = mapSize
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, bounds.height > 0, mapSize.width > 0 else { return }
    if bounds.size != previousSize {
      previousSize = bounds.size
      let fit = min(bounds.width / mapSize.width, bounds.height / mapSize.height)
      minimumZoomScale = fit
      maximumZoomScale = fit * 8
      setZoomScale(fit, animated: false)
    }
    centerCanvas()
    updateScrollingMode()
    highlightLayer.lineWidth = 3 / max(zoomScale, 0.01)
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { canvas }
  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    centerCanvas()
    updateScrollingMode()
    highlightLayer.lineWidth = 3 / max(zoomScale, 0.01)
  }
  private func updateScrollingMode() {
    // Disabling scrolling itself lets Home's ancestor scroll view receive drags at fit.
    // Keep the independent pinch recognizer available for zooming from the overview.
    isScrollEnabled = zoomScale > minimumZoomScale + 0.001
    pinchGestureRecognizer?.isEnabled = true
  }
  private func centerCanvas() {
    let h = max(0, (bounds.width - mapSize.width * zoomScale) / 2)
    let v = max(0, (bounds.height - mapSize.height * zoomScale) / 2)
    contentInset = UIEdgeInsets(top: v, left: h, bottom: v, right: h)
  }
  func perform(_ action: MapCommand.Action) {
    switch action {
    case .reset:
      setZoomScale(minimumZoomScale, animated: false)
      contentOffset = CGPoint(x: -contentInset.left, y: -contentInset.top)
    case .zoomIn: zoom(by: 1.6)
    case .zoomOut: zoom(by: 1 / 1.6)
    }
  }
  private func zoom(by factor: CGFloat) {
    let next = min(maximumZoomScale, max(minimumZoomScale, zoomScale * factor))
    let center = CGPoint(x: (contentOffset.x + bounds.width / 2) / zoomScale,
                         y: (contentOffset.y + bounds.height / 2) / zoomScale)
    let size = CGSize(width: bounds.width / next, height: bounds.height / next)
    zoom(to: CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2,
                    width: size.width, height: size.height), animated: true)
  }
  @objc private func selectBuilding(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: canvas)
    // Prioritize the actual outline, then a 44pt minimum target around the center.
    let exact = buildings.first { building in
      guard !building.mapPolygon.isEmpty else { return false }
      let path = UIBezierPath()
      for (i, p) in building.mapPolygon.enumerated() {
        if i == 0 { path.move(to: CGPoint(x: p[0], y: p[1])) }
        else { path.addLine(to: CGPoint(x: p[0], y: p[1])) }
      }
      path.close()
      return path.contains(point)
    }
    let nearest = buildings.min {
      hypot(point.x - $0.mapCenter[0], point.y - $0.mapCenter[1])
        < hypot(point.x - $1.mapCenter[0], point.y - $1.mapCenter[1])
    }
    if let b = exact { onSelect?(b.id) }
    else if let b = nearest,
      hypot(point.x - b.mapCenter[0], point.y - b.mapCenter[1]) * zoomScale <= 22 {
      onSelect?(b.id)
    }
  }
  func highlight(_ building: CampusBuilding?) {
    guard selected != building else { return }
    selected = building
    guard let building else { highlightLayer.path = nil; return }
    let path = UIBezierPath()
    if building.mapPolygon.isEmpty {
      path.append(UIBezierPath(ovalIn: CGRect(x: building.mapCenter[0] - 18,
        y: building.mapCenter[1] - 18, width: 36, height: 36)))
    } else {
      for (i, p) in building.mapPolygon.enumerated() {
        let point = CGPoint(x: p[0], y: p[1])
        if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
      }
      path.close()
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    highlightLayer.path = path.cgPath
    CATransaction.commit()
  }
}
