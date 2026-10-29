import { describe, it, expect, vi, afterEach } from "vitest";
import { runInNewContext } from "node:vm";
import { serviceWorker } from "../scripts/sw-template.mjs";
function harness() {
  const listeners: Record<string, (e: any) => void> = {},
    messages: { id: string; data: any }[] = [],
    ports: any[] = [],
    assets: string[][] = [];
  let skips = 0;
  const clients = [
    { id: "a", url: "https://pocket.test/" },
    { id: "b", url: "https://pocket.test/#notes" },
  ];
  const self = {
    registration: { scope: "https://pocket.test/" },
    clients: {
      claim: async () => {},
      matchAll: async () =>
        clients.map((c) => ({
          ...c,
          postMessage: (data: any) => messages.push({ id: c.id, data }),
        })),
    },
    addEventListener: (name: string, fn: (e: any) => void) =>
      (listeners[name] = fn),
    skipWaiting: async () => {
      skips++;
    },
  };
  const cache = {
    addAll: async (a: string[]) => {
      assets.push(a);
    },
    match: async (p: string) => (p === "/" ? "old-index" : undefined),
  };
  runInNewContext(serviceWorker("new-build", ["/", "/assets/app-new.js"]), {
    self,
    location: { origin: "https://pocket.test" },
    URL,
    crypto,
    setTimeout,
    clearTimeout,
    caches: { open: async () => cache, match: async () => undefined },
    fetch: async () => {
      throw Error("offline");
    },
  });
  return {
    messages,
    ports,
    assets,
    get skips() {
      return skips;
    },
    addClient: (id: string) =>
      clients.push({ id, url: "https://pocket.test/" }),
    dispatch: async (name: string, extras: any = {}) => {
      const waits: Promise<any>[] = [];
      const e = {
        data: {},
        ports: [{ postMessage: (m: any) => ports.push(m) }],
        waitUntil: (p: Promise<any>) => waits.push(p),
        ...extras,
      };
      listeners[name](e);
      await Promise.all(waits);
    },
    get type() {
      return listeners;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("actual service worker update protocol", () => {
  it("downloads the complete shell and does not activate before all tabs save", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("install");
    expect(h.assets[0]).toContain("/assets/app-new.js");
    await h.dispatch("message", { data: { type: "APPLY_UPDATE" } });
    const token = h.messages[0].data.token;
    expect(h.messages.map((m) => m.id)).toEqual(["a", "b"]);
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token },
      source: { id: "a" },
    });
    expect(h.skips).toBe(0);
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token },
      source: { id: "b" },
    });
    expect(h.skips).toBe(1);
    expect(h.ports.at(-1)).toEqual({ ok: true });
  });
  it("keeps the old worker and releases every tab when a save is refused", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", { data: { type: "APPLY_UPDATE" } });
    await h.dispatch("message", {
      data: { type: "UPDATE_REFUSED", token: h.messages[0].data.token },
      source: { id: "b" },
    });
    expect(h.skips).toBe(0);
    expect(
      h.messages.filter((m) => m.data.type === "ABORT_UPDATE"),
    ).toHaveLength(2);
    expect(h.ports.at(-1).ok).toBe(false);
  });
  it("also prepares tabs opened while an update is saving", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    const token = h.messages[0].data.token;
    h.addClient("c");
    for (const id of ["a", "b"])
      await h.dispatch("message", {
        data: { type: "UPDATE_READY", token, protocol: 2 },
        source: { id },
      });
    expect(h.skips).toBe(0);
    expect(h.messages.at(-1)?.id).toBe("c");
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token, protocol: 2 },
      source: { id: "c" },
    });
    expect(h.skips).toBe(1);
  });
  it.each([
    ["https://pocket.test/cdn-cgi/access/authorized", "GET", "navigate"],
    [
      "https://pocket.test/cdn-cgi/access/authorized?code=test-only&state=test-only",
      "GET",
      "navigate",
    ],
    ["https://pocket.test/cdn-cgi/access/login", "GET", "navigate"],
    ["https://pocket.test/cdn-cgi/access/logout", "GET", "navigate"],
    ["https://pocket.test/cdn-cgi/trace", "GET", "navigate"],
    ["https://pocket.test/cdn-cgi/challenge-platform/test.js", "GET", "cors"],
    ["https://pocket.test/api/session", "GET", "navigate"],
    ["https://pocket.test/sw.js", "GET", "navigate"],
    ["https://pocket.test/version.json", "GET", "navigate"],
    ["https://access.example/", "GET", "navigate"],
    ["https://access.example/cdn-cgi/access/login", "GET", "navigate"],
    ["https://pocket.test/", "POST", "navigate"],
  ])("leaves %s (%s, %s) to browser networking", async (url, method, mode) => {
    const h = harness();
    const respondWith = vi.fn();
    await h.dispatch("fetch", { request: { url, method, mode }, respondWith });
    await Promise.allSettled(
      respondWith.mock.calls.map(([response]) => response),
    );
    expect(respondWith).not.toHaveBeenCalled();
  });
  it.each(["/", "/#notes", "/timetable/2026"])(
    "serves the installed shell offline for app navigation %s",
    async (path) => {
      const h = harness();
      let result: unknown;
      await h.dispatch("fetch", {
        request: {
          url: "https://pocket.test" + path,
          method: "GET",
          mode: "navigate",
        },
        respondWith: (p: Promise<unknown>) => (result = p),
      });
      expect(await result).toBe("old-index");
    },
  );
});

