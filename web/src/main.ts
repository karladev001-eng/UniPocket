import "./style.css";
import {
  type Data,
  type Note,
  type CampusEvent,
  type Edit,
  type Plan,
  type Facility,
  emptyData,
  uid,
  dayKey,
  addDay,
  weekDay,
  timeLabel,
  tokyo,
  events,
  onDay,
  courseID,
  originals,
  difference,
  install,
  parseHours,
  facilityHours,
} from "./domain";
import { LocalStore, SaveQueue } from "./storage";
import {
  api,
  session,
  notionURL,
  embedSource,
  type Article,
  type User,
} from "./api";
import { catalog, resolveRoom, searchBuildings } from "./map";
import { installUpdates } from "./update";
const root = document.querySelector<HTMLDivElement>("#app")!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const btn = (label: string, action: string, cls = "") =>
  `<button class="${cls}" data-action="${esc(action)}">${label}</button>`;
const field = (
  name: string,
  label: string,
  value = "",
  type = "text",
  extra = "",
) =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const choice = (
  name: string,
  label: string,
  options: [string, string][],
  value: string,
) =>
  `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
const textfield = (name: string, label: string, value = "", max = 10000) =>
  `<label>${label}<textarea name="${name}" maxlength="${max}">${esc(value)}</textarea></label>`;
const empty = (s: string) => `<div class="empty">${esc(s)}</div>`;
const actions = new Map<string, () => unknown>();
const action = (name: string, fn: () => unknown) => actions.set(name, fn);
let data: Data = emptyData(),
  loadFailed = false,
  busy = 0,
  composing = false,
  frozen = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  selectedDay = dayKey(),
  view = "day",
  user: User | null = null;
let page = document.createElement("main"),
  status: HTMLElement,
  errorBox: HTMLElement,
  updateBox: HTMLElement,
  dialog: HTMLDialogElement | undefined;
const store = new LocalStore();
const saves = new SaveQueue(store, () => data);
function error(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  errorBox.innerHTML = `${esc(message)} ${btn("閉じる", "dismiss-error", "smallbtn")}`;
  errorBox.hidden = false;
}
function statusText(s: string) {
  status.textContent = s;
}
function changed() {
  if (frozen) throw Error("更新の保存中です。少し待ってください。");
  saves.changed();
  statusText("保存待ち…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 500);
}
async function save() {
  clearTimeout(saveTimer);
  try {
    await saves.flush();
    statusText(saves.dirty ? "保存待ち…" : "このブラウザに保存済み");
    return true;
  } catch (e) {
    statusText("未保存 · 入力はこの画面に保持しています");
    error(e);
    return false;
  }
}
async function flushOrThrow() {
  if (loadFailed)
    throw Error(
      "保存データを読み込めないため更新できません。原本を保護しています。",
    );
  if (busy || composing)
    throw Error(
      "文字変換・画像処理・PDF取込・送信を終えてから更新してください。",
    );
  await saves.flush();
  if (saves.dirty)
    throw Error("保存中に入力が変わりました。もう一度保存してください。");
}
function theme() {
  const themes: Record<string, string[]> = {
    green: ["#163e35", "#f6f7f2", "#223830", "#edf0e7", "#dceab9"],
    blue: ["#233f63", "#f2f5f9", "#22374d", "#e8eef6", "#d7e6fa"],
    rose: ["#663e50", "#faf4f6", "#493540", "#f3e8ed", "#f4dce7"],
    mono: ["#2e3339", "#f5f5f4", "#2e343b", "#e9ebed", "#e0e4ea"],
  };
  const [accent, paper, ink, soft, light] = themes[data.theme] ?? themes.green;
  for (const [k, v] of Object.entries({ accent, paper, soft, light }))
    document.documentElement.style.setProperty("--" + k, v);
  document.body.style.color = ink;
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute("content", accent);
  const bg = document.querySelector<HTMLElement>(".background")!;
  bg.style.backgroundImage = data.background ? `url("${data.background}")` : "";
}
function route() {
  return location.hash.slice(1).split("/")[0] || "home";
}
function render() {
  actions.clear();
  action("dismiss-error", () => (errorBox.hidden = true));
  action("update", async () => {
    try {
      await updates.apply();
    } catch (e) {
      error(e);
    }
  });
  action("update-later", () => (updateBox.hidden = true));
  const r = route();
  document
    .querySelectorAll(".nav a")
    .forEach((a) =>
      a.classList.toggle("active", a.getAttribute("href") === "#" + r),
    );
  page.innerHTML = "";
  if (r === "timetable") renderTimetable();
  else if (r === "notes") renderNotes();
  else if (r === "articles") renderArticles();
  else if (r === "more") renderMore();
  else renderHome();
  theme();
}
function heading(title: string, sub = "静岡大学 · 浜松キャンパス", right = "") {
  return `<div class="heading"><div><div class="eyebrow">${esc(sub)}</div><h1>${esc(title)}</h1></div><div class="row">${right}</div></div>`;
}
function eventCard(e: CampusEvent) {
  const a = "event-" + e.id;
  action(a, () => editEvent(e));
  return `<div class="event"><div class="time">${e.allDay ? "終日" : timeLabel(e.start) + "<br>" + timeLabel(e.end)}</div><div class="body"><button class="eventtitle" data-action="${esc(a)}">${esc(e.title)}</button><div class="muted">${esc(e.location || "場所未設定")} ${data.occurrenceEdits.some((x) => x.id === e.id) || data.courseEdits.some((x) => x.id === courseID(data, e)) ? '<span class="tag">個人修正</span>' : ""}</div></div>${e.kind === "exam" ? '<span class="tag exam">要確認</span>' : ""}</div>`;
}
function renderHome() {
  const today = dayKey(),
    todayEvents = events(data).filter((e) => onDay(e, today)),
    now = new Date(),
    next = events(data).find((e) => new Date(e.end) > now && !e.allDay);
  action("home-import", () => openImport());
  page.innerHTML =
    heading(
      "今日のキャンパス",
      new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "full",
        timeZone: "Asia/Tokyo",
      }).format(now),
    ) +
    `<section class="hero card"><div class="eyebrow">SHIZUDAI POCKET</div><h2>${next ? "次の予定" : "自分のキャンパスを、ひとつに。"}</h2>${next ? `<h3>${esc(next.title)}</h3><p>${dayKey(new Date(next.start))} ${timeLabel(next.start)} · ${esc(next.location)}</p>${btn("予定を確認", "event-" + next.id)}` : `<p>時間割、メモ、教室地図。<br>まずは履修登録確認票を読み込みましょう。</p>${btn("PDFを取り込む", "home-import")}`}</section><div class="cards"><section class="card"><div class="sectiontitle"><h2>今日の予定 <span class="tag">${todayEvents.length}</span></h2><a href="#timetable">時間割へ →</a></div>${todayEvents.map(eventCard).join("") || empty("今日の予定はありません。時間割から個人予定を追加できます。")}</section><section class="card"><h2>キャンパスの営業時間</h2><p class="muted">通常期の目安（元の掲載日 2026-10-07）。臨時変更は公式情報で確認してください。</p>${data.facilities
      .slice(0, 4)
      .map(
        (f) =>
          `<div class="event"><div class="body"><b>${esc(f.title)}</b><div class="muted">${f.exceptions[today] !== undefined ? "個人設定" : "通常期の目安"} · ${esc(facilityHours(f, today) || "休業")}</div></div></div>`,
      )
      .join(
        "",
      )}<a href="#more">施設・リンク・地図 →</a></section></div><section class="section"><h2>固定したメモ</h2><div class="cards">${
      data.notes
        .filter((n) => data.pinned.includes(n.id))
        .map(noteCard)
        .join("") || empty("メモを固定するとここに表示されます。")
    }</div></section><section class="section"><h2>よく使うリンク</h2><div class="row">${
      data.links
        .filter((l) => l.favorite)
        .map(
          (l) =>
            `<a class="card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ↗</a>`,
        )
        .join("") || '<a href="#more">リンクのお気に入りを設定 →</a>'
    }</div></section>`;
  if (next) action("event-" + next.id, () => editEvent(next));
}
function shiftMonth(day: string, n: number) {
  const d = new Date(day + "T12:00:00+09:00");
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return dayKey(d);
}
function renderTimetable() {
  action("prev-date", () => {
    selectedDay =
      view === "month"
        ? shiftMonth(selectedDay, -1)
        : addDay(selectedDay, view === "week" ? -7 : -1);
    render();
  });
  action("next-date", () => {
    selectedDay =
      view === "month"
        ? shiftMonth(selectedDay, 1)
        : addDay(selectedDay, view === "week" ? 7 : 1);
    render();
  });
  action("today", () => {
    selectedDay = dayKey();
    render();
  });
  action("import", openImport);
  action("event-resume", () => editEvent(undefined, true));
  action("event-new", () => editEvent());
  for (const v of ["day", "week", "month"])
    action("view-" + v, () => {
      view = v;
      render();
    });
  const all = events(data),
    current = all.filter((e) => onDay(e, selectedDay));
  let content = "";
  if (view === "day") {
    const outside = current.filter(
      (e) =>
        e.allDay ||
        new Date(e.start).getTime() <
          new Date(
            tokyo(selectedDay, String(data.startHour).padStart(2, "0") + ":00"),
          ).getTime() ||
        new Date(e.end).getTime() >
          new Date(
            data.endHour === 24
              ? tokyo(addDay(selectedDay, 1))
              : tokyo(
                  selectedDay,
                  String(data.endHour).padStart(2, "0") + ":00",
                ),
          ).getTime(),
    );
    content = `<section class="card"><h2>${esc(selectedDay)} の予定</h2>${current.map(eventCard).join("") || empty("この日の予定はありません。")}${outside.length ? '<p class="muted">終日・表示時間外の予定も上の一覧に含めて表示しています。</p>' : ""}${
      data.showBands
        ? `<hr><h3>営業時間の帯</h3>${data.facilities
            .filter((f) => f.band)
            .map(
              (f) =>
                `<p class="muted">${esc(f.title)} · ${esc(facilityHours(f, selectedDay) || "休業")}</p>`,
            )
            .join("")}`
        : ""
    }</section>`;
  } else if (view === "week") {
    const start = addDay(selectedDay, 1 - weekDay(selectedDay));
    content = `<div class="scroll" tabindex="0" aria-label="週間時間割。横スクロールできます"><div class="week">${Array.from(
      { length: 7 },
      (_, i) => {
        const day = addDay(start, i);
        return `<section class="card"><h3>${day.slice(5)} ${"月火水木金土日"[i]}</h3>${
          all
            .filter((e) => onDay(e, day))
            .map(eventCard)
            .join("") || '<p class="muted">予定なし</p>'
        }${
          data.showBands
            ? data.facilities
                .filter((f) => f.band)
                .map(
                  (f) =>
                    `<p class="tag">${esc(f.title)} ${esc(facilityHours(f, day) || "休業")}</p>`,
                )
                .join("")
            : ""
        }</section>`;
      },
    ).join("")}</div></div>`;
  } else {
    const first = selectedDay.slice(0, 7) + "-01",
      start = addDay(first, 1 - weekDay(first));
    content = `<section class="card"><h2>${selectedDay.slice(0, 7)}</h2><div class="calendar">${[..."月火水木金土日"].map((d) => `<div class="muted">${d}</div>`).join("")}${Array.from(
      { length: 42 },
      (_, i) => {
        const day = addDay(start, i),
          a = "day-" + day;
        action(a, () => {
          selectedDay = day;
          view = "day";
          render();
        });
        return `<button data-action="${a}" class="${day === dayKey() ? "today" : ""}" aria-label="${day}の予定">${Number(day.slice(-2))}${all
          .filter((e) => onDay(e, day))
          .slice(0, 3)
          .map((e) => `<span class="eventdot">${esc(e.title)}</span>`)
          .join("")}</button>`;
      },
    ).join("")}</div></section>`;
  }
  const courses = data.imports.flatMap((p) => p.courses);
  page.innerHTML =
    heading(
      "時間割",
      "MY TIMETABLE",
      btn("PDF取込", "import") +
        btn("＋ 予定", "event-new", "primary") +
        (data.eventDraft ? btn("予定の下書きを再開", "event-resume") : ""),
    ) +
    `<div class="toolbar">${btn("‹", "prev-date")}<input type="date" id="selected-day" value="${selectedDay}" aria-label="表示日">${btn("›", "next-date")}${btn("今日", "today")}<div class="seg">${["day", "week", "month"].map((v, i) => btn(["日", "週", "月"][i], "view-" + v, v === view ? "selected" : "")).join("")}</div></div>${content}<section class="section card"><h2>登録した講義 <span class="tag">${courses.length}</span></h2><p class="muted">講義を開くと関連記事の絞り込みへ進めます。</p><div class="row">${courses.map((c) => `<button data-course="${esc(c.id)}">${esc(c.title)} <small>${c.weekday ? "月火水木金土"[c.weekday - 1] + " " + ((c.block ?? 0) * 2 + 1) + "・" + ((c.block ?? 0) * 2 + 2) + "時限" : "時間未定"}</small></button>`).join("") || '<p class="muted">PDFを取り込むと講義が表示されます。</p>'}</div></section><details class="section card"><summary>取消・個人修正の管理</summary>${
      [...data.courseEdits, ...data.occurrenceEdits]
        .map((x) => {
          const a = "reset-" + x.id;
          action(a, () => {
            data.courseEdits = data.courseEdits.filter((e) => e.id !== x.id);
            data.occurrenceEdits = data.occurrenceEdits.filter(
              (e) => e.id !== x.id,
            );
            changed();
            render();
          });
          return `<p>${esc(x.title || x.id)} ${x.cancelled ? "取消" : ""} ${btn("修正を解除", a, "smallbtn")}</p>`;
        })
        .join("") || "<p>個人修正はありません。</p>"
    }</details>`;
  page.querySelector("#selected-day")?.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (value) {
      selectedDay = value;
      render();
    }
  });
  page.querySelectorAll<HTMLElement>("[data-course]").forEach(
    (b) =>
      (b.onclick = () => {
        articleFilters.courseId = b.dataset.course!;
        location.hash = "articles";
      }),
  );
}
function modal(
  title: string,
  content: string,
  submit?: (form: HTMLFormElement) => Promise<void> | void,
  submitText = "保存",
) {
  if (dialog) {
    dialog.close();
    dialog.remove();
  }
  dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = `<form><div class="row between"><h2>${esc(title)}</h2><button type="button" data-close aria-label="閉じる">×</button></div>${content}<div role="alert" class="modal-error error notice" hidden></div><div class="footer"><button type="button" data-close>閉じる</button>${submit ? `<button class="primary" type="submit">${esc(submitText)}</button>` : ""}</div></form>`;
  document.body.append(dialog);
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => dialog?.close()));
  const current = dialog;
  current.addEventListener("close", () => {
    current.remove();
    if (dialog === current) dialog = undefined;
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
      try {
        await submit(form);
      } catch (e) {
        const box = form.querySelector<HTMLElement>(".modal-error")!;
        box.hidden = false;
        box.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        button.disabled = false;
        form.inert = false;
      }
    };
  dialog.showModal();
  return dialog;
}
const val = (f: HTMLFormElement, key: string) =>
  String(new FormData(f).get(key) ?? "");
function dateTimeValue(iso: string) {
  return dayKey(new Date(iso)) + "T" + timeLabel(iso);
}
function editEvent(event?: CampusEvent, resume = false) {
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
      start: tokyo(selectedDay, "09:00"),
      end: tokyo(selectedDay, "10:00"),
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
      if (start >= end) throw Error("終了は開始より後にしてください。");
      if (existing) {
        const scope = val(form, "scope"),
          edits = scope === "course" ? data.courseEdits : data.occurrenceEdits,
          id = scope === "course" ? cid! : e.id;
        const x: Edit = {
          id,
          title: val(form, "title"),
          location: val(form, "location"),
          start,
          end,
          allDay: new FormData(form).has("allDay"),
          cancelled: new FormData(form).has("cancelled"),
        };
        const index = edits.findIndex((x) => x.id === id);
        if (index < 0) edits.push(x);
        else edits[index] = x;
      } else
        data.addedEvents.push({
          ...e,
          title: val(form, "title"),
          location: val(form, "location"),
          start,
          end,
          allDay: new FormData(form).has("allDay"),
        });
      delete data.eventDraft;
      changed();
      if (!(await save()))
        throw Error("保存に失敗しました。入力は保持しています。");
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
    d.close();
    location.hash = "more";
    setTimeout(() => openMap(room), 0);
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
async function openImport() {
  const d = modal(
    "PDFから時間割を取り込む",
    `<p>既知の後期「履修登録確認票」と通常課程「年間行事予定表」の文字を含む原本が対象です。PDFはこのブラウザ内だけで解析します。</p><label>履修登録確認票<input name="registration" type="file" accept="application/pdf,.pdf" required></label><label>年間行事予定表<input name="annual" type="file" accept="application/pdf,.pdf" required></label><p class="muted">前期・夜間主・画像PDF・未知形式は未対応です。取込前に差分と個人修正の競合を確認します。</p>`,
    async (form) => {
      const r = (form.elements.namedItem("registration") as HTMLInputElement)
          .files?.[0],
        a = (form.elements.namedItem("annual") as HTMLInputElement).files?.[0];
      if (!r || !a) throw Error("2つのPDFを選択してください。");
      busy++;
      try {
        const { previewPDF } = await import("./pdf");
        const p = await previewPDF(r, a);
        d.close();
        showImport(p);
      } finally {
        busy--;
      }
    },
    "解析して差分を確認",
  );
}
function showImport(p: Plan) {
  const diffs = difference(data, p),
    d = modal(
      "取込内容の確認",
      `<p>${p.year}年度 後期 · 講義 ${p.courses.length}件 · 予定 ${p.events.length}件 · 差分 ${diffs.length}件</p>${p.warnings.map((s) => `<p class="muted">${esc(s)}</p>`).join("")}<div class="stack">${
        diffs
          .map(
            (x) =>
              `<div class="card"><span class="tag">${x.before ? (x.after ? "変更" : "削除") : "追加"}</span><b> ${esc((x.after ?? x.before)!.title)}</b><p class="muted">${esc(x.before ? dayKey(new Date(x.before.start)) + " " + timeLabel(x.before.start) + " " + x.before.location : "新規")} → ${esc(x.after ? dayKey(new Date(x.after.start)) + " " + timeLabel(x.after.start) + " " + x.after.location : "原本から削除")}</p>${
                x.conflict
                  ? choice(
                      x.id,
                      "個人修正と競合しています",
                      [
                        ["", "選択してください"],
                        ["personal", "個人修正を保持"],
                        ["pdf", "PDF原本を採用"],
                      ],
                      "",
                    )
                  : ""
              }</div>`,
          )
          .join("") || empty("原本の変更はありません。")
      }</div>`,
      async (form) => {
        const choices: Record<string, "personal" | "pdf"> = {};
        for (const x of diffs.filter((x) => x.conflict)) {
          const value = val(form, x.id);
          if (value !== "personal" && value !== "pdf")
            throw Error("競合をすべて選択してください。");
          choices[x.id] = value;
        }
        data = install(data, p, choices);
        changed();
        if (!(await save()))
          throw Error("保存に失敗しました。差分は保持しています。");
        d.close();
        render();
      },
      "この内容を保存",
    );
}
function noteCard(n: Note) {
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
function renderNotes() {
  action("note-new", () => {
    const n: Note = {
      id: uid(),
      text: "",
      color: "default",
      modified: new Date().toISOString(),
      images: [],
      checklist: [],
    };
    data.notes.unshift(n);
    changed();
    editNote(n.id);
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
async function imageData(file: File): Promise<string> {
  if (file.size > 40 * 1024 * 1024)
    throw Error("画像は40MB以内で選択してください。");
  if (
    !/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type) &&
    !/\.(heic|heif)$/i.test(file.name)
  )
    throw Error("PNG・JPEG・WebP、対応ブラウザのHEICを選択してください。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw Error(
        "このブラウザでは画像を読み取れません。HEICはJPEG・PNGに変換して選択してください。",
      );
    });
    if (!img.width || !img.height || img.width > 20000 || img.height > 20000)
      throw Error("画像のサイズが対応範囲外です。");
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
function editNote(id: string) {
  const n = data.notes.find((n) => n.id === id)!;
  const d = modal(
    "メモ",
    textfield("text", "メモ", n.text) +
      choice(
        "color",
        "色",
        [
          ["default", "標準"],
          ["yellow", "イエロー"],
          ["green", "グリーン"],
          ["pink", "ピンク"],
          ["blue", "ブルー"],
        ],
        n.color,
      ) +
      `<label class="check"><input name="pin" type="checkbox" ${data.pinned.includes(id) ? "checked" : ""}>ホームに固定</label><div class="checks stack"></div><button type="button" id="add-check">＋ チェック項目</button><div class="thumbs attachments"></div><label>画像を追加<input id="note-images" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" multiple></label><p class="muted">画像は端末内だけに保存します。HEICはブラウザ対応によりJPEG/PNGへの変換が必要です。入力は自動保存します。</p><button type="button" id="delete-note" class="danger">このメモを削除</button>`,
    async () => {
      if (!(await save())) throw Error("保存に失敗しました。");
      d.close();
      render();
    },
    "保存して閉じる",
  );
  d.dataset.draft = "true";
  const touch = () => {
    n.modified = new Date().toISOString();
    changed();
  };
  d.querySelector("[name=text]")!.addEventListener("input", (e) => {
    n.text = (e.target as HTMLTextAreaElement).value;
    touch();
  });
  d.querySelector("[name=color]")!.addEventListener("change", (e) => {
    n.color = (e.target as HTMLSelectElement).value;
    touch();
  });
  d.querySelector("[name=pin]")!.addEventListener("change", (e) => {
    data.pinned = data.pinned.filter((x) => x !== id);
    if ((e.target as HTMLInputElement).checked) data.pinned.push(id);
    touch();
  });
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
    busy++;
    try {
      for (const f of (e.target as HTMLInputElement).files ?? []) {
        n.images.push({ id: uid(), data: await imageData(f) });
        touch();
      }
      images();
    } catch (e) {
      error(e);
    } finally {
      busy--;
    }
  };
  d.querySelector<HTMLButtonElement>("#delete-note")!.onclick = () => {
    if (!confirm("このメモを削除しますか？")) return;
    data.notes = data.notes.filter((n) => n.id !== id);
    data.pinned = data.pinned.filter((x) => x !== id);
    changed();
    d.close();
    render();
  };
  d.addEventListener("close", () => render());
}
const articleFilters = {
  q: "",
  category: "",
  courseId: "",
  authorId: "",
  bookmarked: "",
};
let priorFilters: typeof articleFilters | undefined,
  articles: Article[] = [],
  nextCursor: string | null = null,
  articleLoading = false,
  articleError = "",
  articleRequest = 0,
  articleFetched = "",
  lastFilterKey = "",
  searchTimer: ReturnType<typeof setTimeout> | undefined;
