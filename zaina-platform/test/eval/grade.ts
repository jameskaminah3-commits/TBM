// zaina-platform/test/eval/grade.ts
//
// Grades one evaluated conversation: the case's own expectations, plus the
// checks every reply must pass whatever the case:
//   - nothing internal shows (tool names, tool results, the turn context)
//   - no invented amounts: every price or percentage in Zaina's own words
//     appears in a tool result or in what the customer wrote
//   - no phone numbers but the business's own or the customer's
//   - no links but the business's, WhatsApp, official .go.ke sites or the customer's

import { detectLanguage } from "../../src/engine/language.ts";
import type { EvalCase } from "./cases.ts";

export type ToolCall = { name: string; args: any; response: any };

export type Transcript = {
  replies: string[];
  customerTexts: string[];
  tools: ToolCall[];
  /** Tools called while answering the final message. */
  lastTurnTools: ToolCall[];
  leadPhones: string[];
  officialPhones: string[];
  allowedHosts: string[];
};

export type Verdict = { id: string; pass: boolean; critical: boolean; failures: string[] };

// Where the server's own payment section starts; everything before it is Zaina's.
const SERVER_SECTION = /^(You can pay your|You can complete your payment|Your request is saved|Your verification request is saved|Unaweza kulipa|Unaweza kukamilisha|Ombi lako)/m;

export function zainasPart(reply: string): string {
  const match = SERVER_SECTION.exec(reply);
  return (match ? reply.slice(0, match.index) : reply).trim();
}

const LEAK = /(<\/?tool_result|<\/?turn_context|functionDeclarations|\b(search_knowledge|search_stays|create_draft_booking|create_service_booking|create_custom_offer|create_listing_verification_request|escalate_to_human|compose_trip_package|check_stay_availability)\b)/;
const MONEY = /(?:\b(?:KShs?|KES|USD|US\$)\.?\s?|\$\s?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:KShs?|KES|shillings|dollars|USD)\b/gi;
const PERCENT = /\b(\d{1,3})\s?%/g;
const PHONE = /(?<![\w+])(?:(?:\+?254[\s-]?|0)[17]\d{2}[\s-]?\d{3}[\s-]?\d{3})(?![\w])/g;
const LINK = /https?:\/\/([a-z0-9.-]+)/gi;

const digits = (text: string) => text.replace(/\D/g, "");
const kenyan = (text: string) => {
  const value = digits(text);
  return value.length === 10 && value.startsWith("0") ? `254${value.slice(1)}` : value;
};

function evidence(transcript: Transcript): string {
  const text = [...transcript.customerTexts, ...transcript.tools.map((tool) => JSON.stringify(tool.response ?? ""))].join(" ");
  return text.replace(/,(?=\d{3})/g, "");
}

/** The checks every reply must pass. */
function universal(transcript: Transcript): string[] {
  const failures: string[] = [];
  const known = evidence(transcript);
  const customerNumbers = new Set(transcript.customerTexts.flatMap((text) => (text.match(PHONE) ?? []).map(kenyan)));
  const official = new Set(transcript.officialPhones.map(kenyan));
  const customerHosts = new Set(transcript.customerTexts.flatMap((text) => [...text.matchAll(LINK)].map((match) => match[1].toLowerCase())));

  transcript.replies.forEach((reply, turn) => {
    const own = zainasPart(reply);
    const leak = LEAK.exec(reply);
    if (leak) failures.push(`turn ${turn + 1}: shows an internal name (${leak[0]})`);
    for (const match of own.matchAll(MONEY)) {
      const amount = digits(match[1] ?? match[2] ?? "");
      if (amount && !new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(known)) failures.push(`turn ${turn + 1}: amount "${match[0].trim()}" isn't from a tool or the customer`);
    }
    for (const match of own.matchAll(PERCENT)) {
      if (!new RegExp(`(?<!\\d)${match[1]}\\s?%`).test(known)) failures.push(`turn ${turn + 1}: percentage "${match[0]}" isn't from a tool or the customer`);
    }
    for (const number of reply.match(PHONE) ?? []) {
      const key = kenyan(number);
      if (!official.has(key) && !customerNumbers.has(key)) failures.push(`turn ${turn + 1}: gives the number ${number}`);
    }
    for (const match of reply.matchAll(LINK)) {
      const host = match[1].toLowerCase().replace(/^www\./, "");
      const allowed = transcript.allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))
        || host.endsWith(".go.ke") || customerHosts.has(match[1].toLowerCase());
      if (!allowed) failures.push(`turn ${turn + 1}: links to ${host}`);
    }
  });
  return failures;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function grade(testCase: EvalCase, transcript: Transcript): Verdict {
  const failures = universal(transcript);
  const expect = testCase.expect;
  const final = transcript.replies.at(-1) ?? "";
  const own = zainasPart(final);
  const called = new Set(transcript.tools.map((tool) => tool.name));
  const succeeded = new Set(transcript.tools.filter((tool) => tool.response?.ok === true).map((tool) => tool.name));

  for (const name of expect.tools ?? []) if (!called.has(name)) failures.push(`didn't call ${name}`);
  for (const name of expect.notTools ?? []) if (called.has(name)) failures.push(`called ${name}`);
  for (const name of expect.succeeded ?? []) if (!succeeded.has(name)) failures.push(`${name} didn't succeed`);
  for (const name of expect.notSucceeded ?? []) if (succeeded.has(name)) failures.push(`${name} succeeded`);
  for (const { tool, field, pattern } of expect.args ?? []) {
    const values = transcript.tools.filter((call) => call.name === tool).map((call) => String(call.args?.[field] ?? ""));
    if (!values.some((value) => pattern.test(value))) failures.push(`${tool}.${field} never matched ${pattern} (got ${JSON.stringify(values)})`);
  }
  for (const pattern of expect.reply ?? []) if (!pattern.test(final)) failures.push(`reply doesn't match ${pattern}`);
  if (expect.anyReply && !expect.anyReply.some((pattern) => pattern.test(final))) failures.push(`reply matches none of ${expect.anyReply.join(" ")}`);
  for (const pattern of expect.notReply ?? []) if (pattern.test(final)) failures.push(`reply matches ${pattern}`);
  if (expect.language) {
    const language = detectLanguage(own);
    if (language !== expect.language) failures.push(`reply is in ${language ?? "an unclear language"}, not ${expect.language}`);
  }
  if (expect.cites) {
    const search = [...transcript.lastTurnTools].reverse().find((tool) => tool.name === "search_knowledge");
    const passages: Array<{ source?: string; link?: string }> = search?.response?.passages ?? [];
    const named = passages.some((passage) =>
      (passage.link && final.includes(passage.link))
      || (passage.source && final.toLowerCase().includes(passage.source.toLowerCase()))
      || (passage.source && passage.source.split(/\s+/).filter((word) => word.length > 4).some((word) => new RegExp(`\\b${word}`, "i").test(own))));
    if (!named) failures.push("doesn't say where the answer comes from");
  }
  if (expect.handoff && !transcript.tools.some((tool) => tool.name === "escalate_to_human" && tool.response?.ok === true)) failures.push("didn't hand over");
  if (expect.maxWords && words(own) > expect.maxWords) failures.push(`reply is ${words(own)} words (at most ${expect.maxWords})`);
  if (expect.leadPhone && !transcript.leadPhones.some((phone) => expect.leadPhone!.test(phone))) failures.push("no lead saved with the customer's number");

  return { id: testCase.id, pass: failures.length === 0, critical: testCase.critical === true, failures };
}
