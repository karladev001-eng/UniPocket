# 015 — iPhoneのPDF取込互換性修正

- 状態: done（互換性修正・配信・更新切替確認済み。利用者実機での再試行は引継ぎ）
- 仕様版: 1
- 基点: 0f7deb202d9db307df3dde315fb3aa0d79e03a80
- 目的: iPhone PWAでPDF解析が `undefined is not a function` で中断する不具合を修正する。

## 範囲・承認

- 011 v3の承認済みPDF取込の不具合修正。利用者が2026-10-19にiPhoneのエラー画像を提示。親が「画面・解析ルールを変えず、ライブラリ互換と既存予定の保護を検証する」と説明済み。
- 既存承認範囲の検証・修正として進める。新画面・新取込形式・013地図変更・認証変更は含まない。視覚モックは既存のPDF選択→差分確認画面を再利用する。
- 入力: 既存対象の文字を含む履修登録確認票・年間行事予定表PDF。出力: 既存形式の差分プレビュー。失敗時は既存予定を変更しない。PDFをサーバーへ送らない。

## 受入条件

1. 依存ライブラリ内の互換性問題をコード・再現テストで特定し、Safari向け互換版など適切な方法で解決する。端末の正確なエラー原因を再現なしに断定しない。
2. main/workerの版を合わせ、PDF解析と差分適用のルールを維持する。失敗時の既存データ保護を検証する。
3. 回帰テスト・typecheck・buildを通し、独立レビュー後に既存の本人限定Workerへ更新配信する。
4. 公開先で新buildと更新導線を確認し、利用者へ既存データを消さずに再試行する手順を案内する。iPhone実機未検証は区別する。

## 未解決事項

- 利用者回答: iOS 26.6.2、iPhone 17e。古いiOSだけの問題とは断定しない。実機スタックは未取得。
- 実際の入力PDFは受領していない。共有を必須にせず、手元の非個人PDFと既存fixtureで検証する。

## 担当・根拠

- active/delegation/review/persistence/measurement/improvement_loop=true、max_agents3、auto no pins。
- 実装ios_pdf_fix: gpt-6.1-sol/high。原因が未確定でWorker/ブラウザ互換の検討を伴うため。起動API列挙のモデルとeffortを確認済み。
- 作業領域: /private/tmp/univ-ios-pdf-compat、branch codex/ios-pdf-compat。
- 公式FAQ: https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions （2026-10-19 JST確認）。modern buildはFirefox/Chrome、legacy buildはSafari18+ mostly supported。mainとworkerは同じversionを要する。
- ユーザー画面では解析エラーと既存予定非変更のメッセージを確認。スクリーンショットから端末OSの版は判断できない。

## 修正・レビュー

- 実装commit 0eb87727b25454a39a2552d02c0618fb92941133。PDF.js依存版は6.4.299を維持し、main/worker双方をlegacy互換buildへ変更。解析ルール・UI・保存処理は維持。
- modernはIterator欠落時のimport失敗とtoHex欠落時の実PDF読込失敗を別processで再現。legacyは不足API条件で合成PDFから数学/情1/15予定のプレビュー成功、破損PDF後にメモリとIndexedDB再openデータが一致。これはiOS版のエミュレーションではなく、実機で失敗したAPIは未確定。
- 変更ファイル: web/src/pdf.ts、web/scripts/service-worker.mjs、web/package.json、web/tests/client.test.ts、web/tests/client-pdf.test.ts、web/tests/fixtures/pdf-pages.ts、web/tests/fixtures/text-pdf.ts。
- 実装check: npm test 34件/5files、typecheck、production build、diff --check成功。
- 独立レビューios_pdf_review（gpt-6.1-sol/high）PASS。リスク表を先に作成し、テスト34件/typecheck/diffcheckを独立実行。main/worker同版・worker URL一致・worker1,321,307bytes・SW210assets実在とmain/worker収録・build ID一致を確認。
- 制約: PDF解析テストはNode fake worker経路。ブラウザ実Worker、iPhone17e/iOS26.6.2、利用者原本PDFは未検証。
- 統合担当ios_pdf_integrate（gpt-6-luna/medium）。承認済みcommitの決定的な統合/配布用buildであるため選択。別worktree /private/tmp/univ-ios-pdf-integration、base0f7deb2。

## 完了記録

- 結果: PDFライブラリmain/workerをSafari向け互換版へ変更し、本人限定の既存URLへ配信。既存UI・解析ルール・保存処理・Access設定は維持。
- 対象仕様版: 015 v1、既存011 v3のPDF取込bugfix。
- コード版: 0eb87727b25454a39a2552d02c0618fb92941133。rootと統合worktreeへff-only統合、指定7files以外の差分なし、013/015未追跡文書を保護。
- 統合check: production buildと両checkoutのdiff --check成功。配信build 20261018160336-85cc81、clean buildの209 offline assetsをSWへ収録。
- 配信: uni-pocket-preview、Worker version 1e258b18-d66a-4d23-bf64-4054555e84d6。Wrangler deploy --env preview成功。既存DB/ASSETS/cronを維持。
- 受入1–3: 不足APIの再現、互換版での合成PDF解析、データ保護、34tests/typecheck/build、独立レビューPASS、配信成功。
- 受入4: 本人認証済みブラウザの公開URLで旧buildから「更新を確認」→「新版をダウンロード」→「保存して更新」→画面/配信build 20261018160336-85cc81一致を確認。証拠 /private/tmp/uni-pocket-pdf-update.png。
- 残る制約: 利用者iPhoneの正確な失敗APIは未確定。利用者原本・実機・実ブラウザWorkerでのPDF抽出は未検証。Nodeで不足APIを除いた試験は機種エミュレーションではない。
- 引継ぎ: iPhoneの「その他」→「更新を確認」→「保存して更新」後、同じ2PDFを再試行。アプリ削除/サイトデータ削除は不要。
- 計測: condition=harness、task=015、完了日=2026-10-19 JST、開始/所要時間/利用量=null（未取得）。実装/レビューgpt-6.1-sol high、統合gpt-6-luna medium。比較ベンチマークなし。
