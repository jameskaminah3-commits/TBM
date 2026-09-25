// zaina-platform/src/connectors/tbm/declarations.ts
//
// The tools TBM gives Zaina, as the model sees them. Copied from the TBM
// app's router.ts, except that the booking tools no longer require contact
// details: the server takes them only as the customer typed them.

import { Type, type FunctionDeclaration } from "@google/genai";

export const tbmToolDeclarations: { functionDeclarations: FunctionDeclaration[] }[] = [
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
            keyword: { type: Type.STRING, description: "Optional food or chef speciality keyword." },
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
            keyword: { type: Type.STRING, description: "Optional vehicle keyword such as SUV or van." },
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
            keyword: { type: Type.STRING, description: "Optional service keyword such as shopping, laundry, cleaning, or childcare." },
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
            keyword: { type: Type.STRING, description: "Optional activity keyword such as dhow, snorkeling, food, or culture." },
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
            budget_amount: {
              type: Type.NUMBER,
              description: "Total budget exactly as the customer stated it, e.g. 60000. Never convert it yourself.",
            },
            budget_currency: {
              type: Type.STRING,
              enum: ["USD", "KES"],
              description: "Currency of budget_amount as the customer stated it. The server converts.",
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
          required: ["people", "check_in", "check_out", "budget_amount", "budget_currency"],
        },
      },
      {
        name: "check_service_availability",
        description:
          "Check live availability for a car, chef, errand, or experience on a requested date. " +
          "For cars, pass check_out for multi-day rentals. For shared experiences, pass the departure id.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            service_id: { type: Type.STRING },
            date: { type: Type.STRING, description: "ISO date" },
            check_out: { type: Type.STRING, description: "ISO return date for a car day rental" },
            mode: { type: Type.STRING },
            guests: { type: Type.NUMBER },
            service_departure_id: { type: Type.STRING },
          },
          required: ["service_id", "date"],
        },
      },
      {
        name: "create_draft_booking",
        description:
          "Create a draft booking and return a payment link. " +
          "IMPORTANT: Do NOT pass a price — the server calculates the total from " +
          "the stay and services you specify. Needs the customer's name, email and phone " +
          "as they typed them, guests, dates, and a stay_id; the tool asks for any contact " +
          "detail still missing. Duplicate protection is handled by the server.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: {
              type: Type.STRING,
              description: "The customer's full name exactly as they typed it. Leave it out if they haven't given it — the tool asks for it.",
            },
            customer_email: {
              type: Type.STRING,
              description: "The customer's email exactly as they typed it. Leave it out if they haven't given it — never make one up.",
            },
            customer_phone: {
              type: Type.STRING,
              description: "The customer's phone number exactly as they typed it. Leave it out if they haven't given it.",
            },
            guests: { type: Type.NUMBER },
            check_in: { type: Type.STRING },
            check_out: { type: Type.STRING },
            stay_id: { type: Type.STRING },
            service_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Optional list of service IDs (chefs, cars, experiences, errands)",
            },
          },
          // Contact details are checked by the server against what the
          // customer typed; requiring them here pushed the model to invent them.
          required: ["guests", "check_in", "check_out", "stay_id"],
        },
      },
      {
        name: "create_custom_offer",
        description:
          "Create a saved custom request and payment link for something outside our " +
          "listed inventory, or when nothing listed fits the customer's budget or exactly " +
          "what they want. Pass every detail the customer gave as its own field; the tool " +
          "asks for anything the team still needs (for a stay: check-in and check-out " +
          "dates, guests, area and budget). For external listing verification, use " +
          "create_listing_verification_request instead. Call it only after the customer " +
          "agreed to the summary and the small request fee, which is credited in full " +
          "against the final quotation. The exact fee, in the customer's currency, is " +
          "returned as fee_display — never quote it from memory.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ["stay", "transport", "experience", "dining", "event", "service", "other"],
              description:
                "stay = villa, apartment, hotel; transport = car hire, transfers; experience = tours, safaris, " +
                "trips, itineraries; dining = private chef, restaurant; event = wedding, birthday, retreat; " +
                "service = photographer or other services; other = anything else.",
            },
            offer_type: {
              type: Type.STRING,
              description: "Short label: 'safari', 'photographer', 'bespoke_itinerary', 'restaurant_reservation', etc.",
            },
            request_details: {
              type: Type.STRING,
              description: "What the customer wants, in their words: the kind of place or service and anything else they said.",
            },
            start_date: { type: Type.STRING, description: "YYYY-MM-DD: check-in, pickup, activity or event date." },
            end_date: { type: Type.STRING, description: "YYYY-MM-DD: check-out or return date, or the last day." },
            time: { type: Type.STRING, description: "HH:MM (24-hour), if the customer gave a time." },
            guests: { type: Type.NUMBER, description: "Number of people: guests, passengers or party size." },
            location: { type: Type.STRING, description: "Area or place, e.g. Nyali or Diani; for transport, pickup and drop-off." },
            preferences: {
              type: Type.STRING,
              description: "Must-haves and nice-to-haves: bedrooms, pool, beach access, dietary needs, style.",
            },
            tier: {
              type: Type.STRING,
              enum: ["intake", "proposal"],
              description: "proposal for a whole trip or itinerary; intake for everything else. Default to intake if unsure.",
            },
            customer_name: {
              type: Type.STRING,
              description: "The customer's name exactly as they typed it. Leave it out if they haven't given it — the tool asks for it.",
            },
            customer_email: {
              type: Type.STRING,
              description: "The customer's email exactly as they typed it. Leave it out if they haven't given it — never make one up.",
            },
            customer_phone: { type: Type.STRING, description: "The customer's phone number, only if they gave it." },
            listing_url: { type: Type.STRING, description: "Full https:// link for a third-party listing being verified." },
            budget_amount: { type: Type.NUMBER, description: "The customer's budget exactly as they stated it; always pass it when they gave one. Never convert it yourself." },
            budget_currency: {
              type: Type.STRING,
              enum: ["USD", "KES"],
              description: "Required whenever budget_amount is given: the currency the customer used. The fee is quoted in it.",
            },
            budget_basis: {
              type: Type.STRING,
              enum: ["total", "per_night", "per_day", "per_person"],
              description: "What the budget covers, as the customer said it.",
            },
            travel_dates: {
              type: Type.STRING,
              description: "Only when the customer's dates are flexible: how they described them, e.g. 'flexible, mid-December'.",
            },
          },
          // Contact details and the other details are checked by the server
          // against what the customer wrote and what the team needs; requiring
          // them here pushed the model to invent them.
          required: ["category", "offer_type", "request_details", "tier"],
        },
      },
      {
        name: "create_listing_verification_request",
        description:
          "Create a paid listing-verification request for an external stay or service the customer found on Facebook, Jiji, Airbnb, " +
          "or through another agent. Works with a link, with the customer's details when there is no link, or both. " +
          "Creates a booking payment link and dispatches the on-ground team only after payment clears. " +
          "The configured verification fee is credited to the final TBM booking if the customer proceeds.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            listing_url: { type: Type.STRING, description: "The listing link exactly as the customer sent it, if they have one." },
            verification_scope: { type: Type.STRING, description: "What the team must verify: property existence, amenities, host documents, or all." },
            agent_contact: {
              type: Type.STRING,
              description:
                "How to reach the agent or host who shared the listing — phone number, WhatsApp, or Instagram/Facebook page — " +
                "exactly as the customer gave it, with the agent's name if known. The team needs it to arrange the visit. " +
                "Not the customer's own number.",
            },
            customer_name: {
              type: Type.STRING,
              description: "The customer's name exactly as they typed it. Leave it out if they haven't given it — the tool asks for it.",
            },
            customer_email: {
              type: Type.STRING,
              description: "The customer's email exactly as they typed it. Leave it out if they haven't given it — never make one up.",
            },
            customer_phone: { type: Type.STRING, description: "The customer's own phone number, only if they gave it." },
            location: { type: Type.STRING, description: "Coast location if it is not clear from the link, e.g. Nyali, Diani, or Shanzu." },
            listing_context: {
              type: Type.STRING,
              description:
                "Everything the customer knows about the listing: property name and area, agent or host name and phone, " +
                "price, what was promised, text copied from the advert. Required when there is no link.",
            },
            travel_dates: { type: Type.STRING },
          },
          // Name and email are checked by the server against what the customer
          // wrote; requiring them here pushed the model to invent placeholders.
          required: ["verification_scope"],
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
            customer_name: {
              type: Type.STRING,
              description: "The customer's full name exactly as they typed it. Leave it out if they haven't given it — the tool asks for it.",
            },
            customer_email: {
              type: Type.STRING,
              description: "The customer's email exactly as they typed it. Leave it out if they haven't given it — never make one up.",
            },
            customer_phone: {
              type: Type.STRING,
              description: "The customer's phone number exactly as they typed it. Leave it out if they haven't given it.",
            },
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
                "For chefs: 'cook-service-fee', 'cook-inclusive', 'cook-per-plate', or 'cook-single-meal'. " +
                "For base errands: 'errand-base'. " +
                "For shopping, laundry, and house cleaning use the matching errand mode. " +
                "For experiences use 'experience-private' or 'experience-shared'.",
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
            service_budget_amount: {
              type: Type.NUMBER,
              description: "For shopping: the estimated receipt budget exactly as the customer stated it, excluding the service fee. Never convert it yourself.",
            },
            service_budget_currency: {
              type: Type.STRING,
              enum: ["USD", "KES"],
              description: "Required with service_budget_amount: the currency the customer used. The server converts.",
            },
            service_bedrooms: {
              type: Type.NUMBER,
              description: "For house cleaning (errand-house-cleaning): number of bedrooms to clean. Ask the customer; never assume.",
            },
            service_laundry_weight_kg: { type: Type.NUMBER, description: "For laundry: estimated weight in kilograms." },
            service_addon_selections: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Errand add-on ids returned by search." },
            service_schedule_slots: {
              type: Type.ARRAY,
              items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, note: { type: Type.STRING } }, required: ["date"] },
              description: "Optional errand schedule details.",
            },
            service_departure_id: { type: Type.STRING, description: "Required for a shared experience; use a departure id returned by search." },
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
          },
          // Contact details are checked by the server against what the customer typed.
          required: ["service_id", "date", "mode"],
        },
      },
    ],
  },
];