describe("automatic worker update safety", () => {
  it("requires v2 readiness for automatic updates and refuses mixed old tabs", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    const token = h.messages[0].data.token;
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token },
      source: { id: "a" },
    });
    expect(h.skips).toBe(0);
    expect(h.ports.at(-1).reason).toBe("legacy");
  });
  it("allows the old version's explicit manual update to bootstrap the new client", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", { data: { type: "APPLY_UPDATE" } });
    const token = h.messages[0].data.token;
    for (const id of ["a", "b"])
      await h.dispatch("message", {
        data: { type: "UPDATE_READY", token },
        source: { id },
      });
    expect(h.skips).toBe(1);
  });
  it("does not activate on processing refusal, timeout, stale or foreign readiness", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    const token = h.messages[0].data.token;
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token, protocol: 2 },
      source: { id: "outsider" },
    });
    await h.dispatch("message", {
      data: { type: "UPDATE_REFUSED", token, reason: "busy" },
      source: { id: "b" },
    });
    expect(h.ports.at(-1).reason).toBe("busy");
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    for (const id of ["a", "b"])
      await h.dispatch("message", {
        data: { type: "UPDATE_READY", token, protocol: 2 },
        source: { id },
      });
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.skips).toBe(0);
    expect(h.ports.at(-1).reason).toBe("failed");
  });
  it("keeps an activation lock for duplicate apply requests", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    const token = h.messages[0].data.token;
    for (const id of ["a", "b"])
      await h.dispatch("message", {
        data: { type: "UPDATE_READY", token, protocol: 2 },
        source: { id },
      });
    await h.dispatch("message", {
      data: { type: "APPLY_UPDATE", protocol: 2 },
    });
    expect(h.skips).toBe(1);
    expect(h.ports.at(-1).reason).toBe("pending");
  });
  it("propagates editing completion to the other tabs without an automatic retry loop", async () => {
    const h = harness();
    await h.dispatch("message", {
      data: { type: "UPDATE_ACTIVITY", protocol: 2, recovered: true },
    });
    expect(h.messages).toEqual([
      { id: "a", data: { type: "RECHECK_UPDATE", recovered: true } },
      { id: "b", data: { type: "RECHECK_UPDATE", recovered: true } },
    ]);
    expect(h.skips).toBe(0);
  });
});

