# タスク: 024 — 面接で見せられるコードとドキュメントへの整理

- 状態: done
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

- 024a（opus/high）7df4816: web/src/main.ts 1722→231行、app/・ui/・screens/ へ分割。最大は screens/articles.ts 401行。
- 024b（sonnet/high）1c9cbe8・27cf834: worker.ts 399→63行、admin main.ts 623→21行。server/admin.ts は自然な境界がなく据え置き。
- 024d（sonnet/medium）27a8ec1: CampusCore主要型に `///`、未使用 `import EventKit` 削除。PersonalViews.swift 分割はリスク対効果から見送り。
- 024c（opus/medium）488f2ef・d68cc17・be551f9: README再構成、docs/{README,pwa,ios,testing,toolchain}.md、docs/harness/README.md 索引、旧版38件削除（64MB→34MB）。
- 統合（sonnet/medium）dceca42: 競合なし。typecheck・typecheck:admin・test:all（toolchain12/client150/admin44/server11/runtime14）・test:integration 7/7・build・build:admin・Core 36テスト・リンク0件切れ。
- レビュー（2者、base 052ba3f→head dceca42）: harness:reviewer（opus/high）PASS（全ゲート再実行、14状態DOM一致）。Codex NEEDS_WORK（README: build手順欠落・メモ保存の記述）→ 修正済み。reviewer提案（verify:tls注記・状態更新）も反映。
- 未確認: admin画面のheadless DOM比較、データあり状態のDOM比較、iOS Simulator起動。013→017の既存リンク切れは013コミットで解消。

## README画像・アーキテクチャの修正（2026-10-31）

- 根拠: 利用者がREADMEの画像一覧を示し「iosの画像は無くして、メモの画像を記事やキャンパスマップの縦横比で作り直してください。実際に講義の予定が入っているところの画像も追加してください」と指示。続けて「アーキテクチャからもiosバージョンは消しておいてください」と明示。
- 承認範囲: 024のREADME整備への直接の修正指示として、画像一覧と既存Mermaid図だけを更新。既存の画像一覧・図を参照し、PWA画像4枚・図のiOS部分除去という指定どおりの修正。製品UI・Swiftソース・保存データは変更しない。
- 受入条件: (1) READMEの画像一覧にiOS画像がない、(2) メモ・時間割が既存記事/地図と同じ390×700、(3) 実際に講義が入ったPWA画面を掲載、(4) Mermaid図にiOS/SwiftUI/EventKit/CampusCoreの構成がない、(5) 画像リンクが存在し、既存の未コミット作業を保持。
- 結果: 画像一覧を記事・地図・メモ・時間割の4枚に変更。新画像は`docs/screenshots/notes-390.png`、`docs/screenshots/timetable-390.png`。旧iOS画像や過去の証拠ファイルは削除せず、READMEからの参照だけを外した。iOSの説明文・ソースは保持し、アーキテクチャ図だけPWA構成へ変更。
- 撮影: 配信済みmain `303b87d` / build `20261031090505-b40782` のローカル実画面。メモは新しい検証用originにUIから本文・チェック項目を入力。時間割は以前提供された2つのPDFを正規のローカルWrangler画面からブラウザ内だけで解析し、6講義・86予定を保存。2026-10-26〜30の平日表示には4件の授業コマがある。原本PDF・氏名・学籍番号はリポジトリへ追加していない。
- 検証: 画像4枚の390×700と参照先の存在を確認。図のiOS要素ゼロ、`git diff --check`成功。撮影した2枚は目視で確認済み。文書・画像のみの修正のため製品テストの再実行は不要。
- 撮影環境の制約: 最初のQA helperは`.mjs`を`application/octet-stream`で返しPDF workerのimportに失敗したため、テストhelperや製品コードは変更せず、使い捨てローカルD1に接続した通常のWrangler配信へ切り替えて取込成功を確認。公開Worker・共有D1への書込みはない。
- ユーザー評価: 新画像・修正後READMEへの評価は未取得（unknown）。単発の今回の修正として記録し、恒久的な好みへ昇格しない。
- 後片付け: 撮影用タブを閉じ、viewport設定を解除。一時QA helperとWranglerは停止済み。
- 制作記憶: `readme_images_record`（Sol6.1/medium、履歴なし、唯一のwriter）へ限定記録を委譲。fresh readはok=true/exit0/pending=falseだったが、リモートGitHubへのwriteは非公開フィードバックの保存先への明示的な許可不足として自動承認レビューが実行前に拒否。再試行・別経路の送信はせず、新しい観察・候補・試用の3件は未保存。既存記録は変更なし。
- 計測: 取得済みの作業中観測区間09:19:49–09:27:16 UTC（447秒）のみをローカルCLIで保存成功、exit0。タスク開始前からの総時間ではない。利用枠は未取得、comparable=false、原価や改善効果へ換算しない。
