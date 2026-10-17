import Foundation
import Testing
@testable import CampusCore

struct CampusMapTests {
  @Test func bundledCatalogAndImageAlign() throws {
    let catalog = try CampusMapCatalog.bundled.get()
    try catalog.validate()
    #expect(catalog.buildings.count == 34)
    #expect(Set(catalog.buildings.map(\.id)).count == 34)
    #expect(catalog.sourceDate == "2026-04-01")
    #expect(catalog.orientation == "north-up")
    #expect(catalog.viewBox == [0, 0, 1118, 1364])
    #expect(catalog.buildings.filter { !$0.mapPolygon.isEmpty }.count == 32)
    #expect(Set(catalog.buildings.filter { $0.mapPolygon.isEmpty }.map(\.id)) == ["503", "901"])
    let image = try Data(contentsOf: #require(CampusMapCatalog.overviewURL))
    #expect(Array(image.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10])
    // The PNG aspect matches the north-up catalog used to place the overlay.
    func uint32(_ offset: Int) -> UInt32 {
      image[offset..<(offset + 4)].reduce(0) { ($0 << 8) | UInt32($1) }
    }
    #expect(abs(Double(uint32(16)) / Double(uint32(20)) - 1118.0 / 1364.0) < 0.001)
    #expect(catalog.roomAliases.count == 42)
    for room in catalog.roomAliases {
      #expect(catalog.building(room.buildingID) != nil)
      for alias in [room.id] + room.aliases {
        #expect(catalog.resolve(alias) == .matched(room.buildingID))
      }
    }
    for building in catalog.buildings {
      #expect(catalog.resolve(building.name) == .matched(building.id))
      #expect(catalog.search(building.id).contains { $0.id == building.id })
    }
  }

  @Test func knownAliasesAndUnicode() throws {
    let c = try CampusMapCatalog.bundled.get()
    for location in ["工2-31", " 工２－３１　", "工2−31", "工２—３１", "2-31", "工2‐31", "工 2 - 31"] {
      #expect(c.resolve(location) == .matched("202"))
    }
    #expect(c.resolve("工２－２１") == .matched("202"))
    #expect(c.resolve("共通講義棟５１") == .matched("811"))
    #expect(c.resolve("共５１") == .matched("811"))
    #expect(c.resolve("Ｓ－Ｐｏｒｔ") == .matched("701"))
    #expect(c.resolve("附属図書館浜松分館・学生支援棟 S-Port") == .matched("701"))
    #expect(c.search("工２－３１").map(\.id) == ["202"])
    #expect(c.search("Ｓ－ＰＯＲＴ").map(\.id) == ["701"])
    #expect(c.search("存在しない場所").isEmpty)
  }

  @Test func unresolvedDoesNotGuessOrRetainPreviousBuilding() throws {
    let c = try CampusMapCatalog.bundled.get()
    #expect(c.resolve("\n　 ") == .missing)
    for location in ["オンライン", "オンライン（工2-31）", "Zoom", "Microsoft Teams", "https://example.com/工2-31"] {
      #expect(c.resolve(location) == .online)
      #expect(c.resolve(location).buildingID == nil)
    }
    for location in ["工2-99", "工99-31", "工2-310", "工2-31付近", "未定", "202", "31", "工2-31/不明"] {
      #expect(c.resolve(location) == .unknown)
      #expect(c.resolve(location).buildingID == nil)
    }
    #expect(c.resolve("工2-31／工3-31") == .ambiguous(["202", "203"]))
    #expect(c.resolve("工2-31、工2-21") == .matched("202"))
    // Separate calls carry no selection state, including after an edited location becomes unknown.
    #expect(c.resolve("工2-31").buildingID == "202")
    #expect(c.resolve("未知の教室").buildingID == nil)
    #expect(c.resolve("工3-31").buildingID == "203")
    var conflicting = c
    conflicting.roomAliases.append(CampusRoomAlias(id: "工2-31", buildingID: "203", aliases: []))
    #expect(conflicting.resolve("工２－３１") == .ambiguous(["202", "203"]))
    #expect(conflicting.resolve("工２－３１").buildingID == nil)
  }

  @Test func invalidCatalogIsRejected() throws {
    let c = try CampusMapCatalog.bundled.get()
    var duplicate = c
    duplicate.buildings.append(c.buildings[0])
    #expect(throws: CampusMapCatalog.CatalogError.self) { try duplicate.validate() }
    var orphan = c
    orphan.roomAliases.append(CampusRoomAlias(id: "未登録", buildingID: "missing", aliases: []))
    #expect(throws: CampusMapCatalog.CatalogError.self) { try orphan.validate() }
    var badCoordinate = c
    badCoordinate.buildings[0].mapPolygon[0] = [99999, 0]
    #expect(throws: CampusMapCatalog.CatalogError.self) { try badCoordinate.validate() }
  }
}
