import CampusCore
import SwiftUI

struct AgendaView: View {
  @EnvironmentObject private var navigation: CampusNavigation
  @EnvironmentObject var model: AppModel
  @EnvironmentObject var calendar: CalendarModel
  @Environment(\.dynamicTypeSize) var typeSize
  @EnvironmentObject private var appearance: CampusAppearance
  @State private var overviewDay: Date?
  @State private var overviewPeriod: Int?
  @State var date = Date()
  @State var mode = 0
  @State var selected: CampusEvent?
  @State var dayList: Date?
  @State private var dayPath = NavigationPath()
  @State var importing = false
  @State var settings = false
  @State var courses = false
  @State var facility: FacilitySelection?
  var all: [CampusEvent] { calendar.combined(model.data) }
  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          CampusPageHeader(title: "時間割")
          Picker("表示", selection: $mode) {
            Text("週").tag(0)
            Text("月").tag(1)
            Text("日").tag(2)
          }.pickerStyle(.segmented).campusReadable()
          HStack(spacing: 6) {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("前へ")
            Spacer(minLength: 0)
            VStack(spacing: 3) {
              Text(date, format: .dateTime.year().month()).font(.headline)
              Text(mode == 0 ? "\(Tokyo.dayKey(Tokyo.week(date)[0])) からの週" : Tokyo.dayKey(date)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("今日") { date = Date() }.font(.caption).frame(minHeight: 44)
            Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.accessibilityLabel("次へ")
          }.campusReadable()
          Text(status(context.date)).font(.caption).foregroundStyle(.secondary).campusReadable()
          if mode == 1 {
            CampusCard {
              DatePicker("月の日付", selection: $date, displayedComponents: .date).datePickerStyle(.graphical)
            }
            selectedDayContent
          } else if typeSize.isAccessibilitySize {
            Text("大きい文字：日別一覧").font(.caption).campusReadable()
            DatePicker("日付", selection: $date, displayedComponents: .date).campusReadable()
            selectedDayContent
          } else if mode == 0 {
            weekOverview(now: context.date)
          } else {
            CampusCard { grid(now: context.date).frame(height: 540) }
            selectedDayContent
          }
          Text(calendar.displayMessage(on: date)).font(.caption).foregroundStyle(.secondary).campusReadable()
          if model.data.showBands {
            CampusCard {
              VStack(alignment: .leading, spacing: 8) {
                Label("選択日の営業時間", systemImage: "clock").font(.subheadline.weight(.medium))
                ForEach(model.data.facilities.filter(\.band)) { f in
                  Button { facility = FacilitySelection(facilityID: f.id, date: date) } label: {
                    HStack { Text(f.title); Spacer(minLength: 4); Text(f.label(on: date)).foregroundStyle(.secondary) }.font(.caption).frame(minHeight: 44)
                  }
                }
              }
            }
          }
          HStack(spacing: 18) {
            Button { courses = true } label: { Label("科目と修正", systemImage: "list.bullet") }
            Button { importing = true } label: { Label("PDF取込", systemImage: "doc.badge.plus") }
          }.font(.caption).frame(minHeight: 44).campusReadable()
        }.padding(.horizontal, 16).padding(.bottom, 24)
      }.campusBackground().navigationTitle("")
        .navigationBarTitleDisplayMode(.inline).toolbar {
          ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
              courses = true
            } label: {
              Image(systemName: "list.bullet")
            }.accessibilityLabel("科目と修正")
            Button {
              importing = true
            } label: {
              Image(systemName: "doc.badge.plus")
            }.accessibilityLabel("PDF取込")
            Button {
              settings = true
            } label: {
              Image(systemName: "gearshape")
            }.accessibilityLabel("表示とカレンダー設定")
          }
        }
    }.sheet(isPresented: $importing) { ImportView() }.sheet(isPresented: $settings) {
      CalendarSettingsView(date: date)
    }.sheet(isPresented: $courses, onDismiss: navigation.finishMapHandoff) {
      NavigationStack { CourseList() }
        .environment(\.showCampusLocation, { location in
          navigation.deferMap(location: location)
          courses = false
        })
    }.sheet(item: $dayList, onDismiss: navigation.finishMapHandoff) { d in
      NavigationStack(path: $dayPath) {
        DayEventList(date: d, events: all).campusEventDestinations().navigationTitle(Tokyo.dayKey(d)).toolbar {
          ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dayList = nil } }
        }
      }.environment(\.showCampusLocation, { location in
        navigation.deferMap(location: location)
        dayList = nil
      }).environment(\.showCampusArticles, { courseID, title in
        navigation.deferArticles(courseID: courseID, title: title, onReturn: { dayList = d })
        dayList = nil
      }).environment(\.showCampusBoard, { courseID, title in
        let returnPath = dayPath
        navigation.deferBoard(courseID: courseID, title: title, onReturn: {
          dayPath = returnPath
          dayList = d
        })
        dayList = nil
      })
    }.sheet(item: $facility) { selection in
      NavigationStack { FacilityEditor(id: selection.facilityID, date: selection.date).toolbar { Button("閉じる") { facility = nil } } }
    }.onChange(of: all) { _, events in
      if let id = selected?.id { selected = events.first { $0.id == id } }
    }.onChange(of: date) { _, d in
      selected = nil
      overviewDay = nil
      overviewPeriod = nil
      calendar.refresh(selected: model.data.selectedCalendarIDs, date: d)
    }.onChange(of: mode) { _, _ in selected = nil; overviewDay = nil; overviewPeriod = nil }.onAppear {
      calendar.refresh(selected: model.data.selectedCalendarIDs, date: date)
    }
  }
  private func openDay(_ day: Date) {
    dayPath = NavigationPath()
    dayList = day
  }
  private var selectedDayContent: some View {
    CampusCard {
      VStack(alignment: .leading, spacing: 12) {
        Text("選択日：\(Tokyo.dayKey(date))").font(.headline)
        let items = all.filter { $0.occurs(on: date) }
        if items.isEmpty { Text("この日のローカル予定はありません").font(.subheadline).foregroundStyle(.secondary) }
        ForEach(items) { e in EventNavigationRow(event: e); if e.id != items.last?.id { Divider() } }
      }
    }
  }
  private func weekOverview(now: Date) -> some View {
    let days = Array(Tokyo.week(date).prefix(5))
    return VStack(alignment: .leading, spacing: 12) {
      GeometryReader { geometry in
        ScrollView(.horizontal) {
        VStack(spacing: 7) {
          HStack(spacing: 5) {
            Color.clear.frame(width: 38, height: 44)
            ForEach(days, id: \.self) { day in
              Button { openDay(day) } label: {
                VStack(spacing: 3) {
                  Text(day, format: .dateTime.weekday(.narrow)).font(.caption2)
                  Text(day, format: .dateTime.day()).font(.subheadline.weight(.semibold))
                }.frame(maxWidth: .infinity, minHeight: 44)
                  .foregroundStyle(Tokyo.calendar.isDate(day, inSameDayAs: now) ? .white : appearance.theme.ink)
                  .background(Tokyo.calendar.isDate(day, inSameDayAs: now) ? appearance.theme.accent : .clear, in: RoundedRectangle(cornerRadius: 12))
              }.buttonStyle(.plain).accessibilityLabel("\(Tokyo.dayKey(day))の全予定")
            }
          }
          ForEach(1...5, id: \.self) { period in
            HStack(spacing: 5) {
              VStack(spacing: 3) {
                Text("\(period)").font(.subheadline.weight(.semibold))
                Text(clock(TimetablePresentation.periods[period - 1].start))
                Text(clock(TimetablePresentation.periods[period - 1].end))
              }.font(.system(size: 8)).foregroundStyle(.secondary).frame(width: 38)
              ForEach(days, id: \.self) { day in
                overviewCell(day: day, period: period)
              }
            }
          }
        }.padding(12).frame(width: max(320, geometry.size.width))
          .background(.white, in: RoundedRectangle(cornerRadius: 22))
        }.scrollIndicators(.hidden)
      }.frame(height: 573)
      Text("講義をタップして詳しく見る · 日付から全件へ").font(.caption2).foregroundStyle(.secondary).campusReadable()
      HStack(spacing: 8) {
        ForEach(Array(Tokyo.week(date).suffix(2)), id: \.self) { day in
          Button { openDay(day) } label: {
            HStack { Text(day, format: .dateTime.weekday()); Text("\(all.filter { $0.occurs(on: day) }.count)件"); Image(systemName: "chevron.right") }
              .font(.caption).frame(maxWidth: .infinity, minHeight: 44).background(appearance.theme.soft, in: RoundedRectangle(cornerRadius: 12))
          }.buttonStyle(.plain).accessibilityLabel("\(Tokyo.dayKey(day))の全予定")
        }
      }
      let extras = days.filter { !TimetablePresentation.additionalEvents(on: $0, events: all).isEmpty }
      if !extras.isEmpty {
        CampusCard {
          VStack(alignment: .leading, spacing: 4) {
            Text("この表のほかにも予定があります").font(.subheadline.weight(.medium))
            Text("終日・外部予定・短時間・6〜7コマ・変更した時刻は日別一覧で確認できます。").font(.caption2).foregroundStyle(.secondary)
            ForEach(extras, id: \.self) { day in
              Button { openDay(day) } label: {
                HStack { Text(day, format: .dateTime.month().day().weekday()); Spacer(); Text("追加 \(TimetablePresentation.additionalEvents(on: day, events: all).count)件"); Image(systemName: "chevron.right") }.font(.caption).frame(minHeight: 44)
              }.buttonStyle(.plain)
            }
          }
        }
      }
      if let selected {
        CampusCard {
          VStack(alignment: .leading, spacing: 8) {
            Text("選択中 · \(Tokyo.dayKey(selected.start))").font(.caption).foregroundStyle(.secondary)
            EventNavigationRow(event: selected)
            Button("この日の予定を全件見る") { openDay(selected.start) }.font(.caption).frame(minHeight: 44)
          }
        }
      } else if let overviewDay, let overviewPeriod {
        CampusCard {
          VStack(alignment: .leading, spacing: 8) {
            Text("\(Tokyo.dayKey(overviewDay)) · \(overviewPeriod)コマ").font(.caption).foregroundStyle(.secondary)
            Text("このコマに登録された講義はありません").font(.subheadline)
            Button("この日の予定を全件見る") { openDay(overviewDay) }.font(.caption).frame(minHeight: 44)
          }
        }
      }
      let count = all.filter { event in Tokyo.week(date).contains { event.occurs(on: $0) } }.count
      Text("この週の予定 \(count)件 · 保存した予定と個人修正を反映").font(.caption2).foregroundStyle(.secondary).campusReadable()
    }
  }
  private func overviewCell(day: Date, period: Int) -> some View {
    let items = TimetablePresentation.overviewEvents(on: day, period: period, events: all)
    let event = items.first
    let chosen = overviewDay == day && overviewPeriod == period
    return Button {
      overviewDay = day
      overviewPeriod = period
      selected = event
      if items.count > 1 { openDay(day) }
    } label: {
      VStack(alignment: .leading, spacing: 5) {
        if let event {
          Text(event.title).font(.system(size: 10, weight: .semibold)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
          Text(event.location.isEmpty ? "場所未登録" : event.location).font(.system(size: 8)).lineLimit(2)
          if items.count > 1 { Text("重複 \(items.count)件").font(.system(size: 8, weight: .bold)) }
        } else {
          Text("–").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }.padding(6).frame(maxWidth: .infinity, minHeight: 94, maxHeight: 94, alignment: .topLeading)
        .foregroundStyle(appearance.theme.ink)
        .background(event == nil ? appearance.theme.paper : appearance.theme.soft, in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(chosen ? appearance.theme.accent : .clear, lineWidth: 1.5))
    }.buttonStyle(.plain)
      .accessibilityLabel("\(Tokyo.dayKey(day)) \(period)コマ。" + (event.map { "\($0.title)、\($0.location)" } ?? "登録された講義なし") + (items.count > 1 ? "。重複\(items.count)件、日別一覧で確認" : ""))
      .accessibilityAddTraits(chosen ? [.isSelected] : [])
  }
  private func clock(_ minute: Int) -> String { String(format: "%d:%02d", minute / 60, minute % 60) }
  func status(_ now: Date) -> String {
    guard mode != 1 || Tokyo.calendar.isDate(date, inSameDayAs: now) else {
      return "現在 \(Tokyo.time(now)) ・ 選択日は別日"
    }
    let next = all.first { !$0.allDay && $0.end > now }
    return "現在 \(Tokyo.time(now))" + (next.map { " ・ \($0.timing(at:now))" } ?? " ・ 今後の予定なし")
  }
  func shift(_ n: Int) {
    date = Tokyo.calendar.date(
      byAdding: mode == 1 ? .month : .day, value: n * (mode == 0 ? 7 : 1), to: date)!
  }
  func grid(now: Date) -> some View {
    GeometryReader { geo in
      let days = mode == 0 ? Tokyo.week(date) : [Tokyo.calendar.startOfDay(for: date)]
      let left: CGFloat = 24
      let header: CGFloat = 40
      let height = max(60, geo.size.height - header)
      let column = (geo.size.width - left) / CGFloat(days.count)
      let start = model.data.startHour * 60
      let finish = model.data.endHour * 60
      let span = CGFloat(finish - start)
      ZStack(alignment: .topLeading) {
        ForEach(Array(days.enumerated()), id: \.offset) { i, d in
          let x = left + CGFloat(i) * column
          let items = all.filter { $0.occurs(on: d) }
          let extra = items.filter {
            $0.extendsOutside(on: d, startMinute: start, endMinute: finish)
          }
          VStack(spacing: 0) {
            Button {
              openDay(d)
            } label: {
              VStack(spacing: 1) {
                Text(d, format: .dateTime.weekday(.narrow))
                Text(d, format: .dateTime.day()).fontWeight(
                  Tokyo.calendar.isDate(d, inSameDayAs: now) ? .bold : .regular)
                if !extra.isEmpty { Text("外\(extra.count)").font(.system(size: 9)) }
              }.font(.caption2).frame(width: column, height: header)
            }
            Rectangle().fill(Color.secondary.opacity(0.04)).frame(width: column, height: height)
          }.offset(x: x)
          if model.data.showBands {
            ForEach(Array(model.data.facilities.filter(\.band).enumerated()), id: \.element.id) {
              bandIndex, f in
              ForEach(f.intervals(on: d)) { interval in
                let a = max(start, interval.start)
                let b = min(finish, interval.end)
                if b > a {
                  Rectangle().fill(
                    f.title.contains("ショップ")
                      ? Color.yellow.opacity(0.15) : Color.green.opacity(0.12)
                  ).frame(width: 4, height: CGFloat(b - a) / span * height).offset(
                    x: x + column - 4 * CGFloat(bandIndex + 1),
                    y: header + CGFloat(a - start) / span * height
                  ).onTapGesture { facility = FacilitySelection(facilityID: f.id, date: d) }
                    .accessibilityLabel(
                      "\(f.title) \(interval.label) 確認\(f.updated)")
                }
              }
            }
          }
          let timed = items.filter {
            !$0.allDay && $0.start < d.addingTimeInterval(TimeInterval(finish * 60))
              && $0.end > d.addingTimeInterval(TimeInterval(start * 60))
          }
          ForEach(timed) { e in
            let a = max(
              start, Tokyo.calendar.isDate(e.start, inSameDayAs: d) ? Tokyo.minute(e.start) : start)
            let b = min(
              finish, Tokyo.calendar.isDate(e.end, inSameDayAs: d) ? Tokyo.minute(e.end) : finish)
            let h = max(2, CGFloat(b - a) / span * height)
            let overlap = timed.filter { $0.id != e.id && $0.start < e.end && $0.end > e.start }
              .count
            Button {
              selected = e
              if overlap > 0 || h < 38 { openDay(d) }
            } label: {
              VStack(alignment: .leading, spacing: 0) {
                if h >= 38 {
                  Text(String(e.title.prefix(3))).font(.system(size: 11, weight: .semibold))
                  Text(Tokyo.time(e.start)).font(.system(size: 9))
                  Text(Tokyo.time(e.end)).font(.system(size: 9))
                  if overlap > 0 { Text("＋\(overlap)").font(.system(size: 9)) }
                } else {
                  Text(overlap > 0 ? "◆\(overlap+1)" : "●").font(.system(size: 9))
                }
              }.frame(width: column - 3, height: h, alignment: .topLeading).background(
                eventColor(e).opacity(0.22)
              ).overlay(alignment: .leading) { Rectangle().fill(eventColor(e)).frame(width: 2) }
            }.buttonStyle(.plain).offset(x: x + 1, y: header + CGFloat(a - start) / span * height)
              .accessibilityLabel(
                "\(e.title) \(Tokyo.time(e.start))から\(Tokyo.time(e.end)) \(e.location)。日別で全件確認")
          }
          if Tokyo.calendar.isDate(d, inSameDayAs: now), Tokyo.minute(now) >= start,
            Tokyo.minute(now) <= finish
          {
            Rectangle().fill(.red).frame(width: column, height: 1.5).offset(
              x: x, y: header + CGFloat(Tokyo.minute(now) - start) / span * height
            ).allowsHitTesting(false).accessibilityLabel("現在 \(Tokyo.time(now))")
          }
        }
        ForEach(
          Array(stride(from: model.data.startHour, to: model.data.endHour, by: 2)) + [
            model.data.endHour
          ], id: \.self
        ) { hour in
          let y = header + CGFloat(hour * 60 - start) / span * height
          Path { p in
            p.move(to: CGPoint(x: left, y: y))
            p.addLine(to: CGPoint(x: geo.size.width, y: y))
          }.stroke(Color.secondary.opacity(0.18), lineWidth: 0.5).allowsHitTesting(false)
          Text(String(format: "%02d", hour)).font(.system(size: 10)).foregroundStyle(.secondary)
            .offset(y: min(geo.size.height - 12, y - 6)).allowsHitTesting(false)
        }
      }
    }
  }
}
extension Date: @retroactive Identifiable { public var id: Date { self } }
struct DayEventList: View {
  var date: Date
  var events: [CampusEvent]
  var body: some View {
    let start = Tokyo.calendar.startOfDay(for: date)
    let items = events.filter { $0.start < start.addingTimeInterval(86400) && $0.end > start }
    List {
      if items.isEmpty { Text("この日の予定はありません") }
      ForEach(items) { e in
        EventNavigationRow(event: e)
      }
    }.campusListStyle()
  }
}
struct CalendarSettingsView: View {
  @EnvironmentObject var model: AppModel
  @EnvironmentObject var calendar: CalendarModel
  @Environment(\.dismiss) var dismiss
  var date: Date
  var body: some View {
    NavigationStack {
      Form {
        Section("読み取りのみ") {
          Text(
            "iPhone標準カレンダーにExchange / Outlookを設定してください。Outlookアプリだけのログインでは接続されません。OSの許可名称はフルアクセスですが、予定の追加・変更・削除は行いません。"
          )
          Button("カレンダーを許可") {
            Task { await calendar.request(selected: model.data.selectedCalendarIDs, date: date) }
          }
          Text(calendar.message)
          if let r = calendar.range {
            Text("取得範囲 \(Tokyo.dayKey(r.lowerBound))〜\(Tokyo.dayKey(r.upperBound))").font(.caption)
          }
          if let t = calendar.refreshedAt { Text("端末取得 \(t.formatted())").font(.caption) }
          Button("再取得") { calendar.refresh(selected: model.data.selectedCalendarIDs, date: date) }
        }
        Section("表示カレンダー") {
          ForEach(calendar.calendars, id: \.calendarIdentifier) { c in
            Toggle(
              c.title,
              isOn: Binding(
                get: { model.data.selectedCalendarIDs.contains(c.calendarIdentifier) },
                set: { on in
                  model.update { d in
                    d.selectedCalendarIDs.removeAll { $0 == c.calendarIdentifier }
                    if on { d.selectedCalendarIDs.append(c.calendarIdentifier) }
                  }
                  calendar.refresh(selected: model.data.selectedCalendarIDs, date: date)
                }))
          }
        }
        Section("日表示の時間範囲・営業時間") {
          Stepper(
            "開始 \(model.data.startHour):00",
            value: Binding(
              get: { model.data.startHour }, set: { v in model.update { $0.startHour = v } }),
            in: 0...max(0, model.data.endHour - 1))
          Stepper(
            "終了 \(model.data.endHour):00",
            value: Binding(
              get: { model.data.endHour }, set: { v in model.update { $0.endHour = v } }),
            in: (model.data.startHour + 1)...24)
          Toggle(
            "営業時間の帯",
            isOn: Binding(
              get: { model.data.showBands }, set: { v in model.update { $0.showBands = v } }))
          ForEach(model.data.facilities) { f in
            Toggle(
              f.title,
              isOn: Binding(
                get: { model.data.facilities.first { $0.id == f.id }?.band ?? false },
                set: { v in
                  model.update { d in
                    if let i = d.facilities.firstIndex(where: { $0.id == f.id }) {
                      d.facilities[i].band = v
                    }
                  }
                }))
          }
        }
      }.campusListStyle().navigationTitle("表示設定").toolbar { Button("完了") { dismiss() } }
    }
  }
}
struct EventDetail: View {
  @Environment(\.showCampusArticles) private var showArticles
  @Environment(\.showCampusBoard) private var showBoard
  @EnvironmentObject var model: AppModel
  @EnvironmentObject var calendar: CalendarModel
  var event: CampusEvent
  @State var editing = false
  var body: some View {
    let event = calendar.combined(model.data).first { $0.id == self.event.id } ?? self.event
    List {
      EventRow(event: event)
      Text(Tokyo.dayKey(event.start))
      if event.kind != "external" && event.kind != "university" {
        Button {
          showArticles(model.data.courseID(for: event) ?? event.id, event.title)
        } label: { Label("関連する記事", systemImage: "book.closed") }
        if let courseID = model.data.courseID(for: event) {
          Button { showBoard(courseID, event.title) } label: {
            Label("この講義の掲示板", systemImage: "bubble.left.and.bubble.right")
          }
        }
        Button("授業を修正・休講") { editing = true }
        if model.data.occurrenceEdits.contains(where: { $0.id == event.id }) {
          Button("この回の修正を元に戻す") {
            model.update { $0.occurrenceEdits.removeAll { $0.id == event.id } }
          }
        }
      } else if event.kind == "external" {
        Text("外部予定は表示のみです")
      }
    }.campusListStyle().navigationTitle("予定詳細").sheet(isPresented: $editing) { EventEditor(event: event) }
  }
}
struct EventEditor: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  var event: CampusEvent
  var courseID: String? = nil
  var adding = false
  @State var title = ""
  @State var room = ""
  @State var start = Date()
  @State var end = Date()
  @State var whole = false
  @State var cancelled = false
  @State var failure: String?
  var cid: String? { courseID ?? model.data.courseID(for: event) }
  var body: some View {
    NavigationStack {
      Form {
        Section("適用範囲") {
          if !adding && cid != nil {
            Picker("範囲", selection: $whole) {
              Text("この1回").tag(false)
              Text("科目全体").tag(true)
            }.pickerStyle(.segmented)
          }
          Text(
            adding
              ? "日時未定科目に新しい1回を追加します"
              : whole ? "科目の全回を修正します。日付は維持し開始時刻と長さを適用します。" : "選択した1回のみ修正します。休講は取消し情報を保持します。")
        }
        TextField("表示名", text: $title)
        TextField("教室", text: $room)
        DatePicker("開始", selection: $start)
        DatePicker("終了", selection: $end)
        if !adding { Toggle("休講", isOn: $cancelled) }
        if let failure { Text(failure).foregroundStyle(.red) }
        Button("この範囲に保存") {
          guard end > start, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            failure = "件名と開始より後の終了時刻が必要です"
            return
          }
          if adding {
            model.update {
              $0.addedEvents.append(
                CampusEvent(
                  id: "manual:\(cid ?? "unknown"):\(UUID().uuidString)", title: title, start: start,
                  end: end, location: room))
            }
          } else {
            model.edit(
              EventEdit(
                id: whole ? cid! : event.id, title: title, location: room, start: start, end: end,
                cancelled: cancelled), course: whole)
          }
          dismiss()
        }
        if !adding {
          Button("選択範囲の修正を元に戻す") {
            model.update {
              if whole {
                $0.courseEdits.removeAll { $0.id == cid }
              } else {
                $0.occurrenceEdits.removeAll { $0.id == event.id }
              }
            }
            dismiss()
          }
          if event.id.hasPrefix("manual:") {
            Button("追加した日程を削除", role: .destructive) {
              model.update {
                $0.addedEvents.removeAll { $0.id == event.id }
                $0.occurrenceEdits.removeAll { $0.id == event.id }
              }
              dismiss()
            }
          }
        }
      }.campusListStyle().navigationTitle(adding ? "日程を追加" : "授業を修正").toolbar { Button("取消") { dismiss() } }.onAppear
      {
        title = event.title
        room = event.location
        start = event.start
        end = event.end
        cancelled = model.data.occurrenceEdits.first { $0.id == event.id }?.cancelled ?? false
      }
    }
  }
}
struct CourseList: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  @State var edit: CampusEvent?
  @State var add: Course?
  var body: some View {
    List {
      ForEach(model.data.imports, id: \.key) { p in
        Section("\(p.year)年度 後期") {
          ForEach(p.courses) { c in
            VStack(alignment: .leading) {
              Text(c.title)
              Text(c.slot).font(.caption)
              CampusLocationButton(location: c.room)
              if c.weekday == nil { Button("日程を追加") { add = c } }
              if let e = model.data.originalEvents.first(where: {
                model.data.courseID(for: $0) == c.id
              }) {
                Button("修正・休講・解除") { edit = model.data.events.first { $0.id == e.id } ?? e }
              }
              if model.data.courseEdits.contains(where: { $0.id == c.id }) {
                Button("科目全体の修正を解除") { model.update { $0.courseEdits.removeAll { $0.id == c.id } } }
              }
            }
          }
        }
      }
      Section("取消し済み・追加した回") {
        ForEach(
          model.data.originalEvents.filter { e in
            model.data.occurrenceEdits.contains { $0.id == e.id && $0.cancelled }
              || e.id.hasPrefix("manual:")
          }
        ) { e in
          VStack(alignment: .leading, spacing: 0) {
            Button { edit = e } label: { EventSummary(event: e) }.buttonStyle(.borderless)
            CampusLocationButton(location: e.location)
          }
        }
      }
    }.campusListStyle().navigationTitle("科目・個人修正").toolbar { Button("閉じる") { dismiss() } }.sheet(item: $edit) { e in
      EventEditor(event: e)
    }.sheet(item: $add) { c in
      EventEditor(
        event: CampusEvent(
          id: "new", title: c.title, start: Date(), end: Date().addingTimeInterval(3600),
          location: c.room), courseID: c.id, adding: true)
    }
  }
}
