import type { Data } from "./domain";

// A first-paint hint only. IndexedDB remains authoritative. Never cache drafts,
// backgrounds, or unsaved choices; a cache error must not fail a durable save.
export const appearanceCacheKey = "uni-pocket-appearance-v1";
export const modeOf = (data: Pick<Data, "colorMode">) =>
  data.colorMode ?? "light";
export const themeColors: Record<string, string> = {
  green: "#f2f7f3",
  blue: "#edf4ff",
  rose: "#fff0f5",
  mono: "#f2f2f2",
};
export const darkThemeColors: Record<string, string> = {
  green: "#111d17",
  blue: "#101c2f",
  rose: "#26141e",
  mono: "#171717",
};
export function cacheAppearance(data: Pick<Data, "theme" | "colorMode">) {
  try {
    localStorage.setItem(
      appearanceCacheKey,
      JSON.stringify({ theme: data.theme, colorMode: modeOf(data) }),
    );
  } catch {
    /* Storage may be unavailable; durable settings still work. */
  }
}
export function applyAppearance(data: Pick<Data, "theme" | "colorMode">) {
  const mode = modeOf(data);
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.dataset.theme = data.theme;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = "";
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute(
      "content",
      (mode === "dark" ? darkThemeColors : themeColors)[data.theme] ??
        (mode === "dark" ? darkThemeColors.green : themeColors.green),
    );
}
