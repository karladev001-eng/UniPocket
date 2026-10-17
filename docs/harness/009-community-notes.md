# 009 — みんなの情報と、自分のメモ

- 仕様版: 1
- 状態: done
- 対象: 掲示板内の記事統合・メモ専用タブ N1–N7
- 承認根拠: 本人の「記事を掲示板タブの中に統合しましょう。また空いたタブにメモを追加して、google keepのような簡単なメモ機能もつけたいです。」による直接の変更依頼。上位指示に従い、許可済みの可逆的実装について重複承認は求めない。仕様と視覚案を着手前に提示し実装する。
- 視覚案: 009-community-notes.plan.html（今回の新構成）、既存005/006と共通4テーマを継承。

## 目的・仕様

大学の情報を探す「掲示板」に記事をまとめ、個人メモを下部タブからすぐ開けるようにする。下部はホーム／時間割／掲示板／メモ／その他。掲示板上部に投稿／記事の切替。メモはオフラインで端末保存、公開されない。

- N1: 記事の独立タブを廃止、掲示板内の「投稿」「記事」で切替。既存記事の一覧・詳細・執筆・Markdown・画像・下書き保存を維持。切替によって入力を失わず、同一WebViewを重複表示しない。
- N2: 講義詳細から掲示板は投稿へ、関連記事は記事へ直接開く。正しい講義文脈、元のホーム詳細/日別sheetへの復帰を維持。通常タブ移動は適切な最後の選択を保持し、文脈の切替は明示的な講義要求に従う。
- N3: 空いた位置をメモタブにする。Keepのような余白ある2列カード（大きい文字等で1列可）、本文/チェック項目検索、固定セクション、空状態と検索0件、アイコン中心の追加を実装。既存メモを同じIDで表示する。
- N4: テキストメモを開いてすぐ編集、自動保存。先頭行をタイトルとする既存形式を維持。チェックリストは項目追加・編集・完了/未完了・削除ができ、メモ本文と併存できる。淡い背景色4色程度と無色を選べる。本文だけでも固定でき、ホームの固定メモと一貫する。
- N5: 既存画像の表示/追加/解除/復旧は保持。メモ削除は既存の確認と30秒取消を維持。保存失敗は見える形で通知して入力を保持。読取失敗時の上書き禁止を維持。空欄だけの新規メモが増殖しない扱いを実装。
- N6: 既存Noteデコードは新しい色/チェック項目が無くても成功。旧本文・画像・ID・固定順序と記事下書きを保護。新情報のroundtrip/再起動を確認。モデル全体の不要な置換やユーザーデータ削除はしない。
- N7: 共通4テーマ・375pt/通常幅・オフラインに対応。Core/記事/掲示板の関連回帰とSimulator build、独立レビュー、シミュレーターで主要導線とメモ保存再起動確認。本体jp.personal.CampusPocketを更新する。

## 対象外・未解決事項

今回を止める未解決事項なし。Googleアカウント連携、Google Keep同期、クラウド同期、共同編集、リマインダー、ラベル体系は含めない。掲示板の投稿/返信は008同様セッション内デモであり、外部共有機能追加はしない。

## 構成・担当

既存AppModel/Note/JSONStoreと画像保存を継承。CampusNavigationに掲示板内選択を追加し、記事/投稿のWebView active判定を変更。メモの新規フィールドは後方互換デフォルトで拡張。仕様/モック作成は親、コード実装統合は1担当、独立レビューは別担当。非Gitのため着手前snapshotを/tmpに保存、commitなし。harness active、5機能ON、max3、auto/no pins。collaboration起動カタログのgpt-6.1-sol/highを使用（データ互換とWebView/ネイティブ複合遷移のリスク）。preferences readはEPERM、推測で記憶を上書きしない。計測null。

## 実施記録

- 着手前: 009 HTMLをpack（警告0）してCodexで提示。ローカルfileブラウザーは過去の拒否を迂回せず、HTMLの実ブラウザー展開テストは未実施。最終評価は本体アプリのDevice Hub画面で行う。
- ソース基点: /tmp/community-notes-before。既存データの事前退避: /private/tmp/community-notes-backup-1792250625136178000（主端末4ファイル、小画面2ファイル）。更新直前にも保存状態を確認して照合。
- 独立リスク評価: 切替中のIME/下書き保持、非表示hostのWebView奪取、講義文脈・sheet復帰、Note後方互換と保存失敗時保持、空メモ整理と非同期画像の競合を重点確認。

