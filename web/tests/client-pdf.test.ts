import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { pdfPages } from "./fixtures/pdf-pages";
import { textPDF } from "./fixtures/text-pdf";

// Each run starts in a fresh process: compatibility polyfills must not leak
// between the baseline, application and worker checks or affect Vitest itself.
// This simulates missing APIs; it does not emulate a particular iOS release.
const missingAPIs = `
  for (const key of ["getOrInsert", "getOrInsertComputed"]) {
    delete Map.prototype[key]; delete WeakMap.prototype[key];
  }
  delete Uint8Array.prototype.toHex;
  delete Uint8Array.fromBase64;
  delete Math.sumPrecise;
  const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  for (const key of ["map", "filter", "flatMap", "reduce", "some", "every", "find", "toArray", "take", "drop", "join"]) delete iteratorPrototype[key];
  delete globalThis.Iterator;
`;

async function applicationURL(modern = false) {
  let workerURL = "";
  const result = await build({
    stdin: {
      contents: `export { previewPDF } from "./src/pdf"; export { LocalStore } from "./src/storage";`,
      resolveDir: new URL("..", import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "pdf-node-worker-url",
      setup(builder) {
        builder.onResolve({ filter: /^pdfjs-dist/ }, args => {
          const path = modern ? args.path.replace("/legacy/", "/") : args.path;
          if (path.endsWith("?url")) return { path: path.slice(0, -4), namespace: "worker-url" };
          return { path: import.meta.resolve(path), external: true };
        });
        builder.onLoad({ filter: /.*/, namespace: "worker-url" }, args => {
          workerURL = import.meta.resolve(args.path);
          return { contents: `export default ${JSON.stringify(workerURL)}` };
        });
      },
    }],
  });
  return { url: "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"), workerURL };
}
function run(script: string) {
  return execFileSync(process.execPath, ["--input-type=module"], {
    input: `process.on("uncaughtException", e => { console.error(e.message); process.exit(1); });\n${script}`,
    encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("PDF compatibility without newer JavaScript APIs", () => {
  it("reproduces the modern build failure and restores worker APIs independently", async () => {
    const modern = import.meta.resolve("pdfjs-dist/build/pdf.mjs");
    expect(run(`${missingAPIs}
      try { await import(${JSON.stringify(modern)}); process.exitCode = 1; }
      catch (error) { console.log(error.message); }
    `)).toContain("Iterator");
    const { workerURL } = await applicationURL();
    expect(run(`${missingAPIs}
      await import(${JSON.stringify(workerURL)});
      if (typeof Map.prototype.getOrInsertComputed !== "function" || typeof Uint8Array.prototype.toHex !== "function" || typeof [][Symbol.iterator]().filter !== "function") throw Error("Worker compatibility APIs are missing");
      console.log("worker compatible");
    `)).toContain("worker compatible");
  });

  it("previews actual PDF bytes and keeps saved personal data after a rejected PDF", async () => {
    const { t, a } = pdfPages();
    const encoded = [t, a].map(page => Buffer.from(textPDF(page)).toString("base64"));
    const { url } = await applicationURL();
    const result = run(`
      import assert from "node:assert/strict";
      await import(${JSON.stringify(import.meta.resolve("fake-indexeddb/auto"))});
      ${missingAPIs}
      const { previewPDF, LocalStore } = await import(${JSON.stringify(url)});
      const registration = new File([Buffer.from(${JSON.stringify(encoded[0])}, "base64")], "registration.pdf");
      const annual = new File([Buffer.from(${JSON.stringify(encoded[1])}, "base64")], "annual.pdf");
      const p = await previewPDF(registration, annual);
      assert.equal(p.courses[0].title, "数学");
      assert.equal(p.courses[0].room, "情1");
      assert.equal(p.events.length, 15);
      const store = new LocalStore(), data = await store.open();
      data.imports = [p];
      data.occurrenceEdits = [{ id: p.events[0].id, title: "個人の数学" }];
      await store.save(data);
      const before = JSON.stringify(data);
      await assert.rejects(previewPDF(new File(["invalid PDF"], "broken.pdf"), annual), /既存の予定は変更していません/);
      assert.equal(JSON.stringify(data), before);
      store.close();
      const reopened = new LocalStore();
      assert.equal(JSON.stringify(await reopened.open()), before);
      reopened.close();
      console.log("preview and existing data protected");
    `);
    expect(result).toContain("preview and existing data protected");
  });

  it("reproduces a modern PDF load failure when newer byte APIs are absent", async () => {
    const { t, a } = pdfPages();
    const encoded = [t, a].map(page => Buffer.from(textPDF(page)).toString("base64"));
    expect(run(`
      import assert from "node:assert/strict";
      delete Map.prototype.getOrInsertComputed;
      delete Uint8Array.prototype.toHex;
      const { previewPDF } = await import(${JSON.stringify((await applicationURL(true)).url)});
      const files = ${JSON.stringify(encoded)}.map((bytes, i) => new File([Buffer.from(bytes, "base64")], i + ".pdf"));
      await assert.rejects(previewPDF(...files), /toHex.*not a function/);
      console.log("modern byte API failure reproduced");
    `)).toContain("modern byte API failure reproduced");
  });
});
