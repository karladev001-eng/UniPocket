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
async function page(p: PDFPageProxy) {
  const vp = p.getViewport({ scale: 1 }),
    text = await p.getTextContent();
  return new PageText(
    vp.width,
    vp.height,
    text.items
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
  try {
    rt = getDocument({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      data: new Uint8Array(await registration.arrayBuffer()),
    });
    at = getDocument({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      data: new Uint8Array(await annual.arrayBuffer()),
    });
    const [r, a] = await Promise.all([rt.promise, at.promise]);
    if (r.numPages !== 1 || a.numPages < 1)
      throw Error("登録票は1ページの原本を選択してください。");
    return parsePages(
      await page(await r.getPage(1)),
      await page(await a.getPage(1)),
    );
  } catch (e) {
    throw Error(
      `PDFの取込を中止しました。${e instanceof Error ? e.message : "破損・パスワードを確認してください。"} 既存の予定は変更していません。`,
    );
  } finally {
    await rt?.destroy();
    await at?.destroy();
  }
}
