// Notes: searchable note cards and the note editor (text, checklist, images, color, pin).
import { icon, noteHasContent } from "../ui-assets";
import { type Note, uid, dayKey } from "../domain";
import { action, composing, data, isBusy, page, render, saves, trackBusy, updates } from "../app/context";
import { changed, exportData, save } from "../app/status";
import { btn, empty, esc, heading } from "../ui/html";
import { imageData } from "../ui/image";
import { modal } from "../ui/modal";
// Image decoding in flight (see trackBusy); the editor guards check isBusy() for the whole app.
let busy = 0;
trackBusy(() => busy);
export function noteCard(n: Note) {
  const a = "note-" + n.id;
  action(a, () => editNote(n.id));
  return `<article class="card note ${esc(n.color)}"><div class="row between"><button class="article-title" data-action="${esc(a)}">${data.pinned.includes(n.id) ? '<span class="pin">◆ </span>' : ""}${esc(n.text.split("\n")[0] || n.checklist.find((c) => c.text)?.text || "画像メモ")}</button><span class="muted">${dayKey(new Date(n.modified)).slice(5)}</span></div><p>${esc(n.text.split("\n").slice(1).join("\n").slice(0, 200))}</p>${n.checklist
    .slice(0, 4)
    .map(
      (c) =>
        `<div class="check ${c.done ? "done" : ""}"><span>${c.done ? "☑" : "☐"} ${esc(c.text)}</span></div>`,
    )
    .join("")}<div class="thumbs">${n.images
    .slice(0, 3)
    .map(
      (i) => `<img src="${esc(i.data)}" alt="メモの添付画像" loading="lazy">`,
    )
    .join("")}</div></article>`;
}
let noteQuery = "";
export function renderNotes() {
  action("note-new", () => {
    const n: Note = {
      id: uid(),
      text: "",
      color: "default",
      modified: new Date().toISOString(),
      images: [],
      checklist: [],
    };
    editNote(n.id, n);
  });
  const q = noteQuery.toLocaleLowerCase(),
    notes = data.notes
      .filter((n) =>
        (n.text + " " + n.checklist.map((c) => c.text).join(" "))
          .toLocaleLowerCase()
          .includes(q),
      )
      .sort(
        (a, b) =>
          Number(data.pinned.includes(b.id)) -
            Number(data.pinned.includes(a.id)) ||
          b.modified.localeCompare(a.modified),
      );
  page.innerHTML =
    heading("メモ", "MY NOTES", btn("＋ 新しいメモ", "note-new", "primary")) +
    `<div class="toolbar"><input id="note-search" type="search" placeholder="メモとチェック項目を検索" value="${esc(noteQuery)}" aria-label="メモ検索"></div><div class="cards">${notes.map(noteCard).join("") || empty(noteQuery ? "該当するメモはありません。" : "メモはまだありません。文章、写真、チェックリストを保存できます。")}</div>`;
  page.querySelector("#note-search")!.addEventListener("input", (e) => {
    noteQuery = (e.target as HTMLInputElement).value;
    const position = (e.target as HTMLInputElement).selectionStart;
    render();
    const input = page.querySelector<HTMLInputElement>("#note-search")!;
    input.focus();
    input.setSelectionRange(position, position);
  });
}
function editNote(id: string, fresh?: Note) {
  const n = fresh ?? data.notes.find((n) => n.id === id)!;
  let notePinned = data.pinned.includes(id);
  const d = modal(
    "メモ",
    `<div class="note-top"><button type="button" id="note-pin" class="icon-button" aria-label="ホームに固定" aria-pressed="${data.pinned.includes(id)}">${icon("pin")}</button></div><textarea name="text" class="note-body" aria-label="メモ本文" placeholder="メモを入力…" maxlength="10000">${esc(n.text)}</textarea><div class="checks stack"></div><div class="thumbs attachments"></div><div id="note-palette" class="note-palette" role="group" aria-label="メモの色" hidden>${[["default", "標準"], ["yellow", "イエロー"], ["green", "グリーン"], ["pink", "ピンク"], ["blue", "ブルー"]].map(([value, label]) => `<button type="button" data-color="${value}" class="swatch ${value}" aria-label="${label}" aria-pressed="${value === n.color}"></button>`).join("")}</div><div id="note-more-menu" class="note-more-menu" hidden><button type="button" id="delete-note" class="danger">このメモを削除</button><p class="muted">入力は端末内に自動保存します。HEICはブラウザにより変換が必要です。</p></div><input id="note-images" class="file-native" data-toolbar="true" tabindex="-1" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" multiple><span id="note-file-name" class="muted" role="status"></span><div id="note-save-recovery" class="notice error" hidden><p>入力はこの画面に保持しています。再試行しても保存できない場合は、入力データを書き出してからブラウザを再読み込みしてください。書き出しには現在のメモ・画像・チェック項目も含まれます。</p><button type="button" id="note-export-data">入力データを書き出す</button></div><div class="note-tools"><button type="button" id="add-image" class="icon-button" aria-label="画像を追加">${icon("image")}</button><button type="button" id="add-check" class="icon-button" aria-label="チェック項目を追加">${icon("check")}</button><button type="button" id="note-color" class="icon-button" aria-label="色を選ぶ" aria-expanded="false">${icon("color")}</button><button type="button" id="note-more" class="icon-button" aria-label="その他の操作" aria-expanded="false">${icon("more")}</button></div>`,
    async () => {
      if (isBusy() || composing) throw Error("文字変換・画像処理を終えてから完了してください。");
      if (!(await save())) throw Error("保存できませんでした。入力を保持しています。もう一度完了してください。");
      d.close();
      render();
    },
    "完了",
  );
  d.dataset.draft = "true";
  d.classList.add("note-editor", n.color);
  d.querySelector("h2")!.classList.add("sr-only");
  d.querySelectorAll("[data-close]").forEach(b => (b as HTMLElement).hidden = true);
  d.querySelector(".note-tools")!.append(d.querySelector(".footer [type=submit]")!);
  const form = d.querySelector("form")!;
  d.querySelector<HTMLButtonElement>("#note-export-data")!.onclick = exportData;
  d.addEventListener("cancel", e => { e.preventDefault(); if (!composing) form.requestSubmit(); });
  d.addEventListener("requestclose", e => { e.preventDefault(); form.requestSubmit(); });
  const showPanel = (buttonID: string, panelID: string) => {
    const button = d.querySelector<HTMLButtonElement>(buttonID)!;
    const panel = d.querySelector<HTMLElement>(panelID)!;
    button.onclick = () => { panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden)); };
  };
  showPanel("#note-color", "#note-palette");
  showPanel("#note-more", "#note-more-menu");
  d.querySelector<HTMLButtonElement>("#add-image")!.onclick = () => d.querySelector<HTMLInputElement>("#note-images")!.click();
  const touch = () => {
    n.modified = new Date().toISOString();
    if (fresh) {
      const present = data.notes.some(note => note.id === id);
      if (noteHasContent(n) && !present) data.notes.unshift(n);
      if (!noteHasContent(n) && present) data.notes = data.notes.filter(note => note.id !== id);
    }
    data.pinned = data.pinned.filter(x => x !== id);
    if (notePinned && (!fresh || noteHasContent(n))) data.pinned.push(id);
    changed();
  };
  d.querySelector("[name=text]")!.addEventListener("input", (e) => {
    n.text = (e.target as HTMLTextAreaElement).value;
    touch();
  });
  d.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(button => button.onclick = () => {
    d.classList.remove(n.color);
    n.color = button.dataset.color!;
    d.classList.add(n.color);
    d.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
    touch();
  });
  d.querySelector<HTMLButtonElement>("#note-pin")!.onclick = e => {
    notePinned = !notePinned;
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(notePinned));
    touch();
  };
  const checks = () => {
    const parent = d.querySelector(".checks")!;
    parent.innerHTML = n.checklist
      .map(
        (c) =>
          `<div class="check"><input data-done="${c.id}" type="checkbox" aria-label="完了" ${c.done ? "checked" : ""}><input data-check="${c.id}" type="text" value="${esc(c.text)}" aria-label="チェック項目"><button type="button" data-remove-check="${c.id}" aria-label="チェック項目を削除">×</button></div>`,
      )
      .join("");
    parent.querySelectorAll<HTMLInputElement>("[data-check]").forEach(
      (i) =>
        (i.oninput = () => {
          n.checklist.find((c) => c.id === i.dataset.check)!.text = i.value;
          touch();
        }),
    );
    parent.querySelectorAll<HTMLInputElement>("[data-done]").forEach(
      (i) =>
        (i.onchange = () => {
          n.checklist.find((c) => c.id === i.dataset.done)!.done = i.checked;
          touch();
        }),
    );
    parent.querySelectorAll<HTMLButtonElement>("[data-remove-check]").forEach(
      (b) =>
        (b.onclick = () => {
          n.checklist = n.checklist.filter(
            (c) => c.id !== b.dataset.removeCheck,
          );
          touch();
          checks();
        }),
    );
  };
  checks();
  d.querySelector<HTMLButtonElement>("#add-check")!.onclick = () => {
    n.checklist.push({ id: uid(), text: "", done: false });
    touch();
    checks();
    const inputs = d.querySelectorAll<HTMLInputElement>("[data-check]");
    inputs[inputs.length - 1].focus();
  };
  const images = () => {
    const p = d.querySelector(".attachments")!;
    p.innerHTML = n.images
      .map(
        (i) =>
          `<div><a href="${esc(i.data)}" target="_blank" rel="noopener"><img src="${esc(i.data)}" alt="メモの添付画像"></a><button type="button" data-remove-image="${i.id}" class="smallbtn">削除</button></div>`,
      )
      .join("");
    p.querySelectorAll<HTMLButtonElement>("[data-remove-image]").forEach(
      (b) =>
        (b.onclick = () => {
          n.images = n.images.filter((i) => i.id !== b.dataset.removeImage);
          touch();
          images();
        }),
    );
  };
  images();
  d.querySelector<HTMLInputElement>("#note-images")!.onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    d.querySelector("#note-file-name")!.textContent = [...input.files ?? []].map(f => f.name).join("、");
    busy++;
    try {
      for (const f of input.files ?? []) {
        n.images.push({ id: uid(), data: await imageData(f) });
        touch();
      }
      images();
    } catch (e) {
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false; box.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      images();
      input.value = "";
      busy--;
      updates?.activity();
    }
  };
  d.querySelector<HTMLButtonElement>("#delete-note")!.onclick = async () => {
    if (isBusy() || composing) return;
    if (!confirm("このメモを削除しますか？")) return;
    const notes = [...data.notes], pins = [...data.pinned];
    data.notes = data.notes.filter((n) => n.id !== id);
    data.pinned = data.pinned.filter((x) => x !== id);
    changed();
    form.inert = true;
    const deleted = await save();
    form.inert = false;
    if (!deleted) {
      data.notes = notes; data.pinned = pins;
      saves.changed();
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false; box.textContent = "削除を保存できませんでした。メモを保持しています。";
      return;
    }
    d.close();
    render();
  };
  d.addEventListener("close", () => render());
  d.querySelector<HTMLTextAreaElement>("[name=text]")!.focus();
}
