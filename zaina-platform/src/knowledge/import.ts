// zaina-platform/src/knowledge/import.ts
//
// Turning what a business has into knowledge sources:
//   - markdown or text, with an optional header:
//       ---
//       title: Coast areas
//       kind: guide
//       url: https://example.com/areas
//       language: en
//       ---
//   - FAQ lists: [{ "question": "…", "answer": "…" }]
//   - web pages (the import command fetches them; staff routes take text only)
// PDFs are converted to text first (for example with pdftotext).

export type ImportedSource = Record<string, unknown> & { title: string; content: string };

/** Reads a markdown file's header and body. */
export function parseMarkdownSource(fileText: string, fallbackTitle: string): ImportedSource {
  const text = fileText.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const fields: Record<string, string> = {};
  if (header) {
    for (const line of header[1].split("\n")) {
      const match = /^([a-z_]+):\s*(.*)$/i.exec(line.trim());
      if (match) fields[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const body = (header ? text.slice(header[0].length) : text).trim();
  const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return { ...fields, title: fields.title || firstHeading || fallbackTitle, content: body };
}

/** An FAQ list as markdown: each question a heading of its own. */
export function faqToMarkdown(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const pairs = items.map((item) => ({
    question: typeof item?.question === "string" ? item.question.trim() : "",
    answer: typeof item?.answer === "string" ? item.answer.trim() : "",
  }));
  if (pairs.some((pair) => !pair.question || !pair.answer)) return null;
  return pairs.map((pair) => `## ${pair.question.replace(/\n+/g, " ")}\n\n${pair.answer}`).join("\n\n");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/[ \t]+/g, " ").trim();

/** A web page's readable text as markdown-ish plain text: headings, paragraphs and lists. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let body = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_whole, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(inner)}\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote|header|dl|dd|dt)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? stripTags(title) : null, text };
}
