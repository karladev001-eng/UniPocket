// Campus map: the home card, the zoomable search dialog and "show this room"
// navigation used from event details.
import { catalog, resolveRoom, mapCandidates } from "../map";
import { MapViewport } from "../map-viewport";
import { action, navigate, page, render, route } from "../app/context";
import { btn, esc } from "../ui/html";
import { dialog, modal } from "../ui/modal";
let mapLocation = "", mapBuilding = "", mapFocusPending = false;
export function showLocation(location: string) {
  const r = resolveRoom(location);
  if (["missing", "online"].includes(r.kind)) return;
  mapLocation = location;
  mapBuilding = r.kind === "matched" ? r.ids[0] : "";
  mapFocusPending = true;
  dialog?.close();
  navigate("home");
}
export function homeMap() {
  const r = resolveRoom(mapLocation), b = catalog.buildings.find(b => b.id === mapBuilding);
  action("home-map", () => openMap());
  action("map-search", () => openMap(mapLocation));
  const candidates = r.kind === "ambiguous" ? r.ids.map(id => {
    const candidate = catalog.buildings.find(b => b.id === id)!;
    const a = "map-select-" + id;
    action(a, () => { mapBuilding = id; mapFocusPending = true; render(); });
    return btn(esc(candidate.name), a, id === mapBuilding ? "primary" : "");
  }).join("") : "";
  return `<section class="section card home-map"><div class="sectiontitle"><h2 id="campus-map-heading" tabindex="-1">キャンパスマップ</h2>${btn("拡大・検索", "home-map", "smallbtn")}</div>${mapLocation ? `<div class="map-result" role="status"><b>${esc(mapLocation)}</b><p${r.kind === "ambiguous" && !b ? ' class="sr-only"' : ""}>${b ? esc(b.name) : r.kind === "ambiguous" ? "複数候補があります。建物を選択してください。" : r.kind === "online" ? "オンライン" : "場所未特定"}</p>${candidates ? `<div class="row">${candidates}</div>` : ""}${!b && r.kind !== "ambiguous" ? btn("建物を検索", "map-search", "smallbtn") : ""}</div>` : ""}<div class="mapwrap home-map-image"><button class="map-preview" data-action="home-map" aria-label="キャンパスマップを拡大して建物・教室を検索"><img src="/campus-map.png" alt="浜松キャンパスの地図" loading="lazy"></button><svg viewBox="${catalog.viewBox.join(" ")}" role="img" aria-label="${esc(b ? b.name + 'の建物の位置' : '建物の選択なし')}">${b ? `${b.mapPolygon.length ? `<polygon points="${b.mapPolygon.map(p => p.join(",")).join(" ")}"/>` : ""}<circle cx="${b.mapCenter[0]}" cy="${b.mapCenter[1]}" r="13"/>` : ""}</svg></div></section>`;
}
export function focusPendingMap() {
  if (mapFocusPending) {
    mapFocusPending = false;
    requestAnimationFrame(() => {
      const target = page.querySelector<HTMLElement>("#campus-map-heading");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  }
}
export function openMap(room = "") {
  let query = room || mapLocation, selected = mapBuilding;
  if (!selected) { const r = resolveRoom(query); selected = r.kind === "matched" ? r.ids[0] : ""; }
  let suggestions = false, active = -1;
  const viewport = new MapViewport(catalog.viewBox);
  const initial = catalog.buildings.find(b => b.id === selected);
  if (initial) viewport.center(initial.mapCenter);
  const [mx, my, mw, mh] = catalog.viewBox;
  const d = modal("キャンパスマップ", `<div class="map-search"><input id="map-query" type="text" inputmode="search" value="${esc(query)}" placeholder="建物・登録済み教室" aria-label="建物・登録済み教室を検索" role="combobox" aria-controls="map-suggestions" aria-expanded="false" autocomplete="off"><button type="button" id="map-clear" aria-label="検索語を消す" ${query ? "" : "hidden"}>×</button><div id="map-suggestions" class="map-suggestions" role="listbox" aria-label="建物の候補" hidden></div></div><p id="map-state" class="map-state" role="status" hidden></p><div class="sr-only" id="map-announcement" aria-live="polite"></div><div class="map-viewport"><svg class="map-canvas" viewBox="${viewport.box.join(" ")}" tabindex="0" role="img" aria-label="浜松キャンパスの地図"><image href="/campus-map.png" x="${mx}" y="${my}" width="${mw}" height="${mh}"/><g id="map-highlight"></g></svg><div class="map-zoom"><button type="button" id="map-plus" aria-label="地図を拡大">＋</button><button type="button" id="map-minus" aria-label="地図を縮小">−</button><button type="button" id="map-reset">全体</button></div><div id="building-info" class="map-selected" hidden></div></div>`, undefined, "保存", { singleClose: true, className: "map-modal" });
  const input = d.querySelector<HTMLInputElement>("#map-query")!, list = d.querySelector<HTMLElement>("#map-suggestions")!, canvas = d.querySelector<SVGSVGElement>(".map-canvas")!;
  const paintViewport = () => canvas.setAttribute("viewBox", viewport.box.join(" "));
  const matches = () => mapCandidates(query);
  const choose = (id: string) => {
    selected = id; mapBuilding = id; mapLocation = query;
    suggestions = false; active = -1;
    const b = catalog.buildings.find(b => b.id === id)!;
    viewport.center(b.mapCenter);
    input.blur(); paint();
    d.querySelector("#map-announcement")!.textContent = b.name + "を選択しました。";
  };
  const paint = () => {
    const found = matches(), b = catalog.buildings.find(b => b.id === selected), open = suggestions && !!query.trim() && !!found.length;
    list.hidden = !open;
    list.innerHTML = open ? found.map((b, i) => `<button type="button" role="option" id="map-option-${i}" data-building="${b.id}" aria-selected="${i === active}">${esc(b.name)}</button>`).join("") : "";
    input.setAttribute("aria-expanded", String(open));
    if (open && active >= 0) input.setAttribute("aria-activedescendant", "map-option-" + active);
    else input.removeAttribute("aria-activedescendant");
    d.querySelector<HTMLButtonElement>("#map-clear")!.hidden = !query;
    const state = d.querySelector<HTMLElement>("#map-state")!;
    state.textContent = query.trim() && !b ? resolveRoom(query).kind === "online" ? "オンライン" : !found.length ? "見つかりません" : "" : "";
    state.hidden = !state.textContent;
    d.querySelector("#map-highlight")!.innerHTML = b ? `${b.mapPolygon.length ? `<polygon points="${b.mapPolygon.map(p => p.join(",")).join(" ")}"/>` : ""}<circle cx="${b.mapCenter[0]}" cy="${b.mapCenter[1]}" r="13"/>` : "";
    const info = d.querySelector<HTMLElement>("#building-info")!;
    info.textContent = b?.name ?? ""; info.hidden = !b;
    list.querySelectorAll<HTMLButtonElement>("[data-building]").forEach(button => button.onclick = () => choose(button.dataset.building!));
    list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    d.querySelector<HTMLButtonElement>("#map-minus")!.disabled = viewport.zoom <= 1;
    d.querySelector<HTMLButtonElement>("#map-plus")!.disabled = viewport.zoom >= 4;
    paintViewport();
  };
  input.oninput = () => {
    query = input.value; selected = ""; mapBuilding = ""; mapLocation = query;
    suggestions = !!query.trim(); active = -1; paint();
    d.querySelector("#map-announcement")!.textContent = matches().length ? `${matches().length}件の候補。矢印キーで選びEnterで決定します。` : "";
  };
  input.onkeydown = ev => {
    if (ev.isComposing) return;
    const found = matches();
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && found.length) {
      ev.preventDefault(); suggestions = true;
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + found.length) % found.length; paint();
    } else if (ev.key === "Enter" && suggestions && found.length && !ev.isComposing) {
      ev.preventDefault(); choose(found[Math.max(0, active)].id);
    }
  };
  d.addEventListener("cancel", ev => {
    if (!list.hidden) { ev.preventDefault(); suggestions = false; active = -1; paint(); }
  });
  d.querySelector<HTMLButtonElement>("#map-clear")!.onclick = () => {
    input.value = query = selected = mapBuilding = mapLocation = "";
    d.querySelector("#map-announcement")!.textContent = "";
    suggestions = false; active = -1; paint(); input.focus();
  };
  d.querySelector<HTMLButtonElement>("#map-plus")!.onclick = () => { viewport.scale(viewport.zoom * 1.25); paint(); };
  d.querySelector<HTMLButtonElement>("#map-minus")!.onclick = () => { viewport.scale(viewport.zoom / 1.25); paint(); };
  d.querySelector<HTMLButtonElement>("#map-reset")!.onclick = () => { viewport.reset(); paint(); };
  const pointers = new Map<number, { x: number; y: number }>();
  canvas.onpointerdown = ev => {
    if (ev.button && ev.pointerType === "mouse") return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); canvas.setPointerCapture(ev.pointerId);
  };
  canvas.onpointermove = ev => {
    const previous = pointers.get(ev.pointerId); if (!previous) return;
    const before = [...pointers.values()];
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const after = [...pointers.values()], rect = canvas.getBoundingClientRect(), fit = Math.min(rect.width / mw, rect.height / mh);
    if (before.length === 2) {
      const distance = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const oldDistance = distance(before); if (oldDistance) viewport.scale(viewport.zoom * distance(after) / oldDistance);
      viewport.pan(((after[0].x + after[1].x) - (before[0].x + before[1].x)) / 2, ((after[0].y + after[1].y) - (before[0].y + before[1].y)) / 2, mw * fit, mh * fit);
    } else if (before.length === 1) viewport.pan(ev.clientX - previous.x, ev.clientY - previous.y, mw * fit, mh * fit);
    paintViewport();
  };
  const release = (ev: PointerEvent) => { pointers.delete(ev.pointerId); if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId); paint(); };
  canvas.onpointerup = release; canvas.onpointercancel = release; canvas.onlostpointercapture = ev => pointers.delete(ev.pointerId);
  canvas.onkeydown = ev => {
    if (["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(ev.key)) {
      ev.preventDefault();
      if (ev.key === "Home") viewport.reset();
      else if (["+", "=", "-"].includes(ev.key)) viewport.scale(viewport.zoom * (ev.key === "-" ? 0.8 : 1.25));
      else { const r = canvas.getBoundingClientRect(), fit = Math.min(r.width / mw, r.height / mh); viewport.pan(ev.key === "ArrowLeft" ? 40 : ev.key === "ArrowRight" ? -40 : 0, ev.key === "ArrowUp" ? 40 : ev.key === "ArrowDown" ? -40 : 0, mw * fit, mh * fit); }
      paint();
    }
  };
  d.addEventListener("close", () => { if (route() === "home") render(); });
  paint();
  // Keep the keyboard closed when opening the map on touch devices.
  canvas.focus({ preventScroll: true });
}
