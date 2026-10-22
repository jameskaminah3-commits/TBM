// "Write with AI" on the admin SEO page: the model rewrites the title and
// description and adds search phrases, from the listing's own facts and the
// rules-based suggestions. Its answer is checked before admin sees it: lengths
// that fit Google, no competitor brand names, and nothing outside the listing.
// Admin still chooses and saves; nothing here is published on its own.
import { GoogleGenAI } from "@google/genai";
import {
  seoDescriptionLimit,
  seoTitleLimit,
  type SeoCompetition,
  type SeoKeyword,
  type SeoListingInput,
  type SeoSuggestions,
} from "../shared/listing-seo.ts";

const competitorBrands = /\b(airbnb|booking\.com|booking com|tripadvisor|expedia|getyourguide|viator|kayak|rentalcars|discover cars|uber|bolt|jiji)\b/i;

export type AiSeoSuggestions = { titles: string[]; description: string | null; keywords: SeoKeyword[]; tips: string[] };

const clean = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

/** Keeps only what is safe to offer admin: Google-sized, no competitor brands, no hype words the listing doesn't use. */
export function cleanAiSeo(raw: unknown, input: SeoListingInput): AiSeoSuggestions {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const listingText = `${input.name} ${input.description} ${input.features.join(" ")}`.toLowerCase();
  const hype = /\b(best|cheapest|no\.? ?1|number one|#1|luxury|luxurious|world[- ]class|unforgettable|stunning)\b/gi;
  const unbackedHype = (textValue: string) => (textValue.match(hype) ?? []).some((word) => !listingText.includes(word.toLowerCase()));
  const ok = (textValue: string) => textValue.length > 0 && !competitorBrands.test(textValue) && !unbackedHype(textValue);

  const titles = (Array.isArray(value.titles) ? value.titles : [])
    .map((title) => clean(title, 120))
    .filter((title) => ok(title) && title.length >= 20 && title.length <= seoTitleLimit)
    .slice(0, 3);
  const description = clean(value.description, 400);
  const keywords = (Array.isArray(value.keywords) ? value.keywords : [])
    .map((item) => {
      const entry = (item && typeof item === "object" ? item : { phrase: item }) as Record<string, unknown>;
      const phrase = clean(entry.phrase, 80).toLowerCase();
      const competition: SeoCompetition = entry.competition === "High" || entry.competition === "Lower" ? entry.competition : "Medium";
      return { phrase, competition, intent: entry.intent === "Planning" ? "Planning" : "Booking", why: clean(entry.why, 200) || "Suggested by AI from the listing's facts." } as SeoKeyword;
    })
    .filter((keyword) => ok(keyword.phrase) && keyword.phrase.split(" ").length >= 2)
    .slice(0, 10);
  const tips = (Array.isArray(value.tips) ? value.tips : []).map((tip) => clean(tip, 240)).filter((tip) => tip.length > 0).slice(0, 4);
  return {
    titles,
    description: ok(description) && description.length >= 70 && description.length <= seoDescriptionLimit + 5 ? description : null,
    keywords,
    tips,
  };
}

const model = process.env.SEO_AI_MODEL?.trim() || "gemini-3.5-flash-lite";

export function seoAiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function suggestSeoWithAi(input: SeoListingInput, rules: SeoSuggestions): Promise<AiSeoSuggestions> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const facts = {
    kind: input.kind,
    name: input.name,
    location: input.location,
    area: rules.area?.name ?? null,
    listingText: input.description.slice(0, 2000),
    features: input.features.slice(0, 30),
    stay: input.stay ?? null,
    car: input.car ?? null,
    chef: input.cook ?? null,
    homeHelp: input.errand ? { service: input.errand.serviceName } : null,
    experience: input.experience ?? null,
    reviewCount: input.reviewCount,
  };
  const prompt = [
    "You are an SEO specialist for Tembea Bila Matata (TBM), a booking site for stays, car hire, private chefs, home help and experiences on the Kenyan Coast. Guests pay through TBM by M-Pesa or card, with prices in KSh.",
    "Improve this listing's Google title, Google description and search phrases so it can outrank bigger sites on specific searches.",
    `Competitors for this kind of listing: ${rules.competitors.map((competitor) => `${competitor.name} (${competitor.where})`).join("; ")}.`,
    `Phrases the rules already found: ${rules.keywords.map((keyword) => `${keyword.phrase} [${keyword.competition}]`).join("; ")}.`,
    "Rules:",
    `- Titles: 3 options, each 30 to ${seoTitleLimit} characters, the main search phrase first, then the listing's name.`,
    `- Description: 120 to ${seoDescriptionLimit} characters, the main phrase in the first sentence, two facts from the listing, and end with booking on TBM by M-Pesa or card.`,
    "- Keywords: up to 8 phrases real guests type into Google, each with competition High, Medium or Lower and one short reason. Prefer specific phrases (place + feature) the big sites don't target.",
    "- Use only facts in the listing below. Never invent a pool, a view, a distance, a landmark, a price or a rating.",
    "- Never use a competitor's name. No hype words such as best, luxury, stunning or unforgettable unless the listing text uses them.",
    "- Home help and childcare: never a person's name.",
    "- Tips: up to 3 short, specific changes to the listing text that would help it rank.",
    "- British English. Answer with JSON only: {\"titles\":[],\"description\":\"\",\"keywords\":[{\"phrase\":\"\",\"competition\":\"\",\"why\":\"\"}],\"tips\":[]}",
    "",
    `Listing: ${JSON.stringify(facts)}`,
  ].join("\n");

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseMimeType: "application/json", temperature: 0.4 },
  });
  const textValue = response.text ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(textValue.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The AI answer wasn't readable. Try again.");
  }
  return cleanAiSeo(parsed, input);
}
