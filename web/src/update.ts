export interface UpdateHooks {
  prepare: () => Promise<void>;
  freeze: (v: boolean) => void;
  notice: (message: string, ready: boolean) => void;
  error: (e: unknown) => void;
}
export function installUpdates(h: UpdateHooks) {
  let freezeTimer: ReturnType<typeof setTimeout> | undefined;
  let registration: ServiceWorkerRegistration | undefined,
    lastCheck = 0,
    hadController = !!navigator.serviceWorker?.controller,
    reloading = false;
  if (!("serviceWorker" in navigator))
    return {
      check: async () => {
        h.notice("このブラウザはオフライン・自動更新に未対応です。", false);
      },
      apply: async () => {},
    };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      reloading = true;
      location.reload();
    }
    hadController = true;
  });
  navigator.serviceWorker.addEventListener("message", async (e) => {
    if (e.data?.type === "PREPARE_UPDATE") {
      h.freeze(true);
      clearTimeout(freezeTimer);
      freezeTimer = setTimeout(() => {
        h.freeze(false);
        h.error(
          Error(
            "更新準備がタイムアウトしました。入力を保持して再試行できます。",
          ),
        );
      }, 25000);
      try {
        await h.prepare();
        (e.source as ServiceWorker)?.postMessage({
          type: "UPDATE_READY",
          token: e.data.token,
        });
      } catch (error) {
        (e.source as ServiceWorker)?.postMessage({
          type: "UPDATE_REFUSED",
          token: e.data.token,
        });
        h.freeze(false);
        h.error(error);
      }
    }
    if (e.data?.type === "ABORT_UPDATE") {
      clearTimeout(freezeTimer);
      h.freeze(false);
    }
  });
  const observe = () => {
    if (registration?.waiting && navigator.serviceWorker.controller)
      h.notice(
        "新しいバージョンがあります。開いている全タブの入力を保存して更新できます。",
        true,
      );
  };
  async function check(force = false) {
    if (!navigator.onLine) {
      h.notice(
        "オフラインです。通信が戻ってから更新を確認してください。",
        false,
      );
      return;
    }
    if (!force && Date.now() - lastCheck < 60 * 60 * 1000) return;
    lastCheck = Date.now();
    try {
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        registration.addEventListener("updatefound", () => {
          const w = registration?.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed") observe();
            if (w.state === "redundant")
              h.error(
                Error(
                  "新版の取得に失敗しました。現在の版と入力は保持しています。",
                ),
              );
          });
        });
      }
      await registration.update();
      observe();
      if (force && !registration.waiting)
        h.notice(
          registration.installing
            ? "新版をダウンロードしています。完了すると更新できます。"
            : "更新の確認を行いました。",
          false,
        );
    } catch (e) {
      h.error(e);
    }
  }
  async function apply() {
    const waiting = registration?.waiting;
    if (!waiting)
      throw Error("更新の準備ができていません。再確認してください。");
    if (!navigator.onLine)
      throw Error("通信できる状態で保存して更新してください。");
    const channel = new MessageChannel();
    const outcome = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error(
              "他のタブから応答がありません。保存して閉じてから再試行してください。",
            ),
          ),
        20000,
      );
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        e.data.ok ? resolve() : reject(Error(e.data.error));
        channel.port1.close();
      };
    });
    waiting.postMessage({ type: "APPLY_UPDATE" }, [channel.port2]);
    try {
      await outcome;
    } catch (e) {
      h.freeze(false);
      throw e;
    }
  }
  void check();
  window.addEventListener("online", () => void check());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  return { check: () => check(true), apply };
}
