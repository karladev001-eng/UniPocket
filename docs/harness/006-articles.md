# 006 — キャンパスの知恵を、読みものに。

- 計画ID: 006-articles
- 仕様版: 6
- 対象範囲: 記事一覧・詳細・プレビュー直接執筆/Markdown書式反応/端末下書き保存モック A1–A13
- 状態: done（v6・A1–A13承認済み、既存iPhoneアプリへの組み込み・ビルド・独立レビュー完了。実機操作の未確認範囲は検証記録参照）

## 目的・本人依頼

「いいですね。次は記事の一覧と詳細画面も、同じ雰囲気でモックを作って下さい。」

サークルや団体の発信、大学生活の役立ち情報、講義の学びのまとめを、読みものとして探し、読む。執筆は読者向けプレビューと同じ記事面へ直接入力し、Markdown記法の成立に応じて見出し・引用・箇条書き・強調へ反映する。全文のMarkdown入力とコピー、画像/リンク挿入、端末への下書き保存を用意する。既存ホーム/時間割/掲示板の4テーマ、余白、丸いカード、小さいアイコン操作を引き継ぐ。

今回のv6改訂は、添付画像で示された「記法が通常文字のまま残る」状態の修正と、仕様書の対応表・反映後見本・操作導線の更新である。v6・A1–A13の実装開始承認をチャットで受領済み。対象と根拠は下の承認欄を参照。

## 仕様と番号付き受入条件

- A1: 記事一覧に「学生生活」「学び」「サークル」等のカテゴリ、表紙、タイトル、短い概要、著者、公開日、読了目安を表示。主役の記事1件＋コンパクトな記事一覧で、掲示板より読みものらしい階層をつける。全体カテゴリ・文字検索を組み合わせ、該当なし時に解除導線を出す。
- A2: 記事を押すと同じ記事IDの詳細へ。表紙・タイトル・著者・カテゴリ・本文の見出し/段落/リストを読みやすく表示。6件程度の独自の架空サンプルを用意し、少なくともカテゴリごとに内容が異なる本文を読める。実在の団体の活動、大学の公式日程/履修条件、実講義の配布資料とは誤認させない。戻ると一覧の検索・カテゴリ・位置を維持する。
- A3: 詳細には小さいアイコンのいいね・あとで読む、関連記事から別記事への遷移を用意。反応とあとで読む状態は記事ごとにページ内で保持するだけで、実公開・端末保存・外部送信をしない。操作名・選択状態をアクセシビリティ属性で保持。
- A4: 002/003/005の「記事」タブを006へ接続し、テーマを引き継ぐ。002講義詳細の「関連する記事」は講義IDで関連一覧に絞る。講義に該当記事がない場合も別講義を同じものとして表示しない。戻り先はhome/timetable/boardと許可済講義ID等の既存内部パラメータに限定。4タブを維持し、既存モックの変更は記事入口とその復帰初期化に限定する。時間割から戻る場合は元の週・表示形式・日/コマ選択・表示例を復元し、空きコマや未登録状態でも講義IDを必須にしない。
- A5: green/blue/rose/monoを全状態に適用。画像・戻る・反応等はコンパクトなアイコン操作にし、操作領域44px、ラベル/フォーカス/状態文字を保つ。320〜390px幅を想定し長いタイトル/著者が横溢れしないCSS。ユーザー入力をHTMLとして実行しない。不正なarticle/course/theme/return値は安全な案内または既定値へ。

- A6: 本文は単一のMarkdown文字列を正本とし、ブロック追加/上下移動/削除のUIを撤去。見出し・段落・箇条書き/番号リスト・引用・太字/斜体・インラインコード/コードフェンス・リンク・画像記法の基本構文を安全に表示。HTMLは文字として扱う。全文のMarkdown入力表示と全文コピーボタンを用意し、普通のテキスト貼付け/選択置換/改行/Undoが行える。コピー成功はclipboard成功時だけ、不可時は全文を選択して手動コピーできる。タイトル80/著者20/概要140、通常の新規本文10,000文字。コピー/貼付け/表示切替で元Markdownの改行・記号を勝手に書き換えない。
- A7: 既定画面はv2/v3のreader風プレビューを基にした、直接書ける記事面。表紙→カテゴリ→大きなタイトル→著者→概要→本文の順を維持。タイトル/著者/概要をその場で編集し、本文も描画済みの見出し/段落/リスト等の見た目で入力できる。選択箇所を枠付き・等幅のMarkdown textareaへ置き換えるv4挙動は撤去。本文は安全なcontenteditable等を用い、入力中はDOM全体を再生成せずnativeカーソル/選択/IMEを保持。本文の原文正本へ必要な編集範囲だけ反映し、未編集箇所は改行/記号を保持。貼付けはplain text/Markdownとして処理し、任意HTMLを取り込まない。空欄にも直接カーソルを置いて書け、段落末尾からEnterで書き続けられる。

