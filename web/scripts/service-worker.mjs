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
  changes: ["週間コマ表示と、次の予定・今日の予定を先に読めるホーム", "設定をコンパクトに整理し、自分の背景画像をプレビュー"],
};
await writeFile(
  new URL("version.json", root),
  JSON.stringify(version, null, 2),
);
// Static Assets redirects /index.html to /. A cached redirected response cannot
// satisfy browser navigation requests whose redirect mode is manual.
const code = serviceWorker(id, [...assets.map((f) => f === "/index.html" ? "/" : f), "/version.json"]);
await writeFile(new URL("sw.js", root), code);
console.log("PWA build " + id + " · " + assets.length + " offline assets");
