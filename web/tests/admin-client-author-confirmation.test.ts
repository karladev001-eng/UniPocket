import { afterEach, expect, it, vi } from "vitest";
import {
  ArticleEditor,
  articlePayload,
  type ArticleConfirmation,
} from "../admin/src/article-editor";
import { articlePreviewControl } from "../admin/src/article-confirmation";
import { AdminError, type Article, type Sender } from "../admin/src/model";
class ElementDouble {
  textContent = "";
  hidden = false;
  disabled = false;
  className = "";
  children: unknown[] = [];
  events = new Map<string, EventListener>();
  constructor(public tagName: string) {}
  append(...children: unknown[]) {
    this.children.push(...children);
  }
  setAttribute() {}
  addEventListener(name: string, callback: EventListener) {
    this.events.set(name, callback);
  }
}
afterEach(() => vi.unstubAllGlobals());
const mount = () =>
  vi.stubGlobal("document", {
    createElement: (tag: string) => new ElementDouble(tag),
  });
const saved = (input: Record<string, unknown>, revision: number): Article => ({
  id: "saved",
  authorId: "reserved",
  authorName: "Uni Pocket運営",
  authorKind: "admin",
  title: String(input.title),
  publicUrl: String(input.publicUrl),
  embedUrl: "",
  summary: String(input.summary),
  category: "",
  courseId: "",
  visibility: "published",
  hiddenReason: "",
  revision,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  viewCount: 0,
  bookmarkCount: 0,
});
it("updates the mounted control after failure and previews the immutable A retry before separately confirming retained B", async () => {
  mount();
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "confirmed A",
    publicUrl: "https://demo.notion.site/a",
    summary: "summary A",
  });
  let shown: ArticleConfirmation | undefined;
  const controls = articlePreviewControl(state, (confirmation) => {
    shown = confirmation;
  });
  const button = controls.button as unknown as ElementDouble;
  const notice = controls.notice as unknown as ElementDouble;
  const click = () => button.events.get("click")!(new Event("click"));
  const writes: {
    path: string;
    body: Record<string, unknown>;
    key: string | undefined;
  }[] = [];
  let fail = true;
  const send: Sender = async <T>(
    path: string,
    _method?: string,
    raw?: unknown,
    headers?: Record<string, string>,
  ) => {
    const body = raw as Record<string, unknown>;
    writes.push({
      path,
      body: structuredClone(body),
      key: headers?.["Idempotency-Key"],
    });
    if (fail) {
      fail = false;
      throw new AdminError("committed but response lost", 503);
    }
    return { article: saved(body, Number(body.revision || 0) + 1) } as T;
  };
  click();
  expect(shown?.recovery).toBe(false);
  expect(shown?.input.title).toBe("confirmed A");
  await expect(controls.submit(shown!, send)).rejects.toMatchObject({
    status: 503,
  });
  // Same DOM instances: no page rerender or new input elements are needed.
  expect(controls.button).toBe(button);
  expect(button.textContent).toBe("前回の送信結果を確認");
  expect(notice.hidden).toBe(false);
  state.input.title = "retained B";
  state.input.summary = "summary B";
  click();
  const recovery = shown!;
  expect(recovery.recovery).toBe(true);
  expect(recovery.input.title).toBe("confirmed A");
  expect(recovery.input.summary).toBe("summary A");
  await expect(controls.submit(recovery, send)).rejects.toMatchObject({
    code: "article_recovered",
  });
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[1].body).toEqual(articlePayload(recovery.input));
  expect(state.latest?.title).toBe("confirmed A");
  expect(state.input.title).toBe("retained B");
  expect(button.disabled).toBe(true);
  state.rebase();
  controls.refresh();
  expect(button.textContent).toBe("変更をプレビュー");
  expect(notice.hidden).toBe(true);
  click();
  expect(shown?.recovery).toBe(false);
  expect(shown?.input.title).toBe("retained B");
  await controls.submit(shown!, send);
  expect(writes[2].body).toMatchObject({
    ...articlePayload(shown!.input),
    revision: 1,
  });
  expect(writes[2].path).toBe("/articles/saved");
  expect(writes[2].key).not.toBe(writes[1].key);
  expect(state.item?.title).toBe("retained B");
});
it("rejects a changed confirmation target before sending any request", async () => {
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "A",
    publicUrl: "https://demo.notion.site/a",
  });
  const confirmed = state.confirmation();
  state.input.title = "B";
  const send = vi.fn();
  await expect(state.submitConfirmed(confirmed, send)).rejects.toMatchObject({
    code: "confirmation_changed",
  });
  expect(send).not.toHaveBeenCalled();
  expect(state.input.title).toBe("B");
  expect(state.pending).toBeUndefined();
});
it("switches the same mounted control back to normal confirmation after definitive duplicate rejection", async () => {
  mount();
  const state = new ArticleEditor();
  Object.assign(state.input, {
    title: "A",
    publicUrl: "https://demo.notion.site/a",
  });
  let shown: ArticleConfirmation | undefined;
  const controls = articlePreviewControl(state, (value) => {
    shown = value;
  });
  const click = () =>
    (controls.button as unknown as ElementDouble).events.get("click")!(
      new Event("click"),
    );
  click();
  await expect(
    controls.submit(shown!, async () => {
      throw new AdminError("duplicate", 409, "duplicate_article", "existing");
    }),
  ).rejects.toMatchObject({ code: "duplicate_article" });
  expect(state.pending).toBeUndefined();
  expect(controls.button.textContent).toBe("公開プレビューへ");
  expect(controls.notice.hidden).toBe(true);
  state.input.publicUrl = "https://demo.notion.site/corrected";
  click();
  expect(shown?.input.publicUrl).toBe("https://demo.notion.site/corrected");
  expect(shown?.recovery).toBe(false);
  let sent: unknown;
  await controls.submit(
    shown!,
    async <T>(_p: string, _m?: string, body?: unknown) => {
      sent = body;
      return { article: saved(body as Record<string, unknown>, 1) } as T;
    },
  );
  expect(sent).toMatchObject({
    publicUrl: "https://demo.notion.site/corrected",
  });
});