- A8: 表紙と本文添付画像を保持。JPEG/PNG/WebPの端末画像を端末内圧縮（1枚20MB/24MP、長辺2048/WebP0.82、PNGfallback、小原本優先）。表紙1枚/本文8枚/合計40MB。本文挿入はMarkdown画像記法＋安定した添付参照に変換し、添付Blobを一括保存。挿入/差替え/取消/失敗/遅延で別箇所や古い本文を上書きしない。添付参照はこの下書き内で有効と簡潔に明示。コピーした参照を画像そのものの書出しとは扱わない。
- A9: 下書き1件の端末自動保存/保存アイコン/IndexedDB transaction完了後成功表示/失敗時保全/再試行/初期復元保護/古い保存と新編集の競合防止/離脱保護を維持。Markdownと添付実体を原子的に保存し、再読込後同じ本文と画像を復元。v3の既存保存を安全に読み、ブロック順/全テキスト/リンク/画像/キャプションをMarkdownへ変換。変換で上限を超える既存データも黙って切り捨てず保持し、元レコードは新形式の保存成功まで失わない。
- A10: MarkdownのリンクとURL挿入を用意し、HTTP/HTTPSのみクリック可能。表示名・URLはescapeし、任意HTML/script/iframe/javascript/dataを実行しない。外部リンクの自動取得はしない。外部画像URLの記法を貼り付けた場合は内容を保持し、自動アクセスせず安全なリンク/案内として表示。添付画像はプレビューに表示する。
- A11: 直接編集↔Markdown全文（補助画面）の切替、コピー/貼付け、IME・選択置換・本文先頭/中間/末尾編集を確認。見出し/段落/リスト/引用/強調/リンク/コード/画像の基本書式を安全にMarkdownへ反映。未編集箇所の原文を再シリアライズして改変しない。ネイティブDOM由来のbr/div/p等は改行として安全に扱う。10000字上限後も表示と正本を一致させ、以降の編集・保存に反映。既存7記事、4テーマ、一覧条件/位置/再開、002/003/005の入口/戻り先とv3/v4保存読み込みを維持。
- A12: v2/v3プレビューのreading/detail-cover/reading-title/byline/reading-deck/proseをデザイン根拠にする。既定画面からwriter-formの入力カード、項目ごとのラベル/カウンター、大見出しの二重表示、live/Markdown大型タブ、確定チェック行、末尾の大きい操作ボタンを撤去。通常時/入力中とも記事面の余白・色・書体を維持。Markdown全文/コピー・保存・画像/URLは小さいアイコンや補助メニューへ。保存状態は小さく見える位置に残す。4テーマ/狭幅/44px操作領域/ラベル・キーボード操作を維持。静的見本でも記事全体と入力中の様子が分かるようにする。

- A13: 記事面の直接入力でもMarkdown記法に反応する。行頭の `# `〜`###### ` / `> ` / `- `・`* `・`+ ` / `1. `等を、半角スペースで記法が成立した時点に見出し/引用/リストへ反映。すでに本文込みの `## aa` 等を入力・貼付けした場合も反映し、blurを必須にしない。太字 `**text**`・斜体 `*text*`・インラインコード・`[text](https://...)` は閉じ記号成立時に反映。コードフェンスは行頭のバッククォート3個＋Enterでコード入力へ、対応する閉じフェンス＋Enterで終了。未完成記法は入力を保ち、コード内/明示escapeの記号は書式化しない。IME変換中は触らず確定後に反映し、変換対象の局所DOMだけ更新してselection/caretを復元。source正本に不要なescapeを足さず記法・本文を保存/復元/コピーできる。見出し末尾Enterは次段落、リストEnterは続項/空項Enterは通常段落へ。`-`だけでは普通の文字、`- `で箇条書きと仕様書に明記。Markdown全文画面は原文入力のまま。

## 入出力・異常時

- 入力: カテゴリ、検索語、記事選択、いいね/あとで読む、4テーマ。下書きのタイトル/著者/カテゴリ/概要/Markdown本文/表紙1枚/本文添付画像/URL。内部allowlistの遷移パラメータ。
- 出力: 操作HTML、仕様HTML、002/003/005の入口接続。表紙は自作のコードSVG等でローカル同梱し外部画像取得をしない。
- 検索0件/関連講義記事0件/不正記事IDを明示。実通信をしないためサーバーエラーやログイン状態は対象外。
- 本文はオリジナルの架空サンプル。実際の最新大学情報の調査は今回不要。テーマは既存localStorageキーを共有。記事の反応や閲覧データは永続保存しない。v3の下書きは端末ブラウザーへ保存する。

## 対象外・未解決事項

実際の投稿/公開、実認証、フォロー、コメント、外部共有、クラウド同期、共同編集、サーバーへの下書き保存、複数下書きの管理は対象外。記事プレビューの直接執筆・Markdown全文入力/コピーと下書き1件の端末保存はv6のモック範囲に含める。モック制作を止める未解決事項はなし。全国展開、著者/団体の本人性、公開/運営の仕組みは製品設計で別途定める。

## 承認

- 状態: approved（2026-10-17、ユーザー本人のチャットによる実装開始承認）。
- 対象: 計画006-articles・仕様版6・「記事一覧・詳細・プレビュー直接執筆/Markdown書式反応/端末下書き保存モック A1–A13」。
- 根拠: 「計画 006-articles の仕様版 6、範囲『記事一覧・詳細・プレビュー直接執筆/Markdown書式反応/端末下書き保存モック A1–A13』の実装開始を承認します。」
- v6仕様HTMLと操作モックの提示後に受領した直接の承認。同じ版・範囲の再承認は求めない。下記の旧版・制作時点のpending表記は履歴であり、現在の承認状態ではない。
- 実装先: 本人が「既存のiPhoneアプリへ組み込む」と回答。CampusPocketへの組み込みを実施する。端末保存と画面遷移はiOS環境へ対応させる。記事の実公開・サーバー保存等は対象外。
- 計画HTMLのdata-approvalは文案生成UIの仕様によりpendingを維持する。実際の承認状態はこの正本を根拠とする。

