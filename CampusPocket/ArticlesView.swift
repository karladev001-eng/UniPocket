import CampusCore
import SwiftUI
import WebKit
import OSLog

/// Bundled, offline reading and editing surface. Its only native capabilities are the explicit bridge below.
struct ArticlesView: View {
  @EnvironmentObject private var navigation: CampusNavigation
  @EnvironmentObject private var appearance: CampusAppearance
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @StateObject private var session = ArticlesSession.shared
  @State private var closing = false
  var body: some View {
    VStack(spacing: 0) {
      if let error = session.pageError {
        VStack(alignment: .leading, spacing: 8) {
          Text(error).font(.caption).foregroundStyle(.red)
          if session.canReload {
            Button("保存済みの内容から記事を再読み込み") { session.reloadSavedContent() }.font(.caption).frame(minHeight: 44)
          }
        }.padding()
      }
      ArticleWebSurface(session: session, active: navigation.tab == 4 && navigation.communitySection == .articles)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay { if session.loading { ProgressView("記事を読み込み中…").padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14)) } }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("掲示板").navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(true)
    .toolbar(.visible, for: .tabBar)
    .toolbar(.visible, for: .navigationBar)
    .background(Color.clear)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        if navigation.articleReturnTab != nil { Button {
          guard !closing else { return }
          closing = true
          session.prepareToLeave { allowed in
            closing = false
            if allowed { navigation.returnFromArticles() }
          }
        } label: { Label("授業に戻る", systemImage: "chevron.left") }
        .disabled(closing).frame(minWidth: 44, minHeight: 44) }
      }
    }
    .onChange(of: appearance.hasBackground) { _, value in session.setBackground(value) }
    .onChange(of: appearance.theme) { _, theme in session.setTheme(theme.rawValue) }
    .onAppear { session.setBackground(appearance.hasBackground); session.setTheme(appearance.theme.rawValue); applyCourseRequest() }
    .onChange(of: navigation.articleRequest) { _, _ in applyCourseRequest() }
    .onDisappear { session.suspend() }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { session.persist() }
    }
  }
  private func applyCourseRequest() {
    if let request = navigation.articleRequest { session.apply(request) }
  }
}

