// zaina-platform/src/knowledge/import-files.ts
//
// Reads knowledge from files and saves it for a business: used by the import
// command and by the release step (TBM's own documents, at every release).
//
// Files: .md and .txt (with an optional header, see import.ts) and .json (an
// FAQ list, or { title, kind, url, language, content }). A source with the
// same title is replaced; an unchanged one is left alone.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { faqToMarkdown, parseMarkdownSource, type ImportedSource } from "./import.ts";
import { saveKnowledgeSource, validateKnowledgeInput } from "./store.ts";

export function sourceFromFile(file: string): ImportedSource {
  const text = readFileSync(file, "utf8");
  const name = path.basename(file).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  if (file.endsWith(".json")) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { title: name, kind: "faq", content: faqToMarkdown(data) ?? "" };
    return { ...data, title: data.title ?? name, content: data.content ?? faqToMarkdown(data.faqs) ?? "" };
  }
  if (file.endsWith(".pdf")) throw new Error(`${file}: convert PDFs to text first (for example: pdftotext -layout file.pdf file.txt)`);
  return parseMarkdownSource(text, name);
}

/** The knowledge files in a folder, in name order. */
export function sourcesInDirectory(directory: string): Array<{ label: string; source: ImportedSource }> {
  const sources: Array<{ label: string; source: ImportedSource }> = [];
  for (const entry of readdirSync(directory).sort()) {
    const file = path.join(directory, entry);
    if (statSync(file).isFile() && /\.(md|txt|json)$/i.test(entry)) sources.push({ label: entry, source: sourceFromFile(file) });
  }
  return sources;
}

export type ImportOutcome = { title: string; unchanged: boolean; passages: number; hiddenAmounts: number };

/** Checks and saves each source; stops at the first one that isn't valid. */
export async function saveImportedSources(
  businessId: string,
  sources: Array<{ label: string; source: ImportedSource }>,
  overrides: Partial<ImportedSource> = {},
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  for (const { label, source } of sources) {
    const checked = validateKnowledgeInput({ ...source, ...overrides });
    if (!checked.ok) throw new Error(`${label}: ${checked.error}`);
    const result = await saveKnowledgeSource(businessId, checked.value, null);
    outcomes.push({ title: checked.value.title, unchanged: result!.unchanged, passages: result!.passages, hiddenAmounts: result!.hiddenAmounts });
  }
  return outcomes;
}

export function describeOutcome(outcome: ImportOutcome): string {
  const hidden = outcome.hiddenAmounts ? `, ${outcome.hiddenAmounts} amount(s) hidden from Zaina` : "";
  return `${outcome.unchanged ? "unchanged" : "saved"}: "${outcome.title}" (${outcome.passages} passages${hidden})`;
}
