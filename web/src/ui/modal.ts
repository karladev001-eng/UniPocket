// The app's single <dialog>. Declarations stay export-free because
// tests/client-modal.test.ts runs slices of this file in a VM; exports are listed at the end.
import { enhanceControls } from "../ui-controls";
import { frozen, updates } from "../app/context";
import { esc } from "./html";
let dialog: HTMLDialogElement | undefined;
let submitting = 0;
// Lets flows outside a form submit (event memo save on close) block updates the same way.
function trackSubmitting(delta: 1 | -1) {
  submitting += delta;
}
function modal(
  title: string,
  content: string,
  submit?: (form: HTMLFormElement) => Promise<void> | void,
  submitText = "保存",
  options: { singleClose?: boolean; className?: string } = {},
) {
  if (dialog) {
    dialog.close();
    dialog.remove();
  }
  dialog = document.createElement("dialog");
  dialog.className = "modal " + (options.className ?? "");
  dialog.innerHTML = `<form><div class="modal-heading"><h2>${esc(title)}</h2><button type="button" data-close aria-label="${options.className === "map-modal" ? "地図を閉じる" : "閉じる"}">×</button></div>${content}<div role="alert" class="modal-error error notice" hidden></div>${options.singleClose && !submit ? "" : `<div class="footer">${options.singleClose ? "" : '<button type="button" data-close>閉じる</button>'}${submit ? `<button class="primary" type="submit">${esc(submitText)}</button>` : ""}</div>`}</form>`;
  document.body.append(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => {
      if (current.dispatchEvent(new Event("requestclose", { cancelable: true }))) current.close();
    }));
  const current = dialog;
  if (!submit) current.querySelector("form")!.onsubmit = e => e.preventDefault();
  current.addEventListener("close", () => {
    current.remove();
    if (dialog === current) dialog = undefined;
    updates?.activity();
  });
  if (submit)
    dialog.querySelector("form")!.onsubmit = async (e) => {
      e.preventDefault();
      if (frozen) return;
      const form = e.currentTarget as HTMLFormElement,
        button = form.querySelector<HTMLButtonElement>("[type=submit]")!;
      if (button.disabled) return;
      button.disabled = true;
      form.inert = true;
      submitting++;
      try {
        await submit(form);
      } catch (e) {
        const box = form.querySelector<HTMLElement>(".modal-error")!;
        box.hidden = false;
        box.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        submitting--;
        updates?.activity();
        button.disabled = false;
        form.inert = false;
      }
    };
  enhanceControls(dialog);
  dialog.showModal();
  return dialog;
}
const val = (f: HTMLFormElement, key: string) =>
  String(new FormData(f).get(key) ?? "");
export { dialog, submitting, trackSubmitting, modal, val };
