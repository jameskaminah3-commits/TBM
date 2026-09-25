// zaina-platform/src/knowledge/chunk.ts
//
// Cuts a document into passages for search. Markdown headings name each
// passage's section ("Coast areas › Diani"); a question heading, or a
// "Q: … A: …" pair, becomes a passage of its own; long sections are split at
// paragraphs, then sentences. Passages stay short so an answer brings along
// only what it needs.

export type Passage = { heading: string | null; content: string };

const TARGET_CHARS = 600;
const MAX_CHARS = 1000;

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length > MAX_CHARS && current) {
      pieces.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  // A single sentence longer than the limit is cut at the limit.
  return pieces.flatMap((piece) => (piece.length <= MAX_CHARS ? [piece] : piece.match(new RegExp(`[\\s\\S]{1,${MAX_CHARS}}`, "g")) ?? []));
}

/** Packs a section's paragraphs into passages of about TARGET_CHARS. */
function packSection(heading: string | null, body: string): Passage[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);
  const passages: Passage[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > TARGET_CHARS) {
      passages.push({ heading, content: current });
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) passages.push({ heading, content: current });
  return passages;
}

/** "Q: …" / "A: …" pairs inside a section, each as its own passage. */
function questionPairs(body: string): Array<{ question: string; answer: string }> | null {
  const matches = [...body.matchAll(/^\s*Q[:.]\s*(.+?)\s*\n\s*A[:.]\s*([\s\S]*?)(?=\n\s*Q[:.]|(?![\s\S]))/gim)];
  if (matches.length === 0) return null;
  return matches.map((match) => ({ question: match[1].trim(), answer: match[2].trim() })).filter((pair) => pair.answer);
}

/** A heading repeating the document's own title isn't part of its passages' section names. */
export function chunkDocument(text: string, options: { title?: string } = {}): Passage[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headings: string[] = [];
  const passages: Passage[] = [];
  const title = options.title?.trim().toLowerCase();
  let body: string[] = [];

  const flush = () => {
    const sectionText = body.join("\n").trim();
    body = [];
    if (!sectionText) return;
    const heading = headings.filter((text) => text && text.toLowerCase() !== title).join(" › ") || null;
    const pairs = questionPairs(sectionText);
    if (pairs) {
      for (const pair of pairs) passages.push(...packSection(heading ? `${heading} › ${pair.question}` : pair.question, pair.answer));
      return;
    }
    passages.push(...packSection(heading, sectionText));
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      headings.length = level - 1;
      headings[level - 1] = heading[2].trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return passages;
}
