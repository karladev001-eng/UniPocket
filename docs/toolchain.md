# 開発ツールチェーンとTLS信頼

PWA（`web/`）の開発・テスト・配布準備で使う実行系の要件です。背景と検証記録は [タスク023](harness/tasks/023-tls-toolchain.md) にあります。

## Node.js

修正版のNode.js（22.23.4以上の22系、24.22.1以上の24系、26.12.1以上の26系）で、リポジトリ内の `web/` を実行ディレクトリにします。npmのengine-strictと各入口で古いNodeを拒否します。

## CA bundleと `verify:tls`

開発・テストの外向きHTTPSには更新済みのCA bundleが必要です。macOSはHomebrewの`ca-certificates`、LinuxはOS管理のPEM bundleを読みます。ほかの環境は`UNI_POCKET_CA_FILE`に更新済みbundleの絶対パスを指定します。

`verify:tls`は認証情報なしで正常HTTPSと4種の危殆化eMudhra証明書を、Node・テスト用Miniflare・ローカルWranglerで検証します。全成功の記録をこの作業コピーの`web/.wrangler/`に7日間だけ保存し、CA・Node・lock・検証処理が変われば再検証が必要です。失敗・未検証時はローカルWorker/D1テスト・Wrangler起動を止めます。型検査・ビルドはオフラインでも実行できます。

```sh
cd web
npm ci
npm run verify:tls
```

## 固定している開発ツール

Wrangler 4.155.0、Miniflare 5.20261023.2-beta（`web/package.json` で固定）、workerd 1.20261023.1、undici 7.30.1を `web/package-lock.json` が解決します。Wrangler/Miniflare/lockが変わると `verify:tls` の記録は無効になり、再検証が必要です。`npm audit`（開発依存を含む）は0件を維持します。

## Wranglerの呼び出し方

Wranglerは`npm run wrangler -- ...`、開発起動とテストは [PWAの説明](pwa.md#ローカル実行) のnpmコマンドを使います。直接の`npx wrangler`はこのプロジェクトの実行系・CA検査を通りません。`--force`・`--ignore-scripts`・TLS検証無効化で対策を回避しないでください。

## Homebrew版 curl / git / Python

Homebrew版curl/git/Pythonも、実行先とCA設定の両方を確認します。`/usr/bin/curl`の絶対パス呼出や別のPython仮想環境・requests独自bundleへ結果を一般化できません。GitのCA設定は各リポジトリごとに確認し、OS・グローバル設定はこのプロジェクトでは変更しません。

## 対応OS

今回の実測対象はmacOS/Homebrewです。Linux/Windowsは同じ検証が通るまで使用を許可せず、CA不足時は更新・設定して再試行します。
