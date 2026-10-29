// Event detail, chooser and editor dialogs, plus helpers shared by the home,
// timetable and calendar screens.
import { setEventMemo, eventMemoText } from "../event-memos";
import { commitEvent } from "../event-editor";
import { courseColor } from "../schedule-presentation";
import { eventKind } from "../calendar-presentation";
import { type CampusEvent, uid, dayKey, addDay, weekDay, timeLabel, tokyo, courseID, originals } from "../domain";
import { resolveRoom } from "../map";
import { action, composing, data, frozen, page, render, saves, updates, view } from "../app/context";
import { changed, exportData, lastSaveError, memoSaveStatus, save, setMemoSaveStatus } from "../app/status";
import { btn, choice, esc, field } from "../ui/html";
import { modal, trackSubmitting, val } from "../ui/modal";
import { showLocation } from "./campus-map";
import { articleFilters } from "./articles";
export function colorFor(e: CampusEvent) {
  const c = data.imports.flatMap(p => p.courses).find(c => c.id === courseID(data, e));
  return courseColor(c?.title || e.title);
}
export function locationControl(location: string, key: string) {
  const r = resolveRoom(location);
  if (r.kind === "missing" || r.kind === "online") return `<span class="room">${esc(location || "場所未設定")}</span>`;
  const a = "location-" + key;
  action(a, () => showLocation(location));
  return btn(`${esc(location)} <span aria-hidden="true">↗</span>`, a, "room location-link");
}
export function eventDate(e: CampusEvent) {
  const start = dayKey(new Date(e.start)), end = dayKey(new Date(e.end));
  return `${start}${e.allDay && dayKey(new Date(Date.parse(e.end) - 1)) !== start ? "–" + dayKey(new Date(Date.parse(e.end) - 1)) : ""} ${e.allDay ? "終日" : timeLabel(e.start) + "–" + (end === start ? "" : end + " ") + timeLabel(e.end)}`;
}
export function showEvent(e: CampusEvent) {
  const canMap = !["missing", "online"].includes(resolveRoom(e.location).kind);
  const d = modal(e.title, `<div class="event-meta">${esc(eventDate(e))}<div class="detail-location">${canMap ? `<button type="button" id="detail-map" class="location-link">${esc(e.location)} ↗</button>` : esc(e.location || "場所未設定")}</div></div><label class="event-memo-label" for="event-memo">この予定のメモ</label><textarea id="event-memo" maxlength="5000" rows="10">${esc(eventMemoText(data, e.id))}</textarea><div class="memo-save-line"><span id="event-memo-status" role="status" aria-live="polite">保存済み</span><span id="event-memo-count">${eventMemoText(data, e.id).length} / 5000</span></div><div id="event-memo-recovery" class="notice error" hidden><p id="event-memo-error"></p><button type="button" id="event-memo-retry">再試行</button><button type="button" id="event-memo-export">入力を書き出す</button></div><button type="button" id="detail-edit" class="text-action">予定を編集</button>`, undefined, "保存", { singleClose: true, className: "event-detail" });
  const form = d.querySelector("form")!, input = d.querySelector<HTMLTextAreaElement>("#event-memo")!;
  const status = (state: string, reason?: unknown) => {
    d.querySelector("#event-memo-status")!.textContent = state;
    const recovery = d.querySelector<HTMLElement>("#event-memo-recovery")!;
    recovery.hidden = state !== "保存できません";
    if (reason) d.querySelector("#event-memo-error")!.textContent = reason instanceof Error ? reason.message : String(reason);
  };
  setMemoSaveStatus(status);
  if (saves.dirty) status(lastSaveError ? "保存できません" : "保存中", lastSaveError);
  input.oninput = () => {
    setEventMemo(data, e.id, input.value);
    d.querySelector("#event-memo-count")!.textContent = `${input.value.length} / 5000`;
    changed();
  };
  let leaving = false;
  const leave = async (next: () => void = () => { d.close(); render(); }) => {
    if (leaving || composing || frozen) return;
    leaving = true;
    form.inert = true;
    trackSubmitting(1);
    try {
      if (await save()) next();
    } finally {
      trackSubmitting(-1);
      form.inert = false;
      leaving = false;
      updates?.activity();
    }
  };
  d.addEventListener("requestclose", ev => { ev.preventDefault(); void leave(); });
  d.addEventListener("cancel", ev => { ev.preventDefault(); void leave(); });
  d.addEventListener("close", () => { if (memoSaveStatus === status) setMemoSaveStatus(undefined); });
  d.querySelector("#detail-map")?.addEventListener("click", () => void leave(() => showLocation(e.location)));
  d.querySelector("#detail-edit")!.addEventListener("click", () => void leave(() => editEvent(e)));
  d.querySelector<HTMLButtonElement>("#event-memo-retry")!.onclick = () => void save();
  d.querySelector<HTMLButtonElement>("#event-memo-export")!.onclick = exportData;
}

