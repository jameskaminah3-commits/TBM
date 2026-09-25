// zaina-platform/src/knowledge/store.ts
//
// A business's knowledge in the database: its sources (what it wrote or
// imported) and their passages, rebuilt in the same transaction whenever a
// source changes. Also the questions nobody could answer. Everything runs
// inside the business's scope.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  chatLanguages,
  knowledgeChunks,
  knowledgeKinds,
  knowledgeMisses,
  knowledgeSources,
  type ChatLanguage,
  type KnowledgeKind,
  type KnowledgeSource,
} from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { chunkDocument } from "./chunk.ts";
import { hideAmounts } from "./money.ts";
import type { IndexedPassage } from "./search-index.ts";

export type KnowledgeInput = {
  title: string;
  kind: KnowledgeKind;
  url: string | null;
  language: ChatLanguage;
  content: string;
  status: "published" | "draft";
};

export const MAX_KNOWLEDGE_CHARS = 200_000;

/** Checks a source sent by staff or the import command. */
export function validateKnowledgeInput(input: Record<string, unknown>): { ok: true; value: KnowledgeInput } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) return { ok: false, error: "A title of 1 to 200 characters is required." };
  const kind = (input.kind ?? "page") as KnowledgeKind;
  if (!knowledgeKinds.includes(kind)) return { ok: false, error: `kind is one of ${knowledgeKinds.join(", ")}.` };
  const url = input.url === undefined || input.url === null || input.url === "" ? null : String(input.url).trim();
  if (url !== null && !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: "url must start with https://" };
  const language = (input.language ?? "en") as ChatLanguage;
  if (!chatLanguages.includes(language)) return { ok: false, error: `language is one of ${chatLanguages.join(", ")}.` };
  const content = typeof input.content === "string" ? input.content.replace(/\r\n?/g, "\n").trim() : "";
  if (!content) return { ok: false, error: "content is required." };
  if (content.length > MAX_KNOWLEDGE_CHARS) return { ok: false, error: `content is at most ${MAX_KNOWLEDGE_CHARS} characters.` };
  const status = input.status === "draft" ? "draft" : "published";
  return { ok: true, value: { title, kind, url, language, content, status } };
}

function hashOf(input: KnowledgeInput): string {
  return createHash("sha256").update(JSON.stringify([input.title, input.kind, input.url, input.language, input.status, input.content])).digest("hex");
}

export type SaveResult = { source: KnowledgeSource; passages: number; hiddenAmounts: number; unchanged: boolean };

/**
 * Saves a source (by id, or by title when no id is given) and rebuilds its
 * passages. An unchanged source is left as it is.
 */
export async function saveKnowledgeSource(businessId: string, input: KnowledgeInput, updatedBy: string | null, id?: string): Promise<SaveResult | null> {
  const contentHash = hashOf(input);
  const passages = chunkDocument(input.content, { title: input.title });
  const { hidden } = hideAmounts(input.content);
  return inBusiness(async (db) => {
    const [existing] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.businessId, businessId), id ? eq(knowledgeSources.id, id) : eq(knowledgeSources.title, input.title)))
      .limit(1);
    if (id && !existing) return null;
    if (existing && existing.contentHash === contentHash) {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, existing.id));
      return { source: existing, passages: count, hiddenAmounts: hidden, unchanged: true };
    }
    const values = { ...input, contentHash, updatedBy, updatedAt: new Date() };
    const [source] = existing
      ? await db.update(knowledgeSources).set(values).where(and(eq(knowledgeSources.businessId, businessId), eq(knowledgeSources.id, existing.id))).returning()
      : await db.insert(knowledgeSources).values({ businessId, ...values }).returning();
    await db.delete(knowledgeChunks).where(and(eq(knowledgeChunks.businessId, businessId), eq(knowledgeChunks.sourceId, source.id)));
    if (passages.length) {
      await db.insert(knowledgeChunks).values(passages.map((passage, position) => ({
        businessId,
        sourceId: source.id,
        position,
        heading: passage.heading,
        content: passage.content,
      })));
    }
    return { source, passages: passages.length, hiddenAmounts: hidden, unchanged: false };
  }, businessId);
}

export async function listKnowledgeSources(businessId: string) {
  return inBusiness((db) => db
    .select({
      id: knowledgeSources.id,
      title: knowledgeSources.title,
      kind: knowledgeSources.kind,
      url: knowledgeSources.url,
      language: knowledgeSources.language,
      status: knowledgeSources.status,
      updatedAt: knowledgeSources.updatedAt,
      passages: sql<number>`(select count(*)::int from knowledge_chunks c where c.source_id = knowledge_sources.id)`,
      characters: sql<number>`length(${knowledgeSources.content})`,
    })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.businessId, businessId))
    .orderBy(asc(knowledgeSources.title)), businessId);
}

export async function getKnowledgeSource(businessId: string, id: string): Promise<KnowledgeSource | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.businessId, businessId), eq(knowledgeSources.id, id)))
    .limit(1), businessId);
  return row;
}

export async function deleteKnowledgeSource(businessId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await inBusiness((db) => db
    .delete(knowledgeSources)
    .where(and(eq(knowledgeSources.businessId, businessId), eq(knowledgeSources.id, id)))
    .returning({ id: knowledgeSources.id }), businessId);
  return rows.length > 0;
}

/** Changes whenever a published source is added, changed or removed. */
export async function knowledgeVersion(businessId: string): Promise<string> {
  const [row] = await inBusiness((db) => db
    .select({ count: sql<number>`count(*)::int`, latest: sql<string | null>`max(${knowledgeSources.updatedAt})::text` })
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.businessId, businessId), eq(knowledgeSources.status, "published"))), businessId);
  return `${row?.count ?? 0}:${row?.latest ?? "-"}`;
}

/** Every passage of the business's published sources, for the search index. */
export async function loadPassages(businessId: string): Promise<IndexedPassage[]> {
  return inBusiness((db) => db
    .select({
      id: knowledgeChunks.id,
      sourceId: knowledgeChunks.sourceId,
      title: knowledgeSources.title,
      url: knowledgeSources.url,
      kind: knowledgeSources.kind,
      heading: knowledgeChunks.heading,
      content: knowledgeChunks.content,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, and(eq(knowledgeSources.id, knowledgeChunks.sourceId), eq(knowledgeSources.businessId, knowledgeChunks.businessId)))
    .where(and(eq(knowledgeChunks.businessId, businessId), eq(knowledgeSources.status, "published")))
    .orderBy(asc(knowledgeChunks.sourceId), asc(knowledgeChunks.position)), businessId);
}

export async function recordKnowledgeMiss(businessId: string, sessionId: string | null, query: string): Promise<void> {
  await inBusiness((db) => db.insert(knowledgeMisses).values({ businessId, sessionId, query: query.slice(0, 300) }), businessId);
}

/** Questions Zaina found nothing for, most asked first. */
export async function listKnowledgeMisses(businessId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return inBusiness((db) => db
    .select({
      query: sql<string>`lower(${knowledgeMisses.query})`,
      times: sql<number>`count(*)::int`,
      lastAsked: sql<Date>`max(${knowledgeMisses.createdAt})`,
    })
    .from(knowledgeMisses)
    .where(and(eq(knowledgeMisses.businessId, businessId), sql`${knowledgeMisses.createdAt} >= ${since}`))
    .groupBy(sql`lower(${knowledgeMisses.query})`)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${knowledgeMisses.createdAt})`))
    .limit(100), businessId);
}
