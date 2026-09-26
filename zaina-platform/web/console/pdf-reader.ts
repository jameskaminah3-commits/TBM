// zaina-platform/web/console/pdf-reader.ts
//
// Reads the text of a PDF in the browser (pdf.js), for knowledge: a menu,
// a price list, house rules, a brochure. Built on its own
// (console/pdf-reader.js, with pdf.js's worker beside it) and loaded only
// when someone picks a PDF, so the console stays small. The PDF never
// reaches the server: only the text the person saves does.
//
// Only the text is wanted: no fonts are loaded into the page (pdf.js 6
// doesn't use eval at all).

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).toString();

const MAX_PAGES = 300;

export type PdfText = { pages: number; read: number; text: string };

export async function readPdf(data: ArrayBuffer): Promise<PdfText> {
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const parts: string[] = [];
    const read = Math.min(pdf.numPages, MAX_PAGES);
    for (let number = 1; number <= read; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.replace(/\s+/g, " ").trim());
          line = "";
        }
      }
      if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
      parts.push(lines.join("\n"));
      page.cleanup();
    }
    return { pages: pdf.numPages, read, text: parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() };
  } finally {
    await task.destroy();
  }
}