- 初期検証: Core28件/9suite、既存記事回帰、掲示板45項目成功。独立レビューで実講義要求を両sectionへ同期する点を確認。新規Note互換・checklist/color roundtripを追加。
- メモの空状態: 今回作成した未入力・無色・未固定のメモだけを閉じた際に整理。既存空メモは削除しない。チェック項目/色/固定の情報を持つメモは保持する。

- Simulator build成功。最終製品ソースhash一覧 /tmp/community-notes-implementation-hashes.json、連結SHA256 b7fb57fca0f6375c5163b3b2b2af4cbd7fc29cb8a8e497a70c8f971752fdefaf。実dylib SHA256 deb13313f2526c839b76aa30fa0eaf0e0543c4b13d2033b1501dda55b1659738。
- 2台本体更新の直前退避とhash検証: /private/tmp/community-notes-install-1792250924014318000/manifest.json。全6ファイル更新前後一致、両端末bundle一致を独立reviewも確認。
- 実画面: 主端末の既存画像メモ/固定情報を新カードで表示、記事一覧→詳細→投稿→記事で詳細保持、ホーム講義→投稿→同講義記事→元詳細の往復を確認。

## 完了・受入確認

2026-10-18、仕様版1 N1–N7の実装・独立レビューPASS。修正必須事項なし。下部はホーム／時間割／掲示板／メモ／その他。記事は掲示板上部の切替に統合。メモは実際に端末保存され、掲示板のセッション内デモとは異なる。

- N1–N2: 記事一覧→詳細→投稿→記事で詳細保持。小画面で保存済み記事の執筆画面→投稿→記事でも執筆画面を保持。ホーム10/19情報工学→投稿→同講義記事→元詳細、次に時間割10/13画像情報工学の日別sheet→記事→同講義投稿→元詳細の往復を確認。以前の講義文脈を引きずらない。
- N3–N4: 主端末の既存画像メモを固定カードで表示。375pt端末に「確認用メモ」を作成し、本文・黄色・完了済みチェック項目・固定を保存。「実験」の検索でチェック項目から絞り込み。グリーンとモノトーンの実画面を確認、4テーマの配色は共通実装を継承。
- N5–N6: 375pt端末を終了/再起動して同じ本文・チェック状態・色・固定を復元。空の新規を開き未入力で閉じると増殖せず、以前からの空メモ2件は保持。更新前旧Note全フィールド・その他AppData・旧固定順序・画像原本・記事下書き内容を照合、独立reviewも再確認。主端末記事のsavedAtのみ通常persistで更新。検証用に作成した1件は小画面QA端末だけに残し、主端末の既存メモは変更していない。
- N7: Core28件/9suite、掲示板45項目、記事回帰、Xcode Simulator Debug build成功。2台の本体アプリ更新・実bundle一致・再起動確認。レビュー担当 community_notes_review は最終10ファイルhashを照合しPASS。
- 入力検証はネイティブAXsetValueに実キー入力（Return/space/Backspace）を伴わせ保存ファイルまで確認。typeText日本語注入には制約あり。実日本語IME変換中の記事切替、VoiceOver、Dynamic Type全サイズ、新規Photos選択全経路は未確認。JavaScriptの既存IME・画像・保存失敗回帰は成功。実物PDFの条件付き回帰は今回未実行。

## 証跡・引渡し

- [既存メモの引継ぎ](assets/community-notes/01-existing.png)
- [掲示板内の記事](assets/community-notes/02-articles.png)
- [別講義の日別sheetへ復帰](assets/community-notes/03-return.png)
- [チェック項目検索・375pt](assets/community-notes/04-search.png)
- [再起動後のメモ・モノトーン](assets/community-notes/05-restart.png)
- 最終データ照合: /private/tmp/community-notes-install-1792250924014318000/post-native.json。独立レビュー: /tmp/community-notes-review.md。build/Coreログ: /tmp/community-notes-build.log、/tmp/community-notes-core.log。
- 変更ファイル: CampusPocketApp.swift、BoardView.swift、ArticlesView.swift、PersonalViews.swift、AppModel.swift、CampusCore Models.swift/NoteTests.swift、scripts/test-articles.cjs、scripts/test-board.cjs、README.md。掲示板/記事HTML本体は変更なし。
- 非Git、コミットなし。ユーザーによる評価は未取得、検証結果を評価根拠として一般化・記憶更新しない。新しいアカウント・外部配信・Google Keep同期は導入していない。