## 制作・検証契約

- harness active、alltrue、max_agents3、auto/no pins。ホストcollaboration候補を確認し、開かれた記事UI制作をgpt-6.1-sol/high、独立レビューもgpt-6.1-sol/high、fork_turns=noneで委譲する。
- preferences readはEPERM。保存済み嗜好を自動適用/上書きせず、今回の依頼と既存デザイン・小さいアイコンへのフィードバックを適用する。
- Gitなし。入口変更前の002/003/005を/tmp/articles-before/へ退避。仕様/計画は親が担当。v1制作は006-mockと3入口/記事からの復帰初期化の最小変更、v2制作は006-mockのみ。独立レビューはソース/VMを中心とする。
- 過去のブラウザー経路拒否/代替経路禁止を継続し、CUA/Playwright/HTTP配信等で迂回しない。実ブラウザー・実DOM・視覚は未検証と明記する。

## 関連・提示

- [操作モック](006-articles-mock.html) / [仕様と画面案](006-articles.plan.html)
- 002ホーム、003時間割、005掲示板は記事の入口。006が今回の仕様正本。
- macOS/zsh、cwd `/Volumes/Data_SSD/dev/univ` から仕様を開く場合: `open "docs/harness/006-articles.plan.html"`。

## v1の制作結果・検証・提示（執筆画面の検証ではない）

- 006操作モックに7本の独自記事、SVG表紙、カテゴリ×検索、一覧/詳細/関連記事、いいね/あとで読む、検索/カテゴリ/スクロール復元を制作。002/003/005の「記事」入口を接続した。002講義詳細は講義別の関連一覧へ進む。
- 制作担当articles_mock、独立レビューarticles_review、両者gpt-6.1-sol/high・fork_turns=none。修正巡1。独立レビューで指摘された時間割復帰時の週リセットを修正し、003専用のarticlesReturn初期化で週/表示/選択/未登録を復元した。002/005は記事入口以外不変、003は記事入口と専用復帰初期化のみ。
- 担当 `/tmp/test_articles.cjs`、`/tmp/articles_entry_test.cjs`、`/tmp/test_articles_roundtrip.cjs` はPASS。独立 `/tmp/review-articles.js` の主要9群、`/tmp/review-articles-roundtrip.js` の18ケースPASS。独立後に担当3suiteを再実行して全PASS。A1–A5を確認し修正必須なし。
- 確認:7独自本文/カテゴリ/検索AND/0件解除、詳細→関連記事→一覧の条件と位置、記事別反応、全9講義の所属/0件、不正ID/theme/return/prototype値、escape、共有テーマキー以外の永続なし。実ハンドラーから返却URLを作り戻り先スクリプトを全起動し、時間割の週5/空き/null/day/empty/週境界、旧boardReturn、ホーム3講義、掲示板のcourse/campus/invalid文脈の復帰を確認した。
- ソース/Node VMによる検証。実DOM・実ブラウザー操作・実描画は未検証。画面案は共有HTML/CSSによる見本であり撮影画像ではない。
- 正本/src/planの006v1/A1–A5/pending、接続先002v6・003v9・005v5を一致確認。全plan pack警告0/エラー0、006は265KB・2アセット。
- 最終006 SHA256: `52380d91f8a89ec87a9171642b51c0eb2ae34ae34557d6a47af9577efdbc82dc`。比較元 `/tmp/articles-before/`。Codexファイル表示へ操作モックを送信（queued、閲覧完了ではない）。ユーザーによる記事モックの評価は未取得、開始終了/利用枠計測null。製品実装pending。

## v2：執筆画面をモック範囲へ追加

- 仕様レビューのscopeコメント「執筆画面もモックを作成して下さい。」を、モックの範囲へのフィードバックとして反映する。コメントには実装承認なしと明記されている。本実装・公開はpendingのまま。
- 執筆→プレビュー→編集、下書きを残して一覧へ→再開を追加。入力内容はページ内メモリのみで、公開・サーバー保存・端末保存の成功とは表示しない。
- 既存の小さいアイコン/4テーマを適用。本文入力は簡易記法で、任意HTML・埋込みスクリプト・外部画像URLを実行しない。投稿するための本人確認やサーバー側の編集管理は今回設計しない。
- harness alltrue/max3/auto no pins。preferences readはEPERMであり既存嗜好を上書きしない。同一制作articles_mockと独立レビューarticles_reviewを継続し、ブラウザー禁止経路を迂回しない。製品実装pending。

## v2の制作結果・検証・提示

