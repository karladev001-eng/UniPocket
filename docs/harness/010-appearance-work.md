# 010 P4–P6 appearance implementation

HARNESS_WORKER / bounded implementation + integration only. Approved v1/P1–P7; this packet covers P4–P6 and supporting image tests. gpt-6.1-sol/high selected by parent for image/storage/concurrency lifecycle risk. Non-Git project, no Git initialization or commits. Baseline preserved at `/tmp/campus-010-baseline-1792253003`. Existing P1–P3 changes retained.

## Changes

- `CampusStyle.swift` / `CampusPocketApp.swift`: theme entry consolidated into More → テーマ・背景; palettes removed from shared headers, Board and Articles. Existing four themes and legacy preference migration preserved. Readable opaque header, section and helper surfaces remain over photo backgrounds.
- `CampusBackground.swift`: shared retained decoded native image, reused by the five tab backgrounds; centered aspect-fill/crop. Photos and Files selection, preview, explicit apply, selection/processing cancel, reset and retry-able errors. Selection generation checks suppress stale completions; a synchronized gate skips queued obsolete decode jobs before input/decode and again before display decode. An already executing ImageIO operation cannot be interrupted, but its result is discarded. Saving after explicit Apply temporarily disables background controls until atomic commit finishes; cancellation is available during picker/input/processing/preview. Failure retains prior applied image and candidate for retry. Theme selection remains independent.
- `BackgroundImageStore.swift`: bounded input read (40MiB + one byte), type/frame/dimension validation, orientation-aware ImageIO thumbnail max2560, opaque RGB JPEG derivative; source bytes never modified. Saved image metadata is validated before display decode. All file/encoding/decoding work is off-main; image work and writes run serially. Store is independent of data.json, using a single atomic `Application Support/CampusPocket/Appearance/background.jpg`. Reset removes that setting file. Preference flag helps distinguish never-selected from missing saved image; the file itself remains authoritative if a crash occurs before the flag persists. Missing/corrupt saved image falls back to solid with a settings notice, retaining corrupt bytes until explicit selection/reset.
- `BoardView.swift` / `ArticlesView.swift` and bundled HTML: only boolean background presence crosses JavaScript, never image data/URLs. WKWebView outer surfaces become transparent over the native Community background; opaque cards, controls, article paper/editor, map and image viewer remain dedicated. Sessions/WebViews are retained. Theme updates retain existing IME/draft protection.
- `scripts/instrument-performance.py`: accepts both baseline solid-root and new native-background root hooks on disposable copies.
- `README.md`: consolidated entry, limits, local persistence, cancellation and validation limitations documented.

## Verification

