# 010 独立レビュー

## 事前リスク表（実装者の検証主張を読む前）

承認: 正本 v1 の実装承認欄と親パケットの提示後明示承認を照合。P1–P7 が対象。HTML内の承認で代用していない。

|条件|独立に想定したリスク|確認経路|
|---|---|---|
|P1|ロード前の空状態で保存、失敗後の原本上書き、MainActor上のデコード|AppModel初期化・更新ガード、JSON保存層|
|P2|古いEventKit結果の再表示、取消直後の残存予定、不要な重複取得、予定キャッシュ失効漏れ|CalendarModel、予定結合、地図IDと遅延構築|
|P3|非同期保存の逆転、失敗後リトライ不能、削除画像参照の不整合、キャッシュ上限逸脱、終了時未保存|保存キュー、画像追加削除、ライフサイクル、縮小キャッシュ|
|P4|残るパレット入口、テーマ反映漏れ、既存選択値の移行不備|共通Style、その他設定、Webテーマ送信|
|P5|背景で文字が読めない、Web背景が執筆面を透過、画像送信でIME/下書き消失|5タブ背景、Web CSS/bridge、セッション保持|
|P6|サイズ/形式境界漏れ、巨大画像メインデコード、取消・連続選択競合、非原子的保存で背景破損、再起動欠損|選択Task/世代、画像処理、専用Store、復元|
|P7|初回描画とデータ反映の混同、異条件比較、上位遅延退行、UI/メモリ/異常系未検証|計測条件・分布、回帰証拠、Simulatorビルド（親収集中）|

静的レビュー実行中。計測やビルドを起動しない。

## 初回判定: NEEDS_WORK

製品の静的差分でP5の修正必須を1件確認した。P7の計測・UI操作・統合Releaseビルドは親が収集中であり、この不足を製品不具合とは扱わない。最終の全受入PASSはP7の証拠が揃うまで保留。

### 修正必須

- **[P2] 記事一覧の通常行に不透明な面を残す** — `CampusPocket/Resources/Articles.html:10–11`。新しい背景セレクタはhtml/body/.phoneを透明化する一方、保護対象が`.article-head,.list-heading,.empty-state,.memory-note,.related`に限られる。既存`.story-row`（同ファイル2行目）にはbackground指定がなく、`resultsMarkup()`が生成する通常記事のタイトル・概要・著者・日付は`.article-content` / `.app-scroll`とも透明な経路になる。背景写真適用 → 掲示板 → 記事 → 一覧の先頭特集以外の行を表示すると、本文が写真に直接重なり明暗や模様によって判読困難になる。P5の「カード・本文・操作部分には読みやすい不透明面」を満たさない。背景時の`.story-row`（関連領域を含む）と、Markdown全文モードの`.reader-source-view`内のヘルプ/通知/コピー操作など、透明祖先の上にある本文・操作にも不透明面を与えること。本文表示用`.reading`の既存白面は保持できている。CSSの限定修正後、明るい/暗い写真で一覧と全文モードの実表示を確認する。

### 受入条件

