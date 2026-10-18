# 014 — Uni Pocketの個人検証環境

- 状態: done（本人限定Access適用・HTTPS配布・本人ログインと記事/更新確認済み。スマートフォン実機検証は利用者へ引継ぎ）
- 仕様版: 1
- 基点: 683f253
- 目的: 利用者本人がスマートフォンからHTTPSで使って検証できるURLを用意する。

## 範囲・承認

- 名称候補は既にチャットに提示済み（UniPocketを含む）。本人が「Uni Pocketでいいです」と空白を含む表記で確定した。既存012の画面を再利用し、ブランド表示・ブラウザタイトル・PWA表示名のみUni Pocketへ置換。新しいUI構造は追加しない。
- 011 v3のCloudflare配布/更新AC11–12は提示後明示承認済み。今回「まず自分で使えるようにして、検証できるようにしてください」と実環境準備を依頼。Cloudflare無料枠・検証環境から開始し、本番/課金変更はしない。
- 013地図再設計はpendingのまま。今回の依頼を013承認へ流用しない。

## 仕様・受入条件

1. 表示名をUni Pocketに統一。Swift版、IndexedDB名、Cookie名、既存保存データは維持する。
2. 検証Worker/DBはuni-pocket-preview、本番予約設定はuni-pocket/uni-pocket-production。実DB IDは認証後に確認して設定。既存remoteリソースがあれば衝突せず扱う。
3. build/typecheck/deploy dry-runを確認し、実認証後は検証DB1個へmigrationとWorker配信。無料プランのみ。
4. 公開範囲の回答に応じアクセス制限を整えてからURLを渡す。本人限定なら保護を確認するまで未保護URLを配布しない。
   - 初回preview設定はworkers_dev=false/preview_urls=false。HTTP入口なしでWorkerを作成し、当該Worker全体のAccessを本人メール1件で設定後、workers_devだけ有効化する。Zero Trustの無料プラン初期設定や規約同意が必要なら本人に引き継ぐ。
5. HTTPS/manifest/API/匿名保存/Notion/更新の検証可能な範囲を確認し、iPhone/Android実機は本人向け手順で残す。ローカルから別originの新環境へ端末データが自動移行しない点を案内。

## 確定した運用条件

- Cloudflare OAuthは本人がAuthorizeを操作し成功。whoamiでアカウントを確認済み。パスワードやAPI tokenをチャットに貼らせない。
- 公開範囲は本人が「自分だけが開ける検証環境」と回答。Cloudflare Accessで本人のメールに限定し、保護が整うまで外部公開しない。他のWorkerへの設定変更は行わない。
- accountは16fc5adb2aa88a3caad1f7c07c5dd026、preview D1はb8a2db54-3dd7-414b-a11e-0edafb59fad6。workers.dev URLを保護後に有効化済み。独自ドメインは初回不要。実装を妨げる未解決事項なし。

## 担当と確認

- active/delegation/review/persistence/measurement/improvement_loop=true,max_agents3,auto no pins。
- 名称/配布準備は決定的な置換と検証のためgpt-6-luna/medium、独立レビューgpt-6.1-sol/highを選ぶ。候補と対応effortはcollaboration.spawn_agent宣言で確認。
- 製品コードの担当は別worktree。親は認証と公開範囲を調整。外部deployは必須条件が揃ってから。

## 実行履歴（過去時点の状態を含む）

