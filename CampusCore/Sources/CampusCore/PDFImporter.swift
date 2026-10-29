import Foundation
import PDFKit

public enum ImportFailure: LocalizedError {
    case unreadable, imageOnly, layout(String), yearMismatch, incomplete(String)
    public var errorDescription: String? {
        switch self {
        case .unreadable: return "PDFを開けません。破損またはパスワード保護を確認してください。"
        case .imageOnly: return "文字を読み取れないPDFです。画像のみのPDFには未対応です。学務の文字を含む原本PDFを選択してください。"
        case .layout(let s): return "未対応のPDF形式です。\(s) 既存の予定は変更していません。"
        case .yearMismatch: return "2つのPDFの年度が一致しません。既存の予定は変更していません。"
        case .incomplete(let s): return "日程を確定できません。\(s) 取り込みを中止しました。"
        }
    }
}
private struct PageText {
    let page: PDFPage
    let width: Double
    let height: Double
    init(_ page: PDFPage, width: Double, height: Double) { self.page=page; self.width=width; self.height=height }
    func lines(x: Double, y: Double, w: Double, h: Double) -> [String] {
        let bounds=page.bounds(for:.mediaBox)
        let rect=CGRect(x:bounds.minX+x/width*bounds.width, y:bounds.maxY-(y+h)/height*bounds.height, width:w/width*bounds.width, height:h/height*bounds.height)
        guard let selection=page.selection(for:rect) else { return [] }
        return selection.selectionsByLine().sorted {
            let a=$0.bounds(for:page), b=$1.bounds(for:page)
            return abs(a.midY-b.midY)>2 ? a.midY>b.midY : a.minX<b.minX
        }.compactMap { $0.string?.trimmingCharacters(in:.whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    func text(x: Double, y: Double, w: Double, h: Double) -> String { lines(x:x,y:y,w:w,h:h).joined(separator:" ") }
}
private func normalized(_ text: String) -> String { text.applyingTransform(.fullwidthToHalfwidth, reverse: false)!.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\n", with: "") }
private func matches(_ pattern: String, _ text: String) -> [[String]] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    let n = text as NSString
    return regex.matches(in: text, range: NSRange(location:0,length:n.length)).map { m in (0..<m.numberOfRanges).map { m.range(at:$0).location == NSNotFound ? "" : n.substring(with:m.range(at:$0)) } }
}
/// Parses the registration confirmation and annual schedule PDFs into an `ImportPlan` preview.
public enum PDFImporter {
    public static func preview(timetableURL: URL, scheduleURL: URL) throws -> ImportPlan {
        let registration = try document(timetableURL)
        let annual = try document(scheduleURL)
        guard registration.pageCount == 1, let t = registration.page(at:0), annual.pageCount >= 1, let a = annual.page(at:0) else { throw ImportFailure.layout("ページ数を確認してください。") }
        let tt = normalized(t.string ?? ""), at = normalized(a.string ?? "")
        guard tt.contains("履修登録確認票"), tt.contains("通常講義"), tt.contains("その他") else { throw ImportFailure.layout("履修登録確認票を選択してください。") }
        guard at.contains("行事予定表"), !at.contains("夜間主コース"), at.contains("後学期試験") else { throw ImportFailure.layout("通常課程の年間行事予定表を選択してください。") }
        let grid = PageText(t,width:842,height:595)
        let yearHeader=normalized(grid.text(x:14,y:86,w:80,h:17))
        guard let yearString = matches("(20[0-9]{2})年度後期", yearHeader).first?[1], let year = Int(yearString), let annualYearString = matches("令和([0-9]+)年度",at).first?[1], let annualYear = Int(annualYearString) else { throw ImportFailure.layout("後期の登録票と年度表記が必要です（前期は未対応）。") }
        guard annualYear+2018 == year else { throw ImportFailure.yearMismatch }
        let tb = t.bounds(for:.mediaBox), ab = a.bounds(for:.mediaBox)
        guard abs(tb.width/tb.height-842.0/595)<0.03, abs(ab.width/ab.height-1700.74/1202.74)<0.03 else { throw ImportFailure.layout("表の縦横比が既知の原本と異なります。") }
        let dayX = [28.44,106.92,185.40,263.88,342.36,421.02,499.50]
        for i in 0..<6 {
            guard grid.text(x:dayX[i],y:130,w:dayX[i+1]-dayX[i],h:13).contains(String(Array("月火水木金土")[i])) else { throw ImportFailure.layout("曜日見出しの座標が異なります。") }
        }
        var courses: [Course] = []
        for weekday in 1...6 {
            for block in 0..<7 {
                let x=dayX[weekday-1], y=143.74+Double(block)*60.48, w=dayX[weekday]-x
                let full = grid.text(x:x,y:y,w:w,h:60.48)
                guard !full.isEmpty else { continue }
                let title = grid.lines(x:x,y:y+14,w:w,h:16).joined()
                guard !title.isEmpty else { throw ImportFailure.layout("通常講義セルの科目名を認識できません。") }
                let room = grid.text(x:x,y:y+38,w:w,h:10)
                let id="\(year)-autumn-\(weekday)-\(block)"
                courses.append(Course(id:id,title:title,weekday:weekday,block:block,room:room))
            }
        }
        for row in 0..<7 {
            let title = grid.lines(x:503.1,y:143.74+Double(row)*21.24,w:172,h:21.24).joined()
            if !title.isEmpty { courses.append(Course(id:"\(year)-autumn-unscheduled-\(row)",title:title,weekday:nil,block:nil)) }
        }
        guard courses.contains(where: { $0.weekday != nil }) else { throw ImportFailure.incomplete("通常講義が見つかりません。") }
        let schedule = PageText(a,width:1700.74,height:1202.74)
        let columns = [844.36,978.44,1112.50,1246.60,1384.70,1518.80]
        let months = [10,11,12,1,2,3]
        var events: [CampusEvent] = []
        var counts: [Int:Set<Int>] = [:]
        let times=[(8,40,10,10),(10,20,11,50),(12,45,14,15),(14,25,15,55),(16,5,17,35),(17,50,19,20),(19,30,21,0)]
        for column in 0..<months.count {
            let month=months[column], actualYear=month<4 ? year+1 : year
            let left=columns[column], right=column+1<columns.count ? columns[column+1] : 1653.69
            let header = normalized(schedule.text(x:left,y:152,w:right-left,h:18))
            guard header.contains("\(month)月") else { throw ImportFailure.layout("月見出しの座標が異なります。") }
            let numberOfDays=Tokyo.calendar.range(of:.day,in:.month,for:Tokyo.date(actualYear,month,1))!.count
            for day in 1...numberOfDays {
                let y=191.08+Double(day-1)*22.115
                let dayText=normalized(schedule.text(x:left,y:y,w:19.5,h:22.115))
                guard Int(dayText)==day else { throw ImportFailure.layout("\(month)月\(day)日セルの位置が異なります。") }
                let cell=normalized(schedule.text(x:left+36,y:y,w:right-left-36,h:22.115))
                let markers=matches("([月火水木金土])([0-9]{1,2})(?![0-9])",cell)
                guard markers.count <= 1 else { throw ImportFailure.incomplete("同じ日から複数の授業回を検出しました。") }
                let blocked=cell.contains("浜松休講") || cell.contains("対面授業等なし")
                if let marker=markers.first, !blocked {
                    let weekday=Array("月火水木金土").firstIndex(of:Character(marker[1]))!+1
                    let number=Int(marker[2])!
                    guard (1...15).contains(number), !(counts[weekday] ?? []).contains(number) else { throw ImportFailure.incomplete("授業回の重複または不正な回数を検出しました。") }
                    counts[weekday,default:[]].insert(number)
                    for course in courses where course.weekday==weekday {
                        guard let block=course.block else { continue }; let time=times[block]
                        let exam=cell.contains("試験") || number==15
                        events.append(CampusEvent(id:"\(course.id)-\(month)-\(day)",title:course.title+(exam ? "｜試験・第15回（要確認）" : "｜第\(number)回"),start:Tokyo.date(actualYear,month,day,time.0,time.1),end:Tokyo.date(actualYear,month,day,time.2,time.3),location:course.room,kind:exam ? "exam" : "class"))
                    }
                }
                var label=cell
                for m in markers { label=label.replacingOccurrences(of:m[0],with:"") }
                label=label.replacingOccurrences(of:"月曜授業",with:"")
                if cell.contains("大学祭") && cell.contains("静岡休講") { label="" }
                let shizuokaOnly=label.contains("静岡") && !label.contains("浜松")
                if !label.isEmpty, !shizuokaOnly, label != "※5", label.count>2 {
                    let start=Tokyo.date(actualYear,month,day)
                    events.append(CampusEvent(id:"\(year)-autumn-university-\(month)-\(day)",title:label,start:start,end:Tokyo.calendar.date(byAdding:.day,value:1,to:start)!,kind:"university",allDay:true))
                }
            }
        }
        for course in courses where course.weekday != nil {
            guard counts[course.weekday!] == Set(1...15) else { throw ImportFailure.incomplete("\(course.slot)の第1〜15回を揃えて認識できません。年度や表形式を確認してください。") }
        }
        return ImportPlan(year:year,term:"autumn",courses:courses,events:events.sorted{$0.start<$1.start},warnings:["PDF原文の欠けた科目名はそのまま表示しています。教室・授業内容は学務情報で確認してください。", "試験・第15回は候補です。非同期回、個別補講、研究・セミナーの実施日時は自動確定していません。", "通常課程1ページ目の浜松に適用する予定だけを使用します。12月の集中講義や補講日に通常授業を追加しません。", "再取り込みは原本の差分を確認し、個人修正との競合を解決してから適用します。外部カレンダーは変更しません。"],importedAt:Date())
    }
    private static func document(_ url:URL) throws -> PDFDocument {
        guard let doc=PDFDocument(url:url), !doc.isLocked, let page=doc.page(at:0) else { throw ImportFailure.unreadable }
        let text=page.string ?? ""
        guard text.trimmingCharacters(in:.whitespacesAndNewlines).count>30 else { throw ImportFailure.imageOnly }; return doc
    }
}
