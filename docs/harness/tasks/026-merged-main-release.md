# 026 — マージ済み main の配信

- 状態: done（2026-10-31配信・独立レビュー完了）
- 仕様版: 1（配信作業のみ。製品仕様の追加・変更なし）
- 配信対象: `303b87d95b8cac5a8f03e6aadfa2dfa1d3e73ac4`
- Git tree: `87aa4088689c45d6b99c9b52aa58002b5c7cd19e`
- 承認根拠: 2026-10-31「マージした最新版を配信してください。URLから誰でも使用できるようにしてください」
- 元の機能仕様・モック: 011–022、整理・開発環境の仕様: 024–025。今回の変更は既承認実装の配信。新しいUIモックは非該当。
- 対象外: 新機能、DBの初期化・実データ編集、管理者権限の拡張、有料プラン変更。

## 受入条件

1. R1: GitHubのマージ済み `main` と同じコミット・treeを、未コミット変更を含めず配信する。
2. R2: プロジェクトのTLSガードを保ち、型検査・lint・テスト・ビルドの結果を記録する。
3. R3: 既存の一般URLから未認証でアプリ、manifest、Service Worker、一般APIへ到達できる。
4. R4: 管理画面は所有者限定のCloudflare AccessとWorker内のJWT検証を維持する。
5. R5: 既存D1のbinding・schema・データを保持し、配信前のWorker版とTime Travel復旧情報を保存する。
6. R6: 配信したWorker版・ビルド・静的ファイルと、ブラウザからの更新を確認する。

## 担当・制約

- coordinator: 現在のホストモデル（変更なし）。
- release operator: `merged_main_release`、`gpt-6.1-sol / medium`。本番設定・データを扱うためSolを選択。
- independent reviewer: `merged_main_release_review`、`gpt-6.1-sol / high`。認証・データ保持・配信証拠を独立評価。
- harness auto、pinなし。候補・effortはホストの `collaboration.spawn_agent` 定義で確認。両担当は `fork_turns=none`、再委譲なし。
- 作業場所: `/private/tmp/campuspocket-merged-main-release`、私有ログ: `/private/tmp/campuspocket-release-evidence`。
- 一般アプリは名前がpreviewの既存公開Workerを使う。`env.production`の仮DB IDは使わない。
- 管理Workerのチェックイン済み `workers_dev:false` は現行公開設定と異なるため、実際の保護設定を維持した配信パラメータを事前確認する。
- 以前の自動レビューでDB全量exportが拒否されたため再実行しない。今回はTime Travel bookmark・旧コード版と読取専用の集計・migration情報で復旧準備する。

## 配信前の確認

- PR #2 → PR #1 の順にマージ済み。最終mainのtreeはPR #2のCI成功対象と一致。
- 2026-10-31の再CIはGitHubの支払い・利用上限によりジョブが開始されず失敗表示。コード検証の失敗とは区別する。
- 未認証の一般URLは表示可能。更新前の画面と配信中ビルドは `20261023054059-ef7f5e`。ブラウザ内の既存ユーザー名も保持されている。
- 新しい `npm audit` の11 moderateは、開発用ESLint系の単一勧告 `GHSA-g3hv-75wg-m249` の依存先への伝播。攻撃者が与えるglobによる増幅が条件。配信コードへのimportはなく、今回の配信を止める問題ではないと独立レビューで判定。lockfileの変更や古いESLintへの自動downgradeは行わない。

## 完了記録