import { installUpdates } from "../src/update";
function clientHarness(waitingAtStart = true) {
  vi.useFakeTimers();
  const sw = new EventTarget() as EventTarget & {
    controller: object | null;
    register: any;
  };
  sw.controller = {};
  const registration = new EventTarget() as EventTarget & {
    waiting: any;
    installing: any;
    update: any;
  };
  const worker = new EventTarget() as EventTarget & {
    postMessage: any;
    state: string;
  };
  worker.state = "installed";
  const messages: any[] = [],
    replies: any[] = [],
    requests: any[] = [];
  worker.postMessage = vi.fn((data, ports) => {
    messages.push(data);
    if (data.type === "APPLY_UPDATE")
      requests.push({ data, reply: ports[0].postMessage });
    else replies.push(data);
  });
  registration.waiting = waitingAtStart ? worker : null;
  registration.installing = null;
  registration.update = vi.fn(async () => {});
  sw.register = vi.fn(async () => registration);
  const doc = new EventTarget() as EventTarget & { hidden: boolean };
  doc.hidden = false;
  const win = new EventTarget();
  const reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: sw, onLine: true });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { reload });
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = { onmessage: null as any, close: vi.fn() };
      port2 = { postMessage: (data: any) => this.port1.onmessage?.({ data }) };
    },
  );
  let idle = true;
  const hooks = {
    isIdle: () => idle,
    prepare: vi.fn(async () => {}),
    freeze: vi.fn(),
    notice: vi.fn(),
    error: vi.fn(),
  };
  const client = installUpdates(hooks);
  return {
    client,
    hooks,
    sw,
    registration,
    worker,
    doc,
    win,
    reload,
    messages,
    replies,
    requests,
    idle: (value: boolean) => {
      idle = value;
    },
    settle: () => vi.advanceTimersByTimeAsync(150),
    receive: async (data: any) => {
      sw.dispatchEvent(
        Object.assign(new Event("message"), { data, source: worker }),
      );
      await Promise.resolve();
      await Promise.resolve();
    },
    installed: () => {
      registration.installing = worker;
      worker.state = "installing";
      registration.dispatchEvent(new Event("updatefound"));
      registration.waiting = worker;
      registration.installing = null;
      worker.state = "installed";
      worker.dispatchEvent(new Event("statechange"));
    },
  };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
});
describe("automatic client lifecycle", () => {
  it("automatically applies an already waiting worker at startup and serializes duplicate requests", async () => {
    const h = clientHarness();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].data.protocol).toBe(2);
    const a = h.client.apply(),
      b = h.client.apply();
    expect(a).toBe(b);
    expect(h.requests).toHaveLength(1);
    h.requests[0].reply({ ok: true });
    await a;
  });
  it("observes download completion and waits for editing to finish without polling", async () => {
    const h = clientHarness(false);
    await h.settle();
    h.idle(false);
    h.installed();
    await h.settle();
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.requests).toHaveLength(0);
    h.idle(true);
    h.client.activity();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    h.requests[0].reply({ ok: true });
  });
  it("refuses editing readiness and delays controller-change reload until editing completes", async () => {
    const h = clientHarness();
    h.idle(false);
    await h.settle();
    await h.receive({ type: "PREPARE_UPDATE", protocol: 2, token: "t" });
    expect(h.replies.at(-1)).toMatchObject({
      type: "UPDATE_REFUSED",
      reason: "busy",
    });
    expect(h.hooks.prepare).not.toHaveBeenCalled();
    h.sw.dispatchEvent(new Event("controllerchange"));
    expect(h.reload).not.toHaveBeenCalled();
    h.idle(true);
    h.client.activity();
    await h.settle();
    expect(h.hooks.prepare).toHaveBeenCalledOnce();
    expect(h.reload).toHaveBeenCalledOnce();
  });
  it("keeps input on save failure, avoids retry loops, and retries after successful save", async () => {
    const h = clientHarness();
    await h.settle();
    h.hooks.prepare.mockRejectedValueOnce(Error("save conflict"));
    await h.receive({ type: "PREPARE_UPDATE", protocol: 2, token: "bad" });
    expect(h.replies.at(-1)).toMatchObject({
      type: "UPDATE_REFUSED",
      reason: "failed",
    });
    h.requests[0].reply({
      ok: false,
      reason: "failed",
      error: "save conflict",
    });
    await Promise.resolve();
    await Promise.resolve();
    h.client.activity();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(h.reload).not.toHaveBeenCalled();
    h.client.activity(true);
    await h.settle();
    expect(h.requests).toHaveLength(2);
    expect(h.messages).toContainEqual({
      type: "UPDATE_ACTIVITY",
      protocol: 2,
      recovered: true,
    });
    h.requests[1].reply({ ok: true });
  });
  it("never sends late readiness after the worker aborted during a save", async () => {
    const h = clientHarness(false);
    await h.settle();
    let finish!: () => void;
    h.hooks.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await h.receive({
      type: "PREPARE_UPDATE",
      protocol: 2,
      token: "cancelled",
    });
    await h.receive({
      type: "ABORT_UPDATE",
      token: "cancelled",
      reason: "busy",
    });
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.replies.some((m) => m.type === "UPDATE_READY")).toBe(false);
    expect(h.hooks.freeze).toHaveBeenLastCalledWith(false);
  });
  it("rechecks on foreground/connectivity recovery while deduplicating registration", async () => {
    const h = clientHarness(false);
    await h.settle();
    h.doc.dispatchEvent(new Event("visibilitychange"));
    h.win.dispatchEvent(new Event("online"));
    await h.settle();
    expect(h.sw.register).toHaveBeenCalledOnce();
    expect(h.registration.update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3600000);
    h.doc.dispatchEvent(new Event("visibilitychange"));
    await h.settle();
    expect(h.registration.update).toHaveBeenCalledTimes(2);
  });
  it("refuses a legacy worker preparation and protects the input", async () => {
    const h = clientHarness(false);
    await h.settle();
    await h.receive({ type: "PREPARE_UPDATE", token: "old-worker" });
    expect(h.replies.at(-1)).toMatchObject({ type: "UPDATE_REFUSED" });
    expect(h.hooks.prepare).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });
  it("does not auto-retry after an unresponsive tab until the user explicitly retries", async () => {
    const h = clientHarness();
    await h.settle();
    await vi.advanceTimersByTimeAsync(20000);
    h.client.activity();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    expect(h.hooks.error).toHaveBeenCalledOnce();
    const retry = h.client.apply();
    expect(h.requests).toHaveLength(2);
    h.requests[1].reply({ ok: true });
    await retry;
  });
  it("requires a successful local save before a controller change can reload", async () => {
    const h = clientHarness(false);
    await h.settle();
    h.hooks.prepare.mockRejectedValueOnce(Error("save failed"));
    h.sw.dispatchEvent(new Event("controllerchange"));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.hooks.freeze).toHaveBeenLastCalledWith(false);
    h.client.activity(true);
    await h.settle();
    expect(h.reload).toHaveBeenCalledOnce();
  });
  it("retries idle busy-refused peers when editing completion is broadcast", async () => {
    const h = clientHarness();
    await h.settle();
    h.requests[0].reply({ ok: false, reason: "busy" });
    await Promise.resolve();
    await Promise.resolve();
    await h.receive({ type: "RECHECK_UPDATE" });
    await h.settle();
    expect(h.requests).toHaveLength(2);
    // Receiving the peer notification must not rebroadcast it forever.
    expect(h.messages.filter((m) => m.type === "UPDATE_ACTIVITY")).toHaveLength(
      0,
    );
    h.requests[1].reply({ ok: true });
  });
});
