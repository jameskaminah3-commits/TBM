// TBM's instructions and knowledge (Phase 2). The rules the catalog tests
// enforced (the audit's C3: no money facts written twice) now apply to the
// prompt and to TBM's knowledge files, and the prompt must stay static.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bookingPaymentHoldMinutes } from "../../../shared/booking-payments.ts";
import type { BusinessConnector } from "../../src/connectors/types.ts";
import { tbmToolDeclarations } from "../../src/connectors/tbm/declarations.ts";
import { buildTbmSystemPrompt, TBM_SYSTEM_PROMPT } from "../../src/connectors/tbm/prompt.ts";
import { toolDeclarationsFor } from "../../src/engine/tool-sets.ts";
import { chunkDocument } from "../../src/knowledge/chunk.ts";
import { parseMarkdownSource, type ImportedSource } from "../../src/knowledge/import.ts";
import { hideAmounts } from "../../src/knowledge/money.ts";
import { KnowledgeIndex, type IndexedPassage } from "../../src/knowledge/search-index.ts";
import { validateKnowledgeInput } from "../../src/knowledge/store.ts";

// TBM's tools as its connector declares them (the connector itself needs TBM's database).
const tbmConnector = { toolDeclarations: () => tbmToolDeclarations.flatMap((group) => group.functionDeclarations), readOnlyTools: new Set() } as unknown as BusinessConnector;

const KNOWLEDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../knowledge/tbm");
const files = readdirSync(KNOWLEDGE_DIR).filter((file) => file.endsWith(".md"));
const sources: Array<ImportedSource & { file: string }> = files.map((file) => ({
  ...parseMarkdownSource(readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8"), file),
  file,
}));

test("the prompt never changes between calls: no clock, no date, no catalog", () => {
  assert.equal(buildTbmSystemPrompt(), TBM_SYSTEM_PROMPT);
  assert.doesNotMatch(TBM_SYSTEM_PROMPT, /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
  assert.doesNotMatch(TBM_SYSTEM_PROMPT, /"regions"|"trip_scenarios"|INVENTORY_CATALOG/);
  assert.match(TBM_SYSTEM_PROMPT, /<turn_context>/);
  assert.match(TBM_SYSTEM_PROMPT, new RegExp(`held for ${bookingPaymentHoldMinutes} minutes`));
});

test("the prompt and tools stay lean", () => {
  // About a quarter of today's prompt; tokens are measured for real in the evaluation.
  assert.ok(TBM_SYSTEM_PROMPT.length < 10_500, `prompt is ${TBM_SYSTEM_PROMPT.length} characters`);
  const tools = JSON.stringify(toolDeclarationsFor({ businessType: "travel_concierge" } as never, tbmConnector));
  assert.ok(tools.length < 13_000, `tools are ${tools.length} characters`);
});

test("every business gets knowledge search and a handoff; TBM keeps its own tools", () => {
  const names = toolDeclarationsFor({ businessType: "travel_concierge" } as never, tbmConnector).map((tool) => tool.name);
  assert.ok(names.includes("search_knowledge"));
  assert.equal(names.filter((name) => name === "escalate_to_human").length, 1);
  for (const name of ["search_stays", "create_draft_booking", "create_service_booking", "create_custom_offer", "create_listing_verification_request"]) {
    assert.ok(names.includes(name), name);
  }
});

test("the prompt and knowledge carry no prices, fees, discounts or exchange rates", () => {
  for (const text of [TBM_SYSTEM_PROMPT, ...sources.map((source) => source.content)]) {
    assert.doesNotMatch(text, /fee_usd|kes_fallback_rate|bundle_discount|\b12%|\$\d|KSh ?\d|USD ?\d/);
    assert.doesNotMatch(text, /\b\d{1,3} ?%/, "no deposit or discount percentages: they come from the payment tools");
  }
  for (const source of sources) assert.equal(hideAmounts(source.content).hidden, 0, `${source.file} has amounts`);
});

test("cancellation is never promised free and points to the published policy", () => {
  for (const text of [TBM_SYSTEM_PROMPT, ...sources.map((source) => source.content)]) assert.doesNotMatch(text, /free cancellation/i);
  const policy = sources.find((source) => /cancellation/i.test(source.title));
  assert.match(String(policy?.url), /\/refund-cancellation$/);
});

test("every knowledge file is a valid source with passages", () => {
  const titles = new Set<string>();
  for (const source of sources) {
    const checked = validateKnowledgeInput(source);
    assert.ok(checked.ok, `${source.file}: ${!checked.ok && checked.error}`);
    assert.ok(!titles.has(source.title), `duplicate title ${source.title}`);
    titles.add(source.title);
    assert.ok(chunkDocument(source.content, { title: source.title }).length > 0);
  }
});

test("TBM's questions find the right passage; unrelated ones find nothing", () => {
  const passages: IndexedPassage[] = sources.flatMap((source, index) => chunkDocument(source.content, { title: source.title }).map((passage, position) => ({
    id: index * 100 + position,
    sourceId: source.file,
    title: source.title,
    url: (source.url as string | undefined) ?? null,
    kind: String(source.kind ?? "page"),
    heading: passage.heading,
    content: passage.content,
  })));
  const index = new KnowledgeIndex(passages);
  const top = (question: string) => index.search(question)[0];
  const expectations: Array<[string, RegExp]> = [
    ["How do we get to Diani from the airport?", /Getting to and around/],
    ["Is the Coast safe for kids?", /travel tips/],
    ["What's your cancellation policy?", /Refund and cancellation/],
    ["Can I pay with M-Pesa?", /How booking and payment work|travel tips/],
    ["What does the verification report include?", /Listing verification/],
    ["Do chefs bring groceries?", /Private chefs/],
    ["Which area is best for nightlife?", /Coast areas/],
    ["What is MamaCare?", /MamaCare/],
    ["When is the rainy season?", /travel tips/],
    ["What are your support hours?", /About Tembea Bila Matata/],
    ["Hali ya hewa ikoje, mvua inanyesha lini?", /travel tips/],
    ["Tunaweza kulipa kwa mpesa?", /How booking and payment work|travel tips/],
  ];
  for (const [question, expected] of expectations) assert.match(top(question)?.title ?? "(nothing)", expected, question);
  for (const question of ["Do you sell iPhones?", "Football match tickets", "bitcoin mining"]) {
    assert.deepEqual(index.search(question), [], question);
  }
});
