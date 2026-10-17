import OSLog
import SwiftUI
import WebKit

/// Both surfaces retain their own session and editor when switching sections.
struct CommunityView: View {
  @EnvironmentObject private var navigation: CampusNavigation
  @EnvironmentObject private var appearance: CampusAppearance
  var body: some View {
    VStack(spacing: 0) {
      Picker("掲示板の表示", selection: $navigation.communitySection) {
        ForEach(CommunitySection.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }.pickerStyle(.segmented).padding(.horizontal, 16).padding(.vertical, 10).background(appearance.theme.paper)
      if navigation.communitySection == .posts { BoardView() } else { ArticlesView() }
    }.campusBackground()
  }
}

/// Local interaction demo. No board records are written to disk or sent outside the app.
struct BoardView: View {
  @EnvironmentObject private var navigation: CampusNavigation
  @EnvironmentObject private var appearance: CampusAppearance
  @StateObject private var session = BoardSession.shared
  var body: some View {
    VStack(spacing: 0) {
      Text("操作デモ · 外部送信なし · アプリ終了時に消えます\n全体の投稿・人物・反応数はサンプルです")
        .font(.caption2).fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 9)
        .foregroundStyle(appearance.theme.ink).background(appearance.theme.soft)
      if let error = session.pageError {
        VStack(alignment: .leading, spacing: 8) {
          Text(error).font(.caption)
          if session.canReload {
            Button("操作デモを最初から開く（投稿・下書きは消えます）") { session.reloadDemo() }
              .font(.caption).frame(minHeight: 44)
          }
        }.padding()
      }
      BoardWebSurface(session: session, active: navigation.tab == 4 && navigation.communitySection == .posts)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay { if session.loading { ProgressView("掲示板を読み込み中…").campusReadable() } }
    }
    .navigationTitle("掲示板").navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(true)
    .toolbar(.visible, for: .navigationBar, .tabBar)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        if navigation.boardReturnTab != nil {
          Button { session.suspend(); navigation.returnFromBoard() } label: {
            Label("授業に戻る", systemImage: "chevron.left")
          }.frame(minWidth: 44, minHeight: 44)
        }
      }
    }
    .background(Color.clear)
    .onDisappear { session.suspend() }
    .onAppear { session.setBackground(appearance.hasBackground); session.setTheme(appearance.theme.rawValue); applyRequest() }
    .onChange(of: navigation.boardRequest) { _, _ in applyRequest() }
    .onChange(of: appearance.hasBackground) { _, value in session.setBackground(value) }
    .onChange(of: appearance.theme) { _, value in session.setTheme(value.rawValue) }
    .onChange(of: navigation.tab) { old, new in if old == 4, new != 4 { session.suspend() } }
  }
  private func applyRequest() {
    if let request = navigation.boardRequest { session.apply(request) }
  }
}

