# Cloudflare 配信・共有API運用

この資料は `web/` を実行ディレクトリとする。共有APIは `server/worker.ts`、D1マイグレーションは `migrations/`。フロントの `wrangler.jsonc` とビルド設定を合わせて利用する。本番アカウント・DB・ドメインは未接続で、本番配信や実機合格を意味しない。

## 必要な設定

- Node.js 22.18以上（推奨24以上）、npm、プロジェクトに固定されたWrangler。
- CloudflareのWorkers/D1を作成できるアカウントと配信認証。ブラウザへAPIトークンを渡さない。ローカルは認証不要。
- Worker entry: `server/worker.ts`。D1 binding: `DB`。静的Assets binding: `ASSETS`、directory: `./dist`、`run_worker_first: ["/api/*"]`、`not_found_handling: "single-page-application"`。
- 毎時のScheduled trigger例 `0 * * * *`。古いセッション/レート制限/閲覧重複キー/送信キーを各500行まで削除する。高トラフィック時は滞留件数を監視して頻度を調整する。
- `APP_ORIGIN` は任意。設定するなら正確な配信元（例 `https://campus.example`、末尾スラッシュなし）。未設定はリクエストURLのoriginと照合。プレビュー・本番で値を共有しない。ローカル設定に本番originを入れない。
- `env.preview` と `env.production` は **異なるWorker名、異なるdatabase_id、異なる公開URL** を設定する。D1 bindingやvarsは各環境へ明示する。仮IDを実DBのIDで置換するまでクラウドへ配信しない。
- 開始時はFreeプランのまま運用し、課金プランへの変更は別途判断する。

例（既存 `wrangler.jsonc` の対象環境に設定する項目）:

```jsonc
{
  "main": "server/worker.ts",
  "assets": {"directory": "./dist", "binding": "ASSETS", "run_worker_first": ["/api/*"], "not_found_handling": "single-page-application"},
  "triggers": {"crons": ["0 * * * *"]},
  "env": {
    "preview": {
      "name": "campuspocket-preview",
      "d1_databases": [{"binding": "DB", "database_name": "campuspocket-preview", "database_id": "REPLACE_PREVIEW_ID", "migrations_dir": "migrations"}]
    },
    "production": {
      "name": "campuspocket",
      "d1_databases": [{"binding": "DB", "database_name": "campuspocket-production", "database_id": "REPLACE_PRODUCTION_ID", "migrations_dir": "migrations"}]
    }
  }
}
```

## ローカル

```sh
npm ci
npm run typecheck
npm run test:all
npm run test:integration
npm run db:local
npm run local
```

同じ `http://127.0.0.1:8787` originで画面とAPIを開く。別portの静的previewだけでは共有APIに接続できない。`Secure` Cookieはloopbackを安全なローカル開発元として扱うブラウザで利用する。LAN上の端末試験にはHTTPSプレビューを使う。`--remote` を付けなければローカルD1を使う。ローカルデータはWranglerの `.wrangler/state` に保存される。削除すると匿名権限を失うため、本番データと同様にCookieとDBを一緒に保持する。

テストは実SQLiteへ本番SQLを適用し、ハンドラを実行する。モックの固定応答は使わない。実D1環境の制限やエッジCookie配送は別途プレビューで確認する。

`npm ci` はlockfileのWrangler・Miniflare・esbuildも導入する。追加インストールは不要。`npm run test:runtime` は固定したMiniflare 5.20261012.1-betaの実workerd/D1で、12件の同時冪等投稿・20件の同時保存/閲覧を確認する。`npm run test:integration` はビルド後にWrangler Static Assets＋API＋一時D1を起動し、ヘッダ・深いURL・投稿編集・匿名権限・保存の再起動復元を確認する。一時DBは通常の `.wrangler/state` と分離し終了時に消去する。これらのテストはlocalhostリスナーを開く。ブラウザのCookie保存とPWA更新は別の実操作確認が必要。

## 認証・データ境界