- 006操作モックだけに執筆画面を追加。タイトル/著者/カテゴリ/概要/本文、簡易記法の書式アイコン、見本または端末画像1枚の表紙、編集とプレビュー往復、一覧条件を保った下書き再開を用意した。7件の記事データと002/003/005入口は不変。
- 制作担当articles_mock、独立レビューarticles_reviewを継続（両者gpt-6.1-sol/high）。比較元 `/tmp/articles-v2-before/006-articles-mock.html`。仕様/計画は親が更新し、製品実装pendingを維持。
- 担当 `/tmp/test_articles_writer.cjs` と `/tmp/final_articles_v2_checks.cjs` PASS。既存 `/tmp/test_articles.cjs`、`/tmp/articles_entry_test.cjs`、`/tmp/test_articles_roundtrip.cjs` PASS。7記事データと帰還contextの同一性も確認。
- 画像は決定的Image/Canvas/Blobスタブで入力MIME/署名/20MB/24MP/長辺2048/WebP0.82/PNGfallback/小原本優先、失敗・取消・置換・削除・離脱後遅延完了、旧表紙保持とURL解放を検証。実DOM・実画像decode/Canvasの圧縮品質・実ブラウザー描画は未検証。
- 仕様/src/planはv2・A1–A8・pending。共有HTML展示に執筆/表紙/プレビューを追加。plan pack301KB・2アセット、警告/エラーなし。展示はinline SVGで一時blob URLを含まず、撮影画像・実圧縮結果とは扱わない。
- 独立 `/tmp/review-writer.js` の14群PASS。独立既存 `/tmp/review-articles.js` の9群、`/tmp/review-articles-roundtrip.js` の18往復PASS。入力/上限/カテゴリ/Markdown/IME、全項目・表紙・4テーマ・一覧文脈の保持、空preview、画像非同期競合/失敗保全/URL所有解放を確認。修正必須なし、修正巡0。002/003/005のhashはv1レビュー時から不変。
- 最終006 SHA256: `7ed0397746b6a37666522e4b91a3324290ef7a178c0f60f9a8b8d609b2285967`。ユーザーによるv2評価は未取得、開始終了/利用枠計測null、製品実装pending。

- 操作モックをCodexファイル表示へ送信（queued、表示・閲覧完了の確認ではない）。

## v3：保存と画像・URLブロック

- 本人依頼「下書きを保存できるようにして。画像やURLも埋め込めるようにしたい。Notionみたいな感じ。」を受け、同じ雰囲気のモックに端末保存とブロック編集を追加。v2の「ページ内のみ」「再読込で消える」「保存なし」はv3では適用しない。
- 事前説明: この端末・ブラウザーに自動保存、保存状態表示、「＋」で文章/見出し/画像/URLカードを追加、並べ替え。URLはカード型とし、外部サービスのiframe再生・OGP取得は含めない。自動保存/手動保存の成功失敗を見分けられるUIにする。
- 仕様/計画は親、006mock制作は既存articles_mock、独立レビューはarticles_review。同一タスク改訂として継続。harness active/alltrue/max3、auto/no pins、同じgpt-6.1-sol/high。ソース/VM検証の範囲と実ブラウザー/IndexedDB/画像品質未検証を区別する。既存のブラウザー経路制約は継続。
- preferences readはEPERM、記憶の自動適用/上書きはしない。現在の明示要望を仕様に反映。製品本実装はpending、モック作成/端末保存は今回依頼の範囲。

## v3の制作結果・検証・提示

- 006mockにブロック編集・上下移動/削除・画像caption・HTTP/HTTPSリンクカード・下書き1件の端末自動/手動保存を追加。画像Blob込みの単一IndexedDBレコードをtransaction完了後に保存済みと表示。起動復元、未保存/保存中/保存済み/失敗表示、再試行、未保存の別ページ遷移保護を用意した。
- 担当 `/tmp/test_articles_v3.cjs`、`/tmp/test_articles_v3_images.cjs`、`/tmp/final_articles_v3_checks.cjs` PASS。既存 `/tmp/test_articles.cjs`、`/tmp/articles_entry_test.cjs`、`/tmp/test_articles_roundtrip.cjs` PASS。7記事と帰還文脈は不変。比較元 `/tmp/articles-v3-before/006-articles-mock.html`。
- 独立予備レビューでURL表示名とcaptionの文字数規約（codepointとUTF16）の不一致を指摘。入力/保存/復元を統一し、絵文字を含む保存→新bootの復元を担当suiteで確認した。
- 保存/復元競合、初期空上書き防止、容量超過/保存不可/破損データ/再試行、画像の遅延所有権/圧縮/失敗保全、40blocks/8画像/40MB、IMEと自動保存をソース/Node VMで確認。実IndexedDB、実DOM、実画像decode/Canvas品質、実ブラウザー描画は未検証。
- 仕様/src/planはv3・A1–A10・pending。plan pack344KB・2アセット、警告/エラーなし。共有HTML展示はinline SVG、一時blob URLなし。保存済みの展示は表示見本で実ブラウザー保存実績ではないと明示。
- 独立 `/tmp/review-v3.cjs` 13群PASS、既存独立9群・18往復PASS。予備Unicode指摘解消、修正必須残件なし。担当v3の3suiteも照合PASS。初回復元/保存競合/transaction完了/Blob再起動復元/40MB境界/画像所有権/IME/URL/一覧文脈/テーマを確認。002/003/005は前回確認版から不変。予備修正1巡、最終レビュー後修正0巡。
- 最終006 SHA256: `f75c212f009dc438119e888a661996c7468c2943f9a32269451aa58e32cebe46`。展示SHA256: `bff07b6712b9187b9cdf9641b40fb9b73be0b2d3a555cbabd16dcc9a38697fe9`。ユーザーによるv3評価は未取得、開始終了/利用枠計測null、製品実装pending。

