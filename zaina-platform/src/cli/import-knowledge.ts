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
import path from "node:path";
import { parseArgs } from "node:util";
import { closePlatformDb, initPlatformDb } from "../db/platform-db.ts";
import { htmlToText, type ImportedSource } from "../knowledge/import.ts";
import { describeOutcome, saveImportedSources, sourceFromFile, sourcesInDirectory } from "../knowledge/import-files.ts";
import { deleteKnowledgeSource, listKnowledgeSources } from "../knowledge/store.ts";

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
  if (values.dir) sources.push(...sourcesInDirectory(values.dir));
  if (values.file) sources.push({ label: path.basename(values.file), source: sourceFromFile(values.file) });
  if (values.url) sources.push({ label: values.url, source: await fromUrl(values.url) });
  if (sources.length === 0) throw new Error("Nothing to import: pass --dir, --file or --url");

  const overrides = {
    ...(values.title && !values.dir ? { title: values.title } : {}),
    ...(values.kind ? { kind: values.kind } : {}),
    ...(values.language ? { language: values.language } : {}),
  } as Partial<ImportedSource>;
  const outcomes = await saveImportedSources(businessId, sources, overrides);
  const titles = new Set(outcomes.map((outcome) => outcome.title));
  for (const outcome of outcomes) console.log(`[knowledge] ${describeOutcome(outcome)}`);

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