初回の `POST /api/session {}` または記事の `POST /view {}` で暗号学的ランダム32byte秘密値を発行。`__Host-campus_session` Cookieは `HttpOnly; Secure; SameSite=Strict; Path=/`、有効期間365日。D1にはSHA-256ハッシュのみ保存する。期限が切れたセッションは復元できず別ユーザーになる。ブラウザデータ削除・別ブラウザ・別端末でも以前の投稿編集やブックマークは復旧できない。Cookieをビルド更新で消去しない。セッション発行は同じブラウザ内でフロントが直列化する。Cookieがまだない同時初回要求をサーバーだけで同一ブラウザと判定する保証はない。

記事の投稿者/編集者/ブックマーク利用者は常に検証済みCookieから決める。bodyの所有者・viewer IDは受けない。Origin完全一致とFetch Metadataで書込を保護し、JSON content typeを必須化する。CORSは許可しない。GETでも個人状態を返し得るため、**全API応答をprivate/no-store** にする。Service Worker・CDNの汎用キャッシュへ `/api/` を入れない。

投稿者ID・表示名と記事情報のみ公開する。セッショントークン/ハッシュ/有効期限・閲覧者キー・他人のブックマーク一覧は返さない。記事ID・投稿者IDは権限証明にならない。Notion本文・画像・個人PDF/メモ/背景はサーバーに保存しない。

ブックマークは `(user_id, article_id)` 一意制約と `INSERT OR IGNORE` で冪等化。閲覧は `(article_id, viewer_key, day_jst)` 一意制約＋INSERTトリガーで累計を原子的に加算。JSTの00:00で日を区切る。初回閲覧の保存後に読取が失敗しても発行済みCookieをエラー応答へ残し、再試行で別の匿名IDを作らない。重複キーを7日程度で削除しても累計は減らない。匿名IDを失った場合や別端末の厳密な重複排除はできない。数字はアプリ内で詳細を開いた記録で、読了・Notion PV・埋込成功ではない。

投稿時は `Idempotency-Key`（8–128文字、英数字・`_`・`.`・`-`）を一度の送信ごとに生成し、通信失敗時には同じキー/内容で再試行する。30日間保持。同じキーの内容変更は409、削除後の同じ送信再試行は410。別キーでも同じ投稿者＋正規化公開URLは重複拒否する（409）。別投稿者の記事登録は禁止しない。

