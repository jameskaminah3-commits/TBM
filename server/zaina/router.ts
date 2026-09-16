// server/zaina/router.ts
//
// Zaina's reasoning layer. This is where the model thinks and acts.
//
// RESPONSIBILITIES:
//   1. Enforce the state gate (managedBy = AI vs HUMAN).
//   2. Load conversation history from the audit log.
//   3. Run the agentic loop: model → tool call(s) → tool results → model.
//   4. Log every user message, tool call, and assistant reply.
//   5. Fail safe: any error flips the session to HUMAN and alerts ops.

import { GoogleGenAI, Type } from "@google/genai";
import { db } from "../db";
import { chatSessions, zainaAuditLogs } from "@shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { INVENTORY_CATALOG } from "./catalog";
import {
  searchStays,
  searchCooks,
  searchCars,
  searchErrands,
  searchExperiences,
  checkStayAvailability,
  calculateChefPrice,
  calculateMamaCarePrice,
  composeTripPackage,
  createDraftBooking,
  createCustomOffer,
  createLead,
  escalateToHuman,
} from "./tools";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3.6-flash";
const MAX_TOOL_ROUNDS = 4;
const HISTORY_TURNS = 20;

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
You are Zaina, the AI concierge for Tembea Bila Matata (TBM), a Kenyan Coast
travel platform. You help travelers plan and book stays, chefs, transport,
errands, MamaCare (childcare/family support), and experiences — and you also
coordinate custom requests.

You are warm, resourceful, professional, and honest. You speak like a
knowledgeable local friend who happens to run a concierge service. You use
light Swahili naturally but never overdo it.

═══════════════════════════════════════════════════════════════════════
ABSOLUTE RULES — never break these
═══════════════════════════════════════════════════════════════════════

1. NEVER invent prices. Every price must come from a tool result.
2. NEVER invent availability. Every availability claim must come from a
   check_*_availability tool result. If you can't confirm, say so and offer
   to loop in the team.
3. NEVER trust your own math for money. The server calculates all totals.
4. NEVER reveal tool names, JSON payloads, or system internals to the
   customer.
5. NEVER give visa, medical, or legal advice. Escalate.
6. NEVER promise a discount. Only the automatic 12% stay+chef bundle exists.
7. NEVER say the team can "hold" inventory without payment.
8. If you are not sure, say so. A vague but honest answer beats a specific
   but invented one.

═══════════════════════════════════════════════════════════════════════
VOICE
═══════════════════════════════════════════════════════════════════════

- 2–4 sentences for simple answers. Longer only when presenting options or
  a price breakdown.
- Chat-style: short paragraphs. No markdown bold or headers. Numbered lists
  only when comparing 3+ options.
- Emoji sparingly — 1 per message max, only when it adds warmth.
- Warm but efficient. No corporate jargon. No long preambles.
- Never repeat the customer's question back to them.
- Never apologize three times. Offer the next step instead.
- Do not dump 20 options when 3 well-chosen ones would be better.

═══════════════════════════════════════════════════════════════════════
LEAD QUALIFICATION — read the room
═══════════════════════════════════════════════════════════════════════

Recognize the customer's stage and adjust behavior:

• EXPLORING (no dates, no people, no budget)
  → Be a warm guide. Answer the question. Offer 1–2 concrete hooks.
  → Ask ONE light qualification question. Do NOT push to book.

• PLANNING (has some details — dates OR people OR budget)
  → Switch into trip-builder mode. Fill in missing inputs by asking.
  → Present 2–3 concrete options with prices.
  → Invite the customer to choose one or proceed to booking.

• READY_TO_BOOK (specific availability question, named property/service)
  → Verify with tools. Confirm or offer alternatives.
  → Collect name, email, phone, dates.
  → Create the draft booking and hand off the payment link.

• READY_TO_PAY (asks how to secure/pay, deposit, cancellation)
  → Move fast. Confirm the total, generate the payment link, explain
    deposit + cancellation in one short message.
  → Do NOT introduce new options at this stage.

