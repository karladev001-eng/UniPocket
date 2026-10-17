import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

public enum BackgroundImageError: LocalizedError {
  case tooLarge, dimensions, unsupported, invalid, unreadable
  public var errorDescription: String? {
    switch self {
    case .tooLarge: "画像は40MiB以下を選んでください。"
    case .dimensions: "画像の縦・横は20,000px以下を選んでください。"
    case .unsupported: "JPEG・PNG・HEICの静止画を選んでください。"
    case .invalid: "画像を読み込めません。別の画像で再試行してください。"
    case .unreadable: "保存した背景画像を読み込めないため、無地で表示しています。画像を選び直すか、無地に戻してください。"
    }
  }
}

/// Synchronous primitives; the app calls them exclusively on its serial appearance worker.
/// One atomic JPEG is the entire background setting, independent of data.json.
public struct BackgroundImageStore: Sendable {
  public static let maximumBytes = 40 * 1024 * 1024
  public static let maximumDimension = 20_000
  public static let displayDimension = 2_560
  public let url: URL
  public init(url: URL) { self.url = url }

  public static func readInput(_ url: URL) throws -> Data {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    // A provider's declared size is not trusted. Never read an unbounded file into memory.
    let bytes = try file.read(upToCount: maximumBytes + 1) ?? Data()
    guard bytes.count <= maximumBytes else { throw BackgroundImageError.tooLarge }
    return bytes
  }

  public static func prepare(_ bytes: Data) throws -> Data {
    guard bytes.count <= maximumBytes else { throw BackgroundImageError.tooLarge }
    guard let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
      let type = CGImageSourceGetType(source) as String?,
      [UTType.jpeg.identifier, UTType.png.identifier, UTType.heic.identifier].contains(type),
      CGImageSourceGetCount(source) == 1 else { throw BackgroundImageError.unsupported }
    guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = props[kCGImagePropertyPixelWidth] as? Int,
      let height = props[kCGImagePropertyPixelHeight] as? Int, width > 0, height > 0 else { throw BackgroundImageError.invalid }
    guard width <= maximumDimension, height <= maximumDimension else { throw BackgroundImageError.dimensions }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: displayDimension,
      kCGImageSourceShouldCacheImmediately: true]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw BackgroundImageError.invalid }
    // Flatten transparent PNGs onto white so JPEG has a predictable, opaque appearance.
    guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw BackgroundImageError.invalid }
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let flattened = context.makeImage() else { throw BackgroundImageError.invalid }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw BackgroundImageError.invalid }
    CGImageDestinationAddImage(destination, flattened, [kCGImageDestinationLossyCompressionQuality: 0.85, kCGImagePropertyOrientation: 1] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw BackgroundImageError.invalid }
    return output as Data
  }

  public func load() throws -> Data? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    do {
      let bytes = try Self.readInput(url)
      guard let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
        CGImageSourceGetType(source) as String? == UTType.jpeg.identifier, CGImageSourceGetCount(source) == 1,
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = props[kCGImagePropertyPixelWidth] as? Int, let height = props[kCGImagePropertyPixelHeight] as? Int,
        width > 0, height > 0, width <= Self.displayDimension, height <= Self.displayDimension else { throw BackgroundImageError.unreadable }
      return bytes
    } catch { throw BackgroundImageError.unreadable }
  }
  public func save(_ derivedJPEG: Data) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try derivedJPEG.write(to: url, options: .atomic)
  }
  public func reset() throws {
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }
}
