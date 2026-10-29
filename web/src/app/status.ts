// Save-state line, error banner and debounced saving of personal data to IndexedDB.
import { dayKey } from "../domain";
import { btn, esc } from "../ui/html";
import { dialog } from "../ui/modal";
import { data, errorBox, frozen, root, saves, status, updates } from "./context";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export let memoSaveStatus: ((state: string, reason?: unknown) => void) | undefined;
export let lastSaveError: unknown;
export function setMemoSaveStatus(next: typeof memoSaveStatus) {
  memoSaveStatus = next;
}
export function error(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  errorBox.innerHTML = `${esc(message)} ${btn("閉じる", "dismiss-error", "smallbtn")}`;
  errorBox.hidden = false;
}
export function statusText(s: string) {
  status.textContent = s;
  status.parentElement!.hidden = !/できません|保護中/.test(s);
}
export function changed() {
  if (frozen) throw Error("更新の保存中です。少し待ってください。");
  saves.changed();
  memoSaveStatus?.("保存中");
  statusText("保存中…");
  root.querySelector<HTMLElement>("#save-retry")!.hidden = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 500);
}
export async function save() {
  clearTimeout(saveTimer);
  try {
    statusText("保存中…");
    memoSaveStatus?.("保存中");
    await saves.flush();
    statusText(saves.dirty ? "保存中…" : "この端末に保存済み");
    memoSaveStatus?.(saves.dirty ? "保存中" : "保存済み");
    lastSaveError = undefined;
    root.querySelector<HTMLElement>("#save-retry")!.hidden = true;
    updates?.activity(true);
    return !saves.dirty;
  } catch (e) {
    reportSaveFailure(e);
    return false;
  }
}
export function reportSaveFailure(e: unknown) {
  lastSaveError = e;
  memoSaveStatus?.("保存できません", e);
  statusText("保存できませんでした · 入力は保持しています");
  root.querySelector<HTMLElement>("#save-retry")!.hidden = false;
  const recovery = dialog?.querySelector<HTMLElement>("#note-save-recovery");
  if (recovery) recovery.hidden = false;
  error(e);
}
export function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "uni-pocket-" + dayKey() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
