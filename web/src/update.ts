const PROTOCOL = 2;
const waitingMessage = "新版を取得しました。全タブの編集・処理・保存が終わると自動で更新します。";
export interface UpdateHooks {
  isIdle: () => boolean;
  prepare: () => Promise<void>;
  freeze: (v: boolean) => void;
  notice: (message: string, ready: boolean) => void;
  error: (e: unknown) => void;
}
export function installUpdates(h: UpdateHooks) {
  let freezeTimer: ReturnType<typeof setTimeout> | undefined;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let lastCheck = 0, checking: Promise<void> | undefined;
  let hadController = !!navigator.serviceWorker?.controller;
  let reloading = false, controllerPending = false, reloadPreparing = false;
  let applying: Promise<void> | undefined, autoBlocked = false;
  let prepared: { token: string; worker: ServiceWorker } | undefined;
  const release = () => {
    clearTimeout(freezeTimer);
    prepared = undefined;
    h.freeze(false);
  };
  if (!("serviceWorker" in navigator))
    return {
      check: async () => h.notice("このブラウザはオフライン・自動更新に未対応です。", false),
      apply: async () => {},
      activity: () => {},
    };

  // Even a tab opened after the worker's last client snapshot must keep its input.
  async function reloadWhenSafe() {
    if (!controllerPending || reloading || reloadPreparing || !h.isIdle()) return;
    reloadPreparing = true;
    h.freeze(true);
    try {
      await h.prepare();
      if (!h.isIdle()) { release(); return; }
      reloading = true;
      location.reload();
    } catch (e) {
      autoBlocked = true;
      release();
      h.notice("更新前の保存に失敗しました。入力を保持しています。保存後に再試行してください。", true);
      h.error(e);
    } finally {
      reloadPreparing = false;
    }
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      controllerPending = true;
      h.notice(waitingMessage, true);
      void reloadWhenSafe();
    }
    hadController = true;
  });
  navigator.serviceWorker.addEventListener("message", async (e) => {
    if (e.data?.type === "PREPARE_UPDATE") {
      const worker = e.source as ServiceWorker;
      const token = e.data.token;
      if (e.data.protocol !== PROTOCOL || !h.isIdle() || reloadPreparing) {
        worker?.postMessage({ type: "UPDATE_REFUSED", token, protocol: PROTOCOL, reason: "busy" });
        h.notice(waitingMessage, true);
        return;
      }
      if (prepared) return;
      prepared = { token, worker };
      h.freeze(true);
      freezeTimer = setTimeout(() => {
        if (prepared?.token !== token) return;
        worker.postMessage({ type: "UPDATE_REFUSED", token, protocol: PROTOCOL, reason: "failed" });
        release();
        autoBlocked = true;
        h.notice("更新準備がタイムアウトしました。入力を保持しています。再試行できます。", true);
      }, 25000);
      try {
        await h.prepare();
        if (prepared?.token !== token) return;
        if (!h.isIdle()) {
          worker.postMessage({ type: "UPDATE_REFUSED", token, protocol: PROTOCOL, reason: "busy" });
          release();
          return;
        }
        worker.postMessage({ type: "UPDATE_READY", token, protocol: PROTOCOL });
      } catch (error) {
        if (prepared?.token !== token) return;
        worker.postMessage({ type: "UPDATE_REFUSED", token, protocol: PROTOCOL, reason: "failed" });
        autoBlocked = true;
        release();
        h.error(error);
      }
    }
    if (e.data?.type === "ABORT_UPDATE" && (!prepared || e.data.token === prepared.token)) {
      release();
      if (e.data.reason !== "busy") autoBlocked = true;
      h.notice(e.data.error || waitingMessage, true);
    }
    if (e.data?.type === "RECHECK_UPDATE") scheduleActivity(false, e.data.recovered === true);
  });
  function observe() {
    if (registration?.waiting && navigator.serviceWorker.controller) {
      h.notice(waitingMessage, true);
      scheduleActivity(false);
    }
  }
  function watchWorker(worker: ServiceWorker | null) {
    if (!worker) return;
    h.notice("新版をダウンロードしています。完了後、安全なタイミングで自動更新します。", false);
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") observe();
      if (worker.state === "redundant") {
        h.notice("新版の取得に失敗しました。現在の版と入力は保持しています。更新を再確認できます。", true);
      }
    });
  }
  async function performCheck(force: boolean) {
    if (!navigator.onLine) {
      h.notice("オフラインです。通信が戻ると更新を確認します。", false);
      return;
    }
    if (!force && Date.now() - lastCheck < 60 * 60 * 1000) { observe(); return; }
    lastCheck = Date.now();
    try {
      h.notice("更新を確認しています…", false);
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        registration.addEventListener("updatefound", () => watchWorker(registration!.installing));
        watchWorker(registration.installing);
      }
      await registration.update();
      observe();
      if (!registration.waiting && !registration.installing)
        h.notice("最新バージョンです。", false);
    } catch (e) {
      lastCheck = 0;
      h.notice("更新を確認できませんでした。現在の版と入力を保持しています。更新を再確認できます。", true);
      h.error(e);
    }
  }
  function check(force = false) {
    if (force) autoBlocked = false;
    if (checking) return checking;
    checking = performCheck(force).finally(() => { checking = undefined; });
    return checking;
  }
  async function requestApply() {
    const waiting = registration?.waiting;
    if (!waiting) throw Error("更新の準備ができていません。再確認してください。");
    if (!navigator.onLine) throw Error("通信が戻ってから自動で更新します。");
    if (!h.isIdle()) { h.notice(waitingMessage, true); return; }
    h.notice("全タブの保存を確認して更新しています…", false);
    const channel = new MessageChannel();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          channel.port1.close();
          reject(Error("他のタブから応答がありません。保存して閉じてから再試行してください。"));
        }, 20000);
        channel.port1.onmessage = (e) => {
          clearTimeout(timer);
          channel.port1.close();
          if (e.data.ok) resolve();
          else if (e.data.reason === "busy" || e.data.reason === "pending") {
            h.notice(waitingMessage, true);
            resolve();
          } else reject(Error(e.data.error));
        };
        waiting.postMessage({ type: "APPLY_UPDATE", protocol: PROTOCOL }, [channel.port2]);
      });
    } catch (e) {
      autoBlocked = true;
      release();
      h.notice(e instanceof Error ? e.message : "更新に失敗しました。入力は保持しています。", true);
      throw e;
    }
  }
  function apply() {
    autoBlocked = false;
    if (controllerPending) return reloadWhenSafe();
    if (applying) return applying;
    applying = requestApply().finally(() => { applying = undefined; });
    return applying;
  }
  // Called only on actual editing/processing transitions, never on a retry timer.
  function scheduleActivity(broadcast = true, recovered = false) {
    if (recovered) autoBlocked = false;
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      if (autoBlocked || prepared || !h.isIdle()) return;
      if (controllerPending) { void reloadWhenSafe(); return; }
      if (broadcast) registration?.waiting?.postMessage({ type: "UPDATE_ACTIVITY", protocol: PROTOCOL, recovered });
      if (!applying && registration?.waiting && navigator.onLine)
        void apply().catch(h.error);
    }, 100);
  }
  const activity = (recovered = false) => scheduleActivity(true, recovered);
  void check();
  window.addEventListener("online", () => { void check(); activity(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { void check(); activity(); }
  });
  return { check: () => check(true), apply, activity };
}
