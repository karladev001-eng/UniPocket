import Foundation
import Testing
@testable import CampusCore

struct ArticleDraftTests {
  private func archive(body: String = "## 本文\n\n原文  \r\n![](attachment:attachment-1)", withImage: Bool = true) throws -> Data {
    let image: [String: Any] = ["sample": false, "type": "image/png", "size": 8,
      "base64": Data([137,80,78,71,13,10,26,10]).base64EncodedString(), "width": 1,
      "height": 1, "originalWidth": 1, "originalHeight": 1, "originalSize": 8]
    return try JSONSerialization.data(withJSONObject: ["schema": 4, "savedAt": 123,
      "draft": ["title": "原文", "author": "筆者", "summary": "概要", "category": "学び",
        "body": body, "bodyLimit": max(10000, body.unicodeScalars.count), "coverCaption": "",
        "cover": NSNull(), "attachments": withImage ? [["id": "attachment-1", "caption": "", "image": image]] : []]])
  }
  @Test func atomicTextAndImageRoundtripAndStaleSave() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("Articles/draft.json"), store = ArticleDraftStore(url: url)
    #expect(try store.load() == nil)
    let first = try archive(), newer = try archive(body: "新しい本文")
    try store.save(first, revision: 1)
    #expect(try ArticleDraftStore(url: url).load() == first)
    try store.save(newer, revision: 3)
    #expect(throws: ArticleDraftStore.Failure.self) { try store.save(first, revision: 2) }
    #expect(try store.load() == newer)
    let impossible = ArticleDraftStore(url: url.appendingPathComponent("draft.json"))
    #expect(throws: (any Error).self) { try impossible.save(first, revision: 1) }
    #expect(try Data(contentsOf: url) == newer)
  }
  @Test func failedReadPreservesOriginalAndExplicitReplacementKeepsRecovery() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let url = root.appendingPathComponent("draft.json"), invalid = Data("corrupted original".utf8)
    try invalid.write(to: url)
    let store = ArticleDraftStore(url: url), valid = try archive()
    #expect(throws: (any Error).self) { try store.load() }
    #expect(throws: ArticleDraftStore.Failure.self) { try store.save(valid, revision: 1) }
    #expect(try Data(contentsOf: url) == invalid)
    try store.save(valid, revision: 1, replacingUnreadable: true)
    #expect(try store.load() == valid)
    let recovery = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix("draft-recovery-") }
    #expect(recovery != nil)
    #expect(try Data(contentsOf: #require(recovery)) == invalid)
  }
  @Test func invalidImageAndArchiveCannotReplaceSavedData() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = ArticleDraftStore(url: root.appendingPathComponent("draft.json")), valid = try archive()
    try store.save(valid, revision: 1)
    var object = try #require(JSONSerialization.jsonObject(with: valid) as? [String: Any])
    var draft = try #require(object["draft"] as? [String: Any])
    draft["attachments"] = [["id": "attachment-1", "image": ["sample": false, "base64": "bad"]]]
    object["draft"] = draft
    let invalid = try JSONSerialization.data(withJSONObject: object)
    #expect(throws: ArticleDraftStore.Failure.self) { try store.save(invalid, revision: 2) }
    #expect(try store.load() == valid)
    try ArticleDraftStore.validate(archive(body: String(repeating: "文", count: 12000), withImage: false))
  }
  @Test func maximumImageBudgetFitsAtomicEnvelopeWithoutSlashExpansion() throws {
    var bytes = Data(repeating: 255, count: 20 * 1024 * 1024)
    bytes[0] = 255; bytes[1] = 216; bytes[2] = 255
    let image: [String: Any] = ["sample": false, "type": "image/jpeg", "size": bytes.count,
      "base64": bytes.base64EncodedString(), "width": 2048, "height": 1024,
      "originalWidth": 2048, "originalHeight": 1024, "originalSize": bytes.count]
    let record: [String: Any] = ["schema": 4, "draft": ["title": "", "author": "", "summary": "",
      "category": "学び", "body": String(repeating: "😀", count: 500000), "bodyLimit": 500000,
      "cover": image, "coverCaption": "", "attachments": [["id": "attachment-1", "caption": "", "image": image]]]]
    let encoded = try JSONSerialization.data(withJSONObject: record, options: .withoutEscapingSlashes)
    #expect(encoded.count < 64 * 1024 * 1024)
    try ArticleDraftStore.validate(encoded)
    print("記事最大保存: 画像40MiB＋本文50万codepoints → \(encoded.count) bytes")
  }
  @Test func externalURLAllowlist() {
    for value in ["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "https://user:password@example.com", "https:///", "//example.com"] {
      #expect(ArticleDraftStore.safeExternalURL(value) == nil)
    }
    #expect(ArticleDraftStore.safeExternalURL("https://example.com/path?q=a")?.host == "example.com")
    #expect(ArticleDraftStore.safeExternalURL("http://example.com") != nil)
  }
}
