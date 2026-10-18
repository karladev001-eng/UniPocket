# 016 — アプリ内の自動更新とPDF取込の継続修正

- 状態: done（自動更新とPDF診断を配信済み。iPhone固有エラーの解消は未確認、015で継続）
- 仕様版: 1
- 基点: 1741ed43bd9510157f1bc4da62174e3bce364a32
- 範囲: 起動時の自動取得・安全な自動適用、編集中/PDF取込中の待機、PDF継続エラーの調査修正。

## 承認

- 親が前ターンで「起動時に新版を取得し、保存が完了していて編集中でなければ自動で切り替える。PDF取込中や保存失敗時には待機」と提示。
- ユーザーが2026-10-19「その方針で実装してください。アプリを開いたら自動で更新して、編集中やPDF取込中は終わるまで待つようにしてください。新しいバージョンでもエラーが出ました」と明示承認・着手指示。
- 新規HTML計画提示待ちではなく、このユーザーの直接の実装指示を優先する。既存更新欄・通知欄を再利用し大幅なUI変更は行わない。
- PDFは015の継続不具合修正。元PDFや認証情報の外部送信、新取込形式、013地図は対象外。

## 受入条件

1. ホーム画面から開いたPWAで新版の取得・適用が完結し、通常はブラウザの別起動や更新ボタンを要しない。起動・前面復帰・通信復帰で適切に確認する。
2. 自動適用は全クライアントの編集終了・処理終了・保存成功が確認できる場合のみ。編集ダイアログ/入力フォーカス/IME/PDF解析・差分確認/画像処理/投稿中は待つ。下書きを保存できるだけで編集中にreloadしない。
3. 編集・取込等の完了後、利用者が更新ボタンを押さなくても待機中の新版を再評価し、安全なら適用する。競合/読込失敗/保存失敗/応答しない別タブでは旧版と入力を維持する。連続ポップアップ・リトライループを避ける。
4. 最新/取得中/編集待ち/適用中/失敗を既存の更新UIに分かる文言で表示。手動の確認・再試行経路は保持。アプリを完全終了中の即時更新、iOS初回ホーム追加の無操作化は保証しない。Access再認証が必要な場合に保護を回避しない。
5. 起動直後のSW待機版・ダウンロード完了・複数タブ・タブ途中追加・新旧版混在・二重適用・保存失敗・中断復帰を意味あるテストで検証する。
6. PDF継続エラーは端末の実際のメッセージ/ビルドを確認し、手元の実ブラウザでも解析経路を検証する。原因未確定なら断定せず段階が分かる診断を必要最小限で追加。PDF内容や生の個人情報をログ/サーバーへ送らない。
7. レビュー・型・テスト・buildを経て本人限定の既存Workerへ配信し、旧版から更新切替を確認。今回の自動更新を取り込む初回だけ旧版の手動適用が必要な点を案内する。

## 設計・担当

- 現行update.tsは自動check/取得と全タブ保存handshakeを持つが、applyは手動。main.tsのprepareはdraftダイアログなら許可するため、自動適用では別の編集完了判定が必要。
- 自動更新担当は main.ts/update.ts/sw-template.mjs/更新関連tests/リリースノート。PDF担当はpdf.ts/pdf関連testsに限定、共通ファイルは親へ調整。双方を同じ基点から別worktreeで作業し、レビュー後別統合worktreeで結合する。
- active/delegation/review/persistence/measurement/improvement_loop=true,max_agents3,model_selection auto,no pins。新旧タブ並行状態とPDF原因調査を伴うため実装はgpt-6.1-sol/high。独立レビューも同モデル/high、統合は決定的ならgpt-6-luna/medium。起動APIの列挙から対応モデル/effortを確認。

## 未解決事項・制約

- 利用者iPhone17e/iOS26.6.2。新版でのエラー全文と画面buildを非同期質問中。既知情報で進め、機器/原本未検証は明記。
- 初回ホーム画面追加はOS操作が必要。既に追加されたアプリ内での新版適用を実装対象とする。
- 参考: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers 、https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting （前ターン確認済み）。

## 調査・検証記録

