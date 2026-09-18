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
//
// GEMINI 3.X NOTE:
//   The API attaches a thoughtSignature to every functionCall part. It must
//   be echoed back verbatim in the follow-up turn. We therefore push the
//   raw `candidate.content` back into the conversation rather than
//   reconstructing it from the normalized `functionCalls` accessor (which
//   drops the signature).

import { sendOpsAlertEmail } from "../notifications";
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
  createServiceBooking,
  createCustomOffer,
  createLead,
  escalateToHuman,
} from "./tools";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-3.5-flash-lite";
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
MATCH FIRST, EXPLAIN SECOND — the most important behavioral rule
═══════════════════════════════════════════════════════════════════════

If the customer has already told you what they want, ASK FOR WHAT YOU NEED
TO HELP THEM. Do not open with a service description. Do not open with a
fee disclosure. Do not recite policy.

Example — customer clicks "Verify a listing I found":

  ✗ Brochure opening (avoid this):
    "We'd love to help you verify that listing — on-the-ground property
     verification is one of our signature services..."

  ✓ Helping opening (use this):
    "Karibu 😊 Send me the listing link and I'll take a look. I can check
     whether it matches what's being advertised and flag anything that
     might need closer verification."

Same for every other service. When the customer's intent is already clear,
the first reply is a question that moves the conversation forward, not a
paragraph that explains what TBM does.

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
BOOKING TOOLS — which one to call
═══════════════════════════════════════════════════════════════════════

You have two booking tools. Choosing correctly matters.

• create_draft_booking
    Use when the customer is booking a STAY (a villa, apartment, etc.)
    — with or without add-on services. Requires a stay_id and a real
    check-in/check-out range (check-out must be after check-in).

• create_service_booking
    Use when the customer is booking a ONE-OFF SERVICE without a stay:
    MamaCare (childcare), a private chef session, a standalone
    experience, or a base errand. Takes a SINGLE date (not a range).

Common mistake to avoid: trying to book MamaCare with create_draft_booking.
MamaCare is a service, not a stay — always use create_service_booking,
with mamacare_children, mamacare_care_mode, and (for hourly modes)
mamacare_hours.

If create_draft_booking returns error "invalid_dates", it means the booking
is a same-day service — switch to create_service_booking.

Example — MamaCare overnight booking:

  Customer: "2 kids, ages 5 and 2, October 20, 6pm to 6am"
  You call create_service_booking with:
    service_id: <the MamaCare errand id you found earlier>
    date: "2026-10-20"
    mode: "errand-childcare"
    mamacare_care_mode: "overnight"
    mamacare_children: [
      { age_band_id: "help-mama-toddler", count: 1 },
      { age_band_id: "help-mama-child", count: 1 }
    ]
    service_start_time: "18:00"
    service_end_time: "06:00"
    service_location: "Nyali 5th Avenue"
    customer_name / email / phone from the conversation
    idempotency_key: <new UUID v4>

═══════════════════════════════════════════════════════════════════════
CUSTOM OFFERS — decision tree
═══════════════════════════════════════════════════════════════════════

Whenever a customer asks for something outside TBM's listed inventory,
never say "we can't help". Offer the custom offer pathway.

MATCH FIRST, EXPLAIN SECOND.
If the customer has already told you what they want (for example they
clicked "Verify a listing I found"), open by asking for what you need
to help them. Do NOT open with a service description. Do NOT open with
a fee disclosure. Save the explanation for after you have context.

Example — customer clicks "Verify a listing I found":

  ✗ Brochure opening (avoid this):
    "We'd love to help you verify that listing — on-the-ground property
     verification is one of our signature services..."

  ✓ Helping opening (use this voice):
    "Karibu 😊 Send me the listing link and I'll take a look. I can
     check whether it matches what's being advertised and flag anything
     that may need closer verification. If it needs an on-ground visit,
     our team can arrange that too."

Tier selection:
• Third-party property/car/tour listing to check for legitimacy, match,
  or red flags → VERIFICATION tier
• Multi-day itinerary, multi-stop trip, bespoke combination → PROPOSAL
• Simple introduction (photographer, restaurant, boat) → INTAKE
• Anything else Coast-related and legitimate → INTAKE
• If unsure → INTAKE. Ops will upgrade if needed.

Disclosing the fee:
• Never lead with it. Never say "log and route your request."
• Once you have basic details, use simple, human language:
  "There's a small intake fee to get this started — it comes off your
   final booking if you go ahead."
• Say it once, briefly, then move on.

Then collect: what they want, travel dates, budget if they'll share,
and a name plus phone or email. Generate a UUID v4 for idempotency_key.

