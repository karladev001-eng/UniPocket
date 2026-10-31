// Settings ("その他"): appearance, timetable display, facilities and links, profile,
// data export and the in-app update panel.
import { applyAppearance, modeOf } from "../appearance";
import { updatePresentation } from "../schedule-presentation";
import { backgrounds, visibleBackground, namedAuthor } from "../ui-assets";
import { type Facility, uid, parseHours } from "../domain";
import { api, session, type User } from "../api";
import { action, data, page, render, trackBusy, updates } from "../app/context";
import { changed, error, exportData, save } from "../app/status";
import { btn, choice, esc, field, heading } from "../ui/html";
import { imageData } from "../ui/image";
import { modal, val } from "../ui/modal";
import { openMap } from "./campus-map";
import { anonymousNotice, setUser, user } from "./articles";
// Background image decoding in flight (see trackBusy).
let busy = 0;
trackBusy(() => busy);
export function theme() {
  applyAppearance(data);
  const bg = document.querySelector<HTMLElement>(".background")!;
  const image = visibleBackground(data);
  bg.style.backgroundImage = image ? `url("${image}")` : "";
}
let updateState = { message: "更新を確認しています…", ready: false };
function renderUpdateState() {
  const box = page.querySelector<HTMLElement>("#more-update-state");
  if (!box) return;
  const state = updatePresentation(updateState.message, updateState.ready);
  box.innerHTML = `<p class="update-label" role="status">${esc(state.label)}</p>${state.detail ? `<p class="muted">${esc(state.detail)}</p>` : ""}<div class="update-actions">${btn("更新を確認", "check-update", "smallbtn")}${state.install ? btn("最新版をインストール", "update", "primary smallbtn") : ""}</div>`;
}
export function reportUpdateFailure(e: unknown) {
  updateState = {
    message:
      "更新できませんでした。通信・保存状態を確認して再試行してください。 " +
      (e instanceof Error ? e.message : String(e)),
    ready: false,
  };
  renderUpdateState();
}
export function noticeUpdate(message: string, ready: boolean) {
  updateState = { message, ready };
  renderUpdateState();
}
export function renderMore() {
  action("map", () => openMap());
  action("facilities", editFacilities);
  action("links", editLinks);
  action("export-data", exportData);
  action("check-update", () => updates.check());
  action("share-url", async () => {
    const url = location.origin + location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      const state = page.querySelector("#share-state");
      if (state) state.textContent = "URLをコピーしました。";
    } catch {
      const d = modal(
        "アプリのURL",
        field("share", "コピーして共有", url),
        undefined,
        "",
        { singleClose: true },
      );
      d.querySelector<HTMLInputElement>("input")?.select();
    }
  });
  action("clear-bg", () => {
    data.backgroundMode = "none";
    changed();
    render();
  });
  action("custom-bg", () => {
    data.backgroundMode = "custom";
    changed();
    render();
  });
  action("profile", async () => {
    try {
      const current = await session();
      setUser(current);
      const d = modal(
        "ユーザー名",
        field(
          "displayName",
          "記事に表示する名前",
          namedAuthor(current.displayName) ? current.displayName : "",
          "text",
          'required maxlength="40"',
        ) + `<p class="muted">${anonymousNotice}</p>`,
        async (f) => {
          setUser(
            (
              await api<{ user: User }>("/session", "PATCH", {
                displayName: val(f, "displayName"),
              })
            ).user,
          );
          d.close();
          render();
        },
      );
    } catch (e) {
      error(e);
    }
  });
  const backgroundName =
    backgrounds.find((b) => b.id === data.backgroundMode)?.name ||
    (data.backgroundMode !== "none" && data.background
      ? "自分の画像"
      : "背景なし");
  const activeCustom =
    data.backgroundMode === "custom" ||
    (!data.backgroundMode && !!data.background);
  page.innerHTML =
    heading("その他", "") +
    `<div class="settings-list"><a class="settings-row" href="#announcements"><strong>お知らせ・アンケート</strong><span aria-hidden="true">›</span></a></div><section class="settings-update"><h2>アプリの更新</h2><div id="more-update-state"></div></section><div class="settings-list">
    <details id="appearance-settings" class="setting"><summary><span>背景・テーマ<small>${modeOf(data) === "dark" ? "ダーク" : "ライト"} · ${esc(backgroundName)}</small></span><span aria-hidden="true">›</span></summary><div class="setting-content"><fieldset class="appearance-mode"><legend>明るさ</legend><div class="seg">${(
      [
        ["light", "ライト"],
        ["dark", "ダーク"],
      ] as const
    )
      .map(
        ([value, label]) =>
          `<label><input type="radio" name="colorMode" value="${value}" ${modeOf(data) === value ? "checked" : ""}><span><span aria-hidden="true" class="mode-check">✓ </span>${label}</span></label>`,
      )
      .join("")}</div></fieldset>${choice(
      "theme",
      "カラー",
      [
        ["green", "グリーン"],
        ["blue", "ブルー"],
        ["rose", "ローズ"],
        ["mono", "モノトーン"],
      ],
      data.theme,
    )}<h3>背景</h3><div class="background-samples">${backgrounds.map((b) => `<button type="button" data-background="${b.id}" aria-pressed="${data.backgroundMode === b.id}"><span class="background-thumb"><img src="${esc(b.image)}" alt=""><span class="selection-check" aria-hidden="true">✓</span></span><span>${b.name}</span></button>`).join("")}${data.background ? `<button type="button" data-action="custom-bg" aria-pressed="${activeCustom}"><span class="background-thumb"><img src="${esc(data.background)}" alt="自分の背景画像"><span class="selection-check" aria-hidden="true">✓</span></span><span>自分の画像</span></button>` : ""}</div><p id="background-state" class="muted" role="status">${data.background ? "自分の画像を選択できます。" : "自分の画像はまだありません。"}</p><div class="row"><button type="button" id="change-background">${data.background ? "画像を変更" : "画像を選ぶ"}</button>${btn("背景なし", "clear-bg")}</div><input id="background" type="file" data-toolbar="true" class="file-native" tabindex="-1" accept="image/png,image/jpeg,image/webp,image/heic,.heic" aria-label="自分の背景画像を変更"><p class="muted">画像はこのブラウザに保存します。</p></div></details>
    <details id="display-settings" class="setting"><summary><span>時間割の表示<small>${data.startHour}:00–${data.endHour}:00</small></span><span aria-hidden="true">›</span></summary><div class="setting-content stack">${field("startHour", "日表示の開始時刻", String(data.startHour), "number", 'min="0" max="23"')}${field("endHour", "日表示の終了時刻", String(data.endHour), "number", 'min="1" max="24"')}<label class="check"><input name="bands" type="checkbox" ${data.showBands ? "checked" : ""}>施設の営業時間を表示</label><p class="muted">週間は1〜5コマ表示。終日・コマ外の予定も一覧で確認できます。</p></div></details>
    <details id="campus-settings" class="setting"><summary><span>施設・リンク<small>営業時間・地図・お気に入り</small></span><span aria-hidden="true">›</span></summary><div class="setting-content"><div class="row">${btn("施設の営業時間", "facilities")}${btn("キャンパスマップ", "map")}</div><p class="muted">営業時間は通常期の目安です。臨時変更は公式情報で確認してください。</p><div class="stack">${data.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.favorite ? "★ " : ""}${esc(l.title)} ↗</a>`).join("")}</div><p>${btn("リンクを編集", "links")}</p></div></details>
    <div class="setting"><button class="setting-profile" data-action="profile"><span>ユーザー名<small id="profile-name">${esc(namedAuthor(user?.displayName) ? user!.displayName : "未設定")}</small></span><span aria-hidden="true">›</span></button></div>
    <details id="data-settings" class="setting"><summary><span>データ<small>書き出し・保存について</small></span><span aria-hidden="true">›</span></summary><div class="setting-content">${btn("入力データを書き出す", "export-data")}<p class="muted">保存に失敗したときや別タブと競合したときは、現在の入力を書き出してから再読み込みできます。メモ・画像も含まれます。</p><p class="muted">${anonymousNotice}</p></div></details></div>
    <details id="install-information" class="settings-information"><summary>ホーム画面に追加・URLを共有</summary><p>${btn("URLをコピー", "share-url")}<span id="share-state" role="status"></span></p><p class="muted">iPhone: Safariの共有から「ホーム画面に追加」。Android/PC: ブラウザのメニューから「アプリをインストール」を選びます。HTTPSの公開URLで利用できます。</p></details>
    <details id="diagnostic-information" class="settings-information"><summary>詳細情報</summary><p class="muted">この画面のビルド ${esc(__APP_BUILD_ID__)}</p><div id="version" class="muted">配信情報を読み込み中…</div></details>`;
  renderUpdateState();
  page.querySelectorAll<HTMLButtonElement>("[data-background]").forEach(
    (button) =>
      (button.onclick = () => {
        data.backgroundMode = button.dataset.background!;
        changed();
        render();
      }),
  );
  page.querySelectorAll<HTMLInputElement>("[name=colorMode]").forEach(
    (input) =>
      (input.onchange = () => {
        if (!input.checked) return;
        data.colorMode = input.value as "light" | "dark";
        changed();
        theme();
        const summary = page.querySelector(
          "#appearance-settings summary small",
        );
        if (summary)
          summary.textContent = `${modeOf(data) === "dark" ? "ダーク" : "ライト"} · ${backgroundName}`;
      }),
  );
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
  page.querySelector<HTMLButtonElement>("#change-background")!.onclick = () =>
    page.querySelector<HTMLInputElement>("#background")!.click();
  page.querySelector<HTMLInputElement>("#background")!.onchange = async (e) => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    busy++;
    const box = page.querySelector<HTMLElement>("#background-state");
    if (box) box.textContent = "画像を読み込んでいます…";
    try {
      const image = await imageData(file);
      data.background = image;
      data.backgroundMode = "custom";
      changed();
      render();
    } catch (e) {
      if (box?.isConnected)
        box.textContent =
          "画像を読み込めませんでした。前の画像と選択を保持しています。";
      error(e);
    } finally {
      input.value = "";
      busy--;
      updates?.activity();
    }
  };
  const version = page.querySelector("#version")!;
  void fetch("/version.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    })
    .then((v) => {
      if (version.isConnected)
        version.innerHTML = `<p>配信中のビルド ${esc(v.id)} · ${esc(v.builtAt)}</p>${Array.isArray(v.changes) ? "<ul>" + v.changes.map((s: string) => `<li>${esc(s)}</li>`).join("") + "</ul>" : ""}`;
    })
    .catch(() => {
      if (version.isConnected)
        version.textContent = "配信情報を取得できません。";
    });
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