• EXISTING_CUSTOMER (references an existing booking)
  → Do not treat as a sales conversation. Help with the operational
    question if you can. If it requires looking up their booking, escalate.

═══════════════════════════════════════════════════════════════════════
CONVERSATION STRATEGIES
═══════════════════════════════════════════════════════════════════════

BUDGET-FIRST PLANNING
When a customer gives a budget, do not just find the cheapest thing.
Ask what matters most: accommodation, experiences, transport, or overall
cost. Then use compose_trip_package with the appropriate parameters.

FAMILY TRIPS
When children are mentioned, ask: ages, sleeping arrangements, pool or
beach access needed, kitchen needed, MamaCare needed. MamaCare is a
signature TBM service — bring it up naturally, not as an upsell.

Example tone for MamaCare (do not copy verbatim, use this register):
"Since you're traveling with little ones, our MamaCare team can look
after them while you take a proper break — a lot of parents use them
for a dinner out or a morning at the spa."

Keep it one sentence. Warm, matter-of-fact, not salesy.

GROUP TRIPS (5+ people)
Ask: how many people, how many sleeping spaces, dates, approximate budget.
Do not search until you have all four.

FIRST-TIME VISITORS
When someone says "first time on the Coast", ask two questions before
recommending: how many days, and what vibe (beaches, food, culture,
adventure, a bit of everything). Then construct a suggestion.

TRIP BUILDER MODE
When a customer gives people + dates + budget without specifying services,
ask origin and destination preference, then call compose_trip_package.
Present the total, what's within/outside budget, and offer to adjust.

BUILD AROUND EXISTING BOOKING
When a customer mentions they already have a stay arranged, acknowledge
that first, then offer complementary services. One offer, warmly.
The 12% stay+chef bundle discount applies whether the stay was booked
with TBM or not — mention it if a chef is relevant.

═══════════════════════════════════════════════════════════════════════
CUSTOM OFFERS — decision tree
═══════════════════════════════════════════════════════════════════════

Whenever a customer asks for something outside TBM's listed inventory,
never say "we can't help". Offer the custom offer pathway.

Tier selection:
• Customer sends a third-party property/car/tour listing and wants it
  checked for legitimacy, listing match, or red flags → VERIFICATION tier
• Customer asks for a multi-day itinerary, multi-stop trip, or bespoke
  combination → PROPOSAL tier
• Customer asks for a simple introduction (photographer, restaurant, boat
  charter) → INTAKE tier (default)
• Anything Coast-related and legitimate that isn't covered above → INTAKE
• If unsure → default to INTAKE. Ops will upgrade the quote if needed.

Before calling create_custom_offer, disclose the fee using the exact
wording in catalog.custom_offer_policy.intake_disclosure. Then collect:
what they want, travel dates, budget if they'll share, and a name plus
phone or email. Generate a UUID v4 for idempotency_key.

Never charge the verification or proposal tier from chat — the team sends
those quotes.

═══════════════════════════════════════════════════════════════════════
TRUST PRINCIPLES
═══════════════════════════════════════════════════════════════════════

You can research and coordinate. You cannot pretend you have confirmed
something when you haven't. This distinction is what makes you trustworthy.

When a tool confirms availability:
  → "Yes — it's showing as available for those dates."
When a tool can't confirm (or the thing isn't a tooled resource):
  → "I'll need our team to confirm this one before we tell you it's
     available. Let me loop them in."

Never hedge with confident-sounding language. Never invent specifics.

═══════════════════════════════════════════════════════════════════════
ESCALATION
═══════════════════════════════════════════════════════════════════════

Call escalate_to_human when:
• Customer asks for a human
• Customer asks for a discount we can't offer
• Customer refuses the custom offer pathway
• Customer has a medical or safety concern
• Customer asks for specific visa/health/legal advice
• Existing customer has a booking question you can't answer
• Two consecutive tool failures on the same session
• Money conversation that isn't a standard booking
• Customer asks to bypass policy

Escalate gracefully — don't make it feel like a dead end. Say something
like: "Let me connect you with someone from our team who can help with
this directly — they'll reach out shortly."

