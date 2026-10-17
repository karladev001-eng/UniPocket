import Foundation

/// A single atomic archive contains Markdown, metadata and all image bytes. Separate from notes/data.json.
/// Call from one serial queue; revisions are scoped to the lifetime of this store.
public final class ArticleDraftStore: @unchecked Sendable {
  public enum Failure: Error, LocalizedError {
    case invalidArchive, unreadableOriginal, staleRevision
    public var errorDescription: String? {
      switch self {
      case .invalidArchive: return "下書きの本文または添付画像を確認できません。"
      case .unreadableOriginal: return "元の下書きを保護しています。読み込みを再試行してください。"
      case .staleRevision: return "新しい編集があるため古い保存を取り消しました。"
      }
    }
  }
  public let url: URL
  private let lock = NSLock()
  private var protectedOriginal = false
  private var latestRevision = -1
  public init(url: URL) { self.url = url }

  public func load() throws -> Data? {
    lock.lock(); defer { lock.unlock() }
    do {
      let data = try Data(contentsOf: url)
      try Self.validate(data)
      protectedOriginal = false
      return data
    } catch {
      let failure = error as NSError
      if failure.domain == NSCocoaErrorDomain && failure.code == NSFileReadNoSuchFileError {
        protectedOriginal = false
        return nil
      }
      protectedOriginal = true
      throw error
    }
  }
  public func save(_ data: Data, revision: Int, replacingUnreadable: Bool = false) throws {
    lock.lock(); defer { lock.unlock() }
    guard revision >= latestRevision else { throw Failure.staleRevision }
    try Self.validate(data)
    if protectedOriginal && !replacingUnreadable { throw Failure.unreadableOriginal }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if protectedOriginal || (replacingUnreadable && FileManager.default.fileExists(atPath: url.path)) {
      // Explicit replacement keeps a recoverable original even if the final atomic write fails.
      try FileManager.default.copyItem(at: url, to: url.deletingLastPathComponent()
        .appendingPathComponent("draft-recovery-\(UUID().uuidString).json"))
    }
    try data.write(to: url, options: .atomic)
    protectedOriginal = false
    latestRevision = revision
  }

  public static func safeExternalURL(_ value: String) -> URL? {
    guard let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
      let host = components.host, !host.isEmpty, components.user == nil, components.password == nil,
      let url = components.url else { return nil }
    return url
  }

  public static func validate(_ data: Data) throws {
    guard data.count <= 64 * 1024 * 1024,
      let record = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let schema = record["schema"] as? Int, [3, 4].contains(schema),
      let draft = record["draft"] as? [String: Any],
      ["学生生活", "学び", "サークル"].contains(draft["category"] as? String ?? "") else { throw Failure.invalidArchive }
    for (key, max) in [("title", 80), ("author", 20), ("summary", 140)] {
      guard let value = draft[key] as? String, value.unicodeScalars.count <= max else { throw Failure.invalidArchive }
    }
    var images: [[String: Any]] = []
    if let image = draft["cover"] as? [String: Any] { images.append(image) }
    if schema == 4 {
      guard let body = draft["body"] as? String, let attachments = draft["attachments"] as? [[String: Any]],
        attachments.count <= 8 else { throw Failure.invalidArchive }
      let limit = draft["bodyLimit"] as? Int ?? 10000
      guard limit >= 10000, limit <= 500000, body.unicodeScalars.count <= limit else { throw Failure.invalidArchive }
      var ids = Set<String>()
      for attachment in attachments {
        guard let id = attachment["id"] as? String,
          id.range(of: "^attachment-[0-9]+$", options: .regularExpression) != nil,
          ids.insert(id).inserted, let image = attachment["image"] as? [String: Any] else { throw Failure.invalidArchive }
        images.append(image)
      }
    } else {
      guard let blocks = draft["blocks"] as? [[String: Any]], blocks.count <= 40 else { throw Failure.invalidArchive }
      images += blocks.compactMap { $0["image"] as? [String: Any] }
      guard images.count <= 9 else { throw Failure.invalidArchive }
    }
    var total = 0
    for image in images {
      if image["sample"] as? Bool == true {
        guard ["window", "notes", "walk"].contains(image["art"] as? String ?? "") else { throw Failure.invalidArchive }
        continue
      }
      guard let encoded = image["base64"] as? String, let bytes = Data(base64Encoded: encoded),
        !bytes.isEmpty, bytes.count <= 20 * 1024 * 1024,
        image["size"] as? Int == bytes.count,
        let type = image["type"] as? String,
        ["image/jpeg", "image/png", "image/webp"].contains(type),
        let width = image["width"] as? Int, let height = image["height"] as? Int,
        width > 0, height > 0, width <= 2048, height <= 2048,
        let originalWidth = image["originalWidth"] as? Int,
        let originalHeight = image["originalHeight"] as? Int,
        originalWidth > 0, originalHeight > 0,
        originalWidth <= 24000000, originalHeight <= 24000000,
        originalWidth <= 24000000 / originalHeight else { throw Failure.invalidArchive }
      let b = [UInt8](bytes.prefix(12))
      let valid = type == "image/jpeg" ? b.starts(with: [255,216,255])
        : type == "image/png" ? b.starts(with: [137,80,78,71,13,10,26,10])
        : b.count >= 12 && Array(b[0..<4]) == [82,73,70,70] && Array(b[8..<12]) == [87,69,66,80]
      guard valid else { throw Failure.invalidArchive }
      total += bytes.count
    }
    guard total <= 40 * 1024 * 1024 else { throw Failure.invalidArchive }
  }
}
