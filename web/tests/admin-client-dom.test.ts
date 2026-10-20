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
    constructor(public tagName: string) { }
    set innerHTML(_: string) { throw Error("HTML parsing is forbidden for admin output"); }
    append(...children: (ElementDouble | string)[]) { this.children.push(...children); }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    addEventListener(name: string, handler: EventListener) { this.events.set(name, handler); }
}
afterEach(() => vi.unstubAllGlobals());
const documentDouble = () => vi.stubGlobal("document", { createElement: (tag: string) => new ElementDouble(tag) });
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
    const wrapper = table(["日付", "件数"], [["2026-10-20", 0], ["2026-10-19", "未収集"]], "日別の表") as unknown as ElementDouble;
    const t = wrapper.children[0] as ElementDouble;
    expect((t.children[0] as ElementDouble).tagName).toBe("caption");
    const header = ((t.children[1] as ElementDouble).children[0] as ElementDouble).children[0] as ElementDouble;
    expect(header.attrs.scope).toBe("col");
    const rows = (t.children[2] as ElementDouble).children as ElementDouble[];
    expect((rows[0].children[1] as ElementDouble).children).toEqual(["0"]);
    expect((rows[1].children[1] as ElementDouble).children).toEqual(["未収集"]);
});
