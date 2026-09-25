// zaina-platform/src/knowledge/search.ts
//
// Searching a business's knowledge. Each business's passages are indexed in
// memory and rebuilt when its knowledge changes (one small query per search
// checks). Amounts are hidden from what comes back: prices come from the
// booking tools, never from documents.

import { hideAmounts } from "./money.ts";
import { KnowledgeIndex } from "./search-index.ts";
import { knowledgeVersion, loadPassages } from "./store.ts";

export type KnowledgePassage = {
  sourceId: string;
  title: string;
  url: string | null;
  kind: string;
  section: string | null;
  text: string;
  relevance: number;
};

const indexes = new Map<string, { version: string; index: KnowledgeIndex }>();

async function indexFor(businessId: string): Promise<KnowledgeIndex> {
  const version = await knowledgeVersion(businessId);
  const cached = indexes.get(businessId);
  if (cached && cached.version === version) return cached.index;
  const index = new KnowledgeIndex(await loadPassages(businessId));
  indexes.set(businessId, { version, index });
  return index;
}

export async function searchKnowledge(businessId: string, question: string, limit = 3): Promise<KnowledgePassage[]> {
  const index = await indexFor(businessId);
  return index.search(question, limit).map((hit) => ({
    sourceId: hit.sourceId,
    title: hit.title,
    url: hit.url,
    kind: hit.kind,
    section: hit.heading,
    text: hideAmounts(hit.content).text,
    relevance: hit.relevance,
  }));
}

/** For tests: forget cached indexes. */
export function clearKnowledgeIndexes() {
  indexes.clear();
}
