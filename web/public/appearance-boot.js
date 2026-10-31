// Run before styles/application loading, within script-src 'self'. IndexedDB
// restores the authoritative state; this small cache contains appearance only.
try {
  const a = JSON.parse(localStorage.getItem("uni-pocket-appearance-v1") || "null");
  const colors = {
    light: { green: "#f2f7f3", blue: "#edf4ff", rose: "#fff0f5", mono: "#f2f2f2" },
    dark: { green: "#111d17", blue: "#101c2f", rose: "#26141e", mono: "#171717" },
  };
  if (a && typeof a.theme === "string" && Object.hasOwn(colors.light, a.theme) && ["light", "dark"].includes(a.colorMode)) {
    document.documentElement.dataset.colorMode = a.colorMode;
    document.documentElement.dataset.theme = a.theme;
    document.documentElement.style.colorScheme = a.colorMode;
    document.documentElement.style.backgroundColor = colors[a.colorMode][a.theme];
    document.querySelector('meta[name="theme-color"]').content = colors[a.colorMode][a.theme];
  }
} catch { /* No cache: light mode without changing personal data. */ }