export function eventChooser(title: string, all: CampusEvent[]) {
  const d = modal(title, `<div class="stack">${all.map((e, i) => `<button type="button" data-choose="${i}"><b>${esc(e.title)}</b><br><small>${esc(eventKind(e))} · ${esc(eventDate(e))}<br>${esc(e.location || "場所未設定")}</small></button>`).join("")}</div>`);
  d.querySelectorAll<HTMLButtonElement>("[data-choose]").forEach(b => b.onclick = () => showEvent(all[Number(b.dataset.choose)]));
}
export function dateTools(label: string) {
  return `<div class="date-tools"><button data-action="prev-date" aria-label="前の${label}">‹</button><label class="date-picker"><span>${esc(label === "月" ? view.selectedDay.slice(0, 7) : label === "週" ? addDay(view.selectedDay, 1 - weekDay(view.selectedDay)).slice(5) + "–" + addDay(view.selectedDay, 7 - weekDay(view.selectedDay)).slice(5) : view.selectedDay)}</span><input type="date" id="selected-day" value="${view.selectedDay}" aria-label="表示日を選ぶ"></label><button data-action="next-date" aria-label="次の${label}">›</button>${btn("今日", "today", "smallbtn")}</div>`;
}
export function bindDatePicker() {
  page.querySelector("#selected-day")?.addEventListener("change", e => {
    const value = (e.target as HTMLInputElement).value;
    if (value) { view.selectedDay = value; view.weekend = weekDay(value) > 5; render(); }
  });
}
function dateTimeValue(iso: string) {
  return dayKey(new Date(iso)) + "T" + timeLabel(iso);
}
export function editEvent(event?: CampusEvent, resume = false, initialStart?: string) {
  if (
    !resume &&
    data.eventDraft &&
    data.eventDraft.event.id !== event?.id &&
    !confirm("保存済みの予定下書きを新しい編集に切り替えますか？")
  )
    return;
  if (resume && data.eventDraft) event = data.eventDraft.event;
  const existing = event
    ? originals(data).some((x) => x.id === event!.id)
    : false;
  const e = event ?? {
      id: "manual:" + uid(),
      title: "",
      start: initialStart ?? tokyo(view.selectedDay, "09:00"),
      end: initialStart ? new Date(Date.parse(initialStart) + 3600000).toISOString() : tokyo(view.selectedDay, "10:00"),
      location: "",
      kind: "personal",
      allDay: false,
    },
    cid = event ? courseID(data, e) : undefined;
  const d = modal(
    existing ? "予定の個人修正" : "個人予定を追加",
    field("title", "タイトル", e.title, "text", 'required maxlength="200"') +
      field(
        "start",
        "開始",
        dateTimeValue(e.start),
        "datetime-local",
        "required",
      ) +
      field("end", "終了", dateTimeValue(e.end), "datetime-local", "required") +
      field("location", "教室・場所", e.location) +
      `<label class="check"><input name="allDay" type="checkbox" ${e.allDay ? "checked" : ""}>終日</label>` +
      (cid
        ? choice(
            "scope",
            "適用範囲",
            [
              ["occurrence", "この1回"],
              ["course", "この講義の全日程"],
            ],
            "occurrence",
          )
        : "") +
      (existing
        ? '<label class="check"><input name="cancelled" type="checkbox">この範囲を取消</label>'
        : "") +
      `<div class="row">${btn("教室を地図で確認", "event-map")}${event ? btn("関連記事", "event-articles") : ""}</div><p class="muted">PDF原本は保持し、個人修正を重ねます。講義全体の時刻修正は各日の時刻に適用します。</p>`,
    async (form) => {
      const start = tokyo(
          val(form, "start").slice(0, 10),
          val(form, "start").slice(11),
        ),
        end = tokyo(val(form, "end").slice(0, 10), val(form, "end").slice(11));
      await commitEvent(
        data,
        e,
        existing,
        cid,
        {
          title: val(form, "title"),
          location: val(form, "location"),
          start,
          end,
          allDay: new FormData(form).has("allDay"),
          cancelled: new FormData(form).has("cancelled"),
          scope: val(form, "scope") === "course" ? "course" : "occurrence",
        },
        { changed, save },
      );
      d.close();
      render();
    },
  );
  d.dataset.draft = "true";
  const form = d.querySelector("form")!;
  if (resume && data.eventDraft) {
    for (const [name, value] of Object.entries(data.eventDraft.values)) {
      const input = form.elements.namedItem(name) as
        | HTMLInputElement
        | HTMLSelectElement
        | null;
      if (input) {
        if (input instanceof HTMLInputElement && input.type === "checkbox")
          input.checked = value === "true";
        else input.value = value;
        if (input instanceof HTMLSelectElement) input.dispatchEvent(new Event("change"));
      }
    }
  }
  const capture = () => {
    const values: Record<string, string> = {};
    for (const input of form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("[name]"))
      values[input.name] =
        input instanceof HTMLInputElement && input.type === "checkbox"
          ? String(input.checked)
          : input.value;
    data.eventDraft = { event: structuredClone(e), values };
    changed();
  };
  form.addEventListener("input", capture);
  form.addEventListener("change", capture);
  d.querySelector("[data-action=event-map]")?.addEventListener("click", () => {
    const room = (d.querySelector("[name=location]") as HTMLInputElement).value;
    capture();
    showLocation(room);
  });
  d.querySelector("[data-action=event-articles]")?.addEventListener(
    "click",
    () => {
      d.close();
      articleFilters.courseId = cid ?? "";
      location.hash = "articles";
    },
  );
}
