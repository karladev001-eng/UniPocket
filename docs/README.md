# ドキュメント索引

リポジトリの入口は [ルートのREADME](../README.md) です。ここでは詳細文書の置き場所をまとめます。

## PWA（Uni Pocket, `web/`）

| 文書 | 内容 |
|---|---|
| [pwa.md](pwa.md) | PWAの概要、ローカル実行、データの置き場所、更新の考え方、配信状況と未確認事項 |
| [web/CLIENT.md](../web/CLIENT.md) | Webクライアントの詳細: IndexedDB保存とrevision照合、PDF取込、Service Worker更新プロトコル、Notion埋め込みと匿名セッション、ローカル結合の検証記録 |
| [web/DEPLOY.md](../web/DEPLOY.md) | Cloudflare Workers / D1 の設定、認証・データ境界、入力上限、preview→production手順、ロールバック、容量と無料枠 |
| [web/admin/README.md](../web/admin/README.md) | 管理画面（別originの管理Worker、Access/JWT、記事・通報・お知らせ・アンケート・集計、運営記事） |

## Swift版（CampusPocket）

| 文書 | 内容 |
|---|---|
| [ios.md](ios.md) | 導入、画面と操作、キャンパスマップのデータ、PDF再取込、Outlook表示、保存・移行、記事と下書き、テーマ・背景 |

## 共通

| 文書 | 内容 |
|---|---|
| [testing.md](testing.md) | PWAとSwift版のテストコマンド、検証内容、日付付きの検証記録 |
| [toolchain.md](toolchain.md) | Node.jsの許可版、CA bundleと `verify:tls`、Wrangler・Homebrewツールの扱い |
| [harness/README.md](harness/README.md) | 開発記録（タスク001〜024の仕様・承認・レビュー・検証）の索引と読み方 |
