import { assertNode } from "./runtime.mjs";
assertNode();
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
    "地図を拡大・移動し、建物や登録済み教室をすぐ検索",
    "予定ごとのメモを端末に自動保存",
    "記事を人気・新着・ブックマークからコンパクトに探す",
    "再ログイン用URLが古い画面に置き換わる不具合を修正",
  ],
};
await writeFile(
  new URL("version.json", root),
  JSON.stringify(version, null, 2),
);
// Static Assets redirects /index.html to /. A cached redirected response cannot
// satisfy browser navigation requests whose redirect mode is manual.
const code = serviceWorker(id, [
  ...assets.map((f) => (f === "/index.html" ? "/" : f)),
  "/version.json",
]);
await writeFile(new URL("sw.js", root), code);
console.log("PWA build " + id + " · " + assets.length + " offline assets");