@MainActor private final class ArticlesSession: NSObject, ObservableObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
  static let shared = ArticlesSession()
  @Published var pageError: String?
  @Published private(set) var canReload = false
  private(set) var webView: WKWebView?
  private var ready = false
  @Published private(set) var loading = true
  private let queue = DispatchQueue(label: "jp.personal.CampusPocket.article-draft", qos: .userInitiated)
  private var store: ArticleDraftStore
  private let resourceURL = Bundle.main.url(forResource: "Articles", withExtension: "html")
  private override init() {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("CampusPocket/Articles", isDirectory: true)
    store = ArticleDraftStore(url: root.appendingPathComponent("draft.json"))
    super.init()
  }
  func makeWebView() -> WKWebView {
    if let webView { return webView }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "articles")
    let theme = CampusAppearance.shared.theme.rawValue
    let context = ["theme": theme]
    if let bytes = try? JSONSerialization.data(withJSONObject: context), let json = String(data: bytes, encoding: .utf8) {
      configuration.userContentController.addUserScript(WKUserScript(source: "window.campusArticlesContext=\(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    view.scrollView.isScrollEnabled = false // The article surface owns its reading position.
    view.allowsBackForwardNavigationGestures = false
    webView = view
    if let resourceURL { view.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL) }
    else { loading = false; pageError = "記事の画面を開けません。アプリを入れ直してください。" }
    return view
  }
  func tearDown() {
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "articles", contentWorld: .page)
    webView?.navigationDelegate = nil
    webView?.uiDelegate = nil
    webView = nil
  }
  func prepareToLeave(_ completion: @escaping (Bool) -> Void) {
    guard ready else { completion(!loading); return }
    webView?.callAsyncJavaScript("return await window.ArticlesApp.prepareToLeave();", arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let allowed): completion(allowed as? Bool == true)
      case .failure: self.pageError = "保存状態を確認できません。画面内の保存を再試行してください。"; completion(false)
      }
    }
  }
  func suspend() {
    webView?.endEditing(true)
    persist()
  }
  private var lastRequest: UUID?
  func apply(_ request: CampusArticleRequest) {
    guard lastRequest != request.id else { return }
    lastRequest = request.id
    setCourseContext(courseID: request.courseID, title: request.title)
  }
  func persist() {
    guard ready else { return }
    webView?.callAsyncJavaScript("return await window.ArticlesApp.persist();", arguments: [:], in: nil, in: .page, completionHandler: nil)
  }
  private var pendingCourse: (String, String)?
  private var currentCourse: (String, String)?
  func setCourseContext(courseID: String, title: String) {
    currentCourse = (courseID, title)
    pendingCourse = (courseID, title)
    guard ready else { return }
    pendingCourse = nil
    webView?.callAsyncJavaScript("return await window.ArticlesApp.setCourseContext(courseID, title);", arguments: ["courseID": courseID, "title": title], in: nil, in: .page) { result in
      if case .success(let applied) = result, applied as? Bool == true { return }
      self.pageError = "下書きを保持しています。文字変換や画像処理を完了し、保存してから講義の記事を開き直してください。"
    }
  }
  private var imageBackground = CampusAppearance.shared.hasBackground
  func setBackground(_ enabled: Bool) {
    imageBackground = enabled
    guard ready else { return }
    webView?.callAsyncJavaScript("document.documentElement.dataset.campusBackground = enabled ? 'image' : 'solid';", arguments: ["enabled": enabled], in: nil, in: .page, completionHandler: nil)
  }
  private var pendingTheme: String?
  func setTheme(_ value: String) {
    pendingTheme = value
    guard ready else { return }
    webView?.callAsyncJavaScript("window.ArticlesApp.applyTheme(value, false);", arguments: ["value": value], in: nil, in: .page, completionHandler: nil)
  }
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard message.frameInfo.isMainFrame,
      message.frameInfo.request.url?.standardizedFileURL == resourceURL?.standardizedFileURL,
      let payload = message.body as? [String: Any], let action = payload["action"] as? String else {
      replyHandler(nil, "許可されていない操作です。"); return
    }
    switch action {
    case "copy":
      guard let text = payload["value"] as? String, text.unicodeScalars.count <= 500000 else { replyHandler(nil, "本文を確認できません。"); return }
      UIPasteboard.general.string = text
      replyHandler(true, nil)
    case "theme":
      guard let value = payload["value"] as? String, ["green", "blue", "rose", "mono"].contains(value) else { replyHandler(nil, "テーマを確認できません。"); return }
      if let theme = CampusTheme(rawValue: value) { CampusAppearance.shared.select(theme) }
      replyHandler(true, nil)
    case "load":
      queue.async { [store] in
        do {
          let result: Any = try store.load().map { try JSONSerialization.jsonObject(with: $0) } ?? NSNull()
          DispatchQueue.main.async { replyHandler(result, nil) }
        } catch { DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) } }
      }
    case "save":
      guard let record = payload["record"] as? [String: Any], let revision = payload["revision"] as? Int, revision >= 0 else { replyHandler(nil, "保存内容を確認できません。"); return }
      let force = payload["force"] as? Bool == true
      queue.async { [store] in
        do {
          let data = try JSONSerialization.data(withJSONObject: record, options: .withoutEscapingSlashes)
          try store.save(data, revision: revision, replacingUnreadable: force)
          DispatchQueue.main.async { replyHandler(true, nil) }
        } catch { DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) } }
      }
    default: replyHandler(nil, "許可されていない操作です。")
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    webView.callAsyncJavaScript("return !!window.ArticlesApp && document.getElementById('article-content').childElementCount > 0;", arguments: [:], in: nil, in: .page) { result in
      self.loading = false
      guard case .success(let initialized) = result, initialized as? Bool == true else {
        self.ready = false
        self.canReload = true
        self.pageError = "記事の画面を準備できませんでした。保存済みの内容から再読み込みできます。"
        return
      }
      self.ready = true
      self.pageError = nil
      self.canReload = false
      Logger(subsystem: "jp.personal.CampusPocket", category: "Articles").info("Article document initialized")
      self.setBackground(self.imageBackground)
      self.setTheme(self.pendingTheme ?? CampusAppearance.shared.theme.rawValue)
      if let pendingCourse = self.pendingCourse { self.setCourseContext(courseID: pendingCourse.0, title: pendingCourse.1) }
    }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    ready = false; loading = false; canReload = true
    pageError = "記事を読み込めませんでした。保存済みの下書きから再読み込みできます。"
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    ready = false; loading = false; canReload = true
    pageError = "記事の画面でエラーが発生しました。保存済みの内容から再読み込みできます。未保存の変更は復元できない場合があります。"
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    ready = false; loading = false; canReload = true
    pageError = "記事の画面が終了しました。保存済みの下書きから再読み込みできます。未保存の変更は失われた可能性があります。"
  }
  func reloadSavedContent() {
    guard canReload, let webView, let resourceURL else { return }
    ready = false; loading = true; canReload = false
    pageError = nil
    pendingCourse = currentCourse
    // A restarted JavaScript editor begins a new revision domain. The same serial queue
    // drains any already-submitted writes before the new document loads its archive.
    store = ArticleDraftStore(url: store.url)
    webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL)
  }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if navigationAction.request.url?.standardizedFileURL == resourceURL?.standardizedFileURL,
      navigationAction.navigationType == .other { decisionHandler(.allow); return }
    if navigationAction.navigationType == .linkActivated, let value = navigationAction.request.url?.absoluteString,
      let url = ArticleDraftStore.safeExternalURL(value) { UIApplication.shared.open(url) }
    decisionHandler(.cancel)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    // target=_blank is handled by the same user-activated URL policy; no embedded browser is created.
    return nil
  }
}

/// SwiftUI owns a fresh container, while the session owns exactly one editor.
/// Returning the shared WKWebView itself from makeUIView lets an outgoing tab host
/// remove the same UIKit view that an incoming host has just adopted.
private struct ArticleWebSurface: UIViewRepresentable {
  let session: ArticlesSession
  let active: Bool
  func makeUIView(context: Context) -> ArticleWebHost { ArticleWebHost(session: session, active: active) }
  func updateUIView(_ host: ArticleWebHost, context: Context) { host.active = active; host.attachIfVisible() }
  static func dismantleUIView(_ host: ArticleWebHost, coordinator: ()) { host.active = false }
}
private final class ArticleWebHost: UIView {
  private let session: ArticlesSession
  var active: Bool
  private var edges: [NSLayoutConstraint] = []
  init(session: ArticlesSession, active: Bool) {
    self.session = session
    self.active = active
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
    Logger(subsystem: "jp.personal.CampusPocket", category: "Articles").info("Attached article editor to visible host")
  }
}