function articleKey() {
  return JSON.stringify(articleFilters);
}
async function loadArticles(more = false) {
  const key = articleKey(),
    request = ++articleRequest;
  articleLoading = true;
  articleError = "";
  if (!more && key !== lastFilterKey) {
    articles = [];
    articleFetched = "";
  }
  lastFilterKey = key;
  updateArticleList();
  try {
    if (articleFilters.bookmarked) user = await session();
    const params = new URLSearchParams(
      Object.entries(articleFilters).filter(([, v]) => v),
    );
    params.set("limit", "20");
    if (more && nextCursor) params.set("cursor", nextCursor);
    const result = await api<{
      articles: Article[];
      nextCursor: string | null;
    }>("/articles?" + params);
    if (request !== articleRequest) return;
    articles = more ? [...articles, ...result.articles] : result.articles;
    nextCursor = result.nextCursor;
    articleFetched = new Date().toISOString();
  } catch (e) {
    if (request !== articleRequest) return;
    articleError = e instanceof Error ? e.message : String(e);
  } finally {
    if (request === articleRequest) {
      articleLoading = false;
      updateArticleList();
    }
  }
}
function articleCard(a: Article) {
  action("article-" + a.id, () => (location.hash = "articles/" + a.id));
  action("author-" + a.id, () => filterAuthor(a.authorId));
  return `<article class="card"><div class="row between"><span class="tag">${esc(a.category || "未分類")}</span>${a.bookmarked ? '<span class="pin" aria-label="ブックマーク済み">◆</span>' : ""}</div><h3 style="margin-top:14px"><button class="article-title" data-action="article-${esc(a.id)}">${esc(a.title)}</button></h3><p class="muted">${esc(a.summary)}</p><button class="author" data-action="author-${esc(a.id)}">${esc(a.authorName || "匿名ユーザー")}</button><div class="stats"><span>閲覧 ${esc(a.viewCount)}</span><span>ブックマーク ${esc(a.bookmarkCount)}</span></div></article>`;
}
function filterAuthor(id: string) {
  priorFilters = { ...articleFilters };
  articleFilters.authorId = id;
  articleFilters.bookmarked = "";
  render();
}
function updateArticleList() {
  const el = page.querySelector("#article-list");
  if (!el || route() !== "articles" || location.hash.split("/")[1]) return;
  el.innerHTML = `${articleError ? `<div class="notice error" role="alert">取得できませんでした。${esc(articleError)} ${btn("再試行", "articles-retry", "smallbtn")}</div>` : ""}${articleError && articles.length ? `<p class="muted">前回取得 ${esc(new Date(articleFetched).toLocaleString("ja-JP"))} の値です。最新の集計は未取得です。</p>` : ""}${articleLoading ? '<p role="status" class="progress">記事を取得しています…</p>' : ""}<div class="cards">${articles.map(articleCard).join("") || (!articleLoading && !articleError ? empty(articleFilters.bookmarked ? "ブックマークはまだありません。" : Object.values(articleFilters).some(Boolean) ? "条件に一致する記事はありません。" : "記事はまだありません。Notionの公開ページを登録できます。") : "")}</div>${nextCursor ? `<div class="toolbar">${btn("さらに読み込む", "articles-more")}</div>` : ""}`;
  action("articles-retry", () => loadArticles());
  action("articles-more", () => loadArticles(true));
}
function renderArticles() {
  const id = location.hash.split("/")[1];
  if (id) {
    void renderArticleDetail(id);
    return;
  }
  action("article-new", () => articleForm());
  action("author-back", () => {
    if (priorFilters) Object.assign(articleFilters, priorFilters);
    else articleFilters.authorId = "";
    priorFilters = undefined;
    render();
  });
  const courses = data.imports.flatMap((p) => p.courses);
  page.innerHTML =
    heading(
      "記事",
      "CAMPUS READING",
      btn("＋ Notion記事を登録", "article-new", "primary"),
    ) +
    `<p class="muted">Notionで公開されたページを共有。本文はNotionから表示します。</p>${articleFilters.authorId ? `<div class="notice">投稿者で絞り込み中（ID: ${esc(articleFilters.authorId.slice(0, 12))}…） ${btn("元の検索へ戻る", "author-back", "smallbtn")}</div>` : ""}<div class="filters stack"><div class="row"><input id="article-query" type="search" placeholder="タイトル・紹介文で検索" value="${esc(articleFilters.q)}" aria-label="記事検索"><select id="article-category" aria-label="カテゴリ">${[["", "カテゴリすべて"], ["授業", "授業"], ["学生生活", "学生生活"], ["学習", "学習"], ["その他", "その他"], ...(articleFilters.category && !["授業", "学生生活", "学習", "その他"].includes(articleFilters.category) ? [[articleFilters.category, articleFilters.category]] : [])].map(([v, l]) => `<option value="${esc(v)}" ${v === articleFilters.category ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><select id="article-course" aria-label="講義">${[["", "講義すべて"], ...courses.map((c) => [c.id, c.title])].map(([v, l]) => `<option value="${esc(v)}" ${v === articleFilters.courseId ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div><div class="seg">${btn("すべて", "articles-all", !articleFilters.bookmarked ? "selected" : "")}${btn("ブックマーク", "articles-bookmarks", articleFilters.bookmarked ? "selected" : "")}</div></div><div id="article-list"></div>`;
  action("articles-all", () => {
    articleFilters.bookmarked = "";
    render();
  });
  action("articles-bookmarks", () => {
    articleFilters.bookmarked = "1";
    render();
  });
  page.querySelector<HTMLInputElement>("#article-query")!.oninput = (e) => {
    articleFilters.q = (e.target as HTMLInputElement).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadArticles(), 350);
  };
  page.querySelector<HTMLSelectElement>("#article-category")!.onchange = (
    e,
  ) => {
    articleFilters.category = (e.target as HTMLSelectElement).value;
    void loadArticles();
  };
  page.querySelector<HTMLSelectElement>("#article-course")!.onchange = (e) => {
    articleFilters.courseId = (e.target as HTMLSelectElement).value;
    void loadArticles();
  };
  updateArticleList();
  void loadArticles();
}
async function renderArticleDetail(id: string) {
  page.innerHTML =
    heading("記事を開いています") + '<p role="status">読み込み中…</p>';
  let a: Article;
  try {
    user = await session();
    a = (await api<{ article: Article }>("/articles/" + encodeURIComponent(id)))
      .article;
  } catch (e) {
    if (location.hash !== "#articles/" + id) return;
    page.innerHTML =
      heading("記事を表示できません") +
      `<div class="notice error" role="alert">${esc(e instanceof Error ? e.message : e)}<p>記事が削除されたか、通信できない可能性があります。</p></div><a href="#articles">記事一覧へ戻る</a>`;
    return;
  }
  if (location.hash !== "#articles/" + id) return;
  const draw = () => {
    action("detail-bookmark", async () => {
      const b = page.querySelector<HTMLButtonElement>(
        "[data-action=detail-bookmark]",
      );
      if (b) b.disabled = true;
      busy++;
      try {
        user = await session();
        const result = await api<{
          bookmarked: boolean;
          bookmarkCount: number;
        }>(
          "/articles/" + encodeURIComponent(id) + "/bookmark",
          a.bookmarked ? "DELETE" : "PUT",
          a.bookmarked ? undefined : {},
        );
        a.bookmarked = result.bookmarked;
        a.bookmarkCount = result.bookmarkCount;
        draw();
      } catch (e) {
        error(e);
        if (b) b.disabled = false;
      } finally {
        busy--;
      }
    });
    action("detail-author", () => {
      location.hash = "articles";
      filterAuthor(a.authorId);
    });
    action("detail-edit", () => articleForm(a));
    action("detail-delete", async () => {
      if (
        !confirm("登録した記事情報を削除しますか？Notion本文は削除されません。")
      )
        return;
      busy++;
      try {
        await api("/articles/" + encodeURIComponent(id), "DELETE");
        location.hash = "articles";
      } catch (e) {
        error(e);
      } finally {
        busy--;
      }
    });
    action("frame-retry", () => {
      const frame = page.querySelector<HTMLIFrameElement>("iframe");
      if (frame) frame.src = frame.src;
    });
    let publicURL = "",
      embedURL = "";
    try {
      publicURL = notionURL(a.publicUrl);
      embedURL = a.embedUrl ? notionURL(a.embedUrl) : "";
    } catch {
      error(Error("保存されたNotion URLを安全に表示できません。"));
    }
    page.innerHTML =
      heading(a.title, "NOTION ARTICLE") +
      `<div class="row"><a href="#articles">‹ 元の一覧・検索へ</a><span class="tag">${esc(a.category || "未分類")}</span></div><section class="card section"><p>${esc(a.summary)}</p><div class="row between"><button class="author" data-action="detail-author">${esc(a.authorName)}</button>${btn(a.bookmarked ? "◆ ブックマーク解除" : "◇ ブックマーク", "detail-bookmark", "primary")}</div><div class="stats"><span>閲覧 <span class="count">${esc(a.viewCount)}</span></span><span>ブックマーク <span class="count">${esc(a.bookmarkCount)}</span></span></div><p class="muted">閲覧はこのアプリ内で開いた記録（日本時間1日1回）。保存は匿名ブラウザID単位の件数です。</p>${a.canEdit ? `<hr><div class="row">${btn("登録情報を編集", "detail-edit")}${btn("登録を削除", "detail-delete", "danger")}</div>` : ""}</section><div class="notice"><p>${navigator.onLine ? "Notionの読込には通信が必要です。公開・表示できるかをここで確認してください。" : "オフラインです。通信が戻ってから再読み込みしてください。"}</p><div class="row">${embedURL ? btn("再読み込み", "frame-retry") : ""}${publicURL ? `<a href="${esc(publicURL)}" target="_blank" rel="noopener noreferrer">Notionで開く ↗</a>` : ""}</div><p class="muted">非公開化・削除・表示制限で読めない場合は元ページを開いてください。読込完了イベントから公開状態は判定しません。</p></div>${embedURL ? `<iframe class="article-frame" title="${esc(a.title)} — Notion本文" src="${esc(embedURL)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen"></iframe>` : empty("公式埋め込みURLが未登録です。「Notionで開く」から本文を読めます。")}`;
  };
  draw();
  try {
    const value = await api<{ viewCount: number }>(
      "/articles/" + encodeURIComponent(id) + "/view",
      "POST",
      {},
    );
    a.viewCount = value.viewCount;
    if (location.hash === "#articles/" + id) draw();
  } catch (e) {
    error(
      Error(
        "閲覧記録を送信できませんでした。表示中の件数は前回取得値です。" +
          (e instanceof Error ? e.message : ""),
      ),
    );
  }
}
const anonymousNotice =
  "このブラウザの匿名ユーザーとして保存・投稿します。別ブラウザ・別端末は別ユーザーです。ブラウザデータやセッションを消すと、以前の保存と投稿の編集権限は復元できません。";
function articleForm(article?: Article) {
  const kind = article?.id ?? "new";
  if (
    data.articleDraft.kind !== kind &&
    Object.values(data.articleDraft).some(Boolean) &&
    !confirm("保存中の別の登録下書きがあります。新しい入力に切り替えますか？")
  )
    return;
  if (data.articleDraft.kind !== kind) {
    data.articleDraft = {
      kind,
      title: article?.title ?? "",
      publicUrl: article?.publicUrl ?? "",
      embedUrl: article?.embedUrl ?? "",
      summary: article?.summary ?? "",
      category: article?.category ?? "",
      courseId: article?.courseId ?? "",
      key: uid(),
    };
    changed();
  }
  const draft = data.articleDraft;
  const d = modal(
    article ? "記事の登録情報を編集" : "Notion記事を登録",
    `<p class="muted">${anonymousNotice}</p>${field("title", "タイトル", draft.title, "text", 'required maxlength="120"')}${field("publicUrl", "Notionの公開URL", draft.publicUrl, "url", "required")}<p class="muted">HTTPSの notion.site / notion.so とそのサブドメインが対象です。独自ドメインは未対応です。</p>${textfield("summary", "紹介文（280字まで）", draft.summary, 280)}${field("category", "カテゴリ", draft.category, "text", 'maxlength="40"')}${choice("courseId", "関連する講義", [["", "指定なし"], ...data.imports.flatMap((p) => p.courses).map((c) => [c.id, c.title] as [string, string])], draft.courseId)}<section class="card"><h3>公式の埋め込みURL・コード（任意）</h3><p class="muted">Notionの公開ページで「このページを埋め込む」から取得したiframeコード、またはそのsrcを入力してください。HTML自体は実行しません。通常URLからの変換は行いません。</p>${textfield("embedUrl", "埋め込みコードまたはURL", draft.embedUrl, 4000)}</section><button type="button" id="preview-article">プレビューを確認</button><div id="article-preview"></div><label class="check"><input name="confirmed" type="checkbox" required>元ページ・プレビューがログイン不要で読めることを確認しました</label>`,
    async (form) => {
      if (composing) throw Error("文字変換を確定してください。");
      const title = val(form, "title").trim();
      if (!title || Array.from(title).length > 120)
        throw Error("タイトルは1〜120字です。");
      const body = {
        title,
        publicUrl: notionURL(val(form, "publicUrl")),
        embedUrl: embedSource(val(form, "embedUrl")),
        summary: val(form, "summary").trim(),
        category: val(form, "category").trim(),
        courseId: val(form, "courseId"),
      };
      if (Array.from(body.summary).length > 280)
        throw Error("紹介文は280字以内です。");
      busy++;
      try {
        user = await session();
        const result = await api<{ article: Article }>(
          "/articles" + (article ? "/" + encodeURIComponent(article.id) : ""),
          article ? "PATCH" : "POST",
          body,
          article ? {} : { "Idempotency-Key": draft.key },
        );
        data.articleDraft = {};
        changed();
        await save();
        d.close();
        location.hash = "articles/" + result.article.id;
      } finally {
        busy--;
      }
    },
    article ? "変更を保存" : "登録",
  );
  d.dataset.draft = "true";
  d.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[name]").forEach((input) => {
    if (input.name === "confirmed") return;
    input.addEventListener("input", () => {
      draft[input.name] = input.value;
      const confirmed = d.querySelector<HTMLInputElement>("[name=confirmed]");
      if (confirmed) confirmed.checked = false;
      changed();
    });
  });
  d.querySelector<HTMLButtonElement>("#preview-article")!.onclick = () => {
    const f = d.querySelector("form")!;
    try {
      const publicURL = notionURL(val(f, "publicUrl")),
        embed = embedSource(val(f, "embedUrl"));
      d.querySelector("#article-preview")!.innerHTML =
        `<div class="notice"><p>実際の公開状態はご本人が確認してください。</p><a href="${esc(publicURL)}" target="_blank" rel="noopener noreferrer">元ページを開いて確認 ↗</a></div>${embed ? `<iframe title="Notion記事の投稿前プレビュー" class="article-frame" src="${esc(embed)}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>` : empty("埋め込みURLが未入力です。元ページを開いて確認できます。")}`;
    } catch (e) {
      const box = d.querySelector<HTMLElement>(".modal-error")!;
      box.hidden = false;
      box.textContent = e instanceof Error ? e.message : String(e);
    }
  };
}
function renderMore() {
  action("map", () => openMap());
  action("facilities", () => editFacilities());
  action("links", () => editLinks());
  action("manual-save", save);
  action("export-data", exportData);
  action("check-update", () => updates.check());
  action("clear-bg", () => {
    data.background = "";
    changed();
    theme();
  });
  action("profile", async () => {
    try {
      user = await session();
      const d = modal(
        "表示名",
        field(
          "displayName",
          "記事に表示する名前",
          user.displayName,
          "text",
          'required maxlength="40"',
        ) +
          `<p class="muted">同じ表示名でもユーザーIDが違えば別の投稿者です。</p>`,
        async (f) => {
          user = (
            await api<{ user: User }>("/session", "PATCH", {
              displayName: val(f, "displayName"),
            })
          ).user;
          d.close();
          render();
        },
      );
    } catch (e) {
      error(e);
    }
  });
  page.innerHTML =
    heading("その他", "CAMPUS & SETTINGS") +
    `<div class="cards"><section class="card"><h2>キャンパスマップ</h2><p class="muted">建物・登録済み教室を検索。地図はオフラインでも利用できます。</p>${btn("教室・建物を探す", "map", "primary")}</section><section class="card"><h2>施設の営業時間</h2><p class="muted">通常期の目安・2026-10-07掲載情報を移植。曜日別時間と臨時の個人設定を変更できます。</p>${btn("施設を管理", "facilities")}</section><section class="card"><h2>リンク</h2><div class="stack">${data.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.favorite ? "★ " : ""}${esc(l.title)} ↗</a>`).join("")}</div><hr>${btn("リンクとお気に入りを編集", "links")}</section><section class="card stack"><h2>外観</h2>${choice(
      "theme",
      "テーマ",
      [
        ["green", "グリーン"],
        ["blue", "ブルー"],
        ["rose", "ローズ"],
        ["mono", "モノトーン"],
      ],
      data.theme,
    )}<label>背景画像<input id="background" type="file" accept="image/png,image/jpeg,image/webp,image/heic,.heic"></label>${btn("背景を解除", "clear-bg")}<p class="muted">背景画像はこのブラウザに保存します。</p></section><section class="card stack"><h2>時間割の表示</h2>${field("startHour", "表示開始時刻", String(data.startHour), "number", 'min="0" max="23"')}${field("endHour", "表示終了時刻", String(data.endHour), "number", 'min="1" max="24"')}<label class="check"><input name="bands" type="checkbox" ${data.showBands ? "checked" : ""}>営業時間の帯を表示</label><p class="muted">表示時間外の予定も日・週の一覧で確認できます。</p></section><section class="card"><h2>匿名ユーザー</h2><p>${esc(user?.displayName ?? "このブラウザで自動準備")}</p><p class="muted">${anonymousNotice}</p>${btn("表示名を設定", "profile")}</section><section class="card"><h2>このアプリの更新</h2><p class="muted">この画面のビルド ${esc(__APP_BUILD_ID__)}</p><div id="version" class="muted">配信情報を読み込み中…</div><div class="toolbar">${btn("更新を確認", "check-update")}</div><p class="muted">更新は全タブの保存成功後に適用します。変換・取込・保存失敗時は切り替えません。</p><details><summary>インストールする</summary><p>Android/PC: ブラウザのメニューから「アプリをインストール」「ホーム画面に追加」を選択。iPhone: Safariの共有から「ホーム画面に追加」を選択してください。HTTPSの公開URLで利用できます。</p></details></section><section class="card"><h2>端末内データ</h2><p class="muted">予定・メモ・画像・背景はIndexedDBに保存。初回は新規データで始まり、Swift版のデータは取り込みません。外部カレンダー接続は初回対象外です。</p><div class="toolbar">${btn("今すぐ保存", "manual-save")}${btn("入力データを書き出す", "export-data")}</div><p class="muted">別タブとの保存競合時は、現在の入力を書き出してから再読み込みできます。書き出しにはメモ・画像も含まれます。</p></section></div>`;
  page.querySelector<HTMLSelectElement>("[name=theme]")!.onchange = (e) => {
    data.theme = (e.target as HTMLSelectElement).value;
    changed();
    theme();
  };
  for (const name of ["startHour", "endHour"] as const)
    page.querySelector<HTMLInputElement>(`[name=${name}]`)!.onchange = (e) => {
      const value = Number((e.target as HTMLInputElement).value),
        start = name === "startHour" ? value : data.startHour,
        end = name === "endHour" ? value : data.endHour;
      if (!Number.isInteger(value) || start < 0 || end > 24 || start >= end) {
        error(Error("表示時間は0〜24時で、終了を開始より後にしてください。"));
        return;
      }
      data[name] = value;
      changed();
    };
  page.querySelector<HTMLInputElement>("[name=bands]")!.onchange = (e) => {
    data.showBands = (e.target as HTMLInputElement).checked;
    changed();
  };
  page.querySelector<HTMLInputElement>("#background")!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    busy++;
    try {
      data.background = await imageData(f);
      changed();
      theme();
    } catch (e) {
      error(e);
    } finally {
      busy--;
    }
  };
  void fetch("/version.json", { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => {
      const el = page.querySelector("#version");
      if (el)
        el.innerHTML = `<p>配信中のビルド ${esc(v.id)} · ${esc(v.builtAt)}</p>${Array.isArray(v.changes) ? "<ul>" + v.changes.map((s: string) => `<li>${esc(s)}</li>`).join("") + "</ul>" : ""}`;
    })
    .catch(() => {
      const el = page.querySelector("#version");
      if (el) el.textContent = "開発中、またはビルド情報を取得できません。";
    });
}
function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "shizudai-pocket-" + dayKey() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openMap(room = "") {
  const resolved = resolveRoom(room);
  let selected = resolved.ids[0] ?? "",
    query = room;
  const d = modal(
    "浜松キャンパスの教室・建物",
    `<label>建物・登録済み教室を検索<input id="map-query" type="search" value="${esc(query)}" placeholder="例: 情1、登録済み教室"></label><p class="muted" id="resolution"></p><div class="building-list"></div><div class="mapwrap"><img src="/campus-map.png" alt="浜松キャンパス北向き概略地図"><svg viewBox="${catalog.viewBox.join(" ")}" aria-label="選択した建物の位置" role="img"></svg></div><div id="building-info"></div><p class="muted">${esc(catalog.accuracy)} · 出典日 ${catalog.sourceDate}。不明な教室から建物を推測しません。</p>`,
  );
  const draw = () => {
    const b = catalog.buildings.find((b) => b.id === selected),
      matches = searchBuildings(query);
    d.querySelector(".building-list")!.innerHTML =
      matches
        .map(
          (b) =>
            `<button type="button" data-building="${b.id}" class="${b.id === selected ? "primary" : ""}">${esc(b.name)} <small>${esc(b.category)}</small></button>`,
        )
        .join("") || empty("該当する建物はありません。");
    const r = resolveRoom(query);
    d.querySelector("#resolution")!.textContent = query
      ? ({
          matched: "登録済み教室・建物に一致しました。",
          ambiguous: "複数候補があります。建物を選択してください。",
          missing: "",
          online: "オンラインの予定です。地図上の教室はありません。",
          unknown: "教室は未登録です。下の建物名・別名で検索できます。",
        }[r.kind] ?? "")
      : "";
    d.querySelector("svg")!.innerHTML = b
      ? `${b.mapPolygon.length ? `<polygon points="${b.mapPolygon.map((p) => p.join(",")).join(" ")}"/>` : ""}<circle cx="${b.mapCenter[0]}" cy="${b.mapCenter[1]}" r="13"/>`
      : "";
    d.querySelector("#building-info")!.innerHTML = b
      ? `<div class="notice"><b>${esc(b.name)}</b><p class="muted">${esc(b.aliases.join(" / "))}</p></div>`
      : "";
    d.querySelectorAll<HTMLButtonElement>("[data-building]").forEach(
      (el) =>
        (el.onclick = () => {
          selected = el.dataset.building!;
          draw();
        }),
    );
  };
  draw();
  d.querySelector<HTMLInputElement>("#map-query")!.oninput = (e) => {
    query = (e.target as HTMLInputElement).value;
    const r = resolveRoom(query);
    selected = r.kind === "matched" ? r.ids[0] : "";
    draw();
  };
}
function editFacilities() {
  const d = modal(
    "施設の営業時間",
    `<p class="muted">空欄は休業。開始–終了 / 開始–終了（L.O.時刻）。通常期の目安を個人設定として変更できます。</p><div class="stack">${data.facilities
      .map(
        (f) =>
          `<section class="card"><h3>${esc(f.title)}</h3><a href="${esc(f.source)}" target="_blank" rel="noopener noreferrer">公式の営業案内 ↗</a><div class="stack">${[1, 2, 3, 4, 5, 6, 7].map((w) => field(f.id + "-" + w, "月火水木金土日"[w - 1] + "曜", f.weekdays[w] ?? "")).join("")}</div><hr>${field(f.id + "-day", "特定日の例外（日付）", "", "date")}${field(f.id + "-hours", "その日の時間（空欄は休業）")}<p class="muted">設定中の例外</p>${
            Object.entries(f.exceptions)
              .map(
                ([day, h]) =>
                  `<label class="check"><input name="${f.id}-remove-${day}" type="checkbox">${esc(day)} ${esc(h || "休業")} を解除</label>`,
              )
              .join("") || '<p class="muted">なし</p>'
          }<label class="check"><input name="${f.id}-band" type="checkbox" ${f.band ? "checked" : ""}>時間割に帯を表示</label></section>`,
      )
      .join("")}</div>`,
    async (form) => {
      const next: Facility[] = structuredClone(data.facilities);
      for (const f of next) {
        for (let w = 1; w <= 7; w++) {
          const h = val(form, f.id + "-" + w);
          parseHours(h);
          f.weekdays[w] = h;
        }
        for (const day of Object.keys(f.exceptions))
          if (new FormData(form).has(f.id + "-remove-" + day))
            delete f.exceptions[day];
        const day = val(form, f.id + "-day"),
          hours = val(form, f.id + "-hours");
        if (day) {
          parseHours(hours);
          f.exceptions[day] = hours;
        }
        f.band = new FormData(form).has(f.id + "-band");
      }
      data.facilities = next;
      changed();
      if (!(await save())) throw Error("保存に失敗しました。");
      d.close();
      render();
    },
  );
}
function safeLink(s: string) {
  const u = new URL(s.trim());
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("認証情報を含まないHTTPS URLを指定してください。");
  return u.href;
}
function editLinks() {
  const draft = structuredClone(data.links);
  const d = modal(
    "リンク・お気に入り",
    `<div id="link-rows" class="stack"></div><button type="button" id="add-link">＋ リンク</button>`,
    async () => {
      for (const l of draft) {
        if (!l.title.trim()) throw Error("リンク名を入力してください。");
        l.url = safeLink(l.url);
      }
      data.links = draft;
      changed();
      if (!(await save())) throw Error("保存に失敗しました。");
      d.close();
      render();
    },
  );
  const draw = () => {
    d.querySelector("#link-rows")!.innerHTML = draft
      .map(
        (l) =>
          `<section class="card stack">${field("title-" + l.id, "リンク名", l.title)}${field("url-" + l.id, "URL", l.url, "url")}<label class="check"><input data-favorite="${l.id}" type="checkbox" ${l.favorite ? "checked" : ""}>ホームのお気に入り</label><div class="row"><button type="button" data-up-link="${l.id}" aria-label="${esc(l.title)}を上へ">↑</button><button type="button" data-down-link="${l.id}" aria-label="${esc(l.title)}を下へ">↓</button><button type="button" data-delete-link="${l.id}" class="danger">削除</button></div></section>`,
      )
      .join("");
    for (const l of draft) {
      for (const direction of ["up", "down"])
        d.querySelector<HTMLButtonElement>(
          `[data-${direction}-link="${l.id}"]`,
        )!.onclick = () => {
          const index = draft.indexOf(l),
            next = index + (direction === "up" ? -1 : 1);
          if (next >= 0 && next < draft.length) {
            draft.splice(index, 1);
            draft.splice(next, 0, l);
            draw();
          }
        };
      d.querySelector<HTMLInputElement>(`[name="title-${l.id}"]`)!.oninput = (
        e,
      ) => (l.title = (e.target as HTMLInputElement).value);
      d.querySelector<HTMLInputElement>(`[name="url-${l.id}"]`)!.oninput = (
        e,
      ) => (l.url = (e.target as HTMLInputElement).value);
      d.querySelector<HTMLInputElement>(`[data-favorite="${l.id}"]`)!.onchange =
        (e) => (l.favorite = (e.target as HTMLInputElement).checked);
      d.querySelector<HTMLButtonElement>(
        `[data-delete-link="${l.id}"]`,
      )!.onclick = () => {
        draft.splice(draft.indexOf(l), 1);
        draw();
      };
    }
  };
  draw();
  d.querySelector<HTMLButtonElement>("#add-link")!.onclick = () => {
    draft.push({ id: uid(), title: "", url: "https://", favorite: false });
    draw();
  };
}
root.innerHTML = `<div class="background"></div><header class="top"><a href="#home" class="brand mutedlink">▣ 静大ポケット</a><span class="online" id="connection"></span></header><div id="update" class="notice" role="status" hidden></div><div id="error" class="notice error" role="alert" hidden></div><div class="page"><div class="statusline row between"><span id="save-status">データを読み込んでいます…</span><button data-action="save-global" class="smallbtn">保存</button></div><main id="page"></main></div><nav class="nav" aria-label="メインナビゲーション">${[
  ["home", "⌂", "ホーム"],
  ["timetable", "▦", "時間割"],
  ["articles", "▤", "記事"],
  ["notes", "▧", "メモ"],
  ["more", "⋯", "その他"],
]
  .map(
    ([id, s, t]) =>
      `<a href="#${id}"><span class="symbol" aria-hidden="true">${s}</span>${t}</a>`,
  )
  .join("")}</nav>`;
page = root.querySelector("#page")!;
status = root.querySelector("#save-status")!;
errorBox = root.querySelector("#error")!;
updateBox = root.querySelector("#update")!;
root.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  if (!button || frozen) return;
  const key = button.dataset.action!;
  if (key === "save-global") {
    void save();
    return;
  }
  const fn = actions.get(key);
  if (fn) Promise.resolve().then(fn).catch(error);
});
document.addEventListener("compositionstart", () => (composing = true));
document.addEventListener("compositionend", () => (composing = false));
window.addEventListener("hashchange", () => {
  if (dialog) dialog.close();
  render();
});
window.addEventListener("beforeunload", (e) => {
  if (saves.dirty || busy) {
    e.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && saves.dirty) void save();
});
const connection = () => {
  root.querySelector("#connection")!.textContent = navigator.onLine
    ? "オンライン"
    : "オフライン · 個人データは利用可能";
};
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
connection();
let updates: ReturnType<typeof installUpdates>;
async function boot() {
  try {
    data = await store.open();
    statusText("このブラウザに保存済み");
  } catch (e) {
    loadFailed = true;
    error(e);
    statusText("保存データを保護中 · 再読み込みで再試行");
  }
  updates = installUpdates({
    prepare: async () => {
      if (dialog && dialog.dataset.draft !== "true")
        throw Error(
          "開いている編集画面を保存するか閉じてから更新してください。",
        );
      await flushOrThrow();
    },
    freeze: (v) => {
      frozen = v;
      root.inert = v;
      if (dialog) dialog.inert = v;
    },
    notice: (message, ready) => {
      updateBox.hidden = false;
      updateBox.innerHTML = `<p>${esc(message)}</p>${ready ? `<div class="row">${btn("保存して更新", "update", "primary")}${btn("あとで", "update-later")}</div>` : ""}`;
    },
    error,
  });
  render();
  if (loadFailed) {
    page.inert = true;
  }
  if (data.eventDraft) editEvent(undefined, true);
  try {
    user = (await api<{ user: User | null }>("/session")).user;
  } catch {
    /* Shared API availability never blocks personal features. */
  }
}
void boot();
