export type Child = Node | string | number | null | undefined | false;
/** All server/user strings enter through text nodes or DOM properties. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("on") && typeof value === "function")
      node.addEventListener(
        name.slice(2).toLowerCase(),
        value as EventListener,
      );
    else if (name === "class") node.className = String(value);
    else if (name === "text") node.textContent = String(value);
    else if (value !== undefined && value !== null && value !== false) {
      if (name in node && !name.startsWith("aria-") && name !== "role")
        (node as unknown as Record<string, unknown>)[name] = value;
      else node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  node.append(
    ...children
      .filter(
        (child): child is Node | string | number =>
          child !== null && child !== undefined && child !== false,
      )
      .map((child) => (typeof child === "number" ? String(child) : child)),
  );
  return node;
}
export function button(
  label: string,
  action: () => unknown,
  className = "linebtn",
): HTMLButtonElement {
  return el(
    "button",
    { type: "button", class: className, onclick: action },
    label,
  );
}
export function field(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLElement {
  return el(
    "label",
    { class: "field" },
    el("span", {}, label),
    input,
    hint ? el("small", {}, hint) : null,
  );
}
export function table(
  headers: string[],
  rows: Child[][],
  caption?: string,
): HTMLElement {
  return el(
    "div",
    { class: "tablewrap" },
    el(
      "table",
      {},
      caption ? el("caption", {}, caption) : null,
      el(
        "thead",
        {},
        el("tr", {}, ...headers.map((h) => el("th", { scope: "col" }, h))),
      ),
      el(
        "tbody",
        {},
        ...rows.map((row) =>
          el("tr", {}, ...row.map((cell) => el("td", {}, cell))),
        ),
      ),
    ),
  );
}
