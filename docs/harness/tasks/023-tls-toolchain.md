# 023 · 配信前のTLS信頼とNode実行系を守る

- 状態: done
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

## Homebrew実経路の再検証（T3）

2026-10-23、上記の実バイナリと更新済みHomebrew CAで、各ツールの正常HTTPS対照1件と危殆化証明書4種を検査し、15/15条件を満たした。curlは4種ともexit60、Gitは4種とも証明書issuerエラー、Python標準ssl/urllibは4種ともSSLCertVerificationErrorを伴うCERTIFICATE_VERIFY_FAILED。正常対照はcurlが一般Worker200、GitがGitHubの公開workerdリポジトリHEAD取得成功、Pythonがnpm registry200。

Gitは新しい実行ファイルでもlibcurl8.7.1を参照し、初期状態では危殆化証明書を受け入れた。そのためこのリポジトリの`.git/config`だけに`http.sslCAInfo=/opt/homebrew/etc/ca-certificates/cert.pem`と`http.sslVerify=true`を設定し、実経路を再検証した。以前のローカル指定はなく、グローバルGit/OSのCAストアは変更していない。他リポジトリやPythonのrequests/venv固有bundleまで安全とは扱わない。

証拠は`/private/tmp/uni-pocket-homebrew-tls-20261023.json`（15結果/allPassed=true）と同名の`.py`検査スクリプト。Pythonの初回正常対照（一般Worker）はHTTP403だったためTLS失敗と誤認せず、証拠に残して通常のnpm registry対照へ変更した。資格情報を検査ホストへ送信していない。独立レビュー担当もJSONとリポジトリ限定設定を確認。

## 実装とレビュー対象

分離worktree `tls-toolchain`の実装コミットは`84f2ab4`（基点e8ee753）。Node許可範囲・npm engine-strict・主要入口の起動検査、更新済みCAの選択とMiniflare/Wranglerへの適用、実ネットワーク検査と7日以内のローカル成功記録を追加。記録はCA内容/経路、正確なNode版、OS/arch、lock、guard/verifier内容に対応し、変更・期限切れ・新規検査失敗で使えない。UI/API/DB/認証コードは変更なし。

実装担当の最終結果: toolchain12、consumer149、admin44、server11、workerd14、integration7件が成功、一般/管理の型検査と両ビルド成功。npm auditはprod/dev込み0件（`/private/tmp/uni-pocket-023-audit-final.json`）。TLS検査はNode・Miniflare・Wranglerそれぞれ正常1+危殆化4の計15条件成功。正常対照のタイムアウトとWranglerの明示的通信切断を途中で検出し、正常対照の変更と、通信切断を証明書拒否と数えない検査の強化後に再実行した。workerdはTLS理由を公開せず内部参照エラーを返すため、同一CAのNode側CERT_REVOKED、正常対照、対策なしworkerdの4/4受入との比較を合わせて判断し、native証明書コードを取得したとは扱わない。

独立レビュー: Sol6.1/highがコミット`84f2ab4`の実差分21ファイル、入口/CA環境継承、成功記録の失効・再読込、範囲保持を確認しT1–T6をPASS。最終toolchain12件を独立再実行し成功、audit JSONとHomebrew証拠・Git限定設定を照合。必須修正指摘なし。Nodeの他系列境界はバージョン模擬と実npm engine-strictで検証、実機実測は26.12.1/macOSに限定。Linux/Windowsの成功を主張しない。

統合は別worktree `tls-toolchain-integration`（基点476e64d）へレビュー済みコミットだけを取り込み、独自のTLS成功記録を作成して全チェックを再実行する。統合担当はカタログのgpt-6-luna/medium（決定的な取り込みと結合検証、慎重さのためmedium）。起動直前statusはauto/no pins、対応effortはspawn_agentカタログを再確認済み。

統合コミット`ade955215d876cea4dfc34ea24166b2e066e96f6`はREADME/web treeがレビュー済み`84f2ab4`と完全一致、clean/diff-check成功。toolchain12、consumer149、admin44、server11、両型検査、両ビルドとintegration7が成功、auditは161依存/0件。初回TLS CLIは空のerror.messageで失敗して記録を作らず、同じexported verifyTlsを詳しい診断付きで再実行して15条件成功。初回の原因は特定できず、成功へ置き換えて記録しない。

初回test:allは229/230成功、既存のshared-school-IP burstだけ429を観測せず失敗した。独立レビューは変更のない固定60秒bucket（180件/分）と、200件を同一分に送る前提のテストの時刻依存を確認。初回の厳密なbucket時刻は未採取で原因確定とは扱わない。対象だけの再検査1/1成功（05:09:53～05:10:01 UTC以内）、続くruntime全体14/14成功（05:10:04～05:10:19 UTC以内）。API/テストの変更なし。ログは`/private/tmp/uni-pocket-023-integration-*`、対象ログ`rate-targeted.log`と`test-runtime-followup.log`。範囲外の既存テストの時刻依存を残る検証上の注意として保持する。

## 完了・引継ぎ

- 最新仕様版1/T1–T6の提示・直接承認・実装対象が一致。未解決の実装必須判断なし。独立レビューと最終統合整合レビューはいずれもPASS、修正必須指摘なし。
- rootへ`ade9552`をfast-forward済み。README/webがレビュー済み`84f2ab4`と完全一致することをrootでも確認。無関係な018の変更と013の未追跡文書を保持した。
- rootで実際の`npm run verify:tls`を再実行しexit0、正常200×3・Node CERT_REVOKED×4・Miniflare/Wrangler拒否×8を確認、作業コピー固有の成功記録を作成。証拠`/private/tmp/uni-pocket-023-root-verify-tls.log`。生成したroot probe cacheだけを除去、既存データは保持。
- 許可Node範囲は22.23.4以上の22系、24.22.1以上の24系、26.12.1以上の26系。現在の26.12.1で実測。開発/検証/配布準備はREADME記載のguard付き入口を使い、CA等の変更時や7日期限後は`npm run verify:tls`を行う。
- Homebrew curl/Python標準sslは実測成功、Gitはこのリポジトリ限定CA設定後に成功。Mac標準CLI、他リポジトリ、別Python bundle、他OSの安全性を一般化しない。OS/global設定やHomebrew管理ファイルは変更なし。
- 配信・push・DB/Access/JWT/記事更新は未実施。UI022も引き続き未配信。公開時は同じorigin/DB/管理認証を保ち、レビュー済みソースとguard付きWrangler入口を用いる。
- 計測: worktree作成時の取得値04:51:57 UTC、最終確認取得値05:11:30 UTC（観測区間19分33秒、全会話時間を表す値ではない）。メインは現在のホストモデル、実装・レビューSol6.1/high、統合Luna/medium。利用枠/トークン/費用は未取得/null。今回の修正はセキュリティ対策で制作評価や好みを更新しない。
