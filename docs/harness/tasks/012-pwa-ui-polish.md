# 012-pwa-ui-polish — PWAの操作UI改善

- 状態: done
- 仕様版: 2
- 基点: 53b4dbb / codex/pwa-migration
- 承認対象範囲: PWA操作UI改善（アイコン・メモ・選択/ファイル・地図・匿名記事・保存表示・背景 / AC1–8）
- モック: [012-pwa-ui-polish.plan.html](012-pwa-ui-polish.plan.html)

## 目的と範囲

2026-10-18のユーザーの7点のフィードバックを反映する。PWAの見た目と操作を整理し、既存データ・機能を保持。Swift、認証、共有DB、Notion本文と配布方式は変更しない。前タスク011の承認を今回の変更へ流用しない。

## 仕様

- S1: 全5タブの文字記号を24px/共通線幅のSVGに置換、名称/選択状態/44px操作領域。ホームの「固定したメモ」の後、「よく使うリンク」（ユーザーのいう固定リンク）の直上に既存画像を用いた地図プレビューを常設。リンク/予定の有無でも表示し、地図または拡大・検索から既存openMapへ1操作。グローバル右上の保存ボタンを外し、保存中/この端末に保存済み/保存できませんでしたを表示、失敗時のみ再試行。端末内データと記事登録/フォーム確定を混同させない。通常の手動保存は設定内でも重複を整理し、失敗時再試行は維持。
- S2: Keepの操作を参考に、メモ初期表示は本文+小さいツールバー。右上ピン、下部に画像/チェックリスト/色/その他と完了。色はスウォッチ、削除はその他。タイトル欄を増やさない。既存本文/画像/項目/色/固定は保持。完了時に保存確認、失敗時に閉じず入力保持、IME/画像処理/更新中の保護を維持。空で閉じた新規メモは残さず、非空メモは自動保存。
- S3: 全select（記事カテゴリ/講義、イベント種別など既存選択項目、テーマ）を共通カスタム選択UIへ。色など少数選択はスウォッチも可。上下キー/Enter/Escape/Tab/外側クリック、フォーカス復帰、ラベル・選択状態、320px画面内配置を備える。file入力は画像/PDF/背景の専用ボタンとファイル名/プレビューへ。OS選択ダイアログは標準を利用。匿名表示名（未設定または既定の匿名ユーザー）のauthorリンクを一覧・詳細からなくし、表示名を設定した投稿者は安定ID絞込を維持。サーバーID/所有権は保持。
- S4: 森/海/空/夕暮れ/紙/幾何のオリジナルSVG背景6種を同梱。見本を表示し選択、端末内保持、オフライン/再起動/更新対応。自分の画像/背景なしも選べる。既存画像の保存を壊さず、カードの可読性を保持。画像素材が必要な場合はimagegenスキルを使い生成し、配布用に最適化して同梱する（現時点では軽量SVG案を維持）。

## 入出力・失敗

メモ本文/画像/チェック、各選択値、背景選択を受け、画面と既存IndexedDBへ反映する。保存失敗/容量不足/競合では入力・原本を保持し再試行。非対応画像案内とファイル選択キャンセルを処理。匿名投稿者リンク除去で記事・件数・本人編集権限は変更しない。

## 受入条件

1. AC1: 5タブの統一SVG、名称、現在位置、44px以上の領域。
2. AC2: 本文中心の新規メモ、追加機能維持、既存データ保持、空メモ/保存失敗/IME確認。
3. AC3: 対象select/fileの統一、キーボードと選択/ファイル表示。
4. AC4: ホームの固定リンク直上に地図をプレビュー表示。拡大・検索へ1操作、閉じて復帰。
5. AC5: 匿名の記事は投稿者の絞込導線なし、名前設定者はID絞込維持。
6. AC6: 常設手動保存なし、正しい端末内自動保存状態と失敗時再試行。
7. AC7: 6背景/自分の画像/背景なし、オフライン/再起動/更新保持。
8. AC8: 320px/PC・メモ画像/各フォーム/PDF/ブックマーク/2タブ更新の回帰、Swift無変更。

## 未解決事項

必須質問なし。匿名は表示名未設定を指す案。背景は6種類のイラスト/模様案。v2・AC1–8の明示承認を受領済み。

## 提示・承認

