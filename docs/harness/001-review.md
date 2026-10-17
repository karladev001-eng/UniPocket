# 001 独立レビュー（修正1回目の再レビュー済み）

- 判定: ソースレビュー **PASS**（初回の取り込み中PDF変更レースは修正済み）。iOSのリリース検証は環境制約により **BLOCKED**。
- 担当: 実装と独立した HARNESS_WORKER / gpt-6.1-sol / high。製品コードは変更せず、実カレンダーとPDF原本を変更していない。
- 基点: 空の非Gitディレクトリ。実装されたCore、app、project、script、READMEを全体確認。

## 独立リスク表

実装の検証主張を根拠にする前に、PDF境界・座標と年度、授業曜日の振替とキャンパス例外、年越し・試験の候補扱い、入力失敗と既存データ保持、個人情報、原子的保存とUI競合、権限取消し、所有マーカーと再書き出し、既存カレンダーの保護、Xcode配線とAPI、日本語UIとアクセシビリティを検討した。

## 初回指摘と修正確認

**P2（解決済み）: 解析中にPDFを選び直すと、古い選択のプレビューが後から公開される。**

場所: `CampusPocket/ImportView.swift:20–21, 49–58`。

再現経路: A/Bを選び「解析してプレビュー」を押す。`analyze()`はA/Bを取り込んでdetached taskを開始する。その間もPDF選択ボタンが有効で、Cを選ぶとURLとpreviewが更新される。しかし旧A/Bタスクが完了すると無条件でpreviewへA/Bの結果を設定する。表示上の選択と取り込み内容が一致せず、ユーザーは古い内容を保存できる。解析中の選択を無効化するか、選択世代/キャンセルにより旧タスク結果を破棄すること。これはコード経路で確認した指摘で、iOS実操作による再現は未実施。

修正1回目の実コードを確認した。20–21行目の両PDF選択ボタンに `.disabled(busy)` が追加され、49–58行目で解析開始時に同期的にbusyをtrueにし、結果取得まで保つ。完了時のbusy解除とpreview公開の間にもawaitはない。したがって解析中のPDF再選択経路が閉じられ、この指摘を解決済みとする。iOS実操作は環境制約により引き続き未確認。

未解決の修正必須コード欠陥は確認しなかった。

## 受入条件

| 条件 | 結果と根拠 |
| --- | --- |
| 1 | Core PASS。添付実物から通常4・時間未定2、原文の切れた名称を保持。保存対象は表領域の科目・教室・生成予定のみで原本や識別ヘッダーを保存する経路なし。 |
| 2 | Core PASS。56通常・4試験、全60日付を列挙比較。11/25振替、11/6、1/7、冬休み、1/4、年越し、10/30静岡行事の除外を確認。通常課程の1ページ目のみ使用。 |
| 3 | Core / ソース確認 PASS。再取り込みはyear-termの置換。破損、画像、年度不一致、未知形式がエラー、既存JSONを保持。上記PDF選択レースは修正1回目で解決確認。実機UI操作は未検証。 |
| 4 | Core PASS / 実機未確認。JSON round tripでメモ・施設・リンク・取り込みを保持。原子的書込みの失敗時に旧ファイル保持をテスト。AppModelはMainActorで保存を直列化し、importは保存成功後に公開、読込失敗は上書き停止、保存失敗を画面へ公開。再起動・機内モードのUI実操作は未検証。 |
| 5 | 静的確認のみ / 実機BLOCKED。権限要求は明示操作、refreshはfullAccessを確認し取消し時に外部表示を消去。選択カレンダーを限定し、書出しは別の明示確認・書込み可能先・所有URLの照合・commit/resetを使用。一般の既存イベントを変更/削除する経路なし。agendaは所有URLが一致するローカルを隠す。実際の権限・読み書き・再書出し・二重表示は未検証。 |
| 6 | 配布物と開示 PASS / iOSビルドBLOCKED。Xcode project、共有scheme、日本語README、導入と検証手順を確認。全6 app sourcesとlocal packageの配線あり。plist/pbxproj lint、Swift構文解析、Core実物テスト成功。フルXcode不足による未検証範囲はREADMEに明示。 |

## 実施した確認

- `TIMETABLE_PDF=/Users/kan/Downloads/timetable.pdf SCHEDULE_PDF=/Users/kan/Downloads/r08_schedule.pdf scripts/test-core.sh`: 3 tests / 1 suite PASS（macOS、Swift 6.3.3）。破損PDFケースでCoreGraphicsの診断ログが出たがテストは成功。
- `plutil -lint CampusPocket/Info.plist CampusPocket.xcodeproj/project.pbxproj`: PASS。
- `swiftc -frontend -parse CampusPocket/*.swift`: PASS（構文確認のみ）。
- 原本の複製や画像を製品ディレクトリに保存していないこと、送信APIがないことを確認。
- AppModel / CalendarModelのmacOS SDK型検査: PASS（Swift 5モード、arm64 macOS 14ターゲット）。最初の試行はsandboxの既定モジュールキャッシュ書込みで失敗し、/tmpキャッシュで再試行して成功。iOS API全体の確認を意味しない。

## 制約と追加確認

`xcode-select -p`は`/Library/Developer/CommandLineTools`。iOS SDK / full Xcodeがないため、iOS全体の型検査・リンク、Simulator UI、Dynamic Type / VoiceOver / ダークモード、実機EventKit、署名とインストールは確認不能。リリース検証の阻害要因であり、上記コード欠陥とは別。提示した後期レイアウトを対応範囲とし、前期・OCR・別形式は未対応の明示エラー、変更済み外部イベントの自動更新/削除は提供しないという初期版の制約をREADMEで確認した。

修正1回目の再レビューではImportViewのライブコードと状態遷移を確認。変更は両選択ボタンのbusy制御のみで、Coreの再テストを必要とする新しい懸念はなく、初回の検証結果を維持する。ソースレビューPASSはiOSビルド・実機検証の完了を意味しない。


## 後続の仕様相談

2026-10-09に仕様相談版v2を提示し、回答を受けてv3で現在線・画像案を追加。続く回答を受けて[仕様正本 v4](001-campus-app.md)と[画面案](001-campus-app.plan.html)へ更新し、メモのホーム固定を回答済みに、週の7日一覧を1画面の構成に変更。このレビューのPASSは新仕様の承認・実装・検証を意味しない。