|条件|現時点の結果|根拠と残る確認|
|---|---|---|
|P1|静的適合、UI確認待ち|AsyncJSONStoreがload/validateを直列workerへ移動。AppModel.loading/failed/committingのreadOnlyガード、Rootのロード表示、原本保持を確認。Coreのinvalid-load/原本保持テスト主張を読了。AppModel自体のロード失敗UI操作テストは未実施。|
|P2|静的適合、実操作確認待ち|EventKit専用serial queue、単一inFlight+最新pending、revisionと権限の再確認、権限なし即時clear。CombinedEventsCacheが予定入力だけで失効し既存combinedを呼ぶ。HomeのLazyVStackと独立した固定mapAnchor、上位保持mapStateを確認。地図handoff、外部予定の権限取消/再許可、Web入力保持は実操作待ち。|
|P3|静的適合、異常系/終了確認待ち|同期enqueueのFIFO、最終revisionだけが保存状態を更新。transaction中はreadOnly、成功後のみpublish、画像参照保存失敗で新画像rollback。原画像保持。ImageIO縮小1024、24MiB/64-entry eviction、メモリ警告clearを追跡。background taskはqueued writesのbarrierを待つ。UIの高速編集/失敗再保存/終了間際と実測ピークメモリは待ち。|
|P4|静的適合、UI確認待ち|More設定入口、CampusThemeMenuの撤去、既存4色と2種legacyキー、shared appearanceのenvironmentObject、Web applyTheme呼出しを確認。再起動と全画面4色実操作待ち。|
|P5|NEEDS_WORK|中央aspect-fill、共通5タブ背景、地図/ビューア/reading専用面は実装。通常記事行等の透明面は上記修正が必要。375pt/文字拡大/写真実表示待ち。|
|P6|静的適合、OS経路確認待ち|40MiB+1 bounded read、jpeg/png/heicかつ1frame、辺20k、transform付き2560縮小、専用ファイルatomic write、前景画像は成功時のみ更新。世代token+lock gateで取消/連続選択の旧結果を抑止。欠損flag/corrupt復元案内。明示apply後は保存終了まで操作を止め、失敗は候補と従来画像を保持。Core image testsを読了。実Photos/Files、iPhone HEIC、取消/欠損復元操作は未確認。|
|P7|BLOCKED（証拠収集中）|既存Core/Board/Articlesテストの実装者記録は存在。親の同一環境10回比較・統合Releaseビルド・UI QA・真の描画メトリクスは未受領。callback proxyは実GPU描画やWebKit/サムネイル完了を証明しないと実装者自身が明記。|

### 確認した差分と検証

- pristine基点 `/tmp/campus-010-baseline-1792253003` と現在のCampusPocket全体、CampusCore/Sources、Xcode projectの実diffを確認。追加AsyncJSONStore/BackgroundImageStore/CampusBackground、変更AppModel/CalendarModel/PersonalViews/Root/Home/More/Import/Board/Articles/CampusStyle/Agendaと周辺モデルを追跡。
- 独立リスク表を本ファイルに先に記録後、`010-performance-work.md` / `010-appearance-work.md` と追加Coreテストを照合。
- HTML計画のplan/srcとも `data-approval="pending"` を確認。正本のv1/P1–P7明示承認と親の会話証拠に一致。
- 製品変更・Simulator操作・ビルド・重いテストは行っていない。静的レビューのみ。テスト成功件数は実装者記録であり独立再実行ではない。
- 保存順序/原本上書き/背景世代競合/キャッシュ保持上限について、静的追跡で追加の具体的不具合は確認しなかった。

### 改善提案（任意）

- Core testsはstore primitivesを検証するが、AppModelの最終revision状態・transaction失敗時UI、CampusAppearanceの世代更新/初期復元競合を直接検証していない。P7実操作を補完するため、その境界の再現手段があれば追加が望ましい。現時点ではコード欠陥と断定しない。
- 正本の「子: 未起動」「本実装は未着手」など開始前の進捗文が後続の開始記録と併存する。最終統合時に現在状態へ整理する。

初回レビュー完了。修正版と親の統合検証証拠を受けて最大2巡の再レビュー対象とする。

## 再レビュー1: コードレビュー PASS / P7総合受入は保留

2026-10-18。初回の修正必須1件は解消した。現在のコードについて追加の修正必須は見つからない。これは実装差分に対するコードレビューPASSであり、P1–P7の全検証完了を意味しない。P7は親の計測とUI QA継続中で、計測不能項目を含むため総合受入PASSにはしていない。

### 修正確認

- `CampusPocket/Resources/Articles.html:12` に背景時の `.story-row,.reader-source-view{background:var(--surface)}` を追加。通常/関連記事行の全本文と、Markdown全文のヘルプ・通知・補助操作が不透明面の配下となった。既存reading/editorの紙面、featuredカードの面も保持される。
- 同ファイル13行目の `.sample-note` と、`CampusPocket/Resources/Board.html:55` の `.board-content>.field-help` も不透明化。生成される一覧・詳細・writer・返信なし表示を静的に追い、同種の未保護テキストを確認しなかった。
- 変更はCSSのみでJavaScriptやbridge、session、入力DOM再生成経路を変えない。初回に追跡した保存順序、readOnly、画像世代管理との新たな不整合はない。
- P5は **静的適合へ更新**。P1–P4/P6の静的適合と残るUI/OS確認は初回表どおり。

