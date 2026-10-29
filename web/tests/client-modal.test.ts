import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget } from "typescript";

// Execute the actual product modal/report handlers with a small dialog contract
// double. Browser-native focus trapping and geometry are checked separately in QA.
const source = readFileSync(
  new URL("../src/screens/articles.ts", import.meta.url),
  "utf8",
);
const modalFile = readFileSync(
  new URL("../src/ui/modal.ts", import.meta.url),
  "utf8",
);
const modalSource = modalFile.slice(
  modalFile.indexOf("function modal("),
  modalFile.indexOf("const val ="),
);
const reportSource = source.slice(
  source.indexOf("function reportArticle("),
  source.indexOf("const community ="),
);
class Control extends EventTarget {
  disabled = false;
}
class Dialog extends EventTarget {
  innerHTML = "";
  className = "";
  open = false;
  removed = false;
  closes: Control[] = [];
  submit = new Control();
  error = { hidden: true, textContent: "" };
  form = {
    onsubmit: undefined as undefined | ((event: unknown) => Promise<void>),
    inert: false,
    values: { reason: "other", details: "保持する補足" },
    querySelector: (selector: string) =>
      selector === "[type=submit]" ? this.submit : this.error,
  };
  querySelectorAll() {
    this.closes = Array.from(
      { length: (this.innerHTML.match(/data-close/g) || []).length },
      () => new Control(),
    );
    return this.closes;
  }
  querySelector(selector: string) {
    return selector === "form" ? this.form : this.error;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
  remove() {
    this.removed = true;
  }
  focus() {}
  escape() {
    const allowed = this.dispatchEvent(
      new Event("cancel", { cancelable: true }),
    );
    if (allowed) this.close();
  }
}
function fixture() {
  const dialogs: Dialog[] = [];
  let accepted = false,
    rejectWrite = false,
    writes = 0;
  const compiled = transpileModule(
    `let dialog; let submitting = 0; const frozen = false; const updates = undefined; ${modalSource} ${reportSource} globalThis.testApi = { modal, reportArticle };`,
    { compilerOptions: { target: ScriptTarget.ES2022 } },
  ).outputText;
  const context: Record<string, unknown> = {
    Event,
    Error,
    document: {
      createElement: () => {
        const d = new Dialog();
        dialogs.push(d);
        return d;
      },
      body: { append() {} },
    },
    esc: (s: string) => s,
    enhanceControls() {},
    choice: () => '<select name="reason"></select>',
    textfield: () => '<textarea name="details" maxlength="500"></textarea>',
    val: (form: Dialog["form"], key: keyof Dialog["form"]["values"]) =>
      form.values[key],
    session: async () => {},
    api: async () => {
      writes++;
      if (rejectWrite) throw Error("一時エラー");
    },
    confirm: () => accepted,
  };
  runInNewContext(compiled, context);
  const api = context.testApi as {
    modal: (
      title: string,
      content: string,
      submit?: unknown,
      label?: string,
      options?: Record<string, unknown>,
    ) => Dialog;
    reportArticle: (article: { id: string }) => void;
  };
  return {
    api,
    dialogs,
    accept: () => {
      accepted = true;
    },
    reject: () => {
      rejectWrite = true;
    },
    writes: () => writes,
  };
}
describe("020 single-close form controls", () => {
  it("keeps one accessible close and the submit action for report and author forms without changing legacy forms", () => {
    const { api } = fixture();
    const report = api.modal(
      "記事を通報",
      "<textarea></textarea>",
      async () => {},
      "通報を送信",
      { singleClose: true, className: "article-report" },
    );
    expect(report.closes).toHaveLength(1);
    expect(report.innerHTML).toContain('aria-label="閉じる"');
    expect(report.innerHTML).toContain('type="submit">通報を送信');
    const author = fixture().api.modal("登録", "", async () => {}, "登録", {
      singleClose: true,
      className: "article-compose",
    });
    expect(author.closes).toHaveLength(1);
    expect(author.innerHTML).toContain('type="submit">登録');
    const old = fixture().api.modal("旧フォーム", "", async () => {});
    expect(old.closes).toHaveLength(2);
    expect(old.innerHTML).toContain('type="submit">保存');
    const done = fixture().api.modal("完了", "", undefined, "", {
      singleClose: true,
    });
    expect(done.closes).toHaveLength(1);
    expect(done.innerHTML).not.toContain('type="submit"');
    expect(source).toContain(
      '{ singleClose: true, className: "article-compose" }',
    );
  });
  it("guards both Escape and the bound close click after typing, and keeps input after a failed submit", async () => {
    const f = fixture();
    f.api.reportArticle({ id: "article" });
    const d = f.dialogs[0];
    expect(d.closes).toHaveLength(1);
    expect(d.form.onsubmit).toBeTypeOf("function");
    d.dispatchEvent(new Event("input"));
    d.escape();
    expect(d.open).toBe(true);
    d.closes[0].dispatchEvent(new Event("click"));
    expect(d.open).toBe(true);
    f.reject();
    await d.form.onsubmit!({ preventDefault() {}, currentTarget: d.form });
    expect(f.writes()).toBe(1);
    expect(d.open).toBe(true);
    expect(d.form.values.details).toBe("保持する補足");
    expect(d.error.textContent).toBe("一時エラー");
    expect(d.form.inert).toBe(false);
    expect(d.submit.disabled).toBe(false);
    f.accept();
    d.escape();
    expect(d.open).toBe(false);
  });
  it("retains keyboard form submission and a single-close success dialog", async () => {
    const f = fixture();
    f.api.reportArticle({ id: "article" });
    const d = f.dialogs[0];
    await d.form.onsubmit!({ preventDefault() {}, currentTarget: d.form });
    expect(f.writes()).toBe(1);
    expect(d.open).toBe(false);
    const success = f.dialogs[1];
    expect(success.open).toBe(true);
    expect(success.closes).toHaveLength(1);
  });
  it("provides scoped 44px controls, 16px inputs and the existing visible focus outline", () => {
    const css = readFileSync(
      new URL("../src/style.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(
      ".article-report button, .article-compose button { min-height: 44px; min-width: 44px; }",
    );
    expect(css).toContain(
      ".article-compose textarea { font-size: 16px; min-height: 44px; }",
    );
    expect(css).toMatch(/button:focus-visible,[\s\S]*?outline: 3px solid/);
  });
});
