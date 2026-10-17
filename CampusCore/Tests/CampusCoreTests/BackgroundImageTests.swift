import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Testing
@testable import CampusCore

@Suite(.serialized) struct BackgroundImageTests {
  private func image(_ width: Int, _ height: Int, type: UTType = .png, orientation: Int = 1, frames: Int = 1) throws -> Data {
    let context = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: max(1, width / 2), height: height))
    let cg = try #require(context.makeImage())
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, type.identifier as CFString, frames, nil))
    for _ in 0..<frames { CGImageDestinationAddImage(destination, cg, [kCGImagePropertyOrientation: orientation] as CFDictionary) }
    #expect(CGImageDestinationFinalize(destination))
    return data as Data
  }
  private func dimensions(_ bytes: Data) throws -> (Int, Int, Int) {
    let source = try #require(CGImageSourceCreateWithData(bytes as CFData, nil))
    let p = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    return (try #require(p[kCGImagePropertyPixelWidth] as? Int), try #require(p[kCGImagePropertyPixelHeight] as? Int), p[kCGImagePropertyOrientation] as? Int ?? 1)
  }
  @Test func resizedAndOrientedDerivative() throws {
    let original = try image(3000, 1200)
    let derivative = try BackgroundImageStore.prepare(original)
    let size = try dimensions(derivative)
    #expect(size.0 == 2560 && size.1 == 1024 && size.2 == 1)
    #expect(try dimensions(original).0 == 3000)
    let rotated = try dimensions(BackgroundImageStore.prepare(image(40, 80, type: .jpeg, orientation: 6)))
    #expect(rotated.0 == 80 && rotated.1 == 40 && rotated.2 == 1)
    let boundary = try dimensions(BackgroundImageStore.prepare(image(20_000, 1)))
    #expect(boundary.0 <= 2560)
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(image(20_001, 1)) }
  }
  @Test func rejectsOversizedUnsupportedAnimatedAndInvalid() throws {
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(Data(count: BackgroundImageStore.maximumBytes + 1)) }
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(Data("not an image".utf8)) }
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(image(12, 12, type: .gif, frames: 2)) }
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(image(12, 12, type: .tiff)) }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("large.png")
    #expect(FileManager.default.createFile(atPath: url.path, contents: nil))
    let handle = try FileHandle(forWritingTo: url); try handle.truncate(atOffset: UInt64(BackgroundImageStore.maximumBytes + 1)); try handle.close()
    #expect(throws: (any Error).self) { try BackgroundImageStore.readInput(url) }
  }
  @Test func atomicPersistenceResetAndFailurePreservation() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = BackgroundImageStore(url: directory.appendingPathComponent("Appearance/background.jpg"))
    #expect(try store.load() == nil)
    let first = try BackgroundImageStore.prepare(image(60, 100))
    let second = try BackgroundImageStore.prepare(image(100, 60))
    try store.save(first); #expect(try store.load() == first)
    try store.save(second); #expect(try store.load() == second)
    #expect(throws: (any Error).self) { try BackgroundImageStore.prepare(Data()) }
    #expect(try store.load() == second)
    let broken = Data("broken saved image".utf8)
    try broken.write(to: store.url, options: .atomic)
    #expect(throws: (any Error).self) { try store.load() }
    #expect(try Data(contentsOf: store.url) == broken)
    try store.save(first); #expect(try store.load() == first)
    let blocked = directory.appendingPathComponent("blocker")
    try Data("keep".utf8).write(to: blocked)
    #expect(throws: (any Error).self) { try BackgroundImageStore(url: blocked.appendingPathComponent("background.jpg")).save(second) }
    #expect(try Data(contentsOf: blocked) == Data("keep".utf8))
    #expect(try store.load() == first)
    try store.reset(); #expect(try store.load() == nil); try store.reset()
  }
  @Test func transparentPNGBecomesOpaqueWhite() throws {
    let bytes = try BackgroundImageStore.prepare(image(20, 20))
    let source = try #require(CGImageSourceCreateWithData(bytes as CFData, nil))
    let cg = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    let context = try #require(CGContext(data: nil, width: 20, height: 20, bitsPerComponent: 8, bytesPerRow: 80,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.draw(cg, in: CGRect(x: 0, y: 0, width: 20, height: 20))
    let pixel = try #require(context.data).assumingMemoryBound(to: UInt8.self)
    let white = (10 * 20 + 18) * 4
    #expect(pixel[white] > 240 && pixel[white + 1] > 240 && pixel[white + 2] > 240 && pixel[white + 3] == 255)
  }
  @Test func installedStaticHEICDecodesWhenAvailable() throws {
    // macOS provides static HEIC desktop fixtures. This avoids relying on a hardware encoder
    // that may advertise HEIC but fail inside a sandbox. No system image is copied into the repo.
    let root = URL(fileURLWithPath: "/System/Library/Desktop Pictures")
    let urls = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
    for url in urls where url.pathExtension == "heic" {
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) == 1 else { continue }
      let result = try BackgroundImageStore.prepare(BackgroundImageStore.readInput(url))
      let size = try dimensions(result)
      #expect(size.0 <= 2560 && size.1 <= 2560 && size.2 == 1)
      print("Static HEIC decoding verified with installed macOS fixture: \(url.lastPathComponent)")
      return
    }
    print("Static HEIC fixture unavailable on this host; JPEG/PNG path covered, HEIC device QA remains.")
  }
}
