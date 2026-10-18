import { expect, it } from "vitest";
import { ApiError } from "../src/api";
import { submitNewArticle } from "../src/article-submit";

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
      expect(input).toEqual({ ...body, title: "edited after lost response" });
    }
    return { article: { id: "created-once", ...(input as object) } } as T;
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
