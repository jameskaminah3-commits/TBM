// zaina-platform/test/e2e/scripted-model.mjs
//
// Test-only preload (node --import): replaces the Gemini API with a scripted
// model, and the email and exchange-rate services with local stand-ins, so
// the real pipeline (gateway → engine → connector → Postgres → reply policy
// → HTTP) runs locally without keys. Never load it in production.
//
// The customer message selects a scenario: "TEST:<name> [extra text]";
// "TEST:whoami" answers with the first line of the business's instructions
// and its tool names, "TEST:say64 <base64>" with exactly that text, and
// "TEST:ask <question>" searches the business's knowledge and answers from
// the first passage, naming its source. The system's <turn_context> block
// isn't part of what the customer wrote.
// Round 1 returns a scripted function call; round 2 returns a deliberately
// messy "model reply" (bold, bare paths, phishing link, foreign phone
// number, its own payment steps) so the server-side reply policy is tested.
// Token counts are estimated at four characters each, so telemetry has
// numbers to add up.
import { appendFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const LOG = process.env.FAKE_GEMINI_LOG;
// FAKE_GEMINI_DUMP_DIR=<dir> saves every request as sent, to measure what a call costs.
const DUMP_DIR = process.env.FAKE_GEMINI_DUMP_DIR;
let dumped = 0;
const realFetch = globalThis.fetch;

const customer = {
  customer_name: "Jane Wanjiru",
  customer_email: "jane@example.com",
  customer_phone: "0712345678",
};

const scenarios = {
  book_crash: () => scenarios.book_car(),
  book_car: () => ({ name: "create_service_booking", args: { ...customer, service_id: "car-noah", date: "2026-10-10", check_out: "2026-10-12", mode: "car-self-drive-day", guests: 4, service_pickup_location: "Moi International Airport", service_return_location: "Nyali", idempotency_key: randomUUID() } }),
  book_stay: () => ({ name: "create_draft_booking", args: { ...customer, stay_id: "stay-nyali-2br", check_in: "2026-10-10", check_out: "2026-10-13", guests: 3, idempotency_key: randomUUID() } }),
  clean: () => ({ name: "create_service_booking", args: { ...customer, service_id: "errand-clean", mode: "errand-house-cleaning", date: "2026-10-10", service_location: "Nyali", service_bedrooms: 3, idempotency_key: randomUUID() } }),
  clean_no_bedrooms: () => ({ name: "create_service_booking", args: { ...customer, service_id: "errand-clean", mode: "errand-house-cleaning", date: "2026-10-10", service_location: "Nyali", idempotency_key: randomUUID() } }),
  shop_kes: () => ({ name: "create_service_booking", args: { ...customer, service_id: "errand-shop", mode: "errand-shopping", date: "2026-10-10", service_location: "Nyali", service_budget_amount: 5000, service_budget_currency: "KES", service_request_details: "Milk, bread, eggs and fruit", idempotency_key: randomUUID() } }),
  shop_no_currency: () => ({ name: "create_service_booking", args: { ...customer, service_id: "errand-shop", mode: "errand-shopping", date: "2026-10-10", service_location: "Nyali", service_budget_amount: 5000, service_request_details: "Milk, bread, eggs and fruit", idempotency_key: randomUUID() } }),
  identify: () => ({ name: "identify_customer", args: { email: "someone@example.com" } }),
  lead: () => ({ name: "create_lead", args: { name: "Jane Wanjiru", email: "jane@example.com", interest: "December family trip to Diani" } }),
  ask: (customerText) => ({ name: "search_knowledge", args: { query: customerText.replace(/TEST:ask/, "").trim() } }),
  escalate: () => ({ name: "escalate_to_human", args: { reason: "Customer asked for a discount (internal note)" } }),
  verify: () => ({ name: "create_listing_verification_request", args: { ...customer, listing_url: "https://www.airbnb.com/rooms/123", verification_scope: "Check the property exists and matches the photos", idempotency_key: randomUUID() } }),
  // Realistic two-message flow: the model first calls without contact details
  // (the tool asks for them), then retries by copying its earlier arguments
  // from the conversation history — including the stored idempotency key.
  verify_start: (customerText) => ({ name: "create_listing_verification_request", args: { listing_url: (customerText.match(/https?:\/\/\S+/i) || [""])[0], verification_scope: "Check the property exists, matches the photos, and the host is genuine", listing_context: customerText.replace(/TEST:\w+/, "").trim(), idempotency_key: randomUUID() } }),
  verify_details: (customerText, contents) => {
    const [name, email] = customerText.replace(/TEST:\w+/, "").split(",").map((s) => s.trim());
    return { name: "create_listing_verification_request", args: { ...previousVerificationArgs(contents), customer_name: name, customer_email: email } };
  },
  // The customer answers the agent-number question; the model adds it.
  agent_number: (customerText, contents) => ({
    name: "create_listing_verification_request",
    args: { ...previousVerificationArgs(contents), agent_contact: customerText.replace(/TEST:\w+/, "").trim() },
  }),
  // The customer doesn't have the agent's number; the model calls again as before.
  no_agent_number: (customerText, contents) => ({ name: "create_listing_verification_request", args: previousVerificationArgs(contents) }),
  // No link: an agent shared the listing on WhatsApp.
  verify_nolink: (customerText) => ({ name: "create_listing_verification_request", args: { ...customer, listing_context: customerText.replace(/TEST:\w+/, "").trim(), verification_scope: "Check the house exists, has the pool, and the agent is genuine" } }),
  // The model calls before it has either a link or any details.
  verify_nothing: () => ({ name: "create_listing_verification_request", args: { ...customer, verification_scope: "Check the property exists and matches the advert" } }),
  // Uses whatever link (or link-like text) the customer pasted, as a model would.
  verify_link: (customerText) => ({ name: "create_listing_verification_request", args: { ...customer, listing_url: (customerText.match(/(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S+/i) || [""])[0], verification_scope: "Check the property exists, matches the photos, and the host is genuine", idempotency_key: randomUUID() } }),
  // "TEST:raw <tool_name> <json args>" — replays exactly the call a real model made.
  raw: (customerText) => {
    const m = customerText.match(/TEST:raw\s+(\S+)\s+(\{[\s\S]*\})\s*$/);
    return { name: m[1], args: JSON.parse(m[2]) };
  },
  // Same, with the JSON base64-encoded so invented contact details don't
  // appear in the customer's own message.
  raw64: (customerText) => {
    const m = customerText.match(/TEST:raw64\s+(\S+)\s+(\S+)/);
    return { name: m[1], args: JSON.parse(Buffer.from(m[2], "base64").toString("utf8")) };
  },
  // Production session 8657091d: the customer never gave a name or email, and
  // the tool schema required them, so the model filled them in.
  prod_verify_fabricated: (customerText) => ({
    name: "create_listing_verification_request",
    args: {
      verification_scope: "Confirm the pictures match the current state of the property, check it is close to the beach, and arrange a live video call if possible.",
      listing_context: `Airbnb shared by an agent on WhatsApp (customer has pictures). ${customerText.replace(/TEST:\w+/, "").trim()}`,
      location: "Nyali",
      customer_name: "Guest",
      customer_email: "guest@example.com",
    },
  }),
  custom: () => ({ name: "create_custom_offer", args: { ...customer, category: "service", offer_type: "photographer", request_details: "Beach photographer for 2 hours on 11 October", start_date: "2026-10-11", location: "Diani beach", tier: "intake", budget_amount: 20000, budget_currency: "KES", idempotency_key: randomUUID() } }),
  trip: () => ({ name: "compose_trip_package", args: { people: 2, check_in: "2026-10-10", check_out: "2026-10-12", budget_amount: 60000, budget_currency: "KES", destination_preference: "Diani" } }),
  search: () => ({ name: "search_stays", args: { region: "Diani" } }),
};

// The arguments of the model's last verification call, read back from the
// conversation history as a real model would copy them.
function previousVerificationArgs(contents) {
  const earlier = [...contents].reverse()
    .flatMap((c) => (c.parts || []).map((p) => p.text).filter(Boolean))
    .find((t) => t.includes('<tool_result name="create_listing_verification_request">'));
  return earlier ? JSON.parse(earlier.match(/args: (\{.*\})\nresult:/s)[1]) : {};
}

/** The customer's own words: the system's turn context removed. */
function withoutContext(text) {
  return text.replace(/\s*<turn_context>[\s\S]*?<\/turn_context>\s*/g, " ").trim();
}

function latestCustomerText(contents) {
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const c = contents[i];
    if (c.role !== "user") continue;
    const text = (c.parts || []).map((p) => p.text).filter(Boolean).join(" ");
    if (text && !text.startsWith("[earlier tool]") && !text.startsWith("<tool_result")) return withoutContext(text);
  }
  return "";
}

function messyReplyFor(name, result) {
  const r = result?.result ?? result ?? {};
  if (name === "search_stays") {
    const s = (r.stays || [])[0] || {};
    return [
      `**${s.title}**`,
      `${s.price_per_night_display}/night`,
      `[View full listing →](${s.public_url})`,
      "![photo](https://abc.supabase.co/storage/v1/object/public/media/a.jpg)",
      "Also see [this deal](javascript:alert(1)) or https://evil.example/pay — or pay M-Pesa to 0799111222.",
    ].join("\n");
  }
  if (name === "identify_customer") {
    return r.has_account ? "Good news — that email already has a TBM account!" : `Status: ${r.client_status ?? r.error}`;
  }
  if (name === "escalate_to_human") return "Let me connect you with someone from our team.";
  if (name === "search_knowledge") {
    const passage = (r.passages || [])[0];
    if (!passage) return "I'm not sure about that one — shall I ask the team for you?";
    return `From our ${passage.source}: ${passage.text.split("\n")[0].slice(0, 220)}${passage.link ? ` More: ${passage.link}` : ""}`;
  }
  if (name === "compose_trip_package") {
    return r.ok ? `Here's a package for you: total ${r.total}, budget ${r.budget}, within budget: ${r.within_budget}.` : `Package failed: ${r.error}`;
  }
  if (name === "create_listing_verification_request" && r.ok) {
    return `Karibu! I've opened a ${r.source_platform} listing verification for you (${r.location ?? "location to be confirmed"}). The fee is ${r.fee_display}.`;
  }
  if (r.ok && r.payment_link) {
    const id = r.booking_id;
    return [
      `**Booked!** It's all set. Total: ${r.total ?? r.fee_display}.`,
      `Pay here: /bookings?bookingId=${id}`,
      `Or here: [Pay now](${r.payment_link})`,
      "",
      "What happens next:",
      "• Log in and pay a 30% deposit.",
      "• If card fails, send M-Pesa to 0799111222.",
    ].join("\n");
  }
  return `Tool said: ${r.error ?? "ok"} ${r.hint ?? ""}`.trim();
}

let requestChars = 0;
function reply(parts) {
  const replyChars = JSON.stringify(parts).length;
  return new Response(JSON.stringify({
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: Math.round(requestChars / 4), candidatesTokenCount: Math.round(replyChars / 4) },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
  }, { once: true });
});

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  // Simulated live exchange rate (the sandbox can't reach the real sources).
  if (process.env.FAKE_USD_TO_KES && url.includes("api.frankfurter.app")) {
    return new Response(JSON.stringify({ amount: 1, base: "USD", date: "2026-09-25", rates: { KES: Number(process.env.FAKE_USD_TO_KES) } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("api.resend.com")) {
    // Simulated email provider: slow on purpose to expose blocking sends.
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_EMAIL_DELAY_MS || 0)));
    if (process.env.FAKE_EMAIL_LOG) {
      const { subject, text } = JSON.parse(init?.body ?? "{}");
      appendFileSync(process.env.FAKE_EMAIL_LOG, JSON.stringify({ at: new Date().toISOString(), subject, text }) + "\n");
    }
    return new Response(JSON.stringify({ id: "fake-email" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);

  const body = JSON.parse(init?.body ?? "{}");
  requestChars = String(init?.body ?? "").length;
  if (DUMP_DIR) {
    dumped += 1;
    writeFileSync(path.join(DUMP_DIR, `${String(dumped).padStart(4, "0")}.json`), String(init?.body ?? "{}"));
  }
  const contents = body.contents || [];
  const systemText = (body.systemInstruction?.parts || []).map((p) => p.text).join("");
  const toolNames = (body.tools || []).flatMap((t) => (t.functionDeclarations || []).map((d) => d.name));
  const last = contents[contents.length - 1] || {};
  const fnResponses = (last.parts || []).filter((p) => p.functionResponse);
  const customerText = latestCustomerText(contents);

  let out;
  if (/TEST:slow_reply/.test(customerText)) {
    await sleep(Number(process.env.SCRIPTED_SLOW_REPLY_MS || 1500), init?.signal);
    out = reply([{ text: "Here's that answer, a little slowly." }]);
  } else if (/TEST:slow\b/.test(customerText)) {
    // Slower than any turn budget: the engine must give up and answer.
    await sleep(Number(process.env.SCRIPTED_SLOW_MS || 60000), init?.signal);
    out = reply([{ text: "Too late." }]);
  } else if (/TEST:model_error/.test(customerText)) {
    out = new Response(JSON.stringify({ error: { code: 400, message: "Simulated invalid argument", status: "INVALID_ARGUMENT" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  } else if (fnResponses.length > 0 && /TEST:book_crash/.test(customerText)) {
    // Simulates the model failing after the booking tool already succeeded.
    out = new Response(JSON.stringify({ error: { code: 400, message: "Simulated invalid argument", status: "INVALID_ARGUMENT" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  } else if (fnResponses.length > 0) {
    const fr = fnResponses[0].functionResponse;
    out = reply([{ text: messyReplyFor(fr.name, fr.response) }]);
  } else if (/TEST:whoami/.test(customerText)) {
    // Which business's instructions and tools this chat runs on.
    out = reply([{ text: `${systemText.split("\n")[0]} Tools: ${toolNames.join(", ")}.` }]);
  } else if (/TEST:say64\s+\S+/.test(customerText)) {
    // Says exactly this (base64, so the text isn't in the customer's own message).
    out = reply([{ text: Buffer.from(customerText.match(/TEST:say64\s+(\S+)/)[1], "base64").toString("utf8") }]);
  } else {
    const match = customerText.match(/TEST:(\w+)/);
    const scenario = match && scenarios[match[1]];
    out = scenario
      ? reply([{ functionCall: scenario(customerText, contents), thoughtSignature: "fake-signature" }])
      : reply([{ text: "Karibu! How can I help you plan your Coast trip?" }]);
  }

  if (LOG) {
    appendFileSync(LOG, JSON.stringify({
      at: new Date().toISOString(),
      customerText,
      phase: fnResponses.length ? "after_tool" : "first",
      systemChars: systemText.length,
      toolsChars: JSON.stringify(body.tools ?? []).length,
      contentsChars: JSON.stringify(contents).length,
      contentsCount: contents.length,
      toolNames,
      // Phase 2: the instructions and tools must be the same for every call,
      // and the turn's context must travel with the latest message.
      systemHash: createHash("sha256").update(systemText).digest("hex").slice(0, 16),
      toolsHash: createHash("sha256").update(JSON.stringify(body.tools ?? [])).digest("hex").slice(0, 16),
      lastUserHasContext: [...contents].reverse().find((c) => c.role === "user" && (c.parts || []).some((p) => typeof p.text === "string" && !p.text.startsWith("<tool_result")))
        ?.parts?.some((p) => typeof p.text === "string" && p.text.includes("<turn_context>")) ?? false,
      mentions12: /12%/.test(systemText),
      mentions30: /\b30%|"percent": 30|deposit_percent": 30/.test(systemText),
      earlierToolFormat: contents.some((c) => (c.parts || []).some((p) => typeof p.text === "string" && p.text.startsWith("[earlier tool]"))) ? "legacy" : contents.some((c) => (c.parts || []).some((p) => typeof p.text === "string" && p.text.startsWith("<tool_result"))) ? "delimited" : "none",
    }) + "\n");
  }
  return out;
};
