import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminClient, AdminError, EditorState, dateRange, duplicateSurvey, errorMessage, jstInput, newContent, payload, question, safeLink, statusLabel, utcInput, validateContent, validateRange, type Announcement, type Survey, type Sender } from "../admin/src/model";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const announcement = (): Announcement => ({ ...newContent("announcements"), title: "学内のお知らせ", body: "本文", link: "" } as Announcement);
const survey = (): Survey => { const s = newContent("surveys") as Survey; s.title = "任意アンケート"; s.questions[0].title = "使う機能は？"; s.questions[0].options.forEach((o, i) => { o.label = `選択${i + 1}`; }); return s; };
describe("admin authentication boundary", () => {
    it("does not fetch any data until /me succeeds and closes the gate after expiry", async () => {
        const calls: {
            url: string;
            init?: RequestInit;
        }[] = [];
        let expired = false;
        const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init }); return String(url).endsWith("/me") ? json({ admin: { email: "owner@example.test" } }) : json({ error: "認証期限切れ", code: "admin_auth_required" }, 401); }) as typeof fetch;
        const client = new AdminClient(transport);
        client.onExpired = () => { expired = true; };
        await expect(client.send("/overview")).rejects.toMatchObject({ status: 401 });
        expect(calls).toHaveLength(0);
        await client.authenticate();
        expect(client.email).toBe("owner@example.test");
        await expect(client.send("/overview")).rejects.toMatchObject({ status: 401 });
        expect(expired).toBe(true);
        await expect(client.send("/surveys")).rejects.toMatchObject({ status: 401 });
        expect(calls).toHaveLength(2);
        expect(calls[0].url).toBe("/api/admin/me");
        for (const call of calls)
            expect(call.init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
    });
    it("requires a real JSON admin result and rejects an Access HTML response", async () => {
        let html = false;
        const client = new AdminClient((async () => html ? new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }) : json({ admin: { email: "owner@example.test" } })) as typeof fetch);
        await client.authenticate();
        html = true;
        await expect(client.send("/announcements")).rejects.toMatchObject({ status: 401 });
        expect(client.authorized).toBe(false);
    });
    it("treats CSV auth HTML as reauthentication, rather than downloading it", async () => {
        const client = new AdminClient((async (url: RequestInfo | URL) => String(url).endsWith("/me") ? json({ admin: { email: "owner@example.test" } }) : new Response("login", { headers: { "Content-Type": "text/html" } })) as typeof fetch);
        const expired = vi.fn();
        client.onExpired = expired;
        await client.authenticate();
        await expect(client.csv("/metrics.csv")).rejects.toMatchObject({ status: 401 });
        expect(expired).toHaveBeenCalledOnce();
    });
    it("leaves server 403 as an authorization failure, never an anonymous session fallback", async () => {
        const fetcher = vi.fn(async () => json({ error: "forbidden" }, 403));
        const client = new AdminClient(fetcher as typeof fetch);
        await expect(client.authenticate()).rejects.toMatchObject({ status: 403 });
        expect(client.authorized).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("closes the data gate on a redirect/network failure until the owner rechecks /me", async () => {
        let failed = false;
        const transport = vi.fn(async () => { if (failed) throw new TypeError("redirect blocked"); return json({ admin: { email: "owner@example.test" } }); });
        const client = new AdminClient(transport as typeof fetch);
        await client.authenticate(); failed = true;
        await expect(client.send("/surveys")).rejects.toMatchObject({ status: 0 });
        expect(client.authorized).toBe(false);
        await expect(client.send("/surveys")).rejects.toMatchObject({ status: 401 });
        expect(transport).toHaveBeenCalledTimes(2);
    });
});
describe("JST dates and content validation", () => {
    it("round trips the Japanese wall clock across UTC day/year boundaries independently of host timezone", () => {
        expect(utcInput("2027-01-01T00:05")).toBe("2026-12-31T15:05:00.000Z");
        expect(jstInput("2026-12-31T15:05:00.000Z")).toBe("2027-01-01T00:05");
        expect(() => utcInput("2026-02-30T12:00")).toThrow();
        expect(dateRange(7, new Date("2026-10-20T15:01:00Z"))).toEqual({ start: "2026-10-15", end: "2026-10-21" });
    });
    it("accepts exactly 90 days and rejects inverted, invalid and longer ranges", () => {
        expect(() => validateRange("2026-01-01", "2026-03-31")).not.toThrow();
        for (const [start, end] of [["2026-01-01", "2026-04-01"], ["2026-04-01", "2026-01-01"], ["2026-02-30", "2026-03-01"], ["", "2026-01-01"]])
            expect(() => validateRange(start, end)).toThrow();
    });
    it("distinguishes scheduled, expired and manually ended content with server-compatible UTC times", () => {
        const item = announcement();
        item.status = "published";
        item.startAt = "2026-10-21T00:00:00Z";
        item.endAt = "2026-10-22T00:00:00Z";
        expect(statusLabel(item, Date.parse("2026-10-20T00:00:00Z"))).toBe("予約");
        expect(statusLabel(item, Date.parse(item.startAt))).toBe("公開中");
        expect(statusLabel(item, Date.parse(item.endAt))).toBe("期限終了");
        item.status = "ended";
        expect(statusLabel(item, 0)).toBe("終了");
    });
    it("rejects unsafe links, 11th questions/options and limits full Japanese payloads without a 16KB client ceiling", () => {
        for (const url of ["javascript:alert(1)", "http://example.test", "https://user:pw@example.test", "data:text/html,x"])
            expect(safeLink(url)).toBeNull();
        expect(safeLink("https://example.test/path")).toBe("https://example.test/path");
        const s = survey();
        s.questions = Array.from({ length: 10 }, () => ({ ...question(), title: "問".repeat(200), options: Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), label: "選".repeat(200) })) }));
        s.intro = "紹".repeat(2000);
        expect(() => validateContent(s)).not.toThrow();
        expect(new TextEncoder().encode(JSON.stringify(payload(s))).length).toBeGreaterThan(16000);
        s.questions[0].options.push({ id: crypto.randomUUID(), label: "11" });
        expect(() => validateContent(s)).toThrow("2〜10");
        s.questions[0].options.pop();
        s.questions.push(question());
        expect(() => validateContent(s)).toThrow("1〜10");
    });
    it("omits immutable published survey fields and gives every duplicate fresh IDs", () => {
        const s = survey();
        s.id = "original";
        s.status = "published";
        s.revision = 4;
        expect(payload(s)).toEqual({ title: s.title, intro: s.intro, endAt: s.endAt });
        const copy = duplicateSurvey(s), oldIds = new Set(s.questions.flatMap(q => [q.id, ...q.options.map(o => o.id)]));
        expect(copy).toMatchObject({ id: "", status: "draft", revision: 0 });
        expect(copy.questions.flatMap(q => [q.id, ...q.options.map(o => o.id)]).every(id => !oldIds.has(id))).toBe(true);
        expect(payload(copy)).toHaveProperty("questions");
        expect(s.id).toBe("original");
    });
});
describe("editor state retains inputs across failed writes", () => {
    it("recovers a lost create with the same payload/key before applying later edits", async () => {
        const state = new EditorState("announcements", announcement());
        let lost = true;
        const calls: {
            method: string;
            body: unknown;
            key?: string;
        }[] = [];
        const send: Sender = async <T>(_path: string, method = "GET", body?: unknown, headers?: Record<string, string>) => { calls.push({ method, body: structuredClone(body), key: headers?.["Idempotency-Key"] }); if (lost) {
            lost = false;
            throw Error("lost after commit");
        } return { announcement: { ...state.item, ...(body as object), id: "saved-once", revision: method === "POST" ? 1 : 2 } } as T; };
        await expect(state.save(send)).rejects.toThrow("lost");
        expect(state.dirty).toBe(true);
        state.item.title = "入力を保持した編集";
        await state.save(send);
        expect(calls.map(c => c.method)).toEqual(["POST", "POST", "PATCH"]);
        expect(calls[1].key).toBe(calls[0].key);
        expect(calls[1].body).toEqual(calls[0].body);
        expect(calls[2].body).toMatchObject({ title: "入力を保持した編集", revision: 1 });
        expect(state.dirty).toBe(false);
    });
    it.each([401, 403, 409, 429, 500])("keeps dirty edits and revision after status %s", async (status) => {
        const item = announcement();
        item.id = "a";
        item.revision = 3;
        const state = new EditorState("announcements", item);
        state.item.title = "保持する入力";
        await expect(state.save(async () => { throw new AdminError("failure", status); })).rejects.toThrow("failure");
        expect(state.item.title).toBe("保持する入力");
        expect(state.item.revision).toBe(3);
        expect(state.dirty).toBe(true);
    });
    it("allows fixing a deterministic create validation rejection and blocks publication of dirty content", async () => {
        const state = new EditorState("announcements", announcement());
        await expect(state.save(async () => { throw new AdminError("invalid", 400); })).rejects.toThrow();
        expect(state.pendingCreate).toBeUndefined();
        const send = vi.fn();
        await expect(state.action("publish", send)).rejects.toThrow("先に");
        expect(send).not.toHaveBeenCalled();
    });
    it("retries a lost publication with its original idempotency key and preserves clean data", async () => {
        const item = announcement();
        item.id = "a";
        item.revision = 1;
        const state = new EditorState("announcements", item);
        let lost = true;
        const keys: string[] = [];
        const send: Sender = async <T>(_path: string, _method?: string, _body?: unknown, headers?: Record<string, string>) => { keys.push(headers!["Idempotency-Key"]); if (lost) {
            lost = false;
            throw Error("lost");
        } return { announcement: { ...item, revision: 2, status: "published" } } as T; };
        await expect(state.action("publish", send)).rejects.toThrow();
        await state.action("publish", send);
        expect(keys[0]).toBe(keys[1]);
        expect(state.item.status).toBe("published");
        expect(state.dirty).toBe(false);
        expect(errorMessage(new AdminError("conflict", 409))).toContain("入力は保持");
    });
});
