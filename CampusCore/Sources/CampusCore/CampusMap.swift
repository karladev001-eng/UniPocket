import Foundation

/// Coordinates use the north-up overview's viewBox, never the original PDF coordinate system.
public struct CampusBuilding: Codable, Identifiable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var category: String
  public var short: String
  public var mapCenter: [Double]
  public var mapPolygon: [[Double]]
  public var aliases: [String]
}

public struct CampusRoomAlias: Codable, Equatable, Sendable {
  public var id: String
  public var buildingID: String
  public var aliases: [String]
}

public enum CampusLocationResolution: Equatable, Sendable {
  case matched(String)
  case missing
  case online
  case unknown
  case ambiguous([String])

  public var buildingID: String? {
    if case .matched(let id) = self { return id }
    return nil
  }
}

/// The bundled campus map catalog: buildings and room aliases used to resolve event locations.
public struct CampusMapCatalog: Codable, Sendable {
  public var sourceDate: String
  public var orientation: String
  public var viewBox: [Double]
  public var accuracy: String
  public var buildings: [CampusBuilding]
  public var roomAliases: [CampusRoomAlias]

  public static let bundled: Result<CampusMapCatalog, Error> = Result {
    guard let url = Bundle.module.url(forResource: "campus-map-catalog", withExtension: "json") else {
      throw CatalogError.missingResource
    }
    let catalog = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    try catalog.validate()
    return catalog
  }

  public static var overviewURL: URL? {
    Bundle.module.url(forResource: "campus-map-overview", withExtension: "png")
  }

  public enum CatalogError: Error { case missingResource, invalidCatalog }

  public func validate() throws {
    let ids = Set(buildings.map(\.id))
    guard !buildings.isEmpty, ids.count == buildings.count,
      viewBox.count == 4, viewBox[0] == 0, viewBox[1] == 0,
      viewBox[2] > 0, viewBox[3] > 0,
      buildings.allSatisfy({ b in
        !b.name.isEmpty && b.mapCenter.count == 2 && inBounds(b.mapCenter)
          && (b.mapPolygon.isEmpty || b.mapPolygon.count >= 3)
          && b.mapPolygon.allSatisfy(inBounds)
      }), roomAliases.allSatisfy({ ids.contains($0.buildingID) })
    else { throw CatalogError.invalidCatalog }
  }

  private func inBounds(_ point: [Double]) -> Bool {
    point.count == 2 && point[0].isFinite && point[1].isFinite
      && point[0] >= 0 && point[0] <= viewBox[2]
      && point[1] >= 0 && point[1] <= viewBox[3]
  }

  public func building(_ id: String?) -> CampusBuilding? {
    buildings.first { $0.id == id }
  }

  /// Full-width forms, whitespace and common dash variants normalize; aliases still match exactly.
  /// No numeric prefix or substring inference is used for unregistered rooms.
  public static func normalized(_ value: String) -> String {
    let folded = value.precomposedStringWithCompatibilityMapping
      .folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "ja_JP"))
    return String(folded.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) })
      .replacingOccurrences(of: "[‐‑‒–—―−ー]", with: "-", options: .regularExpression)
  }

  public func resolve(_ location: String) -> CampusLocationResolution {
    let key = Self.normalized(location)
    guard !key.isEmpty else { return .missing }
    if key.contains("オンライン") || key.hasPrefix("https:") || key.hasPrefix("http:")
      || ["zoom", "teams", "microsoftteams", "webex", "遠隔", "オンデマンド"].contains(key) {
      return .online
    }
    var index: [String: Set<String>] = [:]
    for b in buildings {
      // Numeric facility IDs are offered through search, but are not interpreted as room locations.
      for name in [b.name, b.short].filter({ Int($0) == nil }) + b.aliases {
        index[Self.normalized(name), default: []].insert(b.id)
      }
    }
    for room in roomAliases {
      for name in [room.id] + room.aliases {
        index[Self.normalized(name), default: []].insert(room.buildingID)
      }
    }
    func result(_ ids: Set<String>) -> CampusLocationResolution {
      ids.count == 1 ? .matched(ids.first!) : .ambiguous(ids.sorted())
    }
    if let ids = index[key] { return result(ids) }
    let parts = location.components(separatedBy: CharacterSet(charactersIn: "/／、,，;；\n"))
      .map(Self.normalized).filter { !$0.isEmpty }
    if parts.count > 1 {
      var candidates = Set<String>()
      for part in parts {
        guard let ids = index[part] else { return .unknown }
        candidates.formUnion(ids)
      }
      return result(candidates)
    }
    return .unknown
  }

  public func search(_ query: String) -> [CampusBuilding] {
    let key = Self.normalized(query)
    guard !key.isEmpty else { return buildings }
    let roomIDs = Set(roomAliases.filter { ([ $0.id ] + $0.aliases).contains {
      Self.normalized($0).contains(key)
    }}.map(\.buildingID))
    return buildings.filter { b in
      roomIDs.contains(b.id) || ([b.id, b.name, b.short, b.category] + b.aliases).contains {
        Self.normalized($0).contains(key)
      }
    }
  }
}
