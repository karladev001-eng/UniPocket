# 固定出典と変更表示

本スキルは [anthropics/claude-plugins-community の html-plan](https://github.com/anthropics/claude-plugins-community/tree/f60f0454df3045f724c43c6346ec80bdcc3472b2/html-plan/skills/html-plan) を元にする。
固定コミット: `f60f0454df3045f724c43c6346ec80bdcc3472b2`。ライセンス: Apache-2.0（同梱LICENSE）。取得tree内にhtml-plan固有のLICENSE/NOTICEはない。無関係な上流プラグインは含めない。

| ファイル | 由来と変更 |
|---|---|
| SKILL.md | 上流のwhy/what/how/whereと展示原則をCodex用に再構成。日本語既定、正本、独立した明示承認、関連記録、保存OFFを追加 |
| references/blocks.md | 上流構文資料を継承。Codex用の前置きと未解決事項の配置/回答の扱いを変更 |
| runtime/htmlplan.js | 上流描画・パーサを継承。日本語操作/回答、計画ID/版/範囲に結び付く保存、保存OFF、承認文案を独立追加。HTMLは常にpending |
| runtime/htmlplan.css | 上流スタイルを継承。承認文案・狭幅・関連欄のスタイルを追加 |
| runtime/pack.mjs | 上流packを継承。読取境界、secret検知、コード/画像処理を保持。計画メタデータ検証を追加。Claude専用Artifact出力/STE強制を除去し英単語数は英語ページだけに適用 |
| examples/*、references/workflow.md、agents/openai.yaml | Codex向けに新規作成 |

派生ファイルの先頭にも変更表示を置く。上流のLICENSE全文を維持する。
