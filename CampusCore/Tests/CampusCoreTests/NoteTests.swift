import Foundation
import Testing
@testable import CampusCore

struct NoteTests {
  @Test func legacyNotesKeepIdentityImagesAndPinnedOrder() throws {
    var first = Note()
    first.text = "旧タイトル\n変えない本文"
    first.images = [ImageAttachment(filename: "existing.png", width: 30, height: 20, format: "png")]
    let second = Note()
    var data = AppData()
    data.notes = [first, second]
    data.pinnedNoteIDs = [second.id, first.id]
    let encoded = try JSONEncoder().encode(data)
    var object = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
    var notes = object["notes"] as! [[String: Any]]
    for i in notes.indices { notes[i].removeValue(forKey: "color"); notes[i].removeValue(forKey: "checklist") }
    object["notes"] = notes
    let decoded = try JSONDecoder().decode(AppData.self, from: JSONSerialization.data(withJSONObject: object))
    #expect(decoded.notes == data.notes)
    #expect(decoded.pinnedNoteIDs == [second.id, first.id])
    #expect(decoded.notes[0].title == "旧タイトル")
    #expect(decoded.notes[0].color == .default)
    #expect(decoded.notes[0].checklist.isEmpty)
    try decoded.validate()
  }
  @Test func checklistEditsColorsSearchAndDiskRoundTrip() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("data.json")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    var n = Note()
    n.text = "明日の持ちもの\n午前の実験"
    n.color = .yellow
    n.checklist = [NoteChecklistItem(text: "学生証"), NoteChecklistItem(text: "USBメモリ")]
    let identity = n.checklist[0].id
    n.checklist[0].isCompleted = true
    n.checklist[0].text = "予備の学生証"
    n.checklist.removeLast()
    #expect(n.checklist[0].id == identity)
    #expect(n.matches("学生証"))
    #expect(n.matches("実験"))
    #expect(!n.matches("該当なし"))
    #expect(n.title == "明日の持ちもの")
    var data = AppData()
    data.notes = [n]
    data.pinnedNoteIDs = [n.id]
    try JSONStore(url: url).save(data)
    let reloaded = try JSONStore(url: url).load()
    #expect(reloaded == data)
    #expect(reloaded.notes[0].checklist[0].isCompleted)
    for color in NoteColor.allCases {
      n.color = color
      #expect(try JSONDecoder().decode(Note.self, from: JSONEncoder().encode(n)) == n)
    }
  }
  @Test func emptyContentAndChecklistIdentityValidation() throws {
    var n = Note()
    n.text = "  \n "
    n.checklist = [NoteChecklistItem(text: " ")]
    #expect(n.isEmpty)
    n.checklist[0].text = "買い物"
    #expect(!n.isEmpty)
    #expect(n.title == "  ") // Existing first-line semantics remain intact.
    n.text = ""
    #expect(n.title == "買い物")
    var data = AppData()
    n.checklist.append(n.checklist[0])
    data.notes = [n]
    #expect(throws: JSONStore.StoreError.self) { try data.validate() }
  }
}