- 利用者はエラー全文について「同じ」と回答。画面buildが85cc81かは明示回答なし。PDFがMac上にあれば保存場所を非同期質問中。
- 親が本人認証済み公開85cc81の実ブラウザで非個人fixture2PDFを選択→解析し、講義1/予定15/差分15の確認画面を確認。保存せず閉じた。証拠 /private/tmp/uni-pocket-pdf-browser-preview.png。利用者の原本/iPhone固有条件は未再現。
- PDF担当継続commit23b1d1d1d3f41060bc9c9fff527e1c1518275203: pdf.ts/client-pdf.test.tsのみ。失敗位置の短いコードを表示、両task cleanupを試し本体のエラーをcleanupで上書きしない。ログ/サーバー送信なし。実機TypeError原因の解消とは扱わない。
- PDF独立レビューauto_pdf_review（gpt-6.1-sol/high）PASS。独立PDF tests 9/9、既存保存経路/診断内容を確認。
- 自動更新の初回移行は旧版の明示manual要求を従来handshakeで許容し、新版auto要求では新protocolの編集安全応答を必須とする。旧版しかない状態で更新不能にならないことを検証対象に追加。
- 利用者が /Users/kan/Downloads/timetable.pdf と /Users/kan/Downloads/r08_schedule.pdf を明示提供。親が公開85cc81で原本を実ブラウザ選択し、講義6/予定86/差分86プレビュー成功。保存せず閉じた。原本をrepositoryへコピーせずサーバーへ送らない。証拠 /private/tmp/uni-pocket-original-pdf-preview.png。iPhoneの正確な実行build/固有条件は依然未確認。
- 自動更新commit ce2e652: main.ts/update.ts/sw-template.mjs/service-worker.mjs/client-update.test.tsの5files、実装担当の49tests/typecheck/build/diffcheck成功。独立レビュー中。

## 完了記録

- 結果: 起動時の新版取得・編集/処理終了後の保存と自動適用を実装し、本人限定URLへ配信。初回移行の旧版manual bootstrapを維持。PDF失敗段階の確認コードとcleanup原因保持を追加。
- 対象仕様版/承認: 016 v1、上記ユーザーの明示実装指示。
- コード版: 007e57ace6380ae279c4089b1931ec4c4c132f84。A ff070edとB007e57aは元commitのcherry-pick。変更7files。
- 統合: auto_pdf_integrate（gpt-6-luna/medium）、55/55 tests、typecheck/build/diffcheck成功。rootへff-only統合、未追跡013/016維持。原本PDFはcommit/送信しない。
- 独立レビュー: auto_pdf_review（gpt-6.1-sol/high）、A/B/最終統合すべてPASS。最終7filesは個別PASS変更の合成のみ。独立実行update19件/PDF9件PASS。
- 配信: 1回目build20261018161928-1ed496/Worker c61b4706-7553-4eda-a0af-9d3d751e6d0c。旧85cc81の「更新を確認」→「保存して更新」で初回移行成功。
- 2回目は同じレビュー済みコードの別build20261018161949-64687d/Worker 1b69a575-ead2-4692-8740-7cc5b0aa2f2fを配信。新規タブ起動の自動checkで取得。PDF選択ダイアログを開き原本1つを選択したまま保持され、別タブにも編集終了待ちを表示、旧画面build1ed496のままを確認。ダイアログを閉じると手動適用なしで全タブが64687dへreload。画面/配信build一致を確認。
- 受入1–5/7: 自動testsと上記の公開実操作で確認。iPhone実機の更新は本人での確認が残る。
- 受入6: 原本2つが公開85cc81実ブラウザとisolated不足API Node環境で6講義/86予定のプレビュー成功。保存はしない。iPhoneの正確な失敗箇所は未再現なので解消とは断定しない。新版の確認コードで継続調査できる状態。
- 証拠: /private/tmp/uni-pocket-original-pdf-preview.png、/private/tmp/uni-pocket-auto-update-wait.png、/private/tmp/uni-pocket-auto-update-complete.png。
- 引継ぎ: ホーム画面のアプリ内で初回のみ「その他」→「更新を確認」→「保存して更新」。画面build末尾64687dを確認してPDF再試行。再発時は短い[PDF:...]コードを受領して015を継続。再インストール/データ削除は不要。
- 計測: condition=harness、task016、日付2026-10-19 JST、開始/所要時間/利用量=null（未取得）。実装/レビューgpt-6.1-sol/high、統合gpt-6-luna/medium。比較ベンチマークなし。
