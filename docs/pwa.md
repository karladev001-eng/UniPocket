# Uni Pocket（PWA）

URL配布・検証用の独立したPWAを `web/` に用意しています。PWAの表示名はUni Pocketです。ホーム / 時間割 / 記事 / メモ / その他の5画面を備え、掲示板は表示しません。ブラウザごとの空の個人データから始め、既存Swift版のファイルや保存データは変更しません。

関連文書:

- [Webクライアント説明](../web/CLIENT.md): 端末内データ、PDF取込、更新プロトコル、Notionと匿名ユーザー、ローカル結合の検証記録
- [配信手順](../web/DEPLOY.md): Cloudflareのpreview/production分離、D1 migration、認証・データ境界、公開・バックアップ・ロールバック
- [管理画面](../web/admin/README.md): 別originの管理Worker、Access/JWT認証、記事・通報・お知らせ・アンケートの管理
- [ツールチェーン](toolchain.md): Node.jsの版、CA bundleと `verify:tls`
- [テストと検証記録](testing.md)

## ローカル実行

[修正版のNode.js](toolchain.md#nodejs) で、リポジトリ内の `web/` を実行ディレクトリにします。

```sh
npm ci
npm run verify:tls
npm run typecheck
npm run test:all
npm run test:integration
npm run db:local
npm run local
```

`http://127.0.0.1:8787` でPWA本体とWorker APIが同じoriginで動きます。`test:integration` が本体をビルドし、一時D1で結合を検証します。通常は `npm run build` でもビルドできます。`local` / `db:local` は明示したpreview環境のローカルDBを使い、Cloudflare認証は不要です。Viteの静的previewだけでは記事APIは動作しません。

## データの置き場所

時間割・PDF差分・メモと画像・施設とリンク・地図・テーマと背景は端末内に保存します。Notion記事は公開URLと一覧情報を共有DBへ登録し、本文はNotionで表示します。匿名ユーザーのCookieで投稿編集とブックマークを管理します。外部カレンダー連携と旧Swiftデータの自動移行は初回対象外です。端末内データやPDFは記事サーバーへ送信しません。

## 更新

本体の更新は通知後に利用者が操作し、開いているタブの入力保存を確認して適用します。記事API・認証応答はオフラインキャッシュへ入れません。保存・匿名権限の制約、PDF対応範囲と更新動作は [Webクライアント説明](../web/CLIENT.md)、Cloudflareのpreview/production分離、D1 migration、公開・バックアップ・ロールバック手順は [配信手順](../web/DEPLOY.md) にあります。

## 配信状況と未確認事項

旧READMEの記述（PWA初回統合時点、2026-10-18 の [ローカル結合の検証記録](../web/CLIENT.md#ローカル結合の検証記録2026-10-18) と同時期）:

> Cloudflareの本番アカウント・実DB・公開URLは未接続です。デスクトップのローカル実ブラウザでは、本人提供の公式コードでNotion本文の埋め込み、投稿・保存・再読込、2タブの旧版→新版更新とメモ・匿名権限・ブックマークの保持を確認しました。実Android/iPhoneの導入・更新・Notion埋め込み、実PDFの取込、クラウド上のバックアップ復元は未確認です。設定内の仮DB IDを実IDへ置換し、配信手順の実環境確認を終えてから配布してください。

その後の経過（各タスク記録より）:

- [014](harness/tasks/014-uni-pocket-preview.md): `env.preview` のWorker `uni-pocket-preview` とpreview用D1を作成し、本人限定のCloudflare Accessで保護したworkers.dev URLへ配信。
- [020](harness/tasks/020-public-admin.md): 管理Worker `uni-pocket-admin`（所有者限定Access＋サーバー側JWT検証）を追加し、2026-10-20に一般アプリのAccessだけを解除して一般公開。
- [022](harness/tasks/022-article-header-color-mode.md): 2026-10-23に最新版を一般Workerへ配信（[023](harness/tasks/023-tls-toolchain.md) のTLS対策済み経路を使用）。
- `env.production`（Worker `uni-pocket` / D1 `uni-pocket-production`）は予約設定のままで、DB IDは仮値です。公開中のアプリはpreview環境のWorkerとD1で動いています。
- 未確認のまま残っている項目: 旧iPhone実機での更新適用とデータ保持（[016](harness/tasks/016-in-app-auto-update.md)）、Android/iPhone実機での導入・更新の網羅確認、クラウド上のバックアップ復元。詳細は [Webクライアント説明の未検証項目](../web/CLIENT.md#未検証実環境の受入) と [配信手順の未確認項目](../web/DEPLOY.md#容量上限未確認項目) を参照してください。
