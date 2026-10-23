# 023 · 配信前のTLS信頼とNode実行系を守る

- 状態: ready
- 仕様版: 1
- 対象: 証明書監査で発見した開発用workerd・Mac CLI経路の対策、Node最低版の強制、配信前の再検証（T1–T6）
- 基点: e8ee753 / codex/pwa-migration
- 関連: [022の配信前調査](022-article-header-color-mode.md)。UI022の実装成果は保持し、配信しない。

## 目的・提示・直接承認

前回の調査結果として、workerd1.20261012.1とMac標準curlが危殆化eMudhra証明書を受け入れること、Node最低版指定が古いことを提示し、「開発ツール・証明書ストアを対策し、再検証してから配信」「古いNodeを許す最低バージョン指定の整理」を推奨した。

その提示後、ユーザーが2026-10-23に「残っている証明書の問題とNode.jsの最低バージョン指定を修正して、配信前にもう一度検証してください。また、curl, git, pythonはhomebrewで新しく入れたので、そちらを使えば問題ないですか？」と対象を特定して直接指示。既存の調査で提示した修正と再検証への承認根拠とする。元のUI承認を新しい修正の根拠に流用しない。

本チャットで修正・再検証内容を説明し、Homebrew版の実行経路も調査済み。利用者向けUI・入出力の変更がないため視覚モックは非該当。公開URL/DB/Access/JWT/記事/端末データの変更、公開配信、OSのCAストアやグローバルGit設定の編集は対象外。

## 契約と受入条件

- **T1 Node**: 公式10月21日修正版の22.23.4以上の22系、24.22.1以上の24系、26.12.1以上の26系だけを許可し、未修正/非対応系を拒否。package enginesだけの警告に頼らず、npmと主要実行入口で誤った実行系を止める。現在の26.12.1で通常操作が通る。lockと説明も一致させる。
- **T2 workerd**: 公式の新しい対応ツール/更新済みCAの利用で、ローカル開発・テストの外向きHTTPSが指定4種の危殆化証明書を拒否する。まず現行/更新候補の実経路を調べ、単なるパッケージ更新で直ると推測しない。TLS検証無効化・任意URLによる独自例外・手作業の広域PKI置換は使わない。正常なHTTPSは維持。互換性のないMiniflareの降格や実験系変更は避ける。
- **T3 Homebrew**: 実際のcurl/git/Pythonの解決先とTLS経路を確認。正常HTTPSと危殆化証明書拒否を各ツールで再検証する。必要ならこのリポジトリのGit設定だけへ既存の更新済みHomebrew CAを適用。OS管理領域・ユーザー全体の設定は変更しない。別のPython環境/requests独自bundleまで安全と一般化しない。
- **T4 恒久性**: 開発起動・テスト・配布準備の入口で対策が再現され、親の一時環境変数だけに依存しない。標準curlへの絶対パス呼出を安全だと扱わない。設定不足・安全なCAなし・旧Nodeの場合は短い対処付きエラーとし、証明書検証を回避しない。CA/ツールのOS差は明示する。資格情報を検査用ホストへ送らない。
- **T5 再検証**: npm audit、Node許可/拒否の境界、証明書拒否4種と正常HTTPS対照、実際の開発/テスト入口、一般/管理の型検査・ビルド・既存回帰を検証。独立レビュー、分離統合と最終等価性を確認。監査0件だけをCA対策の証拠にしない。
- **T6 保持と範囲**: アプリUI/保存データ/API認可/DBは不変。公式レジストリの必要な開発ツールと実行設定/テスト/ドキュメントだけを変更。Homebrewの更新済みファイルは読むだけ。公開配信はしない。未対応・未検証は隠さず報告。

## 未解決事項

実装必須の利用者判断なし。CA経路と対応ツールの選択はこの限定修正の実装判断として調査・検証する。修正できない経路があれば完了扱いにせず戻す。

## 現在の証拠

- 現在PATH: curl=/opt/homebrew/opt/curl/bin/curl、git=/opt/homebrew/bin/git、python3=/opt/homebrew/bin/python3、node=/opt/homebrew/bin/node。
- Homebrew: ca-certificates2026-10-20、curl8.23.0、git2.56.0_1、Python3.15.0_1、OpenSSL4.0.3。Pythonのdefault cafileは/opt/homebrew/etc/openssl@4/cert.pem→ca-certificates/cert.pem。
- dv-g3b-noct検査: Homebrew curlはexit60で証明書拒否、Python urllibはCERTIFICATE_VERIFY_FAILED。Homebrew gitは標準設定ではTLSが成功して非Git応答に到達（not valid repository）、更新済みCAをコマンド限定で明示すると証明書拒否。gitのbuild-optionsはlibcurl8.7.1を示す。
- 現行workerdはSSL_CERT_FILE=/opt/homebrew/etc/ca-certificates/cert.pemを一時的に指定すると4種ともfetch失敗。ただし正常HTTPS対照も確認するまでは完成と扱わない。
- npm既定latest照会: Wrangler4.152.0、workerd1.20261023.1、Miniflare4.20260730.0。現行Miniflare5betaより既定latestが古いため、無条件のlatest一括更新をしない。
- [Node公式修正版](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)、[Cloudflareの説明](https://blog.cloudflare.com/emudhra-certificate-compromise)、[検証者の検査サイト](https://emudhra.we-have-a-problem.com/)。前回JSON証拠は/private/tmp/uni-pocket-security-check-20261023.json。

## 役割・運用

Harness active/delegation/review/persistence/measurement/improvement_loop=true、max_agents3、model auto/no pins。モデルの候補/effortは現在のcollaboration.spawn_agentカタログを根拠とする。証明書信頼の判断・実装はSol6.1/high、独立レビューもSol6.1/high。決定的な統合はLuna/medium。履歴なしで bounded HARNESS_WORKER を使用、子は再委譲しない。メインは調整・記録とMac CLIの限定設定/実測、製品実装は子へ渡す。

制作好みの変更ではないため嗜好記憶は更新しない。開始/終了は取得値だけを記録し、利用枠・費用は未取得/null。無関係な018/013文書と、親の022調査メモを実装コミットへ巻き込まない。
