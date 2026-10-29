import { el, button, type Child } from "./dom";
import { errorMessage } from "./model";
import { client, navigation, sections, ui } from "./state";
// Page chrome (sidebar, toast, auth banner, dialog) and helpers shared by every screen.
const app = document.querySelector<HTMLDivElement>("#app")!;
export const main = el("main", { id: "main", tabindex: -1 });
export const auth = el("div", { class: "auth", hidden: true });
const toast = el("div", { class: "toast", role: "status", hidden: true });
export const dialog = el("dialog", { "aria-labelledby": "dialog-title" });
export const owner = el("p", { class: "owner" });
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export const navButtons = sections.map(([id, label]) =>
  button(label, () => void navigation.go(id), "navitem"),
);
const nav = el("nav", { "aria-label": "管理区画" }, ...navButtons);
export const menu = el(
  "details",
  { class: "mobilemenu", open: false },
  el("summary", {}, "管理メニュー"),
);
export const sidebar = el(
  "aside",
  { class: "sidebar" },
  el("div", { class: "brand" }, "Uni Pocket", el("span", {}, ".")),
  el("small", {}, "ADMIN"),
  menu,
  nav,
  el("footer", {}, owner, "日時は日本時間"),
);
app.append(
  el("a", { href: "#main", class: "skip" }, "本文へ"),
  el(
    "div",
    { class: "layout" },
    sidebar,
    el("div", { class: "content" }, auth, main),
  ),
  dialog,
  toast,
);
export function notify(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    toast.hidden = true;
  }, 7000);
}
export function authBanner(): void {
  auth.hidden = false;
  auth.replaceChildren(
    el("strong", {}, "管理者認証を確認してください"),
    el(
      "p",
      {},
      "入力はこの画面に保持しています。別タブでログイン後、認証を再確認してください。",
    ),
    el(
      "a",
      { class: "linebtn", href: "/", target: "_blank", rel: "noopener" },
      "別タブでログイン",
    ),
    button(
      "認証を再確認",
      () =>
        void run(async () => {
          await client.authenticate();
          owner.textContent = client.email;
          auth.hidden = true;
          notify("認証を確認しました。操作を再試行できます。");
          if (!ui.editor && !ui.articleEditor) await navigation.reload();
        }),
    ),
  );
  if (dialog.open && !dialog.querySelector(".dialog-auth"))
    dialog.append(
      el(
        "div",
        { class: "notice dialog-auth" },
        el(
          "p",
          {},
          "入力を保持しています。別タブで再認証し、この確認操作を再試行してください。",
        ),
        el(
          "a",
          { class: "linebtn", href: "/", target: "_blank", rel: "noopener" },
          "別タブでログイン",
        ),
        taskButton("認証を再確認", async () => {
          await client.authenticate();
          owner.textContent = client.email;
          auth.hidden = true;
          dialog.querySelector(".dialog-auth")?.remove();
          notify("認証を確認しました。操作を再試行できます。");
        }),
      ),
    );
}
client.onExpired = authBanner;
export function showError(error: unknown): void {
  const message = errorMessage(error);
  notify(message);
  const box = document.querySelector<HTMLElement>(
    dialog.open ? "#dialog-error" : "#form-error",
  );
  if (box) {
    box.hidden = false;
    box.textContent = message;
    box.focus();
  }
  if (!client.authorized) authBanner();
}
export async function run(
  action: () => Promise<void>,
  trigger?: HTMLButtonElement,
): Promise<void> {
  if (ui.busy) return;
  ui.busy = true;
  if (trigger) trigger.disabled = true;
  main.inert = true;
  main.setAttribute("aria-busy", "true");
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    ui.busy = false;
    if (trigger) trigger.disabled = false;
    main.inert = false;
    main.removeAttribute("aria-busy");
  }
}
export function taskButton(
  label: string,
  action: () => Promise<void>,
  className = "linebtn",
): HTMLButtonElement {
  const b = button(label, () => void run(action, b), className);
  return b;
}
export function heading(title: string, ...actions: Child[]): void {
  main.replaceChildren(
    el(
      "header",
      { class: "top" },
      el(
        "div",
        {},
        el("small", { class: "eyebrow" }, "UNI POCKET / 管理"),
        el("h1", { tabindex: -1 }, title),
      ),
      el("div", { class: "row" }, ...actions),
    ),
  );
}
export function card(
  label: string,
  value: number | null,
  hint?: string,
): HTMLElement {
  return el(
    "div",
    { class: "stat" },
    el("small", {}, label),
    el("b", {}, value === null ? "未収集" : value.toLocaleString("ja-JP")),
    hint ? el("small", {}, hint) : null,
  );
}
export const formatDate = (iso: string) =>
  iso
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso))
    : "—";
export const empty = (text: string) => el("p", { class: "empty" }, text);
export function openDialog(
  title: string,
  body: HTMLElement,
  actions: HTMLButtonElement[] = [],
): void {
  dialog.replaceChildren(
    el(
      "div",
      { class: "top" },
      el("h2", { id: "dialog-title" }, title),
      button("×", () => dialog.close(), "close"),
    ),
    body,
    el("div", {
      id: "dialog-error",
      class: "notice error",
      role: "alert",
      tabindex: -1,
      hidden: true,
    }),
    el("div", { class: "dialogactions" }, ...actions),
  );
  dialog.querySelector("button")?.setAttribute("aria-label", "閉じる");
  dialog.showModal();
}
export function confirmAction(
  title: string,
  body: HTMLElement,
  label: string,
  action: () => Promise<void>,
): void {
  openDialog(title, body, [
    taskButton(
      label,
      async () => {
        await action();
        dialog.close();
      },
      "action",
    ),
  ]);
}
window.addEventListener("beforeunload", (event) => {
  if (ui.editor?.hasInputToLose || ui.articleEditor?.hasInputToLose) {
    event.preventDefault();
    event.returnValue = "";
  }
});
menu.addEventListener("toggle", () => {
  sidebar.classList.toggle("expanded", menu.open);
});
export async function download(path: string, filename: string): Promise<void> {
  const blob = await client.csv(path),
    url = URL.createObjectURL(blob),
    a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
