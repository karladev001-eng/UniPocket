import { describe, expect, it, vi } from "vitest";
import { AdminClient, AdminError, type Article, type Sender } from "../admin/src/model";
import { AdminPages, VisibilityOperation, reportArticle } from "../admin/src/moderation";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const article = (id: string, title = id): Article => ({ id, title, authorId: "author", authorName: "学生", publicUrl: "https://example.test", summary: "", category: "学習", viewCount: 0, bookmarkCount: 0, visibility: "published", hiddenReason: "", revision: 4, createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
describe("article visibility POST contract", () => {
    it("provides the required stable key and immutable body through a committed-but-lost response and reauthentication", async () => {
        let lost = true;
        const commits = new Map<string, Article>(), keys: string[] = [], inputs: unknown[] = [];
        const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
            if (String(url).endsWith("/me"))
                return json({ admin: { email: "owner@example.test" } });
            expect(String(url)).toBe("/api/admin/articles/old%2Farticle/visibility");
            expect(init?.method).toBe("POST");
            const key = new Headers(init?.headers).get("Idempotency-Key");
            if (!key)
                return json({ error: "Idempotency-Keyが必要です。" }, 400);
            keys.push(key);
            const body = JSON.parse(String(init?.body));
            inputs.push(body);
            if (!commits.has(key))
                commits.set(key, { ...article("old/article"), ...body, revision: body.revision + 1 });
            if (lost) {
                lost = false;
                throw new TypeError("response lost after commit");
            }
            return json({ article: commits.get(key) });
        });
        const client = new AdminClient(transport as typeof fetch);
        await client.authenticate();
        const operation = new VisibilityOperation("old/article", 4, "hidden", " リンクの確認が必要 ");
        await expect(operation.submit(client.send)).rejects.toMatchObject({ status: 0 });
        expect(operation.input).toEqual({ revision: 4, visibility: "hidden", reason: "リンクの確認が必要" });
        await client.authenticate();
        const result = await operation.submit(client.send);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
        expect(inputs[0]).toEqual(inputs[1]);
        expect(commits.size).toBe(1);
        expect(result.revision).toBe(5);
    });
    it.each([400, 401, 403, 409, 500])("retains the confirmed revision/reason and key after status %s", async (status) => {
        const operation = new VisibilityOperation("id", 7, "hidden", "保持する理由"), headers: unknown[] = [];
        const send: Sender = async (_path, _method, _input, h) => { headers.push(h); throw new AdminError("failed", status); };
        await expect(operation.submit(send)).rejects.toThrow("failed");
        await expect(operation.submit(send)).rejects.toThrow("failed");
        expect(headers[0]).toEqual(headers[1]);
        expect(operation.input).toEqual({ revision: 7, visibility: "hidden", reason: "保持する理由" });
    });
    it("changes key when target/revision/intent changes, strips reopen reason and validates without modifying inputs", () => {
        const hide = new VisibilityOperation("id", 7, "hidden", "理由");
        const newer = new VisibilityOperation("id", 8, "hidden", "別の理由"), reopen = new VisibilityOperation("id", 7, "published", "previous reason");
        expect(new Set([hide.key, newer.key, reopen.key]).size).toBe(3);
        expect(reopen.input.reason).toBe("");
        const input = " ";
        expect(() => new VisibilityOperation("id", 7, "hidden", input)).toThrow("1〜500");
        expect(input).toBe(" ");
    });
});
describe("server-backed article and report pages", () => {
    it("finds a matching article older than the first 500 and directly retrieves its report target", async () => {
        const fixtures = Array.from({ length: 505 }, (_, i) => ({ ...article(String(i), i === 504 ? "古い記事" : `新しい記事${i}`), visibility: i === 504 ? "hidden" : "published" } as Article));
        const paths: string[] = [];
        const send: Sender = async <T>(path: string) => {
            paths.push(path);
            const url = new URL(path, "https://admin.test");
            if (url.pathname === "/articles/504")
                return { article: fixtures[504] } as T;
            const limit = Number(url.searchParams.get("limit")), cursor = Number(url.searchParams.get("cursor") || "0");
            const q = url.searchParams.get("q") || "", visibility = url.searchParams.get("visibility");
            const matching = fixtures.filter(a => (!q || [a.title, a.authorName, a.category].some(value => value.includes(q))) && (!visibility || a.visibility === visibility));
            const rows = matching.slice(cursor, cursor + limit);
            return { articles: rows, nextCursor: cursor + limit < matching.length ? String(cursor + limit) : null } as T;
        };
        const pages = new AdminPages<Article>("articles", send);
        await pages.reset({ q: "", visibility: "" });
        expect(pages.items).toHaveLength(50);
        expect(pages.items.some(a => a.id === "504")).toBe(false);
        await pages.reset({ q: "古い記事", visibility: "hidden" });
        expect(pages.items.map(a => a.id)).toEqual(["504"]);
        expect(paths[1]).toContain("visibility=hidden");
        const target = await reportArticle("504", send);
        expect(target.visibility).toBe("hidden");
        expect(paths.at(-1)).toBe("/articles/504");
        await pages.reset({ q: "", visibility: "" });
        while (pages.nextCursor)
            await pages.more();
        expect(pages.items).toHaveLength(505);
        expect(pages.items.at(-1)?.id).toBe("504");
    });
    it("passes report status and opaque cursors unchanged, retains pages on failure, and retries without duplicates", async () => {
        const paths: URL[] = [];
        let fail = true;
        const send: Sender = async <T>(path: string) => { const url = new URL(path, "https://admin.test"); paths.push(url); if (!url.searchParams.has("cursor"))
            return { reports: [{ id: "first" }], nextCursor: "opaque+/= 日本語" } as T; if (fail) {
            fail = false;
            throw Error("offline");
        } return { reports: [{ id: "first" }, { id: "second" }], nextCursor: null } as T; };
        const pages = new AdminPages<{
            id: string;
        }>("reports", send);
        await pages.reset({ status: "reviewed" });
        await expect(pages.more()).rejects.toThrow("offline");
        expect(pages.items).toEqual([{ id: "first" }]);
        expect(pages.nextCursor).toBe("opaque+/= 日本語");
        await pages.more();
        expect(pages.items.map(r => r.id)).toEqual(["first", "second"]);
        expect(paths[2].searchParams.get("cursor")).toBe("opaque+/= 日本語");
        expect(paths[2].searchParams.get("status")).toBe("reviewed");
    });
    it("ignores stale success and stale errors after newer filters resolve", async () => {
        const old = deferred<unknown>(), recent = deferred<unknown>();
        const send: Sender = <T>(path: string) => (path.includes("q=old") ? old.promise : recent.promise) as Promise<T>;
        const pages = new AdminPages<{
            id: string;
        }>("articles", send);
        const before = pages.reset({ q: "old", visibility: "" }), after = pages.reset({ q: "new", visibility: "hidden" });
        recent.resolve({ articles: [{ id: "new" }], nextCursor: null });
        await after;
        old.resolve({ articles: [{ id: "old" }], nextCursor: "stale" });
        expect(await before).toBe(false);
        expect(pages.items).toEqual([{ id: "new" }]);
        expect(pages.nextCursor).toBeNull();
        const failure = deferred<unknown>();
        const failedPages = new AdminPages<{
            id: string;
        }>("articles", (<T>(path: string) => (path.includes("q=old") ? failure.promise : Promise.resolve({ articles: [{ id: "new" }], nextCursor: null })) as Promise<T>) as Sender);
        const staleFailure = failedPages.reset({ q: "old" });
        await failedPages.reset({ q: "new" });
        failure.reject(Error("stale error"));
        expect(await staleFailure).toBe(false);
        expect(failedPages.items).toEqual([{ id: "new" }]);
    });
    it("discards an in-flight older page when a new search resets the list", async () => {
        const extra = deferred<unknown>();
        const send: Sender = async <T>(path: string) => { const url = new URL(path, "https://admin.test"); return (url.searchParams.has("cursor") ? extra.promise : Promise.resolve({ articles: [{ id: url.searchParams.get("q") }], nextCursor: "cursor" })) as Promise<T>; };
        const pages = new AdminPages<{
            id: string;
        }>("articles", send);
        await pages.reset({ q: "old" });
        const loadingMore = pages.more();
        await pages.reset({ q: "new" });
        extra.resolve({ articles: [{ id: "old-extra" }], nextCursor: null });
        expect(await loadingMore).toBe(false);
        expect(pages.items).toEqual([{ id: "new" }]);
    });
});