- v3操作モックをCodexファイル表示へ送信（queued、実表示/閲覧確認ではない）。

## v4：Markdownをそのまま書けるライブプレビュー

- 本人依頼「書き方は単純なmarkdownと同じでいいです。コピー&ペーストできるようにしたいので。プレビューのまま書き進められるようにして下さい。」を反映。ブロック管理UIをやめ、単一Markdown正本＋その場編集するライブプレビュー＋全文入力/コピーへ改訂する。
- 親の事前説明: Markdownへ戻し、プレビューの文章を押してその場で編集、周囲を確認しながら継続。端末保存と画像・URLを引き継ぐ。今回もモックの修正で、製品本実装はpending。
- 既存v3保存データを失わない変換と、Markdown文字列の無損失な往復を優先。外部添付ファイル一式の書出し、CommonMark全仕様、クラウド同期は対象外。基本構文の対応範囲をUIに簡潔に示す。
- 同一articles_mock/独立articles_review（gpt-6.1-sol/high）継続、親は仕様/plan。harness alltrue/max3/auto no pins。ブラウザー制約継続、source/VMと実ブラウザー未確認を区別。嗜好読み込みは直前turnでEPERM、既知の未解消制約として扱い、今回の明示要望を正本に反映する。

## v4の制作・検証・提示記録

- Markdown原文を正本とするライブ範囲編集、全文入力/コピー、Markdownリンク/添付画像挿入を006mockへ追加。旧ブロック保存を同DBから変換し、新形式保存成功まで旧レコードを保持する。仕様/src/planは親が担当。
- 予備レビューでtextareaのLF正規化/先頭LF除去と原文との差、URL/画像挿入時のDOM位置と原文位置のずれ、IME確定前に選んだ後続範囲のずれを指摘。normalized baseline・最小差分写像・両方向offset変換・確定後target ID解決へ修正。担当のCRLF/先頭空行/保存コピー復元、全文/live×先頭中間後半×URL画像の12挿入、IME長さ増減の試験はPASS。
- ブラウザー/迂回禁止の制約を継続。実DOMのselection/Undo/clipboard、実IndexedDB/画像decode/Canvas、実描画は未検証。DOM由来の改行変換は制御VMでも模擬し、検証範囲を区別する。

- v4展示を共通HTMLから生成。planの子claim数警告を、全文コピーA11をMarkdown入力A6へ整理して解消。pack343KB・2アセット、警告0/エラー0。
- 独立最終レビューで上限超過後のtextarea表示値とMarkdown正本の不一致をP2指摘。超過ペースト後の先頭編集が保存へ反映されない再現があり、限定修正巡1へ戻した。完了判定は再レビュー後に行う。

- 修正巡1で上限時に既存textareaとselectionを正本へ補正。IME中はDOMを再生成せず確定後に適用。独立 `/tmp/review-v4.cjs` 12群PASS、P2解消。full/live×通常/IME4通りの超過後先頭/中間編集→保存freshbootが一致。LF正規化/先頭LF脱落を模擬し、原文/CRLF/記号/絵文字の切替・コピー・復元、target/IME/caret写像、添付遅延/Blob/旧schema移行も確認。
- 担当 `/tmp/test_articles_v4.cjs`、`/tmp/test_articles_v4_storage.cjs`、`/tmp/test_articles_v4_images.cjs`、`/tmp/test_articles_v4_limit.cjs`、`/tmp/final_articles_v4_checks.cjs` と既存main/entry/roundtripの計8suite PASS。独立既存9群・18往復PASS。独立後に担当v4の5suiteも照合PASS。修正必須残件なし。
- 本体SHA256: `c46b21ff99b9830de52a57db70bfcc09671fffef0e5c4d12523a53e8d0af0e86`。展示SHA256: `6dea6c450bc67d0417c84a2fa53bff0cb0bda437f602c6dfdacb26393769f440`。002/003/005と7件の記事・帰還文脈は不変。仕様/src/plan v4・A1–A11・pending確認。展示live/markdownは本文が見える専用見本、撮影画像や実保存実績とは扱わない。
- 制作/独立レビューは同一担当を継続、最終修正巡1。ユーザーによるv4評価は未取得、開始終了/利用枠計測null。製品実装pending。

- v4操作モックをCodexファイル表示へ送信（queued、実表示/閲覧確認ではない）。

## v5：以前のプレビューを、そのまま書ける記事面へ