Never charge the verification or proposal tier from chat — the team
sends those quotes.

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
      {
        name: "create_service_booking",
        description:
          "Create a draft booking for a ONE-OFF SERVICE where the customer is " +
          "NOT booking a stay. Use this for MamaCare/childcare, private chefs " +
          "(session mode), standalone experiences, or base errands. " +
          "Takes a single date (not check-in/check-out). The server calculates " +
          "the total — never pass a price.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: { type: Type.STRING },
            customer_email: { type: Type.STRING },
            customer_phone: { type: Type.STRING },
            service_id: {
              type: Type.STRING,
              description: "The ID of the errand, cook, or experience being booked.",
            },
            date: {
              type: Type.STRING,
              description: "ISO date for the service, e.g. 2026-10-20.",
            },
            mode: {
              type: Type.STRING,
              description:
                "Service mode. For MamaCare use 'errand-childcare'. " +
                "For chefs: 'cook-service-fee' or 'cook-inclusive'. " +
                "For base errands: 'errand-base'. " +
                "For private experiences: 'experience-private'.",
            },
            guests: {
              type: Type.NUMBER,
              description: "Number of guests (defaults to 1; used for experience-private).",
            },
            service_location: { type: Type.STRING },
            service_start_time: {
              type: Type.STRING,
              description: "HH:MM format, e.g. 18:00.",
            },
            service_end_time: {
              type: Type.STRING,
              description: "HH:MM format, e.g. 06:00.",
            },
            service_request_details: { type: Type.STRING },
            mamacare_children: {
              type: Type.ARRAY,
              description: "For MamaCare only. Each entry is one child's age band and count.",
              items: {
                type: Type.OBJECT,
                properties: {
                  age_band_id: {
                    type: Type.STRING,
                    description: "The age band id from the errand's helpMamaPricing (e.g. 'help-mama-toddler').",
                  },
                  count: { type: Type.NUMBER, description: "How many children in that band." },
                },
                required: ["age_band_id", "count"],
              },
            },
            mamacare_care_mode: {
              type: Type.STRING,
              enum: ["hourly_daytime", "hourly_evening", "overnight", "full_day"],
              description: "For MamaCare only. The type of care session.",
            },
            mamacare_hours: {
              type: Type.NUMBER,
              description: "For hourly MamaCare modes only. Minimum 3 hours.",
            },
            quantity: {
              type: Type.NUMBER,
              description: "Number of sessions/units (defaults to 1). Used for chef sessions and base errands.",
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
            "service_id",
            "date",
            "mode",
            "idempotency_key",
          ],
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
    case "create_service_booking":   return createServiceBooking(args, sessionId);
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
  | { status: "ok"; reply: string; escalated?: boolean }
  | { status: "ignored"; reason: string }
  | { status: "error"; error: string; message: string };

export async function handleZainaMessage(
  sessionId: string,
  message: string,
): Promise<ZainaReply> {
  // 1. State gate
  const [session] = await db
    .select({ managedBy: chatSessions.managedBy })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

   if (!session) {
    return { status: "error", error: "session_not_found", message: "Session not found." };
  }

  // 2. Log the raw user message first — even if a human is handling it.
  //    The admin panel reads from this same log so the agent can see what
  //    the customer just typed.
  await db.insert(zainaAuditLogs).values({
    sessionId,
    actor: "USER",
    messageContent: message,
  });

  // 3. State gate
  if (session.managedBy !== "AI") {
    return { status: "ignored", reason: "Session currently managed by a human agent." };
  }

  // 4. Load recent history
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

  // 5. Agentic loop
  const contents: any[] = [...history, { role: "user", parts: [{ text: message }] }];
  let finalText: string | null = null;
  let escalated = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Retry transient provider errors (503 high demand, 429 rate limit,
      // 500 internal). These are the LLM equivalent of a busy signal —
      // retrying usually succeeds within a few seconds. Escalating to a
      // human on a 503 is wrong: it burns ops time and locks a session
      // over a hiccup.
      let response: any = null;
      let lastError: any = null;
      const MAX_ATTEMPTS = 3;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          response = await ai.models.generateContent({
            model: MODEL,
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              tools: toolDeclarations,
            },
          });
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;

          // Extract the HTTP status from the SDK error. The shape varies
          // between error types, so we check a few common locations.
          const status =
            err?.status ??
            err?.code ??
            err?.error?.code ??
            err?.response?.status;

          const isTransient =
            status === 503 ||
            status === 429 ||
            status === 500 ||
            status === 502 ||
            status === 504;

          if (!isTransient || attempt === MAX_ATTEMPTS - 1) {
            throw err;
          }

          // Exponential backoff: 1s, 2s. Long enough to ride out a
          // spike, short enough that the customer barely notices.
          const delayMs = 1000 * Math.pow(2, attempt);
          console.warn(
            `[zaina] transient model error (status ${status}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (!response) {
        throw lastError ?? new Error("Model call failed after retries");
      }

      // Gemini 3.x attaches a thoughtSignature to every functionCall part.
      // The API rejects any follow-up request that omits it. So we echo the
      // model's raw content back verbatim instead of rebuilding the parts
      // from the normalized functionCalls accessor, which drops the signature.
      const candidate = response.candidates?.[0];
      const modelContent = candidate?.content;
      const rawParts = modelContent?.parts ?? [];
      const functionCallParts = rawParts.filter((p: any) => p.functionCall);

      if (functionCallParts.length === 0) {
        finalText = response.text ?? "";
        break;
      }

      contents.push(modelContent);

      const toolParts: any[] = [];
      for (const part of functionCallParts) {
        const call = part.functionCall;
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

        if (call.name === "escalate_to_human" && toolResponseData?.status === "escalated") {
          escalated = true;
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

    return { status: "ok", reply: finalText, escalated: escalated || undefined };
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
        await sendOpsAlertEmail({
          kind: "system-error",
          sessionId,
          summary: `Zaina system error: ${err.message}`,
          details: { Error: err.message },
        });
      } catch (alertErr) {
        console.error("[zaina] fail-safe alert failed:", alertErr);
      }
    }

    return {
      status: "error",
      error: "routing_failure",
      message:
        "I'm having trouble reaching our systems right now — give me a moment and try again, or reach us on WhatsApp if it's urgent.",
    };
  }
}