- 状態: approved
- 対象: v2 / PWA操作UI改善（アイコン・メモ・選択/ファイル・地図・匿名記事・保存表示・背景 / AC1–8）
- 根拠: v2画面案の提示後、ユーザーがチャットで「計画 012-pwa-ui-polish の仕様版 2、範囲『PWA操作UI改善（アイコン・メモ・選択/ファイル・地図・匿名記事・保存表示・背景 / AC1–8）』の実装開始を承認します。」と明示。2026-10-18受領。
- macOS/zsh、実行場所 /Volumes/Data_SSD/dev/univ: `open "docs/harness/tasks/012-pwa-ui-polish.plan.html"`
- v2・AC1–8の本実装を開始。計画資料の作成・提示は実装開始前に完了。

## 参照・観察

- 添付画像1: ネイティブselectの展開一覧がアプリのカード/配色と不一致。画像2: file入力が標準ボタン/テキスト。
- web/src/main.ts: renderHome / editNote / articleCard / 記事詳細 / 外観 / アプリ外枠。web/src/style.css: タブと共通フォーム。
- Google Keep公式（2026-10-18確認）: https://support.google.com/keep/answer/2888246?co=GENIE.Platform%3DDesktop&hl=ja 、https://support.google.com/keep/answer/6395566?co=GENIE.Platform%3DDesktop&hl=ja 。本文入力→必要に応じてリスト/画像追加→完了の操作を参考。同期/認証/装飾全部はコピーしない。
- harness active全機能true/max_agents3。preferences readはEPERMで失敗、記憶を適用/上書きしない。今回のフィードバックは本仕様で扱い、長期嗜好へ昇格しない。
- 011は既存実装・保存/更新の制約の参照。

## 提示前確認（当時の記録）

- HTML pack成功、警告0。単一HTMLへCSS/JSを内包。
- IABで概要の折りたたみ、メモ画面の展開と表示、承認文案のID・仕様版1・AC1–8・pendingを確認。
- 提示先: http://127.0.0.1:8765/docs/harness/tasks/012-pwa-ui-polish.plan.html 。プレビュー: 012-pwa-ui-polish.preview.png 。
- 製品コードは変更なし。実装後の操作・回帰検証は未実施。

## v2の修正回答（2026-10-18）

- v1への回答「固定リンクの上にマップを表示しておくようにしましょう。」を受領。ホームの「よく使うリンク」直上へ変更し、地図画像を常時プレビューする仕様とモックへ更新。
- 「必要なら、image_genスキルを使って生成してください。」を受領。必要な場合の背景素材生成手段として記録。今回は既存地図とSVG案のため新規生成なし。
- 回答には実装承認を含まない旨の明示あり。v2もplanned / pendingで、本実装は開始しない。
- v2はpack成功（警告0）。ブラウザで改版・固定リンク直上の地図プレビュー・未承認表示を確認。プレビュー: 012-pwa-ui-polish-v2.preview.png。

## 実装開始・担当契約

- v2提示→明示承認→実装開始を確認。未解決の必須判断なし。HTMLの承認文案はpending表示を維持し、承認の正本は本節。
- 実装担当: 独立worktree `/private/tmp/univ-ui-polish`、基点53b4dbb。AC1–8全体を一担当へ割当（共通main.ts・保存処理の競合を避ける）。製品変更はweb/、Swift変更なし。
- 設定: active/delegation/review/persistence/measurement/improvement_loop=true、max_agents=3、auto/pinなし。
- 起動カタログ: collaboration.spawn_agentの候補を確認。実装gpt-6.1-sol/high（UI判断と保存・更新・IMEの回帰リスク）、独立レビューgpt-6.1-sol/high。両モデル/effortは対応候補に存在。
- 依存: 実装→独立コード/ブラウザレビュー→別担当の統合・回帰→最終整合性レビュー。

- 計測: run=012-v2-ui、条件=harness、利用枠/トークン=未取得(null)。開始時刻は本チャットの実装承認受領後。修正巡回数は完了時に記録。

## 更新前のブラウザ基準

- 8788のホームに固定メモ「更新後も残るメモ」、本文「Notion記事とブックマークの保持を確認。」と学務情報リンクあり。更新後の保持確認対象。
- 比較画像: 012-before-home.png。既存D1テスト記事/匿名Cookie/ブックマークは8788のまま引き継ぐ。検証用の新ポートは別データ領域として扱う。

## 実装・レビュー経過

