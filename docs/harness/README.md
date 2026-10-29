# 開発記録（docs/harness）

このディレクトリは、AIエージェントと進めた仕様駆動の開発プロセスの記録です。各タスクは次の流れで進めました。

1. **仕様**: 依頼・目的・受入条件（AC）・対象外を `.md` に書き、必要なら画面モックと説明用HTMLを作る
2. **承認**: 利用者が仕様の版と範囲を明示的に承認してから実装する（承認の原文を記録）
3. **実装**: 実装担当が承認範囲だけを変更する
4. **独立レビュー**: 実装していない別の担当が差分と証拠を読み、PASS / NEEDS_WORK を返す
5. **検証**: テスト・ビルド・Simulator・実ブラウザ・配信後の確認と、未確認事項を記録する

ハーネスのCLIが `docs/harness/tasks` を前提にしているため、このディレクトリの場所と名前は変えていません。

## タスク一覧

001〜010はiOS版（CampusPocket）の時期で、このディレクトリ直下にあります。011以降はPWA（Uni Pocket）で、`tasks/` 以下にあります。状態は各仕様に記録された値の要約です。

| # | 正本 | 目的 | 状態 |
|---|---|---|---|
| 001 | [001-campus-app.md](001-campus-app.md) | iOSアプリの初期実装からPDF取込・個人修正・Outlook表示、ホーム内キャンパスマップまで（仕様版13） | done |
| 002 | [002-home-redesign.md](002-home-redesign.md) | ホーム画面の新デザイン案 | planned（モックのみ。007でデザイン基準として統合） |
| 003 | [003-timetable.md](003-timetable.md) | 時間割画面のモック | planned（モックのみ。007でデザイン基準として統合） |
| 004 | [004-calendar-import.md](004-calendar-import.md) | 履修登録PDFと大学の年間日程の取込準備モック | planned（モックのみ） |
| 005 | [005-course-board.md](005-course-board.md) | 講義ごとの掲示板モック | planned（モックのみ。組み込みは008） |
| 006 | [006-articles.md](006-articles.md) | 記事の閲覧と下書き（iOSに組み込み） | done |
| 007 | [007-app-redesign.md](007-app-redesign.md) | 002/003のデザインをアプリ全体へ統合 | done |
| 008 | [008-board-integration.md](008-board-integration.md) | 掲示板モックのアプリ内組み込みと統合漏れ修正 | done |
| 009 | [009-community-notes.md](009-community-notes.md) | 記事を掲示板へまとめ、メモを下部タブから開けるよう再構成 | done |
| 010 | [010-performance-appearance.md](010-performance-appearance.md) | 起動・表示性能とテーマ・背景設定 | reviewing（実機/OS検証が未完） |
| 011 | [tasks/011-pwa-notion.md](tasks/011-pwa-notion.md) | PWAへの移行とNotion記事の共有API（Workers + D1） | reviewing |
| 012 | [tasks/012-pwa-ui-polish.md](tasks/012-pwa-ui-polish.md) | PWAの操作UI改善 | done |
| 013 | （作業中のため未収録） | 地図の読みやすさ | 作業中 |
| 014 | [tasks/014-uni-pocket-preview.md](tasks/014-uni-pocket-preview.md) | 本人限定の検証環境をCloudflareに用意 | done |
| 015 | [tasks/015-ios-pdf-compat.md](tasks/015-ios-pdf-compat.md) | iPhone SafariでのPDF取込互換性修正 | done |
| 016 | [tasks/016-in-app-auto-update.md](tasks/016-in-app-auto-update.md) | アプリ内の自動更新とPDF取込の継続修正 | reviewing（旧iPhoneの更新確認待ち） |
| 017 | [tasks/017-schedule-first-ui.md](tasks/017-schedule-first-ui.md) | 開いたらすぐ予定が見えるUI | deployed |
| 018 | [tasks/018-timetable-calendar.md](tasks/018-timetable-calendar.md) | 時間割と予定表（カレンダー）の分離 | done |
| 019 | [tasks/019-map-notes-discovery.md](tasks/019-map-notes-discovery.md) | 実画面フィードバックによる地図・時間割入口・予定詳細・記事一覧の改善 | done |
| 020 | [tasks/020-public-admin.md](tasks/020-public-admin.md) | 一般公開、管理画面（Access/JWT）、お知らせ・アンケート・集計 | done |
| 021 | [tasks/021-admin-author.md](tasks/021-admin-author.md) | 運営名義の記事と管理者バッジ | done |
| 022 | [tasks/022-article-header-color-mode.md](tasks/022-article-header-color-mode.md) | 記事の本文優先表示とライト/ダーク切替 | done |
| 023 | [tasks/023-tls-toolchain.md](tasks/023-tls-toolchain.md) | 開発ツールのTLS信頼とNode最低版の強制 | done |
| 024 | [tasks/024-interview-readiness.md](tasks/024-interview-readiness.md) | コードとドキュメントの整理（本整理） | 進行中 |

レビュー・検証の別紙: [001-review.md](001-review.md)、[001-v4-review.md](001-v4-review.md)、[010-review.md](010-review.md)、[010-validation.md](010-validation.md)、[010-performance-work.md](010-performance-work.md)、[010-appearance-work.md](010-appearance-work.md)、[tasks/011-implementation-contract.md](tasks/011-implementation-contract.md)。

## ファイルの読み方

| ファイル | 内容 |
|---|---|
| `NNN-*.md` | 仕様の正本。版、状態、承認の原文、受入条件、実装・レビュー・検証の記録。まずこれを読む |
| `NNN-*.plan.html` | 利用者へ提示した仕様・画面案の単一HTML（`.src.html` から生成）。ブラウザで開く |
| `NNN-*.src.html` | `.plan.html` の元ソース。`htmlplan-runtime/` のCSS/JSを参照する |
| `*-mock.html` / `*.mock.html` | 操作できる画面モック |
| `*.preview.png`、`tasks/*-implemented-*`、`tasks/019-evidence/` | モックのプレビューや実装後の画面の証拠画像 |
| `assets/` | 画面記録、キャンパスマップの元資料（提供PDF・建物/教室の対応表）。`scripts/update-campus-map.py` が `assets/hamamatsu-map/` を読む |
| `010-evidence/` | 010の性能計測ログ（変更前後の計測値と比較表） |
| `hamamatsu-map.html` | キャンパスマップの操作見本（単体HTML） |

おすすめの読み方: 最近の完成度の高い例として [020](tasks/020-public-admin.md)（一般公開と管理画面）、[023](tasks/023-tls-toolchain.md)（セキュリティ修正）を、iOS時代の長い経緯として [001](001-campus-app.md) を読んでください。

## 整理の記録

024の整理で、置き換え済みの旧版を削除しました（commit `488f2ef`）。必要なら `git show 052ba3f:docs/harness/<path>` で取り出せます。

- `001-campus-app.v4〜v12.plan.html / .src.html`: 仕様版13（版番号なしの `001-campus-app.plan.html`）に置き換え済み
- `hamamatsu-map.v9〜v11.html`: 現行の `hamamatsu-map.html` に置き換え済み。あわせて、これらに埋め込まれていたビルド中間ファイル（`assets/hamamatsu-map/map-preview.js`、`mobile-preview.js`）と、削除した旧版だけが参照していた画面画像（`assets/v7-*`、`assets/v8-*`、`assets/hamamatsu-map/*-phone.png` など）
