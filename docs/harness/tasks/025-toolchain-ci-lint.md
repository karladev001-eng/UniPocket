# タスク: 025 — 依存の脆弱性修正・CI・整形とlint

- 状態: ready
- 仕様版: 1
- コード基点: 86e32da（ブランチ `refactor/interview-ready`）
- 担当範囲: web/package.json・package-lock.json、.github/workflows/、web の整形・lint設定、web/src・server・admin・tests・scripts の整形のみ、関連文書
- 依存: 024
- 子のモデル・推論強度: 025 実装 sonnet/high（手順は決まっているが、TLS検証と整形の等価性確認は手を抜けない）、レビュー opus/high＋Codex
- モデル選択: auto、役割キー standard/review、pinなし
- 選択根拠と制約: 挙動不変。既存テストと verify:tls を回帰基準とする

## 実装内容の説明・目的と対象範囲

1. 開発依存の脆弱性修正: wrangler 4.151.1→4.155.0、固定 miniflare 5.20261012.1-beta→5.20261023.2-beta（undici 7.29.1→7.30.1）。壊れる場合は package.json の overrides で undici だけ 7.30.1 に固定する案へ切り替え。
2. GitHub Actions CI: push/PR で npm ci → verify:tls → typecheck（client/admin）→ test:all → test:integration（Linux）。CampusCore の swift test（macOS）。週1回の npm audit。
3. Prettier（2スペース・ダブルクォート＝既定値）と ESLint（typescript-eslint）を導入し、lint・format:check を CI に追加。一括整形は独立コミットにし、.git-blame-ignore-revs に登録。

対象外: 機能や挙動の変更、Swift コード、push・PR。

## 利用者から見た振る舞い・入出力・異常時

利用者向けの変更なし（開発ツールと CI のみ）。UI モックは不要（UI 変更なし）。

## 受入条件

1. `npm audit`（dev 含む）0件。`npm run verify:tls` が成功（Node・Miniflare・Wrangler で危殆化 4種の拒否と正常 HTTPS）。
2. typecheck・typecheck:admin・test:all・test:integration・build・build:admin が全通過。
3. workflow が actionlint を通る（ないなら未実行と記録）。GitHub 上の実行は push 前のため未確認。
4. 整形コミットの前後で build 出力が等価（またはソースの AST 等価）で、全テストが通過。
5. `npm run lint` と `npm run format:check` が 0件。例外は理由付きで明示。
6. 文書（README のテスト節、docs/testing.md、docs/toolchain.md）に CI と lint の使い方を記載し、版番号の記述を更新。

## 未解決事項

なし

## 実装承認

- 承認状態: approved
- 対象仕様版・範囲: v1 全体
- ユーザー発言根拠: 2026-10-29「1,2,3の順で修正してください」のあと、仕様提示に対して質問ダイアログで「この仕様で着手してよい」。回答: 書式=2スペース・ダブルクォート、Swift CI=含める

## 進捗・完了

（未着手）
