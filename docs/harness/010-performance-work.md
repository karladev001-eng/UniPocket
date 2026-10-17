# 010 P1–P3 performance implementation

HARNESS_WORKER / implementation only. Approved scope v1 / P1–P7; this packet covers P1–P3 and supporting P7 checks. gpt-6.1-sol/high selected by parent for storage/concurrency risks. Non-Git project; no Git init or external writes. Original snapshot: `/tmp/campus-010-baseline-1792253003` (parent owns baseline SHA256 record).

## Changes

- `CampusCore/AsyncJSONStore.swift`: synchronous enqueue + private serial queue for load/encode/atomic write/transaction/flush. Call order cannot be reversed by Swift task scheduling. No debounce: every accepted ordinary snapshot remains FIFO.
- `AppModel.swift`: loading state prevents mutation and saving until validated load completes. Load failures retain source JSON and lock editing. Ordinary edits publish immediately, write off-main, and keep pending/failed status until the latest accepted revision completes. Earlier write completions cannot clear a newer save status. Transaction operations (import, attachment add/remove/restore, note delete/undo) publish only after successful JSON save; editing is temporarily disabled during their await, preventing a later edit from being overwritten. Attachment validation and original-image save share the JSON worker; a new image is removed if its reference save fails. Original retained images are never garbage-collected. A bounded iOS background task drains accepted writes after scene deactivation, including writes accepted while an earlier flush was pending.
- `CalendarModel.swift`: lazily constructed EventKit store used exclusively on one serial worker; UI receives value-only calendar descriptors and events. Identical simultaneous requests are merged, newest pending request replaces older pending requests, and revision checks suppress stale results. Store-change notifications force one fresh pending request. Permission checks immediately clear external display state on refresh/reentry and check again before applying results. Invalidated requests cannot suppress a new request after regrant.
- `CombinedEventsCache`: only schedule inputs and external events invalidate combined events. Note, facility, link and display-setting changes reuse the result. Existing `AppData.combined` cancellation/personal-edit/ownership duplicate semantics remain authoritative.
- `PersonalViews.swift`: async ImageIO thumbnail derivatives (orientation transform, max1024px), single decode queue, strict decoded-cache bounds of 24 MiB and 64 entries. Active display references and one in-flight derivative are additional to the cache. Memory warnings clear the cache; disappearing thumbnail views release their reference. Original image viewer and files retain original resolution. File-import bytes load off-main within their security-scoped access interval. Async transactional caller state updates only after success.
- `CampusPocketApp.swift`: simple loading view, refresh after data load, bounded background flush, transaction progress, Home `LazyVStack`. Map heading is a stable separate scroll anchor so explicit map handoff can reveal lazy content. Five tabs, navigation state and persistent WebView sessions remain in place.
- `ImportView.swift`: awaits background import commit before dismissal; failed transaction retains prior schedule.

## Checks