- 本人フィードバック「前のバージョンのプレビュー画面を元にして、そのまま書き込めるような感じにしてほしい。」を反映。v4はフォームの内側だけをライブ化したため、希望する読者向けプレビューの見た目と一致しなかった。v5は記事面そのものを編集可能にする。
- デザイン根拠: `/tmp/articles-v3-before/006-articles-mock.html`（v2 previewMarkup）と `/tmp/articles-v4-before/006-articles-mock.html`（v3 previewMarkup）の表紙/タイトル/著者/概要/本文構成。現在のMarkdown正本・画像保存・旧データ移行は保持する。
- 事前説明: 以前の読むようなプレビューへ戻し、その見た目のままタイトル/本文へカーソルを置いて書く。Markdownコピー/貼付けは補助操作で残す。フォーム枠/大型タブを外し、編集時も記事の文字サイズ・行間を維持。
- 同一制作articles_mock/独立articles_reviewを継続（gpt-6.1-sol/high）、親は仕様/plan。harness active/alltrue/max3/auto no pins。既存のブラウザー経路制約を継続し、source/VM確認と実DOM/視覚未確認を区別。嗜好保存は既知EPERMのため変更しない。製品実装pending、今回も操作モック改訂。

## v5の制作・検証・提示記録

- 通常画面を旧readerのreading/detail-cover/reading-title/byline/reading-deck/prose構成へ戻した。タイトル等と本文をcontenteditableで直接編集し、Markdown全文は小さいアイコンから開く補助画面に配置。通常画面のフォーム/ラベル列/大型tabs/二重見出しintro/等幅textareaへの差替え/確定行/末尾操作ボタンを撤去。主タイトル25px/1.65、本文13px/2.2を旧プレビューから継承。
- 予備レビューで、source区間末尾の区切り改行への追記ずれ、同一区間複数画像への先頭ref一括付与、空metadataのsentinel BR保存を指摘。担当が修正し、LF/CRLF・段落/見出し末尾追記、複数画像の各参照/削除/保存復元、空placeholder維持を確認。
- 担当 `/tmp/test_articles_v5.cjs` はsource/DOM fixture上で局所編集/書式/コード/native改行/IME/上限後編集を確認。実DOM・nativeUndo/IME/selection/contenteditable生成DOM・描画は未確認。既知のbrowser制約を迂回しない。

- 担当 `/tmp/test_articles_v5.cjs`、`/tmp/test_articles_v4_storage.cjs`、`/tmp/test_articles_v4_images.cjs`、`/tmp/final_articles_v5_checks.cjs`、既存main/entry/roundtripの計7suite PASS。7記事/帰還文脈/002/003/005は不変。
- 独立 `/tmp/review-v5.cjs` 15群PASS。旧reader構成・通常フォーム/大tabs/raw textarea/確定行なし、末尾追記/alias/外側CRLF/同一入力node/IME/複数画像/空metadata/上限/native改行/安全DOM→Markdown/plain paste/child境界selection/遅延添付を確認。予備3点は解消、追加の修正必須なし。v4全文/コピー/移行/保存の回帰、既存独立9群・18往復PASS。
- 仕様/src/plan v5・A1–A12・pending、pack392KB・2アセット、警告0/エラー0。展示は従来14keys＋articleEditing、reader全体と入力caretを静的見本にし、一時blob URLなし。撮影画像/実保存実績とは扱わない。
- 本体SHA256: `8931869a36eecb07dcf5a947c5596d7de734357fe6549133b8347f89fe69ba55`。展示SHA256: `637f6ecc0dfa1e79640aa44b7d5a3c8dc0f725040283f73cc5430d3f6bbb303f`。最終レビュー後修正0巡。制作・独立レビューとも同一担当を継続。ユーザーによるv5評価は未取得、開始終了/利用枠計測null、製品実装pending。

- v5操作モックをCodexファイル表示へ送信（queued、実表示/閲覧確認ではない）。

## v6：Markdown記法への反応と仕様書の更新

- 本人依頼「マークダウンの書式に反応するようにしてほしい。あとモックだけでなく、仕様書の方も更新して。」と添付画像を受領。画像ではタイトル下に `## aa` / `> aaa` / `-` が通常テキストとして表示されている。
- 確認した原因: 操作モックの直接入力はDOMテキストをescapeするだけで書式の成立時に局所再描画しない。加えて仕様HTMLの見本にはcontenteditable=trueが71箇所あるが操作モックのhandlerは同梱されておらず、静的見本へ入力できてしまう。操作側のMarkdownショートカットと、仕様側の静的/操作の区別を両方修正する。
- 事前説明: 見出し/引用/箇条書き等の記法を入力すると記事の見た目に反映。仕様書に対応記法と反映時点を追記し、書式反映例と操作モックへの導線を整備する。
- 仕様HTMLには対応表（記法/反映タイミング/結果/非変換例）、実際の書式反映後の画面見本、保存/IME等の受入条件を載せる。仕様の見本は編集不可の静的表示とし、入力テストは操作モックへのリンクから行う。仕様正本/src/packed planをv6/A1–A13/pendingへ揃える。
- 同一articles_mock/独立articles_reviewを継続、親が仕様/planを担当。harness active/alltrue/max3/auto no pins、model継続gpt-6.1-sol/high。ブラウザー制約を継続し、入力イベントのVM検証と実ブラウザー未検証を区別。既知の嗜好保存EPERMは未解消、今回の明示フィードバックを仕様へ記録。製品実装pending。

## v6の制作・検証・提示記録

