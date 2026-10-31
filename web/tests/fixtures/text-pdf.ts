import type { PageText } from "../../src/pdf-parser";

// A real, synthetic PDF with a Unicode text mapping and no personal information.
// It lets PDF.js decode bytes before the existing coordinate parser sees them.
export function textPDF(page: PageText): Uint8Array {
  const hex = (s: string) =>
    Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join(
      "",
    );
  const chars = new Set(page.items.flatMap((i) => Array.from(i.str)));
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Synthetic-UCS def\n/CMapType 2 def
1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange
${chars.size} beginbfchar
${Array.from(chars, (c) => `<${hex(c)}> <${hex(c)}>`).join("\n")}
endbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const content = page.items
    .map(
      (i) =>
        `BT /F1 10 Tf 1 0 0 1 ${i.x} ${page.height - i.y - 5} Tm <${hex(i.str)}> Tj ET`,
    )
    .join("\n");
  const stream = (s: string) =>
    `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Synthetic /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>",
    stream(cmap),
    stream(content),
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