### 統合検証の受領・照合

- `/tmp/campus-010-review1-build.log` を読取り、Release iOS Simulator arm64の **BUILD SUCCEEDED** を確認。統合iOSコンパイル待ちは解消。
- `/tmp/campus-010-review1-board.log`: **45 integration checks PASS**。`/tmp/campus-010-review1-articles.log`: 実際の入力/compositionend/キー操作と下書き保存復元のstub回帰PASS。両ログ自身の「実WebKit/IME未検証」注記も確認。
- `/tmp/campus-010-appearance-core.log`: **36 tests / 11 suites PASS**。CSSのみ修正のためCore再実行は不要。
- 親から通常/大量それぞれ変更前10回計測完了の報告を受領。変更後比較と375ptネイティブUI QAは継続中。本レビューではSimulatorに触れず、ビルドやテストを追加起動していない。

### P7に残す制限

- Instruments App Launch収録後の `/tmp/campus-010-before-lifecycle.xml` を確認したが、`life-cycle-period` のschemaのみでrowがない。親のmissing table source警告と一致し、現環境で真のfirst-frame/GPU描画値は得られていない。
- callback proxyはAppModelより前のプロセス起動、GPU実描画完了、WebKitコンテンツや非同期サムネイル完了を含まない。これをコールド起動全体の速度として扱ってはならない。
- 明暗写真、4色、375pt/文字拡大、背景再起動復元、Photos/Files選択取消・失敗、地図handoff、Web/IME保持、カレンダー権限の実操作、およびメモリ実測の充足は親の最終記録を参照する。未実施は明示して残す。
- 以上は検証範囲の制限であり、追加の具体的コード欠陥ではない。未測定の性能改善や全品質条件達成を断定しない。

再レビュー1完了、製品コードへの変更なし。

## 再レビュー2（最終差分）: コードレビュー PASS / P7総合受入は保留

2026-10-18。親の暗背景実画面QAで判明した掲示板公式案内の可読性漏れについて、`CampusPocket/Resources/Board.html:55` の `.official-note` に画像背景時の不透明 `--paper` が適用される修正を独立確認した。

- `heroMarkup()`（同89行目）の実際の閉じタグを追跡し、公式案内が `.board-hero` の外の兄弟要素であることを確認。この漏れは初回の静的監査でも見逃しており、再レビュー1の「同種の未保護テキストを確認しなかった」は網羅的保証ではなかった。現修正でこの具体的欠陥は解消。
- `listMarkup()/detailMarkup()/composeMarkup()` を再追跡。scope-tabs、hero、official-note、filter-row、list-heading、post/empty/detail/reply cards、detail-return、replies-title、返信なしfield-help、reply-form、sheet、image viewerの可視文字は不透明面の配下。透明compose-entryの可視アイコンは不透明action-disc内にある。追加の修正必須は確認しなかった。
- 変更はCSSの追加セレクタのみ。保存・画像処理・JavaScript・IME・ナビゲーション状態に変更はない。`/tmp/campus-010-review2-board.log` の45項目PASSと `/tmp/campus-010-review2-articles.log` の回帰PASSを照合した。自身ではビルド・テスト・Simulatorを起動していない。
- 親から実画面での4色切替、暗背景preview/cancel/apply、5タブ、地図handoff、再起動背景復元の確認報告を受領。これは親のUI QA証拠であり、本レビュー担当の実操作ではない。
- P1–P6の静的判定は適合を維持。P7のbefore/after通常・大量各10回比較と残るUI/OS検証は親が進行中。真のGPU/first-frame取得不能、callback proxyの範囲、実機/ピークメモリ等の未確認事項は再レビュー1の制限を維持し、全受入PASSとはしない。

最大2巡の再レビュー完了。現在の製品差分について未解決の修正必須なし。以降のP7検証と総合判断はメイン担当へ戻す。

## P7計測からの追加仕上げ差分レビュー: PASS（コードのみ）

2026-10-18。以前の指摘修正2巡とは別に、計測で見つかった不要publishの抑制2箇所を確認した。`/tmp/campus-010-after-perf/CampusPocket/{CalendarModel,CampusBackground}.swift` の直前実装コピーと現在の実diffを照合し、申告された条件付き代入以外の変更がないことを確認。

