import { button, el } from "./dom";
import type { Editable, EditorState } from "./model";

/** The explicit apply control is bound only after showing the compared version. */
export function editorRecoveryPanel(
  state: EditorState,
  preview: (item: Editable) => HTMLElement,
  applied: () => void,
): HTMLElement {
  if (!state.latest) throw Error("先に最新版を表示してください。");
  return el(
    "section",
    { class: "card" },
    el("h2", {}, `最新版（改訂${state.latest.revision}）との比較`),
    el(
      "p",
      {},
      "上の最新版と下の現在の入力を確認してください。変更した項目だけを適用し、他の更新を保持します。",
    ),
    el("fieldset", { disabled: true }, preview(state.latest)),
    button("確認した版へ変更を適用", () => {
      state.rebase();
      applied();
    }),
  );
}
