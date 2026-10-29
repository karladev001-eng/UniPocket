// HTML string helpers shared by every screen. Interpolated text always goes through esc().
export const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const btn = (label: string, action: string, cls = "") =>
  `<button type="button" class="${cls}" data-action="${esc(action)}">${label}</button>`;
export const field = (
  name: string,
  label: string,
  value = "",
  type = "text",
  extra = "",
) =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const choice = (
  name: string,
  label: string,
  options: [string, string][],
  value: string,
) =>
  `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
export const textfield = (name: string, label: string, value = "", max = 10000) =>
  `<label>${label}<textarea name="${name}" maxlength="${max}">${esc(value)}</textarea></label>`;
export const empty = (s: string) => `<div class="empty">${esc(s)}</div>`;
export function heading(title: string, sub = "静岡大学 · 浜松キャンパス", right = "") {
  return `<div class="heading"><div>${sub ? `<div class="eyebrow">${esc(sub)}</div>` : ""}<h1>${esc(title)}</h1></div><div class="row">${right}</div></div>`;
}
