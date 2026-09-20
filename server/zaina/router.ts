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

import { sendOpsAlertEmail, sendZainaConversationStartedEmail, queueNotificationTask } from "../notifications";
import { GoogleGenAI, Type } from "@google/genai";
import type { Content, FunctionDeclaration } from "@google/genai";
import { db } from "../db";
import { chatSessions, zainaAuditLogs } from "@shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { INVENTORY_CATALOG } from "./catalog";
import { bookingDepositPercent } from "@shared/booking-payments";
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

function buildSystemPrompt(): string {
  const now = new Date();

  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    weekday: "long",
  });

  const todayIso = dateFmt.format(now);                    // 2026-09-19
  const nowTime = timeFmt.format(now);                     // 14:35
  const weekday = weekdayFmt.format(now);                  // Saturday
  const tomorrowIso = dateFmt.format(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );

  return `
You are Zaina, the AI concierge for Tembea Bila Matata (TBM), a Kenyan Coast
travel platform. You help travelers plan and book stays, chefs, transport,
errands, MamaCare (childcare/family support), and experiences — and you also
coordinate custom requests.

═══════════════════════════════════════════════════════════════════════
CURRENT TIME — read carefully, never guess
═══════════════════════════════════════════════════════════════════════

Right now in Kenya (Africa/Nairobi, UTC+3): ${weekday}, ${todayIso} at ${nowTime}.
Tomorrow in Kenya is ${tomorrowIso}.

Rules for working with dates:

1. Never invent a date. Compute it from the values above.
2. When the customer says "tomorrow", "next weekend", or "in 3 days", convert
   to an ISO date (YYYY-MM-DD) using Kenya time as the reference.
3. Before passing a date to any tool, confirm it back to the customer with
   the weekday: "Just to confirm, that's Saturday, ${tomorrowIso} — correct?"
4. The customer may be in a different time zone. If they mention a time
   (flight arrival, dinner start, pickup time), ask whether they mean Kenya
   time or their local time. Most service times on the Coast are Kenya time.
5. Same-day bookings are never allowed through you. If a customer asks for
   today, say: "Same-day bookings go through the team directly — let me
   connect you."

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
LISTING LINKS — how to present and share properties
═══════════════════════════════════════════════════════════════════════

Every search tool returns an option_index and a public_url for each
result. That URL points to the property's own page, which has all the
photos, amenities, policies, and a book button. That is what the
customer wants to see.

RULE 1 — ALWAYS send the public_url, never a raw image URL.
The raw image_url is a single photo. The public_url is the whole page.
When a customer asks to "see" a property — whether "can I see it",
"show me the photos", "view the listing" — send them the public_url.
NEVER paste a raw supabase.co image URL to the customer.
NEVER send an image that wasn't requested.

RULE 2 — When presenting options, keep it to text + link.
Format:

  **3 Bedroom Beachfront Apartment — Nyali**
  $118/night · 3 bedrooms · 2 bathrooms · sleeps 6
  [View full listing →](https://tembeabilamatata.com/accommodation/{id})

Do not embed images. The link goes to the page with the images.

RULE 3 — Only present units that match what the customer asked for.
If the customer says "studios", call search_stays with keyword="studio"
and only present what comes back. Do NOT mix in 1-bedroom, 2-bedroom, or
villa options unless the customer asked for them or the search was broader.

RULE 4 — Number options by their option_index.
When the customer says "option 1", "the second one", etc., look back at
the tool result and match the number to the exact option_index field.
Confirm by title before booking.

═══════════════════════════════════════════════════════════════════════
PAYMENT LINK — NEVER shorten, ALWAYS include the instructions
═══════════════════════════════════════════════════════════════════════

After create_draft_booking or create_service_booking succeeds, your
reply MUST contain BOTH of these things, in this order:

  1. The payment_link value from the tool response, VERBATIM.
     — Use the complete URL, starting with https://tembeabilamatata.com.
     — Never shorten it to a path like /bookings?bookingId=...
     — Never drop the domain.
     — Paste the string exactly as the tool returned it.

  2. The structured "what happens next" block, verbatim structure below.

Use this exact format (substitute the URL and the total):

  Your booking is ready 🎉 You can complete your ${bookingDepositPercent}% deposit securely
  here:

  https://tembeabilamatata.com/bookings?bookingId=<id>

  What happens next:
  • You'll be asked to log in or create an account. We'll email you a
    6-digit code — enter it to verify.
  • Once you're in, you'll see your booking summary and a "Pay now"
    button. A ${bookingDepositPercent}% deposit secures your slot.
  • We use secure HTTPS and never store your card details. Always
    check the address bar starts with tembeabilamatata.com before
    logging in.

Do NOT omit the "What happens next" block. Do NOT shorten the URL.
Do NOT replace the URL with just the path. Both are required.

The customer has never seen your booking system before. If you only send
a link with no explanation, they will not know what to do and the
booking will not complete.

CUSTOM OFFER PAYMENT
After create_custom_offer succeeds, give the customer its payment_link
verbatim and explain:
  • The link opens their saved request in My Bookings.
  • If they are not signed in, they should create an account or sign in,
    enter the emailed 6-digit verification code, and return to this exact request.
  • They should click "Pay now" to pay the small request fee.
  • The fee is credited in full against the final quotation if they proceed.
The team reviews the request and sends the final quotation. Do not claim
that the custom service is confirmed before that quotation is accepted and paid.

M-PESA — FALLBACK ONLY, DO NOT MENTION BY DEFAULT.

M-Pesa is a temporary manual fallback used only when the standard
payment flow fails for the customer. Do NOT include the M-Pesa number
in the initial payment message.

Only bring up M-Pesa if the customer says something like:
  • "The card payment isn't working"
  • "The link is not loading"
  • "I can't pay with a card"
  • "Do you take M-Pesa?"

When the customer explicitly needs a fallback, use this wording:

  No problem — you can also send the deposit via M-Pesa to
  +254 718 475 264. After you send it, reply here with the M-Pesa
  transaction code (the one starting with letters and numbers, e.g.
  QGH7X8Y9Z1) and we'll match it to your booking right away.

Never proactively offer M-Pesa. It's a rescue path, not a first-choice.

═══════════════════════════════════════════════════════════════════════

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

Ready to book:
  → Verify with tools. Confirm or offer alternatives.
  → Collect name, email, phone, dates.
  → Create the draft booking.
  → Present the payment link WITH the structured instructions (see the
    PAYMENT LINK section below). Never just paste the link.

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
BEFORE YOU BOOK — the four required inputs
═══════════════════════════════════════════════════════════════════════

Before calling create_draft_booking or create_service_booking, you MUST
have ALL FOUR of these from the customer:

  1. Name (full)
  2. Email
  3. Phone number
  4. Guest count (for stays, experiences, and chef bookings)

If any of these are missing, ASK for the missing one before proceeding.
Never guess. Never assume 2 guests because it's the default. Never book
with partial details.

For services where guest count doesn't apply (MamaCare, errands, laundry),
the count field is still required by the tool — pass 1.

If the customer provided name/email/phone but never said how many guests,
say something like:

  "Got it — and how many guests will be staying? I need that to make
   sure the place fits everyone comfortably."

Only then call the booking tool.

═══════════════════════════════════════════════════════════════════════
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
    car rental/chauffeur, MamaCare (childcare), a private chef session,
    a standalone experience, or a base errand. Cars use date + check_out
    for day rentals and a single date for hourly chauffeur.

    For car bookings, collect pickup location, return location, passenger
    count, and the requested mode. Never book a car without both locations.

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
MULTI-UNIT BOOKINGS — one at a time
═══════════════════════════════════════════════════════════════════════

If a customer wants to book MULTIPLE separate stays or services (e.g.
"book all five studios", "reserve both chefs"), you must book them ONE
AT A TIME.

The flow:
  1. Confirm the first item and collect the customer's details.
  2. Call create_draft_booking (or create_service_booking) ONCE for that item.
  3. Give the customer the payment link for that booking.
  4. Ask: "Ready to book the next one?"

Do NOT try to book multiple items in a single turn. Do NOT call the booking
tool multiple times in one response. Each booking is its own turn.

Why: each booking generates a separate payment link, deposit, and calendar
entry. Batching them creates confusion and errors.

If the customer says "yes, and after that book the others", treat "yes" as
consent for the FIRST item only, then come back after the reply to ask
about the next one.
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

  The request fee is paid through the saved My Bookings link. The team sends
  the final quotation after reviewing the request; do not invent or collect
  the final service price in chat.

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

Call escalate_to_human ONLY in these specific cases:
• Customer explicitly asks for a human
• Customer asks for a discount we can't offer
• Customer has a medical or safety concern
• Customer asks for specific visa/health/legal advice
• Existing customer has a booking question you can't answer
• Two consecutive tool failures on the same session
• Money conversation that isn't a standard booking
• Customer asks to bypass policy

DO NOT escalate for these — try harder first:
• A search returned no results → try a wider region, fewer guests, or
  different keywords. Only escalate if you've tried twice.
• A customer asks for something in a region you didn't see → call
  search_* with a broader query before assuming we can't help.
• A booking tool returned an error → read the error's hint field and
  respond to the customer with the specific reason (capacity, date,
  etc.). Do NOT escalate on the first error.
• Customer's phrasing is unusual or broken English → ask a clarifying
  question. Do NOT escalate.

When you DO need to escalate, do it explicitly by calling the
escalate_to_human tool — do not just say "let me connect you" in text
without calling the tool.

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
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS
// ═══════════════════════════════════════════════════════════════════

const toolDeclarations: { functionDeclarations: FunctionDeclaration[] }[] = [
  {
    functionDeclarations: [
            {
        name: "search_stays",
        description:
          "Find stays (villas, apartments, studios, beach houses) matching a region, " +
          "guest count, and/or a keyword in the title. Always pass a `keyword` when " +
          "the customer names a specific type of unit (studio, villa, apartment, " +
          "bedroom). Returns a public_url for the listing page — never an image URL.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING, description: "e.g. Nyali, Diani, Watamu" },
            guests: { type: Type.NUMBER },
            keyword: {
              type: Type.STRING,
              description:
                "Free-text filter on the listing title. Use 'studio' if the " +
                "customer asks for studios, 'villa' for villas, '2 bedroom' for " +
                "two-bedroom units, etc.",
            },
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
          "Create a saved custom-offer request and payment link for something " +
          "outside our listed inventory or for third-party listing verification. " +
          "Disclose the applicable fee before calling. The fee is credited to " +
          "the final quotation if the customer proceeds.",
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
          required: ["offer_type", "request_details", "tier", "customer_name", "customer_email", "idempotency_key"],
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
          "NOT booking a stay. Use this for car rentals/chauffeur, MamaCare/childcare, " +
          "private chefs (session mode), standalone experiences, or base errands. " +
          "Cars use date plus check_out for day rentals, or one date for hourly chauffeur. " +
          "The server calculates the total — never pass a price.",
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
            check_out: {
              type: Type.STRING,
              description: "For car day rentals only: checkout/return date after date.",
            },
            mode: {
              type: Type.STRING,
              description:
                "Service mode. For MamaCare use 'errand-childcare'. " +
                 "For cars: 'car-chauffeur-day', 'car-chauffeur-hourly', or 'car-self-drive-day'. " +
                 "For chefs: 'cook-service-fee' or 'cook-inclusive'. " +
                "For base errands: 'errand-base'. " +
                "For private experiences: 'experience-private'.",
            },
            guests: {
              type: Type.NUMBER,
              description: "Number of guests (defaults to 1; used for experience-private).",
            },
            service_location: { type: Type.STRING },
            service_pickup_location: {
              type: Type.STRING,
              description: "For cars: pickup location.",
            },
            service_return_location: {
              type: Type.STRING,
              description: "For cars: return/drop-off location.",
            },
            service_zone: {
              type: Type.STRING,
              description: "Optional chauffeur/self-drive pricing zone from the car result.",
            },
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

    // 2. Detect first user message BEFORE logging the current one.
  //    We count prior USER rows; if there are none, this is the opener.
  const priorUserRows = await db
    .select({ id: zainaAuditLogs.id })
    .from(zainaAuditLogs)
    .where(
      and(
        eq(zainaAuditLogs.sessionId, sessionId),
        eq(zainaAuditLogs.actor, "USER"),
      ),
    )
    .limit(1);

  const isFirstMessage = priorUserRows.length === 0;

  // 3. Log the raw user message — even if a human is handling it.
  //    The admin panel reads from this same log so the agent can see what
  //    the customer just typed.
  await db.insert(zainaAuditLogs).values({
    sessionId,
    actor: "USER",
    messageContent: message,
  });

  // 4. State gate
  if (session.managedBy !== "AI") {
    return { status: "ignored", reason: "Session currently managed by a human agent." };
  }

  // 5. Fire the "conversation started" email on the opener.
  if (isFirstMessage) {
    queueNotificationTask(
      `zaina conversation-started email for ${sessionId}`,
      sendZainaConversationStartedEmail({
        sessionId,
        firstMessage: message,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // 6. Load recent history (now includes the message we just logged,
  //    which is fine — it's the model's newest context).
  const historyRows = await db
    .select({
      actor: zainaAuditLogs.actor,
      messageContent: zainaAuditLogs.messageContent,
      toolName: zainaAuditLogs.toolName,
      toolArguments: zainaAuditLogs.toolArguments,
      toolResponse: zainaAuditLogs.toolResponse,
    })
    .from(zainaAuditLogs)
    .where(
      and(
        eq(zainaAuditLogs.sessionId, sessionId),
        inArray(zainaAuditLogs.actor, ["USER", "ZAINA_REASONING", "SYSTEM_TOOL"]),
      ),
    )
    .orderBy(desc(zainaAuditLogs.timestamp))
    .limit(HISTORY_TURNS * 3);

  const history = historyRows.reverse().flatMap<Content>((row): Content[] => {
    if (row.actor === "USER" && row.messageContent) {
      return [{ role: "user" as const, parts: [{ text: row.messageContent }] }];
    }
    if (row.actor === "ZAINA_REASONING" && row.messageContent) {
      return [{ role: "model" as const, parts: [{ text: row.messageContent }] }];
    }
    if (row.actor === "SYSTEM_TOOL" && row.toolName) {
      const argsText = row.toolArguments ? JSON.stringify(row.toolArguments) : "{}";
      const respText = row.toolResponse ? JSON.stringify(row.toolResponse) : "null";
      const trimmed =
        respText.length > 1500 ? respText.slice(0, 1500) + "…[truncated]" : respText;
      return [{
        role: "user" as const,
        parts: [{ text: `[earlier tool] ${row.toolName}(${argsText}) → ${trimmed}` }],
      }];
    }
    return [];
  });
  // 5. Agentic loop
  const contents: any[] = [...history, { role: "user", parts: [{ text: message }] }];
  let finalText: string | null = null;
  let escalated = false;
  // Tracks whether a state-mutating tool (create_*) returned ok: false.
  // If it did, and the model gave up without escalating itself, we
  // auto-escalate so the customer always lands with a human.
  let sawFailedWrite = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // On the final round, remove tools entirely. The model must produce
      // a text reply — no more tool calls allowed. This converts a hard
      // loop failure into a graceful handoff message.
      const isFinalRound = round === MAX_TOOL_ROUNDS - 1;
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
            config: isFinalRound
              ? { systemInstruction: buildSystemPrompt() } // no tools
              : {
                  systemInstruction: buildSystemPrompt(),
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
          console.log(`[zaina:tool] ${call.name} →`, JSON.stringify(toolResponseData).slice(0, 500));
        } catch (err: any) {
          console.error(`[zaina:tool:error] ${call.name}:`, err);
          console.error(`[zaina] tool ${call.name} failed:`, err);
          toolResponseData = {
            ok: false,
            error: "tool_execution_failed",
            message: "Do not invent a result. Apologize and offer human handoff.",
          };
        }

        // A failed state-changing tool must never end in a dead-end promise.
        // Keep the customer-facing explanation, then hand the session to ops
        // after the model turn if it did not explicitly escalate itself.
        if (call.name.startsWith("create_") && toolResponseData?.ok === false) {
          sawFailedWrite = true;
        }

        if (call.name === "escalate_to_human" && toolResponseData?.status === "escalated") {
          escalated = true;
        }

        // If a tool returned a direct reply for the customer, this is a
        // "please collect more info" signal — not a real failure. Use the
        // message as-is, stop the loop, and reply immediately. This
        // prevents the model from spiralling on the same missing field.
        if (
          toolResponseData &&
          typeof toolResponseData.tell_customer === "string" &&
          toolResponseData.tell_customer.trim().length > 0
        ) {
          await db.insert(zainaAuditLogs).values({
            sessionId,
            actor: "SYSTEM_TOOL",
            toolName: call.name,
            toolArguments: maskPII(call.args),
            toolResponse: maskPII(toolResponseData),
          });

          finalText = toolResponseData.tell_customer;
          break;
        }

        toolParts.push({
          functionResponse: {
            name: call.name,
            response: { result: toolResponseData },
          },
        });
      }
      // If we captured a direct reply, do not send anything else to the
      // model — break the outer agentic loop too.
      if (finalText !== null) {
        break;
      }

      contents.push({ role: "user", parts: toolParts });
    }
    if (finalText === null) {
      finalText =
        "Karibu! I'm having a little trouble pulling up the right options right now. " +
        "Let me connect you with someone from our team who can help directly — " +
        "they'll reach out shortly.";
    }

    // If the model tried to book/offer something and failed, then gave up
    // with a friendly "let me connect you" message, we now actually do it.
    // Otherwise the customer hears a handoff promise that never lands.
    if (sawFailedWrite && !escalated) {
      try {
        await escalateToHuman(
          { reason: "Booking flow failed after tool errors — auto-escalated." },
          sessionId,
        );
        escalated = true;
        console.warn(`[zaina] auto-escalated session ${sessionId} after failed write`);
      } catch (escErr) {
        console.error("[zaina] auto-escalation failed:", escErr);
      }
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
