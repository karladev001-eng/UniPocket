# タスク: 024 — 面接で見せられるコードとドキュメントへの整理

- 状態: ready
- 仕様版: 1
- コード基点: 18afcac（ブランチ `refactor/interview-ready`）
- 担当範囲: README.md、docs/、web/src、web/admin/src、web/server、CampusPocket・CampusCore（軽微のみ）
- 依存: なし
- 子のモデル・推論強度: 024a opus/high（107KBのmain.ts分割で回帰リスク最大）、024b sonnet/high（admin・workerの分割、テストで担保）、024c opus/medium（README・文書の構成と取捨判断）、024d sonnet/medium（Swiftの軽微整理）、レビュー opus/high
- モデル選択: auto、役割キー complex/standard/review、pinなし
- ホスト候補・対応effort・取得元: Claude Code Agent（harness:implementer/reviewer）、model=opus|sonnet|haiku、effort low〜max、2026-10-29 起動時設定
- 選択根拠と制約: 挙動不変のリファクタリングで、既存テスト全通過を回帰の基準とする

## 実装内容の説明・目的と対象範囲

面接官が読んでも構成と設計意図がすぐ分かるリポジトリにする。

- README.md を入口として再構成（概要・機能・技術スタック・構成・セットアップ・テスト・ディレクトリ・設計判断）。詳細は docs/ 以下へ移し、情報は削らない。
- docs/harness は場所を維持し（ハーネスCLIが `docs/harness/tasks` を前提にするため）、各タスクの最新仕様・最終証跡だけを残して旧版（v4〜v12等）を削除し、索引を置く。
- web/src/main.ts を画面単位のモジュールと共通ヘルパーに分割。web/admin/src/main.ts、web/server/worker.ts も責務ごとに分割。
- Swift版は命名・不要コードなど軽微な整理のみ。

対象外: 機能追加、UI・挙動変更、依存更新、公開済み履歴の書換え、013・018の作業中ファイル。

## 利用者から見た振る舞い・入出力・異常時

利用者から見た振る舞いの変更はない（挙動不変のリファクタリングと文書整理）。

## 全体像（大きな実装）

024a（PWAクライアント分割）・024b（admin/worker分割）・024c（文書）を並列、024d（Swift）を後続、統合後に独立レビュー。

## 実装前の提示

- 説明・仕様の参照と版: 本パケット v1（会話内で提示した整理案と同内容）
- 視覚モックの参照と対応仕様版: 非該当（UI変更なし）
- 提示証拠: 2026-10-29 会話内の「整理案（仕様の草案 v1）」と質問ダイアログ
- 開始前確認: 済み

## 受入条件

1. `npm run typecheck`、`npm run test:all`、`npm run test:integration`、`npm run build`、`npm run build:admin` が全通過（基点で全通過を確認済み: test:all、integration 7/7）。
2. web/src/main.ts が画面単位に分割され、単一ファイルが概ね600行を超えない。
3. 公開API・DOM構造・CSSクラス・保存形式・APIレスポンスに変更がない。
4. README.md 冒頭で、何を作ったか・技術スタック・起動方法が分かる。旧READMEの情報は docs/ のどこかに残る。
5. docs/harness に索引があり、旧版HTMLが削除されている。文書内リンクが切れていない。
6. Swift変更はビルドとCoreテストを壊さない（Xcode環境で実行できなければ未実行と記録）。

## 制約と参照

Node 26.12.1。テストは `web/` で実行。worktreeでは `npm ci` が必要。

## 未解決事項

なし（docs/archive への改名はツール制約のため docs/harness 維持に変更、意味は同等）

## 実装承認

- 承認状態: approved
- 対象仕様版・範囲: v1 全体
- ユーザー発言根拠: 2026-10-29 質問ダイアログで「この案で着手してよい」。回答: 作業記録=最新版だけ残して移動、範囲=PWA中心＋Swift軽め、言語=日本語

## 進捗・完了

基点で typecheck・test:all・test:integration が全通過。
