import { expect, it } from "vitest";
import { ApiError, notionURL } from "../src/api";
import { submitNewArticle, bindArticleRecovery } from "../src/article-submit";

const body = { title: "first", publicUrl: "https://demo.notion.site/page", embedUrl: "", summary: "", category: "", courseId: "" };

it("retains an ambiguous creation through rate limiting and restart, then applies edited content once", async () => {
  let saved = "", created = false, lost = true, limited = true;
  const calls: string[] = [];
  let draft: Record<string, string> = { key: "one-submission" };
  const persist = async () => { saved = JSON.stringify(draft); };
  const send = async <T>(path: string, method: string, input: unknown, headers?: Record<string, string>): Promise<T> => {
    calls.push(method);
    if (method === "POST") {
      expect(JSON.parse(saved).pendingBody).toBe(JSON.stringify(body));
      expect(input).toEqual(body);
      expect(headers?.["Idempotency-Key"]).toBe("one-submission");
      created = true;
      if (lost) { lost = false; throw Error("response lost after server commit"); }
      if (limited) { limited = false; throw new ApiError("retry later", 429); }
    } else {
      expect(path).toBe("/articles/created-once");
      expect(input).toEqual({ title: "edited after lost response" });
      expect(headers?.["If-Match"]).toBe("1");
    }
    return { article: { id: "created-once", revision: 1, ...(input as object) } } as T;
  };
  await expect(submitNewArticle(draft, body, send, persist)).rejects.toThrow("response lost");
  expect(created).toBe(true);
  draft = JSON.parse(saved); // Simulate reopening the persisted draft.
  await expect(submitNewArticle(draft, { ...body, title: "edited after lost response" }, send, persist)).rejects.toThrow("retry later");
  expect(draft.pendingBody).toBe(JSON.stringify(body));
  draft = JSON.parse(saved);
  const result = await submitNewArticle(draft, { ...body, title: "edited after lost response" }, send, persist);
  expect(result.article.id).toBe("created-once");
  expect(calls).toEqual(["POST", "POST", "POST", "PATCH"]);
});

it("allows correcting a rejected first payload and blocks posting when snapshot save fails", async () => {
  const draft: Record<string, string> = { key: "one-submission" };
  await expect(submitNewArticle(draft, body, async () => { throw new ApiError("invalid URL", 400); }, async () => {})).rejects.toThrow("invalid URL");
  expect(draft.pendingBody).toBeUndefined();
  let network = false;
  await expect(submitNewArticle(draft, body, async () => { network = true; throw Error(); }, async () => { throw Error("disk full"); })).rejects.toThrow("disk full");
  expect(network).toBe(false);
});

it.each([413, 415])("allows corrected content after deterministic body rejection %s", async (status) => {
  const draft: Record<string, string> = { key: "same-key" };
  const oversized = { ...body, publicUrl: "https://demo.notion.site/" + "a".repeat(17000) };
  await expect(submitNewArticle(draft, oversized, async () => { throw new ApiError("body rejected before write", status); }, async () => {})).rejects.toThrow("body rejected");
  expect(draft.pendingBody).toBeUndefined();
  let sent: unknown;
  const result = await submitNewArticle(draft, body, async <T>(_path: string, _method: string, input: unknown) => {
    sent = input;
    return { article: { id: "corrected", revision: 1, ...(input as object) } } as T;
  }, async () => {});
  expect(sent).toEqual(body); expect(result.article.id).toBe("corrected");
});

it("rejects oversized Notion URLs before they can enter a submission snapshot", () => {
  expect(() => notionURL("https://demo.notion.site/" + "a".repeat(17000))).toThrow("2048");
  expect(notionURL(body.publicUrl)).toBe(body.publicUrl);
});

it('keeps lost-create inputs and binds explicit comparison/rebase before applying only local changes', async () => {
  const original = { ...body, summary: 'original summary' }, desired = { ...original, title: 'local title' };
  const draft: Record<string, string> = { key: 'original-key', pendingBody: JSON.stringify(original), title: desired.title };
  const latest = { ...original, id: 'existing', revision: 2, summary: 'other tab summary', visibility: 'published' };
  const methods: string[] = [];
  const send = async <T>(_path: string, method: string, input: unknown, headers?: Record<string, string>): Promise<T> => {
    methods.push(method);
    if (method === 'GET') return { articles: [latest] } as T;
    if (method === 'PATCH') { expect(input).toEqual({ title: 'local title' }); expect(headers).toEqual({ 'If-Match': '2' }); }
    return { article: { ...latest, ...(method === 'PATCH' ? input as object : {}) } } as T;
  };
  await expect(submitNewArticle(draft, desired, send, async () => {})).rejects.toThrow('別の更新');
  expect(methods).toEqual(['POST']); expect(draft.title).toBe('local title');
  const trigger = { disabled: false, onclick: undefined as (() => Promise<void>) | undefined }, box = { textContent: '' };
  let accepted = false;
  const dialog = { open: true, isConnected: true, querySelector: (selector: string) => selector === '#refresh-article-revision' ? trigger : box } as unknown as HTMLDialogElement;
  bindArticleRecovery(dialog, { draft, send, confirm: () => { expect(box.textContent).toContain('other tab summary'); return accepted; }, persist: async () => {} });
  await trigger.onclick!(); expect(draft.applyRevision).toBeUndefined();
  accepted = true; await trigger.onclick!(); expect(draft.applyRevision).toBe('2');
  const saved = await submitNewArticle(draft, desired, send, async () => {});
  expect(saved.article.summary).toBe('other tab summary'); expect(saved.article.title).toBe('local title');
  expect(draft.key).toBe('original-key'); expect(draft.pendingBody).toBe(JSON.stringify(original));
  expect(methods).toEqual(['POST', 'GET', 'GET', 'PATCH']);
});