- 実装commit: 30dbc0f。typecheck/client30/server6/runtime1/build成功。
- 初期統合: 08513ef（実装とtree一致）。実Wrangler integration test 1/1成功。build 20261018125843-266df2。
- コード独立レビューは一旦PASS後、親から追加した競合復旧の確認によりNEEDS_WORKへ訂正。メモ保存競合時にmodalを閉じられずMoreの書出しへ到達不能。修正1巡目: メモ内から入力を書き出す救済を追加する。
- 統合時の旧state退避は担当がmv→cp復元で実施（copy-onlyではなかった）。元のpersist pathと /private/tmp/univ-ui-polish-old-state-backup の両方に保持。以後の不要なデータ操作は行わない。
- QAの127.0.0.1はport間でCookieを共有するため、8790と8788の匿名identity分離は成立しない。旧Cookie保持はこの分離方法では証明しない。最終更新の前後を同じhost/port/sessionで確認する。IndexedDBはorigin別。

## 完了（012 v2 / AC1–8）

- 実装30dbc0f → 修正4674616 → 統合f1d8ced32f96583e2b9bde76f19e27391bbf57ce。codex/pwa-migrationへfast-forward済み。最終tree eb9d6746dec8bb4443b9530ccc7d0276b7bf34ac。
- buildID: 20261018220300-467461。コード独立レビュー・修正1巡目再レビュー・最終統合整合性レビュー・ブラウザレビューPASS。修正必須残件なし。
- 変更: web/src/main.ts、style.css、domain.ts、ui-assets.ts、ui-controls.ts、web/tests/client-ui.test.ts、web/package.json。Swift関連無変更。
- 検証: typecheck/build成功。client31、server6、runtime1、実Wrangler staticassets/Worker/persistD1 integration1、合計39テスト成功。変更の影響範囲に応じて実行し、最終統合はreview済treeとの一致確認。

### 受入結果

| 条件 | 結果・根拠 |
|---|---|
| AC1 | PASS: 全5タブSVG/名称/current/44px以上、PC1280×900と320×800で実操作。 |
| AC2 | PASS: 本文中心・空メモ破棄・本文/画像/check/pin/色の保存と再読込。競合時保持・Escape閉鎖防止・modal内書出し。JSONに同一noteの未保存本文/画像/チェックを実確認。IME中の終了/更新拒否はコードレビュー、日本語入力保持はブラウザ確認。 |
| AC3 | PASS: カスタム一覧・上下/Enter/Escape/Tab/外側クリック/焦点復帰。画像/PDF/背景picker・選択ファイル名・必須チェック。 |
| AC4 | PASS: 固定メモ→常時地図→固定リンク、地図→検索→閉じる実操作。 |
| AC5 | PASS: 匿名の一覧/詳細にauthor導線なし、名前設定後は両者からID絞込。 |
| AC6 | PASS: 自動保存状態、常設Save除去、失敗時再試行と入力書出し救済。 |
| AC7 | PASS: 6SVG背景/none/custom、再読込・更新保持、自分の画像を保持し再切替。通信停止中のキャッシュ表示も確認。 |
| AC8 | PASS: PC/320px全タブ横overflowなし、メモ画像/フォーム/PDF選択/ブックマーク/2タブ更新。旧8788 integration-2→最新版を保存して更新し、既存固定メモ本文・リンク保持。別タブの記事実Notion本文と集計表示も確認。 |

### 制約と確認範囲

- 実iPhone/Androidおよび実IMEの変換中操作は今回未確認。正規履修PDFの解析→差分確定はfixture未提供で未確認。既存parser自動テスト、picker/必須チェックは確認。
- オフラインは検証server停止中のキャッシュ表示/再読込で確認。端末全体のネットワーク切断は未操作。
- QA8790と8788はhostのCookieを共有し、QAで匿名セッションが切り替わるため旧匿名Cookie/本人ブックマーク状態の継続は証明しない。旧共有DBの検証記事・ブックマーク累計1は保持。匿名所有権の再起動保持はisolated integration test、2タブ更新はQAの同一sessionで確認。
- ローカルプレビュー更新済み。本番Cloudflare配布は今回未実施。

### 証拠・稼働先

- 012-implemented-home.png: 親による更新後の地図・固定リンク・SVGタブ。
- 012-implemented-notes-320.jpg / 012-implemented-background-320.jpg / 012-implemented-select-320.jpg / 012-implemented-recovery-320.jpg: 独立ブラウザ評価証拠。全画像/書出し検証JSONは /private/tmp/univ-ui-polish-qa/。
- プレビュー http://127.0.0.1:8788/#home （/private/tmp/univ-ui-polish-integration/web、既存D1 state利用）。親session6090で再開。QA8790は親session72559。
- 計測: 修正1巡、完了、未解決のコード欠陥0。モデル実装/レビューSol6.1 high、統合Luna medium。利用枠・tokens・正確な開始時刻は未取得(null)。終了2026-10-18 13:07 UTC。
