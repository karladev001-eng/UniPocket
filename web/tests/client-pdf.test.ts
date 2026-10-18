import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { previewPDF } from "../src/pdf";
import { pdfPages } from "./fixtures/pdf-pages";
import { textPDF } from "./fixtures/text-pdf";
import type { PageText } from "../src/pdf-parser";
import * as pdfParser from "../src/pdf-parser";

const pdfMock = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => pdfMock);

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
  it("reads PDF text without ReadableStream async iteration and protects saved data on text failure", async () => {
    const { t, a } = pdfPages();
    const encoded = [t, a].map(page => Buffer.from(textPDF(page)).toString("base64"));
    const { url, workerURL } = await applicationURL();
    expect(run(`
      import assert from "node:assert/strict";
      await import(${JSON.stringify(import.meta.resolve("fake-indexeddb/auto"))});
      ${missingAPIs}
      delete ReadableStream.prototype[Symbol.asyncIterator];
      const { getDocument, GlobalWorkerOptions } = await import(${JSON.stringify(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"))});
      GlobalWorkerOptions.workerSrc = ${JSON.stringify(workerURL)};
      assert.equal(ReadableStream.prototype[Symbol.asyncIterator], undefined);
      const files = ${JSON.stringify(encoded)}.map((bytes, i) => new File([Buffer.from(bytes, "base64")], i + ".pdf"));
      const baseline = getDocument({ data: new Uint8Array(await files[0].arrayBuffer()) });
      let pagePrototype;
      try {
        const page = await (await baseline.promise).getPage(1);
        pagePrototype = Object.getPrototypeOf(page);
        await assert.rejects(page.getTextContent(), { name: "TypeError", message: /not async iterable/ });
      } finally { await baseline.destroy(); }
      const { previewPDF, LocalStore } = await import(${JSON.stringify(url)});
      const plan = await previewPDF(...files);
      assert.equal(plan.courses[0].title, "数学");
      assert.equal(plan.courses[0].room, "情1");
      assert.equal(plan.events.length, 15);
      const store = new LocalStore(), data = await store.open();
      data.imports = [plan];
      data.occurrenceEdits = [{ id: plan.events[0].id, title: "個人の数学" }];
      await store.save(data);
      const before = JSON.stringify(data);
      const originalStream = pagePrototype.streamTextContent;
      pagePrototype.streamTextContent = () => new ReadableStream({
        pull(controller) { controller.error(Error("text stream failed")); },
      });
      try {
        await assert.rejects(previewPDF(...files), /text stream failed \\[PDF:R-TEXT\\]/);
      } finally { pagePrototype.streamTextContent = originalStream; }
      assert.equal(JSON.stringify(data), before);
      store.close();
      const reopened = new LocalStore();
      assert.equal(JSON.stringify(await reopened.open()), before);
      reopened.close();
      console.log("reader compatibility and saved data verified");
    `)).toContain("reader compatibility and saved data verified");
  });

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

