import CampusCore
import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  @State private var timetable: URL?
  @State private var schedule: URL?
  @State private var picking = false
  @State private var pickingTimetable = true
  @State private var busy = false
  @State private var preview: ImportPlan?
  @State private var failure: String?
  @State private var choices: [String: ConflictChoice] = [:]
  var body: some View {
    NavigationStack {
      List {
        Section("2つのPDFを選択") {
          Text("学務の履修登録確認票（後期）と、同年度の年間行事予定表を選びます。ファイルを端末内で解析します。氏名・学籍番号・単位表・原本PDFは保存しません。").font(
            .subheadline)
          Button {
            pickingTimetable = true
            picking = true
          } label: {
            Label(
              timetable == nil ? "履修登録確認票を選択" : "履修登録確認票：選択済み",
              systemImage: timetable == nil ? "doc" : "checkmark.circle")
          }.disabled(busy)
          Button {
            pickingTimetable = false
            picking = true
          } label: {
            Label(
              schedule == nil ? "年間行事予定表を選択" : "年間行事予定表：選択済み",
              systemImage: schedule == nil ? "doc" : "checkmark.circle")
          }.disabled(busy)
          Button("解析してプレビュー") { analyze() }.disabled(timetable == nil || schedule == nil || busy)
          if busy { ProgressView("端末でPDFを解析中…") }
          if let failure { Text(failure).foregroundStyle(.red).font(.subheadline) }
        }
        if let preview {
          Section("取り込みプレビュー") {
            Text("\(String(preview.year))年度 後期・浜松").font(.headline)
            Text(
              "通常講義 \(preview.courses.filter{$0.weekday != nil}.count)科目 / 時間未定 \(preview.courses.filter{$0.weekday == nil}.count)科目"
            )
            Text(
              "授業 \(preview.events.filter{$0.kind == "class"}.count)件 / 試験候補 \(preview.events.filter{$0.kind == "exam"}.count)件 / 大学行事 \(preview.events.filter{$0.kind == "university"}.count)件"
            )
            Text(
              "差分：追加 \(model.data.difference(preview).filter{$0.before==nil}.count)、変更 \(model.data.difference(preview).filter{$0.before != nil && $0.after != nil}.count)、削除 \(model.data.difference(preview).filter{$0.after==nil}.count)"
            ).font(.caption)
            ForEach(preview.courses) { c in
              VStack(alignment: .leading) {
                Text(c.title)
                Text("\(c.slot) \(c.room)").font(.caption).foregroundStyle(.secondary)
              }
            }
          }
          Section("差分と個人修正の競合") {
            ForEach(model.data.difference(preview)) { d in
              VStack(alignment: .leading) {
                Text("\(d.label)：\((d.after ?? d.before)!.title)")
                if let before = d.before {
                  Text(
                    "旧 \(Tokyo.dayKey(before.start)) \(Tokyo.time(before.start))–\(Tokyo.time(before.end)) \(before.location)"
                  ).font(.caption)
                }
                if let after = d.after {
                  Text(
                    "新 \(Tokyo.dayKey(after.start)) \(Tokyo.time(after.start))–\(Tokyo.time(after.end)) \(after.location)"
                  ).font(.caption)
                }
                if d.conflict {
                  Text("個人修正と競合：選択が必要です").font(.caption).foregroundStyle(.orange)
                  Picker(
                    "解決",
                    selection: Binding(
                      get: { choices[d.id]?.rawValue ?? "" },
                      set: { choices[d.id] = ConflictChoice(rawValue: $0) })
                  ) {
                    Text("未選択").tag("")
                    Text("個人修正と旧原本を保持").tag("personal")
                    Text("この回に新PDFを採用").tag("pdf")
                  }
                }
              }
            }
            if model.data.difference(preview).isEmpty { Text("原本の差分はありません。個人修正は保持します。") }
          }
          Section("取り込み前の確認") {
            ForEach(preview.warnings, id: \.self) { Text($0).font(.caption) }
            Button("この内容を端末に取り込む") {
              busy = true
              Task {
                do {
                  try await model.install(preview, choices: choices)
                  dismiss()
                } catch { failure = "保存できませんでした。既存の予定を保持しています。\(error.localizedDescription)" }
                busy = false
              }
            }.font(.headline).disabled(
              model.readOnly || busy
                || model.data.difference(preview).filter(\.conflict).contains {
                  choices[$0.id] == nil
                })
          }
          Section("生成する予定") {
            ForEach(preview.events) { event in
              VStack(alignment: .leading) {
                Text(event.start, format: .dateTime.year().month().day().weekday()).font(.caption)
                  .foregroundStyle(.secondary)
                EventRow(event: event, allowsMapNavigation: false)
              }
            }
          }
        }
      }.campusListStyle().navigationTitle("PDF取り込み").toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } }
      }
      .fileImporter(isPresented: $picking, allowedContentTypes: [.pdf]) { result in
        switch result {
        case .success(let url):
          if pickingTimetable { timetable = url } else { schedule = url }
          preview = nil
          choices = [:]
          failure = nil
        case .failure(let error): failure = "PDFを選択できませんでした。\(error.localizedDescription)"
        }
      }
    }
  }
  private func analyze() {
    guard let timetable, let schedule else { return }
    busy = true
    failure = nil
    preview = nil
    Task {
      let result = await Task.detached(priority: .userInitiated) {
        () -> Result<ImportPlan, Error> in
        let access1 = timetable.startAccessingSecurityScopedResource()
        let access2 = schedule.startAccessingSecurityScopedResource()
        defer {
          if access1 { timetable.stopAccessingSecurityScopedResource() }
          if access2 { schedule.stopAccessingSecurityScopedResource() }
        }
        return Result { try PDFImporter.preview(timetableURL: timetable, scheduleURL: schedule) }
      }.value
      busy = false
      switch result {
      case .success(let plan): preview = plan
      case .failure(let error): failure = error.localizedDescription
      }
    }
  }
}
