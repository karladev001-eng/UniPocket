import type { Data } from "./domain";

// A first-paint hint only. IndexedDB remains authoritative. Never cache drafts,
// backgrounds, or unsaved choices; a cache error must not fail a durable save.
export const appearanceCacheKey = "uni-pocket-appearance-v1";
export const modeOf = (data: Pick<Data, "colorMode">) => data.colorMode ?? "light";
export const themeColors: Record<string, string> = {
  green: "#163e35", blue: "#233f63", rose: "#663e50", mono: "#2e3339",
};
export function cacheAppearance(data: Pick<Data, "theme" | "colorMode">) {
  try {
    localStorage.setItem(appearanceCacheKey, JSON.stringify({ theme: data.theme, colorMode: modeOf(data) }));
  } catch { /* Storage may be unavailable; durable settings still work. */ }
}
export function applyAppearance(data: Pick<Data, "theme" | "colorMode">) {
  const mode = modeOf(data);
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.dataset.theme = data.theme;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = "";
  document.querySelector("meta[name=theme-color]")?.setAttribute("content", mode === "dark" ? "#141b19" : themeColors[data.theme] ?? themeColors.green);
}