- 直接入力のinput/paste/compositionend/keydown経路から、成立したMarkdown記法を局所的に描画する。行頭の半角スペースで見出し/引用/リスト、閉じ記号で太字/斜体/インラインコード/リンク、Enterでコードフェンスを反映。未完の記法・エスケープ・コード内は文字として保持する。書式変換後の続き入力と見出し/リストのEnterも扱う。
- 予備レビューで、インラインコードの閉じ記号後のcaretがコード内へ戻るリスクを修正。code/strong/em/link直後に続けた文字が書式の外へ入り、未完フェンスを保存して再開しても続きが書けることをDOM fixtureで確認した。
- 担当 `/tmp/test_articles_v6.cjs`、`/tmp/test_articles_v5.cjs`、`/tmp/test_articles_v4_storage.cjs`、`/tmp/test_articles_v4_images.cjs`、`/tmp/final_articles_v6_checks.cjs`、既存main/entry/roundtripの計8suite PASS。イベントハンドラーを呼び出すNode VM上の検証であり、実ブラウザーのcontenteditable/selection/IME/nativeUndo/Clipboard/IndexedDB/Canvas・実描画の検証ではない。
- 仕様正本/src/planをv6・A1–A13・pendingへ更新。Markdownの入力ルール表、反映後見本、AC13を追加。静的見本のcontenteditable=trueは0件とし、各見本から操作モックへ進むリンクを設置。最終展示16keys、pack407KB・2アセット、警告/エラーなし。一時blob URLなし、撮影画像や実保存実績とは扱わない。
- 本体SHA256: `d8bcf62ce53a95b8bf88e9ad35cf89b6996b5af0d6f9e6d971bbedffe13751c6`。展示SHA256: `d57db4ecc88ec82b9320322550b3f6f66744349e6943d5ada292e37fa0b33f00`。7件の記事と002/003/005は不変。開始終了/利用枠計測null、ユーザーによるv6評価は未取得。製品実装pending。
- 同hashで独立 `/tmp/review-v6.cjs` 6群PASS。input/compositionend/複数keydownのイベント配送、各prefix、閉じinline記法直後の続字、未完/escape/単独ハイフン、IME確定、見出し/リストEnter、フェンス開始/終了/未閉保存再開を確認。`/tmp/review-v6-regression.cjs` 15群、既存独立9群・18往復もPASS。仕様/src/plan整合と静的化を確認し、追加の修正必須なし。最終レビュー後修正0巡。
- v6仕様HTMLと操作モックをCodexファイル表示へ送信（queued、実表示/閲覧の確認ではない）。仕様書内は表示見本、入力確認は操作モックで行う区別を提示した。


## v6実装開始承認の受領

- 2026-10-17、提示済みv6・A1–A13への実装開始承認を本人のチャットで受領し、上記承認欄へ記録した。対象範囲の機能承認は有効。実装先の確認と承認の取り直しを区別する。
- 調査では既存製品はCampusPocket / CampusCoreのSwiftUI iPhoneアプリ、006成果物はdocs/harness配下のHTMLモックであった。仕様中のIndexedDB・ブラウザー保存とネイティブ実装の対応が未確定のため、組み込み先を質問した。Gitは未初期化で、コード変更が必要な場合は担当を分けて直列に進める。
- harness active/alltrue/max3/auto/no pinsを確認。今回はまず承認記録と実装先の確認を行う。既存の機能・表示仕様は変更しない。


## v6 iPhoneアプリ組み込みの実装パケット

- 根拠: v6・A1–A13の提示後の明示承認、および実装先への本人回答「既存のiPhoneアプリへ組み込む」。既存の表示/編集仕様を維持するプラットフォーム対応として進め、再承認は不要。
- 対象: CampusPocket既存SwiftUIアプリ。記事一覧・7件の架空サンプル・カテゴリ検索・詳細・関連記事・反応・4テーマ・記事面直接執筆・Markdown原文コピー/入力・添付画像/URL・下書き1件の自動/手動保存・復元。公開/クラウド同期は含めない。
- 入口: 既存ホームと講義詳細へ記事導線を追加。既存の予定/地図/メモ/施設/リンクを維持する。講義は実際の科目を渡し、サンプル科目IDへの推測による関連付けをしない。該当がない場合は0件から全記事へ進む。
- アプリ対応: 確認済みHTML/CSS/編集ロジックの同梱利用を許容する。モック外枠/デモ操作やHTMLファイルへの戻る遷移は製品から外し、SwiftUIの画面遷移へ対応させる。ローカル資料の表示にネットワーク不要。外部URLは許可したHTTP(S)のユーザー操作だけで開く。
- 保存: ブラウザーのIndexedDBという実装詳細をiOSの永続領域に対応させる。単一のMarkdown本文と添付画像の一貫した保存/復元、成功失敗表示、失敗時保持、古い非同期処理の上書き防止を維持する。既存の予定/メモの保存形式へ影響させない。デスクトップブラウザー下書きの自動取得はできないため、明示的なMarkdownコピー/貼付けを移行手段とする。
- 制作/統合は一担当で直列実施（Git未初期化のため作業前に/tmpへ変更対象を退避）。親は仕様と記録、実装担当はアプリ/Core/リソース/テスト/Xcode project/README。実装完了後に別担当が独立レビューする。
- 検証: 記事データ/検索/安全URL/保存失敗・復元と画像の一貫性をテストし、既存Core回帰とiOS Simulator用署名なしビルドを実施。可能ならiOS内WebKitの入力/保存経路をテストする。既知のブラウザー経路拒否を代替ブラウザー経路で迂回しない。未確認の実機/IME/描画等は区別する。
- harness active/alltrue/max3/auto/no pins。collaborationのモデル一覧にgpt-6.1-sol/highがあることを確認。保存/非同期/プラットフォーム統合と独立レビューのリスクを考慮し、実装・レビューともgpt-6.1-sol/high、fork none。メインはホスト現在モデルを維持する。開始終了/利用枠は取得できない場合null。