@MainActor private final class BoardSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
  static let shared = BoardSession()
  @Published private(set) var loading = true
  @Published private(set) var pageError: String?
  @Published private(set) var canReload = false
  private var webView: WKWebView?
  private let resourceURL = Bundle.main.url(forResource: "Board", withExtension: "html")
  private var ready = false
  private var lastRequest: UUID?
  private var context: (courseID: String, title: String) = ("", "")
  private var theme = CampusAppearance.shared.theme.rawValue
  func makeWebView() -> WKWebView {
    if let webView { return webView }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    // Native owns all navigation/theme actions. No JavaScript-to-native handlers are exposed.
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    view.scrollView.isScrollEnabled = false
    view.allowsBackForwardNavigationGestures = false
    webView = view
    if let resourceURL { view.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL) }
    else { loading = false; pageError = "掲示板の画面を開けません。アプリを入れ直してください。" }
    return view
  }
  func apply(_ request: CampusArticleRequest) {
    guard request.id != lastRequest else { return }
    lastRequest = request.id
    context = (request.courseID, request.title)
    applyContext()
  }
  private func applyContext() {
    guard ready else { return }
    webView?.endEditing(true)
    webView?.callAsyncJavaScript("return window.BoardApp.setCourseContext(courseID, title);", arguments: ["courseID": context.courseID, "title": context.title], in: nil, in: .page) { result in
      guard case .success(let value) = result, value as? Bool == true else {
        self.pageError = "講義を確認できません。講義詳細から開き直してください。"
        return
      }
      self.pageError = nil
    }
  }
  private var imageBackground = CampusAppearance.shared.hasBackground
  func setBackground(_ enabled: Bool) {
    imageBackground = enabled
    guard ready else { return }
    webView?.callAsyncJavaScript("document.documentElement.dataset.campusBackground = enabled ? 'image' : 'solid';", arguments: ["enabled": enabled], in: nil, in: .page, completionHandler: nil)
  }
  func setTheme(_ value: String) {
    guard CampusTheme(rawValue: value) != nil else { return }
    theme = value
    guard ready else { return }
    webView?.callAsyncJavaScript("window.BoardApp.applyTheme(value);", arguments: ["value": value], in: nil, in: .page, completionHandler: nil)
  }
  func suspend() {
    guard ready else { return }
    webView?.endEditing(true)
    webView?.callAsyncJavaScript("window.BoardApp.suspend();", arguments: [:], in: nil, in: .page, completionHandler: nil)
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript("return !!window.BoardApp && document.getElementById('board-content').childElementCount > 0;", arguments: [:], in: nil, in: .page) { result in
      self.loading = false
      guard case .success(let value) = result, value as? Bool == true else { self.failed(); return }
      self.ready = true
      self.canReload = false
      self.pageError = nil
      self.setBackground(self.imageBackground)
      self.setTheme(self.theme)
      self.applyContext()
      Logger(subsystem: "jp.personal.CampusPocket", category: "Board").info("Board document initialized")
    }
  }
  private func failed() {
    ready = false; loading = false; canReload = true
    pageError = "操作デモの画面が終了しました。今回の投稿・返信・下書きを失った可能性があります。"
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failed() }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed() }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed() }
  func reloadDemo() {
    guard canReload, let resourceURL, let webView else { return }
    ready = false; loading = true; canReload = false; pageError = nil
    webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL)
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let isDocument = navigationAction.request.url?.standardizedFileURL == resourceURL?.standardizedFileURL
    decisionHandler(isDocument && navigationAction.navigationType == .other && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}

/// Each SwiftUI host owns its container; only the active visible host attaches the shared WebView.
private struct BoardWebSurface: UIViewRepresentable {
  let session: BoardSession
  let active: Bool
  func makeUIView(context: Context) -> BoardWebHost { BoardWebHost(session: session, active: active) }
  func updateUIView(_ host: BoardWebHost, context: Context) { host.active = active; host.attachIfVisible() }
  static func dismantleUIView(_ host: BoardWebHost, coordinator: ()) { host.active = false }
}
private final class BoardWebHost: UIView {
  private let session: BoardSession
  var active: Bool
  private var edges: [NSLayoutConstraint] = []
  init(session: BoardSession, active: Bool) {
    self.session = session; self.active = active
    super.init(frame: .zero)
    backgroundColor = .clear
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func didMoveToWindow() { super.didMoveToWindow(); attachIfVisible() }
  override func layoutSubviews() { super.layoutSubviews(); attachIfVisible() }
  func attachIfVisible() {
    guard active, window != nil else { return }
    // Hidden prebuilt tab containers never start WebKit. The session returns its retained
    // editor on every later attachment, preserving the document and in-progress input.
    let webView = session.makeWebView()
    guard webView.superview !== self else { return }
    NSLayoutConstraint.deactivate(edges)
    webView.removeFromSuperview()
    addSubview(webView)
    webView.translatesAutoresizingMaskIntoConstraints = false
    edges = [webView.leadingAnchor.constraint(equalTo: leadingAnchor), webView.trailingAnchor.constraint(equalTo: trailingAnchor), webView.topAnchor.constraint(equalTo: topAnchor), webView.bottomAnchor.constraint(equalTo: bottomAnchor)]
    NSLayoutConstraint.activate(edges)
  }
}