function documentTask(text: PageText) {
  const items = text.items.map(item => ({ ...item, transform: [1, 0, 0, 1, item.x, item.y + 5] }));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ items: [] });
      for (let i = 0; i < items.length; i += 25) {
        controller.enqueue({ items: [
          { type: "beginMarkedContent", id: "ignored" },
          { str: " \t" },
          ...items.slice(i, i + 25),
        ] });
      }
      controller.close();
    },
  });
  return {
    stream,
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        isPureXfa: false,
        getViewport: () => ({ width: text.width, height: text.height, convertToViewportPoint: (x: number, y: number) => [x, y] }),
        getTextContent: vi.fn().mockResolvedValue({ items }),
        streamTextContent: vi.fn().mockReturnValue(stream),
      }),
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}
describe("local PDF failure diagnostics and cleanup", () => {
  const file = () => new File(["synthetic"], "private-name.pdf");
  beforeEach(() => pdfMock.getDocument.mockReset());

  it("preserves chunk order, text filtering and viewport conversion, then unlocks both streams", async () => {
    const { t, a } = pdfPages(), registration = documentTask(t), annual = documentTask(a);
    const registrationPage = await (await registration.promise).getPage(1);
    registrationPage.getViewport = () => ({ width: t.width, height: t.height, convertToViewportPoint: (x: number, y: number) => [x + 11, y + 17] });
    const expectedPlan = pdfParser.parsePages(t, a);
    const parse = vi.spyOn(pdfParser, "parsePages").mockReturnValue(expectedPlan);
    pdfMock.getDocument.mockReturnValueOnce(registration).mockReturnValueOnce(annual);
    try {
      await expect(previewPDF(file(), file())).resolves.toBe(expectedPlan);
      expect(parse).toHaveBeenCalledWith(
        new pdfParser.PageText(t.width, t.height, t.items.map(item => ({ ...item, x: item.x + 11, y: item.y + 17 }))),
        a,
      );
      expect(registrationPage.getTextContent).not.toHaveBeenCalled();
      expect(registration.stream.locked).toBe(false);
      expect(annual.stream.locked).toBe(false);
      expect(registration.destroy).toHaveBeenCalledOnce();
      expect(annual.destroy).toHaveBeenCalledOnce();
    } finally { parse.mockRestore(); }
  });

  it("keeps pure XFA extraction on PDF.js's dedicated text path", async () => {
    const { t, a } = pdfPages(), registration = documentTask(t), annual = documentTask(a);
    for (const task of [registration, annual]) {
      const page = await (await task.promise).getPage(1);
      page.isPureXfa = true;
    }
    pdfMock.getDocument.mockReturnValueOnce(registration).mockReturnValueOnce(annual);
    const result = await previewPDF(file(), file());
    expect(result.courses[0].title).toBe("数学");
    expect(result.events).toHaveLength(15);
    for (const task of [registration, annual]) {
      const page = await (await task.promise).getPage(1);
      expect(page.getTextContent).toHaveBeenCalledOnce();
      expect(page.streamTextContent).not.toHaveBeenCalled();
    }
  });

  it("identifies file reads without exposing the file name", async () => {
    const registration = { size: 1, arrayBuffer: () => Promise.reject(Error("read failed")) } as File;
    await expect(previewPDF(registration, file())).rejects.toThrow("read failed [PDF:R-FILE]");
    expect(pdfMock.getDocument).not.toHaveBeenCalled();
  });

  it.each(["R", "A"])("keeps the %s document error when cleanup also rejects", async side => {
    const { t, a } = pdfPages(), registration = documentTask(t), annual = documentTask(a);
    const failed = side === "R" ? registration : annual;
    // Reject when awaited so constructing the fixtures creates no unhandled promise.
    Object.defineProperty(failed, "promise", { get: () => Promise.reject(TypeError("undefined is not a function")) });
    registration.destroy.mockRejectedValue(Error("cleanup failure"));
    pdfMock.getDocument.mockReturnValueOnce(registration).mockReturnValueOnce(annual);
    await expect(previewPDF(file(), file())).rejects.toThrow(`undefined is not a function [PDF:${side}-OPEN]`);
    expect(registration.destroy).toHaveBeenCalledOnce();
    expect(annual.destroy).toHaveBeenCalledOnce();
  });

  it.each(["R", "A"])("identifies %s text extraction and always releases both tasks", async side => {
    const { t, a } = pdfPages(), registration = documentTask(t), annual = documentTask(a);
    const failed = side === "R" ? registration : annual;
    const page = await (await failed.promise).getPage(1);
    let reads = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (++reads === 1) controller.enqueue({ items: [] });
        else controller.error(TypeError("text API failed"));
      },
    });
    page.streamTextContent.mockReturnValue(stream);
    failed.destroy.mockRejectedValue(Error("cleanup failed"));
    pdfMock.getDocument.mockReturnValueOnce(registration).mockReturnValueOnce(annual);
    await expect(previewPDF(file(), file())).rejects.toThrow(`text API failed [PDF:${side}-TEXT]`);
    expect(registration.destroy).toHaveBeenCalledOnce();
    expect(annual.destroy).toHaveBeenCalledOnce();
    expect(reads).toBe(2);
    expect(stream.locked).toBe(false);
  });

  it("identifies cleanup-only failures after a successful preview", async () => {
    const { t, a } = pdfPages(), registration = documentTask(t), annual = documentTask(a);
    registration.destroy.mockRejectedValue(Error("release failed"));
    pdfMock.getDocument.mockReturnValueOnce(registration).mockReturnValueOnce(annual);
    await expect(previewPDF(file(), file())).rejects.toThrow("release failed [PDF:CLOSE]");
    expect(annual.destroy).toHaveBeenCalledOnce();
  });
});