- Core suite: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer ./scripts/test-core.sh` — **31 tests / 10 suites passed**, `/tmp/campus-010-performance-core.log`. Three new regression tests cover FIFO 80 snapshots/flush + off-main execution; invalid load preservation + failed write/retry; schedule cache reuse, cancellation, personal edit and duplicate suppression.
- iOS Simulator Release build initial revision: succeeded in `/tmp/campus-010-performance-build` (before final attachment off-main refinement). Final rebuild status is recorded in the handoff below.
- Python instrumentation and summary scripts syntax check: passed with `PYTHONPYCACHEPREFIX=/tmp/campus-010-pycache python3 -m py_compile ...`.
- Initial ordinary sandbox Xcode build failed because Simulator/module caches are outside the workspace. Retried using the permitted escalation and Xcode caches; no product workaround.

## Measurement helper (test-only)

`scripts/instrument-performance.py --project <DISPOSABLE_COPY>` patches a baseline/current project copy identically, without changing the production source. It starts a monotonic clock before JSON work, records validation/load completion, adds a UIView/CADisplayLink display callback probe, and automatically visits tabs `[1,4,2,3,0]` twice with one second of settling between visits. Launch instrumented Release copies with `SIMCTL_CHILD_CAMPUS_BENCHMARK=1 xcrun simctl launch --console <DEDICATED_DEVICE> jp.personal.CampusPocket`. Capture `CAMPUS_PERF` JSON lines until `finished`, then terminate before the next cold-process run. Use the same dedicated Simulator, source date/data, build options, launch mode and cache conditions for before/after. Parent-generated fixtures are `/tmp/campus-010-fixtures/{empty,normal,large}`.

`scripts/summarize-performance.py <logs...>` prints actual sample count, median, nearest-rank p90 and worst for load complete, first display callback, data-ready display callback and per-tab first/revisit durations. It does not synthesize missing runs.

**These callback timings are presentation-opportunity proxies, not GPU frame completion or proof that asynchronous WebKit/thumbnail content has finished.** They exclude process startup before AppModel begins. True first-frame launch measurement needs XCTest application-launch metrics / Instruments. Report unverified items honestly; do not claim P7 complete from callback timings alone. No speedup numbers were fabricated in this packet.

## Remaining validation owned by parent/integration

- Same-environment ten-run normal/large comparison, true first-frame metric, WebKit ready/content completion, and first/revisit tab timing.
- Simulator visual/interaction checks: loading/read failure, saving failure/retry, rapid text updates, image attach/remove/undo/delete, background save, map handoff, persistent article/board draft input.
- EventKit permission revoke/regrant and out-of-date request races on a configured calendar (Simulator data/authorization not assumed).
- Device memory (cache bounded by code; actual peak additionally includes view references, original image viewer and UIKit surfaces) and OS background-task expiration / forced termination. Atomic JSON writes avoid partial replacement; no app can promise a just-accepted write survives OS force-kill before completion.
- Appearance worker owns P4–P6; independent review and integrated build remain required. No theme or background setting behavior was edited by this worker.


## Follow-up: startup no-op publications (2026-10-18)

Parent requested only the two narrowly scoped publication changes after read-only diagnosis during measurement. `CampusBackground.swift` skips background restoration assignment only when both the loaded image and current image are nil. Non-nil restoration and clearing any existing image retain their prior behavior; the persistence-revision guard and failure notice are unchanged. `CalendarModel.swift` compares authorization before publishing, and clears unauthorized state only where a value is nonempty/non-nil/different. Request revision invalidation and pending-request cancellation still occur on every unauthorized refresh, so stale-result suppression and immediate external-event removal are unchanged.

No GeometryReader, WebKit construction, root structure, loading contract or other product code changed. No Simulator, build or test commands were run for this follow-up, as requested to avoid measurement contention. Parent owns the integrated rebuild and fresh final comparison; no performance effect is asserted from source inspection alone.


## Follow-up: create WebKit only for an active visible host (2026-10-18)

Parent authorized a bounded P2 follow-up after startup measurement. `BoardWebSurface.makeUIView` and `ArticleWebSurface.makeUIView` now construct only their lightweight UIKit host and retain its existing session. Each host first checks `active && window != nil` in `attachIfVisible`; only then does it ask the session for its WKWebView. The session's existing `if let webView { return webView }` keeps one document/editor across tab revisits and host transfers. No new teardown, reload, persist timing or IME behavior was introduced. Outgoing hosts still only become inactive and never detach or destroy an editor adopted by an incoming host.

Source inspection confirms precreation requests remain queued: Board `apply` stores request ID/context and `setTheme`/`setBackground` store values before their ready guard, then `didFinish` applies all three. Articles stores `pendingCourse`/`currentCourse`, `pendingTheme` and `imageBackground` before ready guards; `didFinish` applies them after the editor has initialized and loaded its archive. Precreation `suspend`/`persist` remain no-ops because no document or unsaved input exists yet. Navigation and section state remain above these hosts.

Only `CampusPocket/BoardView.swift` and `CampusPocket/ArticlesView.swift` changed in product code. No Simulator, build or test commands were run while the parent comparison was active. Parent owns integrated compile, independent code review, actual draft/IME/tab-transfer interaction checks and final 20-run measurements. No startup improvement is asserted until those measurements complete.
