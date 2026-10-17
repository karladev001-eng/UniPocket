#!/usr/bin/env python3
"""Opt-in identical display-opportunity probes for disposable before/after project copies.
Never patches live user data. Run on COPIES, then build Release and launch with
SIMCTL_CHILD_CAMPUS_BENCHMARK=1. Display ticks are a proxy, not GPU frame-completion metrics.
"""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--project', type=Path, required=True)
a = parser.parse_args()
app_path = a.project / 'CampusPocket/CampusPocketApp.swift'
model_path = a.project / 'CampusPocket/AppModel.swift'
app, model = app_path.read_text(), model_path.read_text()
if '// CAMPUS_BENCHMARK_PROBE' in app:
    raise SystemExit('already instrumented')
# Start before any JSON filesystem work, identically on both revisions.
needle = '    let root = '
assert needle in model
model = model.replace(needle, '    CampusPerformance.begin()\n' + needle, 1)
if 'self.loading = false' in model:
    model = model.replace('self.loading = false', 'self.loading = false\n        CampusPerformance.mark("data_loaded")', 1)
    readiness = '!model.loading'
else:
    needle = '  var readOnly: Bool'
    assert needle in model
    # Synchronous baseline init's completion includes successful validation or failure handling.
    model = model.replace('  init() {', '  init() {\n    defer { CampusPerformance.mark("data_loaded") }', 1)
    readiness = 'true'
needle = '    }.background(appearance.theme.paper).toolbarBackground'
if needle in app:
    app = app.replace(needle, f'    }}.background(CampusPerformanceProbe(ready: {readiness}, tab: navigation.tab))\n      .onAppear {{ CampusPerformance.startTabs {{ navigation.selectTab($0) }} }}\n      .background(appearance.theme.paper).toolbarBackground', 1)
elif '      .campusBackground().toolbarBackground' in app:
    needle = '      .campusBackground().toolbarBackground'
    app = app.replace(needle, f'      .background(CampusPerformanceProbe(ready: {readiness}, tab: navigation.tab))\n      .onAppear {{ CampusPerformance.startTabs {{ navigation.selectTab($0) }} }}\n' + needle, 1)
else:
    needle = '      .background(appearance.theme.paper).toolbarBackground'
    assert needle in app
    app = app.replace(needle, f'      .background(CampusPerformanceProbe(ready: {readiness}, tab: navigation.tab))\n      .onAppear {{ CampusPerformance.startTabs {{ navigation.selectTab($0) }} }}\n' + needle, 1)
app += r'''

// CAMPUS_BENCHMARK_PROBE — test-only, installed in disposable comparison copies.
@MainActor private enum CampusPerformance {
  static let enabled = ProcessInfo.processInfo.environment["CAMPUS_BENCHMARK"] == "1"
  static var start = ProcessInfo.processInfo.systemUptime
  static var started = false
  static var presented = false
  static var readyPresented = false
  static var step = 0
  static var select: ((Int) -> Void)?
  static var requestTime: TimeInterval?
  static let sequence = [1, 4, 2, 3, 0, 1, 4, 2, 3, 0]
  static func begin() { guard enabled else { return }; start = ProcessInfo.processInfo.systemUptime; mark("model_init") }
  static func mark(_ name: String, tab: Int? = nil, elapsed: Double? = nil) {
    guard enabled else { return }
    var event: [String: Any] = ["event": name, "ms": (ProcessInfo.processInfo.systemUptime - start) * 1000]
    if let tab { event["tab"] = tab }
    if let elapsed { event["duration_ms"] = elapsed * 1000 }
    guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
    FileHandle.standardError.write(Data("CAMPUS_PERF ".utf8) + data + Data("\n".utf8))
  }
  static func startTabs(_ action: @escaping (Int) -> Void) {
    guard enabled, !started else { return }; started = true; select = action
  }
  static func displayed(ready: Bool, tab: Int) {
    guard enabled else { return }
    if !presented { presented = true; mark("first_display_tick", tab: tab) }
    guard ready else { return }
    if !readyPresented {
      readyPresented = true; mark("data_display_tick", tab: tab)
      advance(); return
    }
    if let requestTime, step > 0, tab == sequence[step - 1] {
      mark("tab_display_tick", tab: tab, elapsed: ProcessInfo.processInfo.systemUptime - requestTime)
      self.requestTime = nil; advance()
    }
  }
  static func advance() {
    guard step < sequence.count else { mark("finished"); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      let tab = sequence[step]; step += 1
      requestTime = ProcessInfo.processInfo.systemUptime
      mark("tab_request", tab: tab); select?(tab)
    }
  }
}
private struct CampusPerformanceProbe: UIViewRepresentable {
  let ready: Bool
  let tab: Int
  func makeUIView(context: Context) -> CampusPerformanceView { CampusPerformanceView() }
  func updateUIView(_ view: CampusPerformanceView, context: Context) { view.schedule(ready: ready, tab: tab) }
}
private final class CampusPerformanceView: UIView {
  private var link: CADisplayLink?
  private var ready = false
  private var tab = 0
  func schedule(ready: Bool, tab: Int) {
    guard CampusPerformance.enabled else { return }
    self.ready = ready; self.tab = tab
    link?.invalidate()
    let display = CADisplayLink(target: self, selector: #selector(tick))
    link = display; display.add(to: .main, forMode: .common)
  }
  @objc private func tick() {
    guard window != nil else { return }
    link?.invalidate(); link = nil
    CampusPerformance.displayed(ready: ready, tab: tab)
  }
}
'''
# AppModel is another file; internal access is needed there.
app = app.replace('@MainActor private enum CampusPerformance', '@MainActor enum CampusPerformance')
model_path.write_text(model)
app_path.write_text(app)
print('Instrumented', a.project, '(display callback proxy; not GPU frame completion)')
