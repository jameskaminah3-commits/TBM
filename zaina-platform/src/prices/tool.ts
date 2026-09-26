// zaina-platform/src/prices/tool.ts
//
// get_prices: the business's price list for Zaina (every business on the
// platform's own connectors; TBM prices through its own system). Prices
// come back written out ("KSh 3,500 per car"), to be quoted as they are;
// nothing else is a source of prices (documents have their amounts hidden).
// A question the list doesn't answer is recorded with the business's
// unanswered questions.

import { Type, type FunctionDeclaration } from "@google/genai";
import { textArg } from "../engine/tool-args.ts";
import { recordKnowledgeMiss } from "../knowledge/store.ts";
import { listPriceItems, priceText } from "./price-list.ts";
import type { PriceItem } from "../db/schema.ts";

export const GET_PRICES = "get_prices";

export const getPricesDeclaration: FunctionDeclaration = {
  name: GET_PRICES,
  description:
    "The business's price list (things not booked here: extras, services, products). " +
    "The only source of these prices: quote them exactly as returned.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "What the customer asks the price of, in a few English words. Empty for the whole list." },
    },
  },
};

const HOW_TO_USE =
  "These are the business's own prices. Quote each exactly as written (the amount, the currency, what it's per). " +
  "Don't convert currencies or add up totals. If what the customer asks isn't listed, say you're not sure and offer to pass it to the team.";
const NO_LIST = "This business has no price list. Don't guess a price: say you're not sure and offer to pass the question to the team.";
const NOT_LISTED = "Nothing on the price list matches. Don't guess a price: say you're not sure and offer to pass the question to the team.";

const WHOLE_LIST = 40;
const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
  .filter((word) => word.length > 2 && !["the", "and", "for", "how", "much", "price", "cost", "does", "what", "per"].includes(word))
  .map((word) => (word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));

/** Items matching the question, best first: words in the name count most, then the section, then the description. */
export function matchPriceItems(items: PriceItem[], query: string): PriceItem[] {
  const wanted = new Set(words(query));
  if (!wanted.size) return [];
  const scored = items.map((item) => {
    const score = (text: string | null, weight: number) => words(text ?? "").filter((word) => wanted.has(word)).length * weight;
    return { item, score: score(item.name, 3) + score(item.section, 2) + score(item.description, 1) };
  }).filter((entry) => entry.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, 12).map((entry) => entry.item);
}

const shown = (item: PriceItem) => ({
  ...(item.section ? { section: item.section } : {}),
  name: item.name,
  price: priceText(item),
  ...(item.description ? { about: item.description } : {}),
});

export async function runGetPrices(args: unknown, context: { businessId: string; sessionId: string | null }) {
  const query = textArg((args as { query?: unknown } | null)?.query).slice(0, 200);
  const items = await listPriceItems(context.businessId, { activeOnly: true });
  if (!items.length) return { ok: true, items: [], note: NO_LIST };
  const matches = query ? matchPriceItems(items, query) : [];
  if (matches.length) return { ok: true, items: matches.map(shown), note: HOW_TO_USE };
  if (query) {
    await recordKnowledgeMiss(context.businessId, context.sessionId, `Price: ${query}`).catch((error) => {
      console.error("[prices] recording a missed question failed:", error);
    });
  }
  // A short list is given whole, so the answer can come from it; a long one by its sections.
  if (items.length <= WHOLE_LIST) return { ok: true, items: items.map(shown), note: query ? `${NOT_LISTED} The whole list is here in case it's under another name.` : HOW_TO_USE };
  const sections = [...new Set(items.map((item) => item.section).filter(Boolean))];
  return { ok: true, items: [], sections, note: query ? `${NOT_LISTED} Its sections are listed: ask again with one of them.` : "The list is long: ask for what the customer wants, or a section." };
}