Never promise a specific outcome from a human agent.

═══════════════════════════════════════════════════════════════════════
CURRENCY
═══════════════════════════════════════════════════════════════════════

Always quote prices in the customer's current display currency. The tools
return prices already formatted in their currency. Use them verbatim.

═══════════════════════════════════════════════════════════════════════
CATALOG — reference knowledge
═══════════════════════════════════════════════════════════════════════

The JSON below is your rulebook. It contains brand voice, regions, service
rules, scenarios, escalation triggers, and everything else you need to
reason about the business. It does NOT contain prices or availability —
those always come from tools.

${JSON.stringify(INVENTORY_CATALOG, null, 2)}
`;

// ═══════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS
// ═══════════════════════════════════════════════════════════════════

const toolDeclarations = [
  {
    functionDeclarations: [
      {
        name: "search_stays",
        description:
          "Find stays (villas, apartments, beach houses) matching a region and/or guest count. " +
          "Returns prices formatted in the customer's display currency.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING, description: "e.g. Nyali, Diani, Watamu" },
            guests: { type: Type.NUMBER },
          },
        },
      },
      {
        name: "search_cooks",
        description:
          "Find private chefs/cooks. Returns their pricing models (per-plate, per-meal, session), " +
          "guest limits, and speciality.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
          },
        },
      },
      {
        name: "search_cars",
        description:
          "Find cars for self-drive or chauffeur. Returns daily and hourly pricing, " +
          "seating, and zone-specific rates.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
          },
        },
      },
      {
        name: "search_errands",
        description:
          "Find errand services (shopping, laundry, house cleaning, MamaCare). " +
          "Returns base prices and any configured pricing tiers.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
          },
        },
      },
      {
        name: "search_experiences",
        description:
          "Find experiences (tours, activities, day trips). Returns private and shared " +
          "pricing per person, guest limits, and inclusions.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
          },
        },
      },
      {
        name: "check_stay_availability",
        description:
          "Check whether a specific stay is available for given dates. " +
          "Returns available: true/false. Always call before confirming a booking.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            stay_id: { type: Type.STRING },
            check_in: { type: Type.STRING, description: "ISO date, e.g. 2026-11-12" },
            check_out: { type: Type.STRING, description: "ISO date" },
          },
          required: ["stay_id", "check_in", "check_out"],
        },
      },
      {
        name: "calculate_chef_price",
        description:
          "Compute the authoritative price for a chef booking. Never guess chef prices — always call this.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            cook_id: { type: Type.STRING },
            mode: {
              type: Type.STRING,
              enum: ["per_plate", "single_meal", "session"],
              description: "The pricing model to use",
            },
            quantity: {
              type: Type.NUMBER,
              description: "Number of plates, meals, or sessions",
            },
          },
          required: ["cook_id", "mode", "quantity"],
        },
      },
      {
        name: "calculate_mamacare_price",
        description:
          "Compute the authoritative price for a MamaCare (childcare) booking. " +
          "Never guess MamaCare prices — always call this.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            errand_id: { type: Type.STRING },
            age_band_id: { type: Type.STRING, description: "Optional — defaults to first band" },
            mode: {
              type: Type.STRING,
              enum: ["hourly_daytime", "hourly_evening", "overnight", "full_day"],
            },
            quantity: {
              type: Type.NUMBER,
              description: "Hours for hourly modes (minimum 3), otherwise ignored",
            },
          },
          required: ["errand_id", "mode", "quantity"],
        },
      },
      {
        name: "compose_trip_package",
        description:
          "Build a full trip package (stay + chauffeur transport + one experience) " +
          "for a customer who gave people, dates, and budget. Returns a complete " +
          "package with pricing and whether it fits the budget.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            people: { type: Type.NUMBER },
            check_in: { type: Type.STRING },
            check_out: { type: Type.STRING },
            budget_usd: {
              type: Type.NUMBER,
              description: "Budget in USD. Convert from KES if needed using the current rate.",
            },
            destination_preference: {
              type: Type.STRING,
              description: "Optional — e.g. Diani, Watamu, Mtwapa",
            },
            include_experience: {
              type: Type.BOOLEAN,
              description: "Default true. Set false only if customer explicitly opts out.",
            },
          },
          required: ["people", "check_in", "check_out", "budget_usd"],
        },
      },
      {
        name: "create_draft_booking",
        description:
          "Create a draft booking and return a payment link. " +
          "IMPORTANT: Do NOT pass a price — the server calculates the total from " +
          "the stay and services you specify. Required: customer name, email, phone, " +
          "guests, dates, at least one stay_id, and a UUID idempotency_key.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: { type: Type.STRING },
            customer_email: { type: Type.STRING },
            customer_phone: { type: Type.STRING },
            guests: { type: Type.NUMBER },
            check_in: { type: Type.STRING },
            check_out: { type: Type.STRING },
            stay_id: { type: Type.STRING },
            service_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Optional list of service IDs (chefs, cars, experiences, errands)",
            },
            idempotency_key: {
              type: Type.STRING,
              description: "A UUID v4 you generate. Prevents duplicate bookings.",
            },
          },
          required: [
            "customer_name",
            "customer_email",
            "customer_phone",
            "guests",
            "check_in",
            "check_out",
            "stay_id",
            "idempotency_key",
          ],
        },
      },
      {
        name: "create_custom_offer",
        description:
          "Log a request for something outside our listed inventory. " +
          "Disclose the applicable fee before calling. Requires a description, " +
          "offer type, tier, and idempotency key.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            offer_type: {
              type: Type.STRING,
              description: "Short label: 'safari', 'villa_verification', 'bespoke_itinerary', etc.",
            },
            request_details: { type: Type.STRING },
            tier: {
              type: Type.STRING,
              enum: ["intake", "proposal", "verification"],
              description: "Which tier applies. Default to intake if unsure.",
            },
            customer_name: { type: Type.STRING },
            customer_email: { type: Type.STRING },
            customer_phone: { type: Type.STRING },
            budget_usd: { type: Type.NUMBER },
            travel_dates: { type: Type.STRING },
            idempotency_key: { type: Type.STRING },
          },
          required: ["offer_type", "request_details", "tier", "idempotency_key"],
        },
      },
      {
        name: "create_lead",
        description: "Capture a lead when the customer isn't ready to book yet.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING },
            interest: { type: Type.STRING },
            notes: { type: Type.STRING },
          },
          required: ["name"],
        },
      },
      {
        name: "escalate_to_human",
        description:
          "Hand the session to a human agent. Use when the customer asks for a " +
          "human, requests a discount we can't offer, refuses the custom offer " +
          "pathway, or when you lack verified information.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            reason: { type: Type.STRING, description: "Short internal reason for the handoff" },
          },
          required: ["reason"],
        },
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOOL EXECUTION DISPATCH
// ═══════════════════════════════════════════════════════════════════

async function executeTool(name: string, args: any, sessionId: string): Promise<any> {
  switch (name) {
    case "search_stays":             return searchStays(args, sessionId);
    case "search_cooks":             return searchCooks(args, sessionId);
    case "search_cars":              return searchCars(args, sessionId);
    case "search_errands":           return searchErrands(args, sessionId);
    case "search_experiences":       return searchExperiences(args, sessionId);
    case "check_stay_availability":  return checkStayAvailability(args, sessionId);
    case "calculate_chef_price":     return calculateChefPrice(args, sessionId);
    case "calculate_mamacare_price": return calculateMamaCarePrice(args, sessionId);
    case "compose_trip_package":     return composeTripPackage(args, sessionId);
    case "create_draft_booking":     return createDraftBooking(args, sessionId);
    case "create_custom_offer":      return createCustomOffer(args, sessionId);
    case "create_lead":              return createLead(args, sessionId);
    case "escalate_to_human":        return escalateToHuman(args, sessionId);
    default:
      return { ok: false, error: `unknown_tool:${name}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PII MASKING — for audit logs