- `CalendarModel.swift:84–87`: OS権限から算出した `canRead` を分岐に使用し、`authorized` は異なる場合だけ代入。許可取消時は必ず `clearUnauthorized()` へ進み、既存外部予定の消去を省略しない。再付与時はfalse→trueをpublishして通常要求生成へ進む。
- 同97–109行目: `revision += 1; pending = nil` は値が既に空でも毎回実行される。inFlightの古いrevision判定、単一worker、完了時OS権限再確認、最新pending開始は無変更。拒否/未許可の反復では公開値の等値代入だけを省く。取消後の再付与で古いinFlightが残っていても、新しい要求はrevision不一致で抑制されずpendingになり、旧完了時に旧結果を破棄してpendingを開始する従来の動作を保持。
- `CampusBackground.swift:40–45`: persistenceRevisionガードと復元失敗案内は無変更。成功結果nil・現画像nilの場合だけ代入を省く。非nil画像の復元、既存画像をnilへ戻す代入、明示apply/resetが初期復元より優先される動作は維持される。候補画像・世代gate・永続化には変更なし。
- MainActor上の値比較と直後の代入で間にawaitがなく、この変更による新たな競合は確認しない。性能改善幅はコードから断定しない。

修正必須なし。製品編集・ビルド・テスト・Simulator操作は実施せず。親がこの最終コードのReleaseビルドと通常/大量各10回の比較を取り直す。P7の総合受入保留と実描画メトリクス/実機等の制限は従来どおり。

## P2 WebView生成遅延の追加差分レビュー: PASS（コードのみ）

2026-10-18。直前コピー `/tmp/campus-010-after-perf/CampusPocket/{BoardView,ArticlesView}.swift` との実diffを確認。変更は軽量Hostへのsession保持と、WebView取得を可視判定後へ移す箇所に限定される。修正必須は確認しなかった。

- BoardWebSurface.makeUIView（167行目）/ArticleWebSurface.makeUIView（247行目）はWKWebViewを生成しない。Hostの `active && window != nil` 判定（Board184/Articles265行目）を通った後だけ `session.makeWebView()` を呼ぶ。updateUIView/didMoveToWindow/layoutSubviewsのいずれも同じ判定を利用。active値は親タブ4かつ対応する投稿/記事セクションで算出され、隠れた初期タブHostでは生成しない。
- 両sessionのmakeWebViewは既存インスタンスを先に返す。Hostの再生成や記事/投稿切替でも新しいHTMLをロードせず、既存文書・DOM・入力を保持する。従来のshared session、superview移動、制約置換、dismantle時のinactive化を維持し、古いHostが新しいHostへ移ったWebViewを破棄する処理は追加されていない。
- 未生成時のBoard.applyはcontextとlastRequest、setTheme/setBackgroundは保留値をready判定前に記録。didFinishで背景・テーマ・講義contextを順に反映する。ArticlesはpendingCourse/currentCourse、pendingTheme、imageBackgroundを同様に保持し、didFinishで反映。再訪の同じrequest IDは再適用せず、既存編集中documentの意図しない講義リセットを防ぐ従来動作を維持。
- suspend/persist、背景/テーマ更新のJS、記事IME deferと保存処理、投稿下書き保持経路は無変更。初回生成前のsuspendは保存すべきdocumentが存在しないためno-opで問題ない。実UIKitでのfocus/変換、各セクション往復時の下書き保持、初回講義指定、背景/テーマ事前変更は親のUI QAで確認が必要。
- 検証表現の注意: Articles.didFinishはDOMのchildElementCountを検証するだけで、HTMLのasync initDraftStorage()完了をawaitしてはいない。これは今回のHost差分以前からの動作。didFinishを「保存archiveロード完了」や完全WebReadyの証拠と扱わず、初回表示で保存済み下書きを開く確認を含めるよう親へ連絡した。

製品変更・ビルド・テスト・Simulator操作なし。この最終差分に対するReleaseビルド、UI入力保持、再計測は親担当。P7総合受入の保留と計測範囲の制限を維持する。