- Core: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer ./scripts/test-core.sh` — **36 tests / 11 suites passed**, `/tmp/campus-010-appearance-core.log`.
- Five new image tests cover oriented JPEG 6→1 and swapped dimensions; max2560 + 20,000px boundary/20,001px rejection; 40MiB+1 bounded-read rejection; malformed/TIFF/animated-GIF rejection; replacement/reset/missing/corrupt save behavior and failed-write preservation; transparent PNG flattened to white; actual static HEIC decode and derivative dimensions.
- HEIC test uses an installed static macOS fixture (`iMac Blue.heic` on this run), never copies system images into repository. Hosts without an installed single-frame HEIC log that condition and omit that one format check. An initial synthetic HEIC encoder fixture failed because ImageIO advertised an encoder but sandbox IOSurface/sysctl access prevented finalization; replaced fixture generation with actual installed HEIC decode, leaving product/dimension/pixel assertions intact.
- `node scripts/test-board.cjs` — **45 checks passed**, `/tmp/campus-010-appearance-board.log`.
- `node scripts/test-articles.cjs` — passed, `/tmp/campus-010-appearance-articles.log` (DOM/selection/native-bridge stubs).
- Instrumentation helper applied successfully to separate temporary copies of both current and baseline AppModel/App files; exactly one probe inserted in each. Production files were not instrumented.
- No Simulator or Release build invoked by this worker at parent's request, to avoid baseline measurement contention. Parent owns integrated Release build, independent review, actual Photos/Files/UI cancellation/error/reset/restart/4-theme/375pt/dynamic-type/bright-dark image checks and performance comparison. iOS code has not yet been type-checked after these appearance changes.

## Constraints

- Decoded background max2560×2560 is about25MiB, plus a candidate during preview, bounded input bytes and one serial in-flight transformation; view/UI/decoder working allocations are additional. No full-resolution background image is retained, no background copies in JSON or JavaScript. Attachment cache limits and original-image viewer from P3 remain unchanged.
- Actual OS Photos/Files transfer, HEIC on iPhone, peak memory, visual layout and process termination during saving require Simulator/device validation. Atomic file replacement protects against partial writes; explicit apply cannot guarantee persistence if the OS kills the process before the write completes.
- Tests do not prove UIKit/WebKit visual correctness or GPU frame completion. Independent integrated review/build and parent P7 checks remain required.

Final handoff: product edits stopped; no Git commit (non-Git source). No ongoing build/test process.

## First independent review corrections

- Mandatory review P2/P5: image-background article `.story-row` and Markdown `.reader-source-view` now have opaque `--surface` backgrounds. This covers normal and related article row titles/summaries/bylines as well as full-source help text, notifications and controls, while preserving the article `.reading` paper.
- Audited generated root-level article/list/detail/writer markup and Board list/detail/composer paths. Added opaque `--paper` for article list `.sample-note` footer and Board detail's direct `.board-content > .field-help` no-replies message. Existing header/list-heading/filter/related surfaces, featured article, Board hero/post/detail/reply/composer/viewer and reader tools already have opaque surfaces. No JavaScript/state/navigation changes.
- Re-ran Board **45 checks passed** and Articles regression **passed** against revised HTML. Logs: `/tmp/campus-010-review1-board.log`, `/tmp/campus-010-review1-articles.log`.
- Parent's first integrated Release build **succeeded**, no Swift source errors. Then this worker ran the requested incremental Release build against the same `/tmp/campus-010-integrated-build` derived-data path, dedicated simulator destination, `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO`: **BUILD SUCCEEDED**, `/tmp/campus-010-review1-build.log` (completed session2985). Existing Xcode caches required permitted escalation. No Simulator interaction or installation performed.
- Prior statement that iOS appearance code had not been type-checked is superseded by the successful integrated and incremental Release builds. Core 36/11 unchanged and not repeated for CSS-only corrections. Actual bright/dark image and Markdown/list visual verification remains with parent UI QA and independent re-review.

First-review correction handoff: edits stopped, no ongoing processes, no commits (non-Git source).

## Second scope/readability correction from actual UI QA

- Parent's dark-image Board UI check found the official-information warning unreadable. Corrected `.official-note` to use opaque `--paper` when an image background is active. Prior first-review audit incorrectly grouped this paragraph with the opaque hero; `heroMarkup()` actually places it immediately after the hero section. This correction changes only the missing background rule.
- Re-audited Board list and detail direct-child output: `.scope-tabs` has opaque `--soft`; `.board-hero` opaque `--forest`; `.official-note`, `.filter-row`, `.list-heading`, `.detail-return`, `.replies-title` and direct empty-reply `.field-help` now have opaque `--paper`. Post/detail/reply/composer cards and sheet are opaque. `.compose-entry` itself is transparent but has no visible text; its visible icon is entirely inside opaque `.action-disc` (`--forest` / white). Image viewer retains its dedicated surface. No other direct visible text/action label over a transparent ancestor was found in these paths.
- Re-ran Board **45 checks passed** (`/tmp/campus-010-review2-board.log`) and Articles regression **passed** (`/tmp/campus-010-review2-articles.log`). No Swift/state/JavaScript behavior changed. No new tests mirroring a CSS declaration added.
- Parent owns integrated Release rebuild and actual dark/bright-image verification. This worker did not operate Simulator or build during this correction.

Second-correction handoff: edits stopped; no ongoing processes.
