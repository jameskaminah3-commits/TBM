// zaina-platform/src/cli/import-knowledge.ts
//
// Imports knowledge for a business, as the platform team does at onboarding:
//
//   npm run knowledge:import -- --business tbm --dir zaina-platform/knowledge/tbm [--prune]
//   npm run knowledge:import -- --business acme --file faq.md
//   npm run knowledge:import -- --business acme --url https://acme.example/faq --title "FAQ" [--kind faq]
//
// Files: .md and .txt (with an optional header, see knowledge/import.ts) and
// .json (an FAQ list, or { title, kind, url, language, content }). A source
// with the same title is replaced; an unchanged one is left alone. --prune
// removes the business's sources that aren't in the folder. PDFs are
// converted to text first (pdftotext).

import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { closePlatformDb, initPlatformDb } from "../db/platform-db.ts";
import { faqToMarkdown, htmlToText, parseMarkdownSource, type ImportedSource } from "../knowledge/import.ts";
import { deleteKnowledgeSource, listKnowledgeSources, saveKnowledgeSource, validateKnowledgeInput } from "../knowledge/store.ts";

const { values } = parseArgs({
  options: {
    business: { type: "string" },
    dir: { type: "string" },
    file: { type: "string" },
    url: { type: "string" },
    title: { type: "string" },
    kind: { type: "string" },
    language: { type: "string" },
    prune: { type: "boolean", default: false },
  },
});

function fromFile(file: string): ImportedSource {
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

async function fromUrl(url: string): Promise<ImportedSource> {
  if (!/^https:\/\//.test(url)) throw new Error("--url must start with https://");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "ZainaKnowledgeImport/1.0" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const page = htmlToText(await response.text());
  return { title: values.title ?? page.title ?? url, url, content: page.text };
}

async function main() {
  const url = process.env.PLATFORM_DATABASE_URL?.trim();
  if (!url) throw new Error("PLATFORM_DATABASE_URL is required");
  const businessId = values.business;
  if (!businessId) throw new Error("--business is required");
  initPlatformDb(url, { max: 2 });

  const sources: Array<{ label: string; source: ImportedSource }> = [];
  if (values.dir) {
    for (const entry of readdirSync(values.dir).sort()) {
      const file = path.join(values.dir, entry);
      if (statSync(file).isFile() && /\.(md|txt|json)$/i.test(entry)) sources.push({ label: entry, source: fromFile(file) });
    }
  }
  if (values.file) sources.push({ label: path.basename(values.file), source: fromFile(values.file) });
  if (values.url) sources.push({ label: values.url, source: await fromUrl(values.url) });
  if (sources.length === 0) throw new Error("Nothing to import: pass --dir, --file or --url");

  const titles = new Set<string>();
  for (const { label, source } of sources) {
    const overrides = { ...(values.title && !values.dir ? { title: values.title } : {}), ...(values.kind ? { kind: values.kind } : {}), ...(values.language ? { language: values.language } : {}) };
    const checked = validateKnowledgeInput({ ...source, ...overrides });
    if (!checked.ok) throw new Error(`${label}: ${checked.error}`);
    const result = await saveKnowledgeSource(businessId, checked.value, null);
    titles.add(checked.value.title);
    const state = result!.unchanged ? "unchanged" : "saved";
    const hidden = result!.hiddenAmounts ? `, ${result!.hiddenAmounts} amount(s) hidden from Zaina` : "";
    console.log(`[knowledge] ${state}: "${checked.value.title}" (${result!.passages} passages${hidden})`);
  }

  if (values.prune && values.dir) {
    for (const source of await listKnowledgeSources(businessId)) {
      if (titles.has(source.title)) continue;
      await deleteKnowledgeSource(businessId, source.id);
      console.log(`[knowledge] removed: "${source.title}"`);
    }
  }
}

main()
  .catch((error) => {
    console.error(`[knowledge] ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => closePlatformDb());