- 名称変更: 3f593bd。typecheck/build/manifest確認/preview dry-run成功。Swift、IndexedDB、Cookieは維持。
- 独立レビュー: uni_pocket_review（gpt-6.1-sol/high）PASS。統合: uni_pocket_integrate（gpt-6-luna/medium）がcodex/pwa-migrationへfast-forwardし差分を検証。
- OAuthログインを開始し、Cloudflareログイン画面を本人へ引き継いだ。待機はタイムアウトし、本人のログイン後にOAuthリンクを再発行する。新規権限の許可は本人操作。実認証・DB作成・実配布は未完了。
- 本人限定回答を受け、previewのHTTP入口を初期無効化する設定da52c80とAccess手順修正fbdd975を追加。dry-run/差分チェック成功。独立レビューは初回に確認順序の不備を検出し、設定確認→URL有効化→実リクエスト確認の順へ修正後PASS（683f253..fbdd975全体も確認）。
- 公式確認: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ （単一Workerの全traffic保護）、https://developers.cloudflare.com/workers/wrangler/configuration/ （workers_dev/preview_urls）。
- Zero Trust初期設定は無料プランでも支払情報入力が必要と公式に記載。必要時は本人が入力/規約同意し、課金プランへ変更しない。https://developers.cloudflare.com/cloudflare-one/setup/
- 実環境: D1一覧は空、同名Workerは10007不存在を確認後、uni-pocket-preview DBをAPACに作成。0001_articles.sqlの19コマンドをremoteに適用成功。設定commit1c523faは独立レビューPASS・統合済み。
- Zero Trust実画面: Free基本料金$0/月。ただし支払方法/請求先/規約に加え無料枠超過課金許可のチェック欄あり。「無料なら請求なし」という先の説明を訂正し、本人へ登録操作か別方式の選択を依頼した。課金許可/規約/支払情報は代理操作していない。
- 配布成功: Worker uni-pocket-preview、version 5b087869-2de7-42d5-aa8d-dbf985a877a5、build 20261018142302-1fbcd5。D1/ASSETS bindingと毎時cronを設定。初回はaccount subdomain未生成によりcronのみ10063で失敗したが、Workers一覧を開いてkan0507kt.workers.devの自動作成を確認後、同設定を再配布しexit0で完了。
- Dashboardで「有効なURLがありません」、ドメイン0、トリガー1、DB/ASSETSの2bindingを確認。workers_dev=false/preview_urls=falseを維持。まだスマートフォンから利用不可。本人限定Access設定・URL有効化・HTTPS/API/PWA検証は残作業。
- 費用表現を訂正したdocs-only commit5e93b85は独立レビューPASS・統合済み。本人操作待ちタブはZero Trust Free checkout/payment。証拠 /private/tmp/uni-pocket-zero-trust-checkout.png、/private/tmp/uni-pocket-worker-private.png。
- 本人が「Zero Trust Freeの登録ができました。自分だけが使えるように設定を続けてください」と依頼。再利用ポリシー731f4573-40e5-44f6-9275-b212f4ac5252（Uni Pocket — owner only）はAllow、Emails完全一致1件のみ。これをuni-pocket-previewのWorker-level Access All trafficへ適用し、保存後のDashboardで全URLログイン必須・本人メール許可を確認。Access app b27f1c81-de99-474b-9460-113078e420e4、team delicate-fog-c883.cloudflareaccess.com。証拠 /private/tmp/uni-pocket-owner-access.png。

## 完了記録

- 結果: https://uni-pocket-preview.kan0507kt.workers.dev を本人のCloudflareアカウントだけで開ける検証環境として配布。preview URLは無効のまま、workers_devのみ有効化。
- 対象仕様版: 014 v1（配布/更新は承認済み011 v3 AC11–12）。013地図再設計は未承認のまま対象外。
- コード版: d5976923823c23686b12adca63f0a328d8f1d7d5。Worker version 94a9b263-f8bd-4cb8-a88b-62b369074ed4。配信build 20261018142302-1fbcd5。
- 変更ファイル: README.md、web/CLIENT.md、web/DEPLOY.md、web/index.html、web/public/manifest.webmanifest、web/scripts/service-worker.mjs、web/src/main.ts、web/wrangler.jsonc。
- AC1–3: 名称・manifest・型・build・dry-run検証済み。D1 migrationとWorker/ASSETS/cron配布成功。Swift・既存端末保存識別子を維持。
- AC4: Dashboardで単一Worker All traffic、本人メール1件Allowを確認。未ログインのブラウザはCloudflare Accessログイン画面へ遷移。資格情報なしHTTP GETの /、/api/articles、/api/session、/manifest.webmanifest、/sw.js、/version.jsonは全て403（このHTTP応答だけでAccess由来とは断定せず、ブラウザと設定の証拠を併用）。本人のCloudflareログインではアプリへ到達。
- AC5: 公開先UIで空の記事一覧取得→本人提供Notion検証ページ登録→埋め込み本文表示→閲覧1/ブックマーク1→再読込後も状態保持を確認。検証記事ID b4b4d67f-0a15-468f-adef-a64c1c5f5471。「その他」の更新確認で配信buildを取得し、画面buildと一致。Service Workerのナビゲーションキャッシュ動作も確認。証拠 /private/tmp/uni-pocket-private-live.png。
- レビュー: uni_pocket_reviewがd597692の設定差分とAccess証拠を独立確認しPASS。uni_pocket_integrateがrootへfast-forward統合、683f253..HEADのdiffチェック成功。
- 残る制約: iPhone/Android実機のインストール・次回配布時の更新切替は未検証。manifestはビルド時確認済みだが、公開先で直接ナビゲーションするとService Workerがアプリ画面を返すため、その操作ではmanifestレスポンスを検証していない。Accessログインとアプリ内匿名IDは別であり、メモ等の端末データや投稿の編集権限は端末間で同期しない。ローカルoriginから自動移行しない。
- 引継ぎ: スマートフォンで検証URLを開き、同じCloudflareアカウントでログイン。ホーム画面への追加は「その他」のインストール手順を参照。
- 計測: condition=harness、task=014、終了=2026-10-18T14:53:33Z、開始/所要時間/利用量=null（未取得）。実装gpt-6-luna/medium、レビューgpt-6.1-sol/high、統合gpt-6-luna/medium。比較ベンチマークなし。
