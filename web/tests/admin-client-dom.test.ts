import { afterEach, expect, it, vi } from "vitest";
import { button, el, field, table } from "../admin/src/dom";
/** Minimal DOM contract double: deliberately has no HTML parser. */
class ElementDouble {
  children: (ElementDouble | string)[] = [];
  attrs: Record<string, string> = {};
  events = new Map<string, EventListener>();
  className = "";
  textContent = "";
  value = "";
  constructor(public tagName: string) {}
  set innerHTML(_: string) {
    throw Error("HTML parsing is forbidden for admin output");
  }
  append(...children: (ElementDouble | string)[]) {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  addEventListener(name: string, handler: EventListener) {
    this.events.set(name, handler);
  }
}
afterEach(() => vi.unstubAllGlobals());
const documentDouble = () =>
  vi.stubGlobal("document", {
    createElement: (tag: string) => new ElementDouble(tag),
  });
it("renders hostile content as text while attaching handlers separately", () => {
  documentDouble();
  const hostile = '<img src=x onerror="alert(1)">';
  const clicked = vi.fn();
  const b = button(hostile, clicked) as unknown as ElementDouble;
  expect(b.children).toEqual([hostile]);
  expect(b.attrs).not.toHaveProperty("onclick");
  b.events.get("click")!(new Event("click"));
  expect(clicked).toHaveBeenCalledOnce();
  const cell = el("p", {}, hostile, null, false, 0) as unknown as ElementDouble;
  expect(cell.children).toEqual([hostile, "0"]);
});
it("keeps accessible labels, table captions, column headers and zero/null content distinct", () => {
  documentDouble();
  const input = el("input", { value: "保持する入力", "aria-invalid": "true" });
  const label = field("題名", input, "80文字まで") as unknown as ElementDouble;
  expect(label.tagName).toBe("label");
  expect(label.children[1]).toBe(input);
  expect((input as unknown as ElementDouble).value).toBe("保持する入力");
  const wrapper = table(
    ["日付", "件数"],
    [
      ["2026-10-20", 0],
      ["2026-10-19", "未収集"],
    ],
    "日別の表",
  ) as unknown as ElementDouble;
  const t = wrapper.children[0] as ElementDouble;
  expect((t.children[0] as ElementDouble).tagName).toBe("caption");
  const header = ((t.children[1] as ElementDouble).children[0] as ElementDouble)
    .children[0] as ElementDouble;
  expect(header.attrs.scope).toBe("col");
  const rows = (t.children[2] as ElementDouble).children as ElementDouble[];
  expect((rows[0].children[1] as ElementDouble).children).toEqual(["0"]);
  expect((rows[1].children[1] as ElementDouble).children).toEqual(["未収集"]);
});

it("labels expired survey results as retained-window values after reopen, including zero and new answers", async () => {
  documentDouble();
  const { resultsSummary } = await import("../admin/src/results");
  const text = (node: ElementDouble | string): string =>
    typeof node === "string" ? node : node.children.map(text).join(" ");
  const retained = {
    resultsComplete: false,
    resultsSince: "2026-10-19T15:05:00.000Z",
    responseCount: 0,
  };
  const expired = text(resultsSummary(retained) as unknown as ElementDouble);
  expect(expired).toContain("保存期間内の回答数 0");
  expect(expired).toContain("2026/10/20 0:05");
  expect(expired).toContain("回答数と選択数の0件は、この期間内の値");
  expect(expired).toContain("再公開しても過去の集計は復元されません");
  const newAnswer = text(
    resultsSummary({
      ...retained,
      responseCount: 1,
    }) as unknown as ElementDouble,
  );
  expect(newAnswer).toContain("保存期間内の回答数 1");
  expect(newAnswer).toContain("保存期限");
  const complete = text(
    resultsSummary({
      ...retained,
      resultsComplete: true,
      responseCount: 2,
    }) as unknown as ElementDouble,
  );
  expect(complete).toBe("回答数 2");
});

it("binds admin rebase only to the explicit apply control after rendering the compared version", async () => {
  documentDouble();
  const { EditorState, newContent } = await import("../admin/src/model");
  const { editorRecoveryPanel } = await import("../admin/src/editor-recovery");
  const state = new EditorState("announcements", {
    ...newContent("announcements"),
    title: "original",
    body: "original body",
    link: "",
  });
  state.pendingCreate = {
    key: "original-key",
    body: {
      title: "original",
      body: "original body",
      link: "",
      startAt: state.item.startAt,
      endAt: state.item.endAt,
    },
  };
  state.item.title = "local title";
  state.latest = {
    ...state.item,
    id: "created",
    revision: 2,
    title: "original",
    body: "newer body",
    link: "",
  };
  const applied = vi.fn();
  const panel = editorRecoveryPanel(
    state,
    (item) => el("p", {}, item.title, "body" in item ? item.body : item.intro),
    applied,
  ) as unknown as ElementDouble;
  expect(state.latest).toBeDefined();
  expect(applied).not.toHaveBeenCalled();
  const preview = panel.children[2] as ElementDouble;
  expect(preview.attrs.disabled).toBe("");
  expect((preview.children[0] as ElementDouble).children).toEqual([
    "original",
    "newer body",
  ]);
  const apply = panel.children[3] as ElementDouble;
  apply.events.get("click")!(new Event("click"));
  expect(applied).toHaveBeenCalledOnce();
  expect(state.item.title).toBe("local title");
  expect("body" in state.item && state.item.body).toBe("newer body");
  expect(state.latest).toBeUndefined();
});