入力上限: タイトル120、紹介文280、表示名40、カテゴリ60、講義ID120文字、URL2048文字、JSON本文16KiB。公開URL/埋込URLはHTTPSかつ `notion.site` / `notion.so` またはその正しいサブドメイン。資格情報、非標準port、空ページpath、他ホストを拒否。fragmentと既知の共有追跡parameterを削除。任意URLへのサーバーfetchは一切しない。通常URLから特殊な埋込URLを生成しない。公式「このページを埋め込む」コードの `src` のみ補助入力へ使い、HTML自体は実行/保存しない。[Notion公式の埋込手順](https://www.notion.com/help/public-pages-and-web-publishing)を参照。実際の対象ページの表示可否は未確認で、iframe loadだけから成功を断定できない。公開サンプル `https://gridfiti.notion.site/Flix-Clock-Widget-Setup-9e19f260d89643ff8273309bde21c471` は2026-10-18の実ブラウザ確認で直接表示できた一方、同じ通常URLのiframeは拒否された。この通常URLをそのまま埋め込めると扱わない。対象ページの所有者が公式機能で取得した埋込srcを用意して、Android/iPhoneで確認する必要がある。

レート制限はD1の原子的UPSERT: IPごとの初回セッション10回/時、書込180回/分、認証済ユーザー書込120回/分。429とRetry-Afterを返す。IP値はCloudflareが設定する `CF-Connecting-IP` のみ使用（ローカル未設定時は共通local）。元IPを渡す別リバースプロキシ下での運用には別途信頼境界を検討する。共有回線では制限を共有する。個別攻撃者の大規模IP切替・ボット攻撃を完全には防げないためCloudflare側ルールとDB利用量を監視する。

## プレビューから本番へ

以下のクラウド操作は、アカウント/公開先を決めた運営者が実行する。作成したIDを設定へ記入する。

```sh
npx wrangler login
npx wrangler d1 create shizudai-pocket-preview
npx wrangler d1 create shizudai-pocket-production
npx wrangler d1 migrations apply DB --remote --env preview
npm run build
npx wrangler deploy --env preview
```

プレビューの別ブラウザA/Bで、初回匿名ID・再起動復元、投稿、本人編集/他人拒否、重複送信、ブックマーク追加解除/他人分離、閲覧同日重複を確認する。Android Chrome/iPhone Safariで本物の公開Notionページの埋込/元リンク、オフライン、インストール、旧版→新版更新（メモ/匿名ID/ブックマーク保持）を確認する。未確認を合格に置換しない。

本番へ進める前にD1 exportと現在のWorker deployment/version IDを保存し、build IDと変更内容を確認する。

```sh
npx wrangler d1 export DB --remote --env production --output=production-before-release.sql
npx wrangler d1 time-travel info DB --env production
npx wrangler deployments list --env production
npx wrangler d1 migrations apply DB --remote --env production
npx wrangler deploy --env production
```

初回DBが空ならバックアップ対象がない点を記録する。公開後、HTTPS/深いURL/manifest/SW/記事APIのno-store・Cookie・投稿/保存を確認する。DB migrationは追加型を基本に旧クライアントと互換を保つ。公開時に既存のユーザー/ブックマークを消すseedやresetを実行しない。

Git連携を使用する場合はCloudflare Workers Buildsでリポジトリと公開対象branchを運営者が接続する。Build commandは `cd web && npm ci && npm run typecheck && npm test && npm run test:server && npm run build`、deploy commandは対象環境の `npx wrangler deploy --env production`（working directoryをwebに設定している場合は `cd web` を除く）。DB migrationはバックアップ付きの明示リリース段階で行う。PR・任意branchから本番DBへ配信しない。認証トークンはCloudflareのsecret管理へ置く。Git接続は未実施。

## ロールバックと障害

1. 共有API障害では成功扱いせず入力と端末内の個人データを保持する。静的本体/個人機能はAPI障害から独立する。
2. コードを戻す時は保存したIDで `npx wrangler rollback WORKER_VERSION_ID --env production`。静的アセットとWorkerを同じ版へ戻し、DB互換を確認する。Cookie/IndexedDBを消す対処は行わない。コードのrollbackはDBを巻き戻さない。
3. DB破損・誤migrationは書込を停止して現在のexportと復旧点を保存し、運営者の判断で `npx wrangler d1 time-travel restore DB --bookmark=BOOKMARK --env production`。復元点以降の投稿・保存・セッションを失う操作であり、通常の配信rollbackには使わない。復元後はschema/migration履歴/API互換・匿名セッション・集計を再検証する。
4. Time Travel対象外の長期復旧は安全な新規DBにexportをimportして確認し、bindingを切り替える設計が必要。exportにはセッションハッシュ等を含むため非公開で厳重に保管する。
5. 修正版は新build IDで配信して次回更新確認から取得する。旧版タブに必要なアセットは保持する。自動reloadや保存領域消去を障害回避策にしない。

[D1 Time Travel公式資料](https://developers.cloudflare.com/d1/reference/time-travel/)ではFreeは7日、Paidは30日とされている（2026-10-18確認）。実アカウントのプランと復旧可能範囲を操作前に確認する。

## 容量・上限・未確認項目

検索はタイトル/紹介文へのエスケープ済LIKE検索、カテゴリ/講義/投稿者/日時の索引、最大50件のcursor pagination。大規模全文検索には向かない。D1の読取/書込行はAPI回数ではなく走査と索引更新も含む。Freeの目安はD1 500万read行/日、10万write行/日、総保存5GB、1DB500MB。WorkersのFreeも10万リクエスト/日等の制限がある。静的AssetsとAPI課金は異なる。[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[D1上限](https://developers.cloudflare.com/d1/platform/limits/)、[Workers上限](https://developers.cloudflare.com/workers/platform/limits/)、[Assets料金](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)を確認する。枠超過時の共有API成功は保証しない。

レート制限保存そのものも書込を消費する。プロフィールは公開記事の投稿者を保持するため削除しない。記事/ブックマークの増加、清掃の滞留、DBサイズ、rows_read/rows_writtenを監視し、無料枠に永久に収まると約束しない。

未確認: 本番Cloudflare/D1実配信とバックアップ復元、本番originのCookie、実Android/iPhoneのインストール・更新、本物の対象Notion埋込、実アクセス時のCPU/行数/無料枠。ローカルSQLiteテストはこれらの代替ではない。
