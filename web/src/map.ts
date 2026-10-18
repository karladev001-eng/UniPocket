import catalog from "./map-catalog.json";
export { catalog };
export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s/g, "")
    .replace(/[‐‑‒–—―−ー]/g, "-");
export function resolveRoom(s: string): { kind: string; ids: string[] } {
  const key = normalize(s);
  if (!key) return { kind: "missing", ids: [] };
  if (
    key.includes("オンライン") ||
    /^https?:/.test(key) ||
    [
      "zoom",
      "teams",
      "microsoftteams",
      "webex",
      "遠隔",
      "オンデマンド",
    ].includes(key)
  )
    return { kind: "online", ids: [] };
  const index = new Map<string, Set<string>>();
  const add = (a: string, id: string) => {
    const k = normalize(a);
    index.set(k, new Set([...(index.get(k) ?? []), id]));
  };
  for (const b of catalog.buildings)
    for (const a of [
      b.name,
      ...(!/^\d+$/.test(b.short) ? [b.short] : []),
      ...b.aliases,
    ])
      add(a, b.id);
  for (const r of catalog.roomAliases)
    for (const a of [r.id, ...r.aliases]) add(a, r.buildingID);
  let ids = index.get(key);
  if (!ids) {
    const parts = s
      .split(/[\/／、,，;；\n]/)
      .map(normalize)
      .filter(Boolean);
    if (parts.length > 1 && parts.every((p) => index.has(p)))
      ids = new Set(parts.flatMap((p) => [...index.get(p)!]));
  }
  return {
    kind: ids ? (ids.size === 1 ? "matched" : "ambiguous") : "unknown",
    ids: [...(ids ?? [])].sort(),
  };
}
export function searchBuildings(q: string) {
  const k = normalize(q),
    rooms = new Set(
      catalog.roomAliases
        .filter((r) =>
          [r.id, ...r.aliases].some((x) => normalize(x).includes(k)),
        )
        .map((r) => r.buildingID),
    );
  return catalog.buildings.filter(
    (b) =>
      rooms.has(b.id) ||
      [b.id, b.name, b.short, b.category, ...b.aliases].some((x) =>
        normalize(x).includes(k),
      ),
  );
}
