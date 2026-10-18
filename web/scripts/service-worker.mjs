import { serviceWorker } from "./sw-template.mjs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const root = new URL("../dist/", import.meta.url);
async function files(path = "") {
  const result = [];
  for (const entry of await readdir(new URL(path, root), {
    withFileTypes: true,
  })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(name + "/")));
    else result.push("/" + name);
  }
  return result;
}
const assets = (await files()).filter(
  (f) => f !== "/sw.js" && f !== "/version.json" && f !== "/_headers",
);
const hash = createHash("sha256");
for (const f of assets) hash.update(await readFile(new URL(f.slice(1), root)));
const id = process.env.BUILD_ID ?? hash.digest("hex").slice(0, 12);
const version = {
  id,
  builtAt: new Date().toISOString(),
  changes: [
    "時間割とPDF差分、画像メモ、施設・地図をブラウザ内に保存",
    "Notion記事・匿名ブックマーク・共通集計",
    "保存と全タブの準備確認後に更新",
  ],
};
await writeFile(
  new URL("version.json", root),
  JSON.stringify(version, null, 2),
);
const code = serviceWorker(id, [...assets, "/version.json"]);
await writeFile(new URL("sw.js", root), code);
console.log("PWA build " + id + " · " + assets.length + " offline assets");