## v6 iPhone実装・検証結果

- SwiftUIの`ArticlesView`へ、同梱の`Resources/Articles.html`をWKWebViewで表示する記事画面を追加。ホームの「キャンパスの記事」と講義詳細の「関連する記事」から開く。既存5タブ・予定/地図/メモ/施設/リンクを維持し、外部のHTMLモックへは遷移しない。
- 実講義IDと名前を文脈として渡し、7件の架空サンプルと推測で紐付けない。実講義の関連一覧は該当なしから全記事へ進む。これは公開記事データ基盤をまだ含めないv6範囲の挙動。
- 単一Markdown＋全添付を`Application Support/CampusPocket/Articles/draft.json`へ原子的に保存。既存`data.json`とImagesは変更しない。保存処理は専用直列queueで実行。古いrevisionを拒否、読み込み失敗時の自動上書きを止め、明示再保存でも旧原本を回復用ファイルへ保全する。本文/添付の実体はアプリ内保存、外部サーバーなし。
- ネイティブbridgeはローカルのメインフレームと操作/型/上限を検証。コピーはUIPasteboardへ、テーマはUserDefaultsへ保存。ユーザー操作のHTTP(S)だけ外部ブラウザーへ渡し、外部画像を自動取得しない。モックの外枠とデモ操作は製品リソースから除去。
- 予備レビューでネイティブのテーマ変更がIME未確定DOMを再生成するP2を検出。IME確定後へ遅延するガードを追加し、実際のネイティブAPI入口を呼ぶNode回帰で修正を確認。正式レビュー前に修正済み。
- 担当検証: Core 23 tests / 7 suites PASS（既存18＋記事保存5）。Node `scripts/test-articles.cjs` PASS（書式反応/IME/Enter/テーマ遅延/保存競合・失敗・初期復元/画像base64）。画像40MiB＋50万codepoints本文のarchive 57,924,566byteが64MiB上限内となる境界テストを含む。Xcode27 Simulator arm64/x86_64の署名なしビルド成功。ログ `/tmp/articles-core-tests.log`、`/tmp/articles-js-tests.log`、`/tmp/articles-ios-build.log`。
- iOS27 Simulatorの別bundle `jp.personal.CampusPocket.articlesqa`でホーム→記事一覧→執筆を実画面確認。入力された非空本文がQA端末の実保存ファイルに存在することを確認。その後本文を消し、保存してホームから空下書きを再開した。既存本体アプリの保存データは変更していない。
- 実画面証拠: `assets/articles-ios/01-list.png`は記事一覧、`02-writer-restored.png`は空下書きの再開・保存済み表示。後者を非空本文の復元証拠と扱わない。親も両画像を確認。仕様HTMLに一覧の実画面を追加し、従来の静的見本と区別した。
- 未確認: Device HubのIME/クリップボード同期で半角Markdownが指定通り入力されなかったため、半角記法の実WebKit入力反応、非空本文の実画面復元、実機IME/Undo/選択、写真ピッカー全経路。非空本文/画像復元と入力イベントはCore/Node fixtureで確認。実機署名・配布はしていない。ブラウザーの既知禁止経路は使用していない。
- 変更: ArticlesView.swift、Articles.html、ArticleDraftStore.swift、ホーム/講義詳細入口、Xcode project、ArticleDraftTests.swift、test-articles.cjs、READMEと実画面画像。Git未初期化のためcommitなし、比較元`/tmp/articles-ios-before/`。実装担当articles_ios、独立担当articles_ios_review、両者gpt-6.1-sol/high・fork none。計測の開始終了/利用枠null。
- 主要SHA256: ArticlesView.swift `7aae9d7e64e1d58ebff9758c48e8209b6095a3fcedac05943d5c31b3caedeb7e`、Articles.html `06163b14b3c7cf84cec8713fac3a8cb9abea5da24c1f2981de98ddd474c22121`、ArticleDraftStore.swift `96a39239aa36877082fec56a0e9a511e1f5e10706dc90632446c04308fd6bd1e`。

- 独立最終レビュー: PASS（コード/保存/VM検証範囲）。主要3hashを照合し、Node suiteを独立再実行PASS。さらに7記事一意性/3カテゴリ/0件解除/一覧scroll復帰/記事別反応/反応非永続/4テーマ・不正fallback/HTML戻り先なしを独立VMで確認。Swift既存変更はHome/講義詳細入口のみ、Xcode projectは新Swift/HTML登録のみ。保存原子性/失敗保全/容量・署名・ID/revision/bridge送信元と外部URL境界を確認。予備P2のIMEテーマ処理は解消、正式レビュー後修正0巡、追加修正必須なし。実機と前記の実操作未確認を成功扱いにしない。