- 結果: マージ済みmainの一般・管理Workerを100%配信。一般URLはログイン不要、管理URLは従来と同じAccess保護を維持。
- 一般URL: https://uni-pocket-preview.kan0507kt.workers.dev/
- 管理URL: https://uni-pocket-admin.kan0507kt.workers.dev/
- 対象仕様版: 本配信仕様v1、製品仕様の追加なし。ソースコミット・treeは上記と一致し、配信worktreeはclean。
- ビルド: `20261031090505-b40782`（2026-10-31 18:05 JST）。
- 一般Version: `8663d6b8-5f9a-4a7b-8b44-092620643329`、deployment `b88a74c0-7a77-45b7-b300-150a05c1747d`。
- 管理Version: `4fa46fdc-a86b-4ba7-b6e4-7fc810a0d3c7`、deployment `54871faa-8f66-4437-8b3f-fa9d5026b029`。
- 配信条件: 一般は`--env preview --keep-vars`、管理は現行の`workers_dev:true`と絶対パスだけを反映した一時設定＋`--keep-vars`。両方のdry-run成功後に配信。Accessの設定変更、DB migration、SQL全量exportは行っていない。
- R1: exact main・treeとartifact manifestを照合。手元の未コミットファイルは含まない。
- R2: Node26.13.0 / npm11.20.0 / Wrangler4.155.0。TLSはNode・Miniflare・Wranglerの3実行系で成功。lint、一般/server/admin型検査、231テスト、7統合テスト、両ビルド成功。production依存のauditは0件。開発依存の11 moderateは上記の既知制約として残る。
- R3: 未認証でHTML・深いURL・manifest・SW・一般APIが成功。APIはno-store、公開Workerの管理APIは404。アプリ内「ホーム画面に追加・URLを共有」の入口を維持。
- R4: 管理HTML・API・資産は配信前後とも同じAccessアプリへ302。secret名、team、DB binding、公開設定は一致。所有者JWT検証は変更前と等価、ローカルの所有者・非所有者テストも成功。
- R5: D1 binding・migration履歴を維持。profiles3 / sessions2 / articles2 / bookmarks2 / announcements0 / surveys0 / admin_audit2は配信前後一致。検証用SQLはrows_written0。コードrollback用の旧一般Version `7f9c4d8b-fe28-456e-a17f-fe4bfe5610c7`、旧管理Version `70cbce21-741b-400d-896c-a163facc99e5`とTime Travel bookmarkを私有ログへ保存。
- R6: SW参照211ファイル（5,605,243 bytes）がすべてHTTP200、ローカルのSHA256と一致。独立担当も主要6ファイルを再取得・照合。親の実ブラウザでは旧版の「更新を確認」→「新版を取得中…」→自動切替→「最新です」を確認し、この画面/配信中のビルドが両方`20261031090505-b40782`、既存ユーザー名も保持されていた。キャッシュや端末内データは削除していない。
- 独立レビュー: `merged_main_release_review`、R1–R6すべてPASS、必須指摘なし。
- 証拠: `/private/tmp/campuspocket-release-evidence/release-manifest.json`、同ディレクトリの配信・設定・D1・テスト・資産照合ログ、`/private/tmp/campuspocket-review-http-after.json`、`/private/tmp/campuspocket-review-admin-after.json`。
- ブラウザ画面: `/private/tmp/uni-pocket-main-20261031-live.png`。
- 残る制約: 実iPhone/Androidでのインストール、管理者本人の実環境ログイン後の操作、DB復元は今回再実施していない。開発用lint依存の[単一minimatch勧告](https://github.com/advisories/GHSA-g3hv-75wg-m249)は別途修正対象。GitHubの請求・利用上限によるCI停止も今回の配信では変更していない。
- 記憶更新: 新しいUI評価やコード修正はなく、好み・技術lessonへの書込みは行わない。配信の事実はこの完了記録に集約。
- 計測: 09:03:34–09:09:11 UTCは取得できた作業中の観測区間のみ。開始前の時間・利用枠消費は未取得のため、タスク全体の所要時間や原価としては扱わない。
- 計測保存: `measure record`は通常権限でEPERMになった後、同じ入力を権限付きで保存成功（exit0）。337秒の観測区間、comparable=false、利用枠差分はnull。送信待ち・新たなlesson記録なし。
- 引継ぎ: なし（開発用依存の警告・GitHub請求設定は上記制約として別管理）。
