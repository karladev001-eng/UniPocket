import { describe, it, expect, vi, afterEach } from "vitest";
import { runInNewContext } from "node:vm";
import { serviceWorker } from "../scripts/sw-template.mjs";
function harness() {
  const listeners: Record<string, (e: any) => void> = {},
    messages: { id: string; data: any }[] = [],
    ports: any[] = [],
    assets: string[][] = [];
  let skips = 0,
    clients = [
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
    match: async (p: string) => (p === "/index.html" ? "old-index" : undefined),
  };
  runInNewContext(
    serviceWorker("new-build", ["/index.html", "/assets/app-new.js"]),
    {
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
    },
  );
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
    await h.dispatch("message", { data: { type: "APPLY_UPDATE" } });
    const token = h.messages[0].data.token;
    h.addClient("c");
    for (const id of ["a", "b"])
      await h.dispatch("message", {
        data: { type: "UPDATE_READY", token },
        source: { id },
      });
    expect(h.skips).toBe(0);
    expect(h.messages.at(-1)?.id).toBe("c");
    await h.dispatch("message", {
      data: { type: "UPDATE_READY", token },
      source: { id: "c" },
    });
    expect(h.skips).toBe(1);
  });
  it("never caches API/auth responses and serves the current installed shell offline", async () => {
    const h = harness();
    let handled = false;
    await h.dispatch("fetch", {
      request: { url: "https://pocket.test/api/session", method: "GET" },
      respondWith: () => (handled = true),
    });
    expect(handled).toBe(false);
    let result: unknown;
    await h.dispatch("fetch", {
      request: {
        url: "https://pocket.test/timetable/2026",
        method: "GET",
        mode: "navigate",
      },
      respondWith: (p: Promise<unknown>) => (result = p),
    });
    expect(await result).toBe("old-index");
  });
});
