// Run before styles/application loading, within script-src 'self'. IndexedDB
// restores the authoritative state; this small cache contains appearance only.
try {
  const a = JSON.parse(localStorage.getItem("uni-pocket-appearance-v1") || "null");
  const colors = { green: "#163e35", blue: "#233f63", rose: "#663e50", mono: "#2e3339" };
  if (a && typeof a.theme === "string" && Object.hasOwn(colors, a.theme) && ["light", "dark"].includes(a.colorMode)) {
    document.documentElement.dataset.colorMode = a.colorMode;
    document.documentElement.dataset.theme = a.theme;
    document.documentElement.style.colorScheme = a.colorMode;
    document.documentElement.style.backgroundColor = a.colorMode === "dark" ? "#141b19" : "";
    document.querySelector('meta[name="theme-color"]').content = a.colorMode === "dark" ? "#141b19" : colors[a.theme];
  }
} catch { /* No cache: light mode without changing personal data. */ }
