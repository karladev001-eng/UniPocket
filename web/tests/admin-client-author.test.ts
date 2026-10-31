import { expect, it } from "vitest";
import {
  ArticleEditor,
  articleErrors,
  articlePayload,
} from "../admin/src/article-editor";
import {
  AdminClient,
  AdminError,
  type Article,
  type Sender,
} from "../admin/src/model";
const article = (overrides: Partial<Article> = {}): Article => ({
  id: "one",
  authorId: "reserved",
  authorName: "Uni Pocket運営",
  authorKind: "admin",
  title: "original",
  publicUrl: "https://demo.notion.site/a",
  embedUrl: "",
  summary: "original summary",
  category: "運営",
  courseId: "",
  revision: 1,
  visibility: "published",
  hiddenReason: "",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  viewCount: 0,
  bookmarkCount: 0,
  ...overrides,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
it("keeps the confirmed POST and key after a committed response loss and reauthentication", async () => {
  let lost = true;
  const writes: {
    body: Record<string, unknown>;
    key: string;
  }[] = [];
  let commits = 0;
  const transport = async (path: RequestInfo | URL, init?: RequestInit) => {
    if (String(path).endsWith("/me"))
      return json({ admin: { email: "owner@example.test" } });
    const body = JSON.parse(String(init?.body)),
      key = new Headers(init?.headers).get("Idempotency-Key")!;
    writes.push({ body, key });
    if (!commits) commits++;
    if (lost) {
      lost = false;
      throw Error("lost committed response");
    }
    return json({ article: article({ title: body.title }) }, 201);
  };
  const client = new AdminClient(transport);
  await client.authenticate();
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "new",
    publicUrl: "https://demo.notion.site/a",
  });
  await expect(state.submit(client.send)).rejects.toMatchObject({ status: 0 });
  expect(state.input.title).toBe("new");
  expect(state.hasInputToLose).toBe(true);
  expect(client.authorized).toBe(false);
  await client.authenticate();
  await state.submit(client.send);
  expect(writes[0]).toEqual(writes[1]);
  expect(commits).toBe(1);
  expect(state.hasInputToLose).toBe(false);
});
it("holds local edits through a real revision conflict and rebases only changed fields on explicit apply", async () => {
  const state = new ArticleEditor(article());
  state.input.title = "my edit";
  const latest = article({
    revision: 2,
    summary: "remote summary",
    visibility: "hidden",
  });
  const send: Sender = async <T>(_path: string, method?: string) => {
    if (method === "PATCH")
      throw new AdminError("conflict", 409, "revision_conflict");
    return { article: latest } as T;
  };
  await expect(state.submit(send)).rejects.toMatchObject({
    code: "revision_conflict",
  });
  expect(state.input.title).toBe("my edit");
  expect(state.latest).toEqual(latest);
  expect(state.item?.revision).toBe(1);
  state.rebase();
  expect(state.input.title).toBe("my edit");
  expect(state.input.summary).toBe("remote summary");
  expect(state.item?.visibility).toBe("hidden");
  expect(state.item?.revision).toBe(2);
  expect(state.pending).toBeUndefined();
  let body: unknown;
  await state.submit(async <T>(_p: string, _m?: string, b?: unknown) => {
    body = b;
    return {
      article: article({ ...latest, title: "my edit", revision: 3 }),
    } as T;
  });
  expect(body).toMatchObject({
    title: "my edit",
    summary: "remote summary",
    revision: 2,
  });
  expect(body).not.toHaveProperty("visibility");
});
it("distinguishes post-submit edits and newer replayed revisions from an ordinary conflict", async () => {
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "first",
    publicUrl: "https://demo.notion.site/a",
  });
  await expect(
    state.submit(async () => {
      throw new AdminError("network", 0);
    }),
  ).rejects.toThrow();
  state.input.title = "second";
  await expect(
    state.submit(
      async <T>() =>
        ({
          article: article({
            title: "first",
            summary: "remote summary",
            revision: 2,
          }),
        }) as T,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(state.input.title).toBe("second");
  state.rebase();
  expect(state.input.title).toBe("second");
  expect(state.input.summary).toBe("remote summary");
  expect(state.item?.revision).toBe(2);
  const edit = new ArticleEditor(article());
  edit.input.title = "sent";
  await expect(
    edit.submit(
      async <T>() =>
        ({
          article: article({ title: "other later title", revision: 3 }),
        }) as T,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(edit.input.title).toBe("sent");
  expect(edit.latest?.revision).toBe(3);
});
it("retains input on expiry and permits a corrected URL after a definitive duplicate response", async () => {
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "kept",
    publicUrl: "https://demo.notion.site/a",
  });
  await expect(
    state.submit(async () => {
      throw new AdminError("expired", 401);
    }),
  ).rejects.toMatchObject({ status: 401 });
  const key = state.pending?.key;
  expect(state.input.title).toBe("kept");
  expect(key).toBeTruthy();
  await expect(
    state.submit(async () => {
      throw new AdminError("duplicate", 409, "duplicate_article", "existing");
    }),
  ).rejects.toMatchObject({ articleId: "existing" });
  expect(state.pending).toBeUndefined();
  state.input.publicUrl = "https://demo.notion.site/b";
  let usedKey: string | undefined;
  await state.submit(
    async <T>(
      _p: string,
      _m?: string,
      _b?: unknown,
      h?: Record<string, string>,
    ) => {
      usedKey = h?.["Idempotency-Key"];
      return {
        article: article({
          title: "kept",
          publicUrl: "https://demo.notion.site/b",
        }),
      } as T;
    },
  );
  expect(usedKey).not.toBe(key);
});
it("validates each field and normalizes shared Notion URLs without treating a frame load as proof", () => {
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "x".repeat(121),
    publicUrl: "https://evil.test/a",
    summary: "x".repeat(281),
    category: "x".repeat(61),
    courseId: "x".repeat(121),
    embedUrl: "javascript:alert(1)",
  });
  expect(Object.keys(articleErrors(state.input)).sort()).toEqual([
    "category",
    "courseId",
    "embedUrl",
    "publicUrl",
    "summary",
    "title",
  ]);
  Object.assign(state.input, {
    title: "題".repeat(120),
    publicUrl: "https://demo.notion.site/page?utm_source=x&b=2&a=1#section",
    summary: "",
    category: "",
    courseId: "",
    embedUrl: "",
  });
  expect(articleErrors(state.input)).toEqual({});
  expect(articlePayload(state.input).publicUrl).toBe(
    "https://demo.notion.site/page?a=1&b=2",
  );
});
