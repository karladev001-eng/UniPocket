# テストと検証記録

## PWA（`web/`）

`web/` で実行します。Node.jsの版とCA設定は [ツールチェーン](toolchain.md) を参照してください。

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | クライアントとWorkerの型検査 |
| `npm run typecheck:admin` | 管理画面の型検査 |
| `npm test` | クライアント単体テスト（個人修正・PDF差分、PDF座標パーサー、IndexedDB原本保護と複数タブ競合、SW更新プロトコル など） |
| `npm run test:admin` | 管理画面の単体テスト（認証の境界、入力保持・重複再試行、日時・期間・設問制約、DOM出力） |
| `npm run test:server` | 実SQLiteへ本番SQLを適用したAPIハンドラのテスト |
| `npm run test:runtime` | 固定したMiniflareの実workerd/D1で同時冪等投稿・同時保存/閲覧を確認 |
| `npm run test:toolchain` | Node版・TLS対策の入口ガード |
| `npm run test:all` | 上記 toolchain / client / admin / server / runtime をまとめて実行 |
| `npm run test:integration` | 本体と管理画面をビルドし、実Wrangler Static Assets＋API＋一時D1で結合確認 |
| `npm run build` / `npm run build:admin` | 一般アプリ / 管理画面のビルド |

各テストの詳細は [Webクライアント説明](../web/CLIENT.md#ローカル)、[配信手順](../web/DEPLOY.md#ローカル)、[管理画面](../web/admin/README.md) にあります。ローカル結合とブラウザでの確認記録は [CLIENT.md のローカル結合の検証記録（2026-10-18）](../web/CLIENT.md#ローカル結合の検証記録2026-10-18) を参照してください。

## Swift版（CampusPocket）

### 掲示板の回帰検証

掲示板の回帰検証は `node scripts/test-board.cjs`。同梱HTMLの実際のJavaScriptに対し、講義IDの分離、空状態、投稿/返信下書き、画像圧縮と処理中取消、IME中の講義変更、4テーマをDOM/Image/Canvasのスタブで確認します。実WebKit・写真ピッカー・IME・狭幅の確認は別のSimulator検証です。掲示板のテキスト入力は16px以上としてiOSのフォーカス時の自動拡大を避け、利用者によるピンチ拡大は制限しません。

### Coreテストとビルド

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer ./scripts/test-core.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  TIMETABLE_PDF=/path/to/timetable.pdf SCHEDULE_PDF=/path/to/r08_schedule.pdf \
  ./scripts/test-core.sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project CampusPocket.xcodeproj -scheme CampusPocket \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/campus-build \
  CODE_SIGNING_ALLOWED=NO build
```

Coreテストは34施設と42教室の対応、地図座標と画像比率、表記ゆれ、未知/オンライン/複数候補を確認します。既存テストでは保存失敗、schema=1移行と原本保持、破損データ、個人修正と再取込の競合、取消しと復元、旧所有IDによる重複除去、施設例外・分割・不正時刻、画像保存/参照と失敗、開始/終了の境界を確認します。実物PDFは環境変数が指定された時だけ読み、リポジトリへ複製しません。

キャンパスマップの元データと再生成手順は [Swift版の説明](ios.md#キャンパスマップのデータ) にあります。

### 記事と下書き

検証コマンド: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer scripts/test-core.sh` と `node scripts/test-articles.cjs`。Coreテストは原子的保存、画像/本文復元、読み込み失敗時の保護、古いrevisionの拒否、最大40MiB画像+50万codepointsのarchive上限を確認します。NodeテストはDOM/Selectionとnative bridgeのスタブで書式反応・IME確定・編集中テーマ変更・保存競合/失敗/初期復元・画像変換を検証します。実機のIME/Undo/選択や写真ピッカー全経路は別途確認が必要です。iOS27 Simulatorではホーム入口・一覧・執筆面・入力した非空本文の実ファイル保存・空下書きの戻る/再開を確認済みですが、Device Hubの入力モードとクリップボード同期の制約により、指定した半角Markdown文字列での実入力確認と、非空本文を再起動後に実画面で復元する確認は未完了です。

### 検証記録（日付順）

- **2026-10-09**：Xcode 27.0をコマンド単位の`DEVELOPER_DIR`で使用し、Simulator用とiOS実機SDK用の署名なしビルドに成功しました。既定のxcode-selectは変更していません。Simulator画面・小画面・ダーク・文字拡大などの確認結果は仕様の検証記録へ記載します。実機の大学Outlook接続・OS権限取消し・機内モード・実際の容量不足/クラウド写真未取得・VoiceOver操作はユーザー端末で確認が必要です。署名や端末操作を成功扱いにしていません。
  - 同時点の注記：Git初期化・コミット・公開は行っていません。（その後、2026-10-18にリポジトリへ初回コミット）
- **2026-10-17**：キャンパスマップ追加後のCore 18テスト・6スイートが成功しました。実物PDFの環境変数未指定のため、その条件付き読込部分は今回未実行です。Simulator画面の操作確認と実機/VoiceOverの確認は別に記録します。

タスクごとの詳しい検証記録は [開発記録の索引](harness/README.md) から各仕様を参照してください。
