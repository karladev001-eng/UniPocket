import {
  getDocument,
  GlobalWorkerOptions,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
// Use PDF.js's Safari compatibility build in both contexts so that each has
// the polyfills for newer JavaScript APIs, including Map/Iterator helpers.
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { type Plan } from "./domain";
GlobalWorkerOptions.workerSrc = worker;
import { PageText, parsePages } from "./pdf-parser";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

type PDFStage =
  | "R-FILE"
  | "A-FILE"
  | "R-OPEN"
  | "A-OPEN"
  | "R-TEXT"
  | "A-TEXT"
  | "LAYOUT"
  | "PARSE"
  | "CLOSE";
class PDFStageError extends Error {
  constructor(
    readonly stage: PDFStage,
    cause: unknown,
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : "破損・パスワードを確認してください。",
      { cause },
    );
  }
}
async function atStage<T>(
  stage: PDFStage,
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new PDFStageError(stage, error);
  }
}
function importError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : "破損・パスワードを確認してください。";
  const code = error instanceof PDFStageError ? ` [PDF:${error.stage}]` : "";
  // Local diagnostic only: no file names, extracted text, stack or telemetry.
  return Error(
    `PDFの取込を中止しました。${message}${code} 既存の予定は変更していません。`,
  );
}
async function textItems(p: PDFPageProxy): Promise<TextContent["items"]> {
  // PDF.js handles pure XFA separately, without the text-content stream.
  if (p.isPureXfa) return (await p.getTextContent()).items;
  // The legacy build still async-iterates ReadableStream in getTextContent,
  // but Safari can support getReader without Symbol.asyncIterator.
  const reader = p.streamTextContent().getReader();
  const items: TextContent["items"] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const item of (value as TextContent).items) items.push(item);
    }
    return items;
  } finally {
    reader.releaseLock();
  }
}
async function page(p: PDFPageProxy) {
  const vp = p.getViewport({ scale: 1 }),
    items = await textItems(p);
  return new PageText(
    vp.width,
    vp.height,
    items
      .filter(
        (i): i is import("pdfjs-dist/types/src/display/api").TextItem =>
          "str" in i,
      )
      .filter((i) => i.str.trim())
      .map((i) => {
        const m = i.transform;
        const point = vp.convertToViewportPoint(m[4], m[5]);
        return {
          str: i.str,
          x: point[0],
          y: point[1] - Math.abs(i.height) * 0.5,
          width: i.width,
          height: i.height,
        };
      }),
  );
}
export async function previewPDF(
  registration: File,
  annual: File,
): Promise<Plan> {
  if (registration.size > 40 * 1024 * 1024 || annual.size > 40 * 1024 * 1024)
    throw Error("PDFは各40MB以内で選択してください。");
  let rt: ReturnType<typeof getDocument> | undefined,
    at: ReturnType<typeof getDocument> | undefined;
  let failed = false;
  try {
    const registrationBytes = await atStage("R-FILE", () =>
      registration.arrayBuffer(),
    );
    const annualBytes = await atStage("A-FILE", () => annual.arrayBuffer());
    const [r, a] = await Promise.all([
      atStage("R-OPEN", () => {
        rt = getDocument({
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          data: new Uint8Array(registrationBytes),
        });
        return rt.promise;
      }),
      atStage("A-OPEN", () => {
        at = getDocument({
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          data: new Uint8Array(annualBytes),
        });
        return at.promise;
      }),
    ]);
    await atStage("LAYOUT", () => {
      if (r.numPages !== 1 || a.numPages < 1)
        throw Error("登録票は1ページの原本を選択してください。");
    });
    const registrationPage = await atStage("R-TEXT", async () =>
      page(await r.getPage(1)),
    );
    const annualPage = await atStage("A-TEXT", async () =>
      page(await a.getPage(1)),
    );
    return await atStage("PARSE", () =>
      parsePages(registrationPage, annualPage),
    );
  } catch (e) {
    failed = true;
    throw importError(e);
  } finally {
    // Release both tasks even if one fails. A cleanup error must not conceal
    // the original failing phase, which is needed to diagnose device errors.
    const cleanup = await Promise.allSettled(
      [rt, at].map((task) => Promise.resolve().then(() => task?.destroy())),
    );
    const rejected = cleanup.find((result) => result.status === "rejected");
    if (!failed && rejected?.status === "rejected")
      throw importError(new PDFStageError("CLOSE", rejected.reason));
  }
}
