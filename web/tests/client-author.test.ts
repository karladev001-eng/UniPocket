import { expect, it } from "vitest";
import { adminBadge } from "../src/author-badge";
import { articlePreviewSource } from "../src/article-preview";
it("renders a noninteractive text badge only for the explicit admin server value", () => {
  for (const value of [
    undefined,
    null,
    "user",
    "unknown",
    true,
    1,
    "Uni Pocket運営",
    "ADMIN",
  ])
    expect(adminBadge(value)).toBe("");
  const badge = adminBadge("admin");
  expect(badge).toContain("管理者");
  expect(badge).toContain('aria-hidden="true"');
  expect(badge).toContain("<svg");
  expect(badge).not.toMatch(/button|href|tabindex/);
});
it("shares preview validation and keeps publication verification a human confirmation", () => {
  const preview = articlePreviewSource(
    "https://demo.notion.site/page?source=share#top",
    "",
  );
  expect(preview.publicURL).toBe("https://demo.notion.site/page");
  expect(preview.embed).toBe("");
  expect(preview.warning).toContain("iframe");
  expect(preview.warning).toContain("判定しません");
  expect(() => articlePreviewSource("https://evil.test/page", "")).toThrow();
  expect(() =>
    articlePreviewSource(
      "https://demo.notion.site/page",
      "https://evil.test/embed",
    ),
  ).toThrow();
});
