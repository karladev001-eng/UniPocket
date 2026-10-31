# 011 v3 実装契約（仕様正本を補助）

正本: /Volumes/Data_SSD/dev/univ/docs/harness/tasks/011-pwa-notion.md
承認: 2026-10-18ユーザーがv3・AC1–12の全範囲の実装開始を明示承認。資料は同名plan.htmlで提示済み。匿名ユーザー、外部カレンダーなし、旧Swiftデータ移送なし確定。Swiftファイルは変更しない。
基点: 59c719ea1c08423b30e99bdf424f5207fa4b142b

## 実装境界

A: web/ のフロント、package/tsconfig/build設定、public、PWA service worker、個人データ、PDF、マップ、フロントテスト。server/とmigrations/はB所有。TypeScript+Vite（vanillaまたは軽量UI）。wrangler.jsoncはAがBの入口server/worker.ts・DB binding DBを設定。D1ローカル接続の統合は後段。
B: web/server/worker.tsと補助serverファイル、web/migrations/、web/tests/server*、web/DEPLOY.md。フロントpackageは触らず、必要な依存/コマンドを親へ連絡。Workers APIはD1 binding DB、assets binding ASSETS。フロント静的ファイルはWorker呼出不要の構成をAが設定。
統合担当: A/Bレビュー後に専用worktreeへcherry-pick、接続/検証/READMEを担当。最終的に現在のcheckoutへ統合。

## API v1（JSON、同一オリジン）

JSONレスポンス。失敗は{error:string,code?:string}。リストGETはログイン不要。Cookieで匿名認証。mutationはOrigin検証。同一オリジンのfetch credentialsで接続。ボディに所有者IDを受けない。

- GET /api/session → {user:null|{id,displayName}}。未作成の場合null。
- POST /api/session {} → {user:{id,displayName}}。既存セッションなら再利用。
- PATCH /api/session {displayName} → {user}。
- GET /api/articles?q=&category=&courseId=&authorId=&bookmarked=1&cursor=&limit=20 → {articles:Article[],nextCursor:string|null}。bookmarkedのみ有効セッション必須。
- POST /api/articles {title,publicUrl,embedUrl?,summary?,category?,courseId?} → {article:Article} status201。Idempotency-Key対応。
- GET /api/articles/:id → {article:Article}。
- PATCH /api/articles/:id {title?,publicUrl?,embedUrl?,summary?,category?,courseId?} → {article}。本人のみ。
- DELETE /api/articles/:id → {ok:true}。本人のみ。
- PUT /api/articles/:id/bookmark {} → {bookmarked:true,bookmarkCount:number}。本人・冪等。
- DELETE /api/articles/:id/bookmark → {bookmarked:false,bookmarkCount:number}。
- POST /api/articles/:id/view {} → {viewCount:number}。初回なら匿名セッションを作成してCookie設定。同一匿名ID・記事・JST日で1回。閲覧時に発行することで初回ブックマーク前後のID切替重複を避ける（仕様の自動準備の具体化）。

Article={id,authorId,authorName,title,publicUrl,embedUrl,summary,category,courseId,createdAt,updatedAt,viewCount,bookmarkCount,bookmarked,canEdit}。IDはstring。日時ISO文字列。category/courseId/summaryは未指定なら空文字。canEditは匿名所有権からサーバー算出。bookmarked未ログインfalse。IDで投稿者を絞り込み、表示名同一を同一人物としない。

## Notion

公開URLを検証し、実ページの公式埋め込みURL形式を調査。通常URLの勝手な変換を断定しない。必要時公式iframeコードからsrcのみ安全抽出する補助入力を提供。許可ホストはnotion.site / notion.soとその正しいサブドメイン。https必須、credential/非標準ポート/偽装ホスト拒否。独自ドメインは初回対象外。任意HTMLは実行しない。表示成功をiframe loadから断定しない。

## 重要な受入

既存ホーム/時間割日週月・個人修正・PDF解析/差分・メモ画像チェック固定・施設リンク地図テーマ背景を現コードから移植する。省略を完成扱いにしない。実アカウント未接続のCloudflare本番配信と実Notionページが必要な実機検証は未確認として残す。フロント/サーバーのローカルテストと結合は実施。

更新はwaiting SW・保存成功・他タブ協調後に適用。失敗時は切替せず入力保持。個人DBとCookieを更新で削除しない。API/認証応答を汎用キャッシュしない。build IDと更新履歴、公開/rollback手順。

## テストと返却

変更パス、テストの実結果、既知制約、コミットSHAを返す。子の再委譲なし。指定ファイルだけコミット。必要なパッケージ取得やlocalhost起動は適切な権限で実施。レビュー後修正は元担当に戻す。