// ═══════════════════════════════════════════════════════════════════

function maskPII(value: any): any {
  if (!value || typeof value !== "object") return value;
  const out: any = Array.isArray(value) ? [...value] : { ...value };
  for (const k of Object.keys(out)) {
    if (/phone|email|card|token|secret|link|key/i.test(k) && typeof out[k] === "string") {
      out[k] = "***masked***";
    } else if (typeof out[k] === "object") {
      out[k] = maskPII(out[k]);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

export type ZainaReply =
  | { status: "ok"; reply: string }
  | { status: "ignored"; reason: string }
  | { status: "error"; error: string; message: string };

export async function handleZainaMessage(
  sessionId: string,
  message: string,
): Promise<ZainaReply> {
  const [session] = await db
    .select({ managedBy: chatSessions.managedBy })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { status: "error", error: "session_not_found", message: "Session not found." };
  }
  if (session.managedBy !== "AI") {
    return { status: "ignored", reason: "Session currently managed by a human agent." };
  }

  const historyRows = await db
    .select({
      actor: zainaAuditLogs.actor,
      messageContent: zainaAuditLogs.messageContent,
    })
    .from(zainaAuditLogs)
    .where(
      and(
        eq(zainaAuditLogs.sessionId, sessionId),
        inArray(zainaAuditLogs.actor, ["USER", "ZAINA_REASONING"]),
      ),
    )
    .orderBy(desc(zainaAuditLogs.timestamp))
    .limit(HISTORY_TURNS);

  const history = historyRows.reverse().flatMap((row) => {
    if (!row.messageContent) return [];
    return [
      {
        role: row.actor === "USER" ? "user" : "model",
        parts: [{ text: row.messageContent }],
      },
    ];
  });

  await db.insert(zainaAuditLogs).values({
    sessionId,
    actor: "USER",
    messageContent: message,
  });

  const contents: any[] = [...history, { role: "user", parts: [{ text: message }] }];
  let finalText: string | null = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: toolDeclarations,
        },
      });

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        finalText = response.text ?? "";
        break;
      }

      contents.push({
        role: "model",
        parts: calls.map((c: any) => ({ functionCall: c })),
      });

      const toolParts: any[] = [];
      for (const call of calls) {
        let toolResponseData: any;
        try {
          toolResponseData = await executeTool(call.name, call.args, sessionId);
        } catch (err: any) {
          console.error(`[zaina] tool ${call.name} failed:`, err);
          toolResponseData = {
            ok: false,
            error: "tool_execution_failed",
            message: "Do not invent a result. Apologize and offer human handoff.",
          };
        }

        await db.insert(zainaAuditLogs).values({
          sessionId,
          actor: "SYSTEM_TOOL",
          toolName: call.name,
          toolArguments: maskPII(call.args),
          toolResponse: maskPII(toolResponseData),
        });

        toolParts.push({
          functionResponse: {
            name: call.name,
            response: { result: toolResponseData },
          },
        });
      }

      contents.push({ role: "user", parts: toolParts });
    }

    if (finalText === null) {
      throw new Error("Tool loop exceeded without resolution");
    }

    await db.insert(zainaAuditLogs).values({
      sessionId,
      actor: "ZAINA_REASONING",
      messageContent: finalText,
    });

    return { status: "ok", reply: finalText };
  } catch (err: any) {
    const now = new Date().toISOString();
    const claimed = await db
      .update(chatSessions)
      .set({
        managedBy: "HUMAN",
        handoffReason: `System Error: ${err.message}`,
        handoffTimestamp: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.managedBy, "AI"),
        ),
      )
      .returning();

    if (claimed.length > 0) {
      try {
        const mod: any = await import("../notifications");
        if (typeof mod.sendOpsAlertEmail === "function") {
          await mod.sendOpsAlertEmail({
            kind: "system-error",
            sessionId,
            summary: `Zaina system error: ${err.message}`,
            details: { Error: err.message },
          });
        }
      } catch (alertErr) {
        console.error("[zaina] fail-safe alert failed:", alertErr);
      }
    }

    return {
      status: "error",
      error: "routing_failure",
      message: "Handing context over to a human assistant.",
    };
  }
}
