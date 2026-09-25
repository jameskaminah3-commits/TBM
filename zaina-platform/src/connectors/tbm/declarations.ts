// zaina-platform/src/connectors/tbm/declarations.ts
//
// The tools TBM gives Zaina, as the model sees them. Copied from the TBM
// app's router.ts, except that the booking tools don't require contact
// details (the server takes them only as the customer typed them). Phase 2:
// the same tools, names and parameters with shorter descriptions: rules the
// prompt already states aren't repeated here, and escalate_to_human is a
// tool every business gets from the engine (engine/tool-sets.ts).

import { Type, type FunctionDeclaration } from "@google/genai";

/** A contact detail: only as the customer typed it (the server checks). */
const typed = { type: Type.STRING, description: "As the customer typed it; leave out if not given." };
const isoDate = { type: Type.STRING, description: "YYYY-MM-DD" };
const clockTime = { type: Type.STRING, description: "HH:MM" };

export const tbmToolDeclarations: { functionDeclarations: FunctionDeclaration[] }[] = [
  {
    functionDeclarations: [
      {
        name: "search_stays",
        description: "Find stays (villas, apartments, studios, beach houses) by region, guests and a title keyword. Returns each listing's public_url.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING, description: "e.g. Nyali, Diani, Watamu" },
            guests: { type: Type.NUMBER },
            keyword: { type: Type.STRING, description: "Words from the listing title, e.g. studio, villa, 2 bedroom." },
          },
        },
      },
      {
        name: "search_cooks",
        description: "Find private chefs, with their pricing models (per plate, single meal, session), guest limits and speciality.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
            keyword: { type: Type.STRING, description: "Food or speciality." },
          },
        },
      },
      {
        name: "search_cars",
        description: "Find cars for self-drive or chauffeur, with daily, hourly and zone prices and seating.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
            keyword: { type: Type.STRING, description: "e.g. SUV, van." },
          },
        },
      },
      {
        name: "search_errands",
        description: "Find errand services (shopping, laundry, house cleaning, MamaCare) with their prices and tiers.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            keyword: { type: Type.STRING, description: "e.g. shopping, laundry, cleaning, childcare." },
          },
        },
      },
      {
        name: "search_experiences",
        description: "Find experiences (tours, activities, day trips) with private and shared prices per person, guest limits and inclusions.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            region: { type: Type.STRING },
            guests: { type: Type.NUMBER },
            keyword: { type: Type.STRING, description: "e.g. dhow, snorkeling, food, culture." },
          },
        },
      },
      {
        name: "check_stay_availability",
        description: "Whether a stay is free for the dates. Call it before confirming a booking.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            stay_id: { type: Type.STRING },
            check_in: isoDate,
            check_out: isoDate,
          },
          required: ["stay_id", "check_in", "check_out"],
        },
      },
      {
        name: "calculate_chef_price",
        description: "The exact price of a chef booking. Always call it; never estimate.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            cook_id: { type: Type.STRING },
            mode: { type: Type.STRING, enum: ["per_plate", "single_meal", "session"] },
            quantity: { type: Type.NUMBER, description: "Plates, meals or sessions." },
          },
          required: ["cook_id", "mode", "quantity"],
        },
      },
      {
        name: "calculate_mamacare_price",
        description: "The exact price of a MamaCare (childcare) booking. Always call it; never estimate.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            errand_id: { type: Type.STRING },
            age_band_id: { type: Type.STRING, description: "Optional; defaults to the first band." },
            mode: { type: Type.STRING, enum: ["hourly_daytime", "hourly_evening", "overnight", "full_day"] },
            quantity: { type: Type.NUMBER, description: "Hours for hourly modes (at least 3)." },
          },
          required: ["errand_id", "mode", "quantity"],
        },
      },
      {
        name: "compose_trip_package",
        description: "A trip package (stay, chauffeur transport, one experience) for people, dates and a budget, with its total and whether it fits.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            people: { type: Type.NUMBER },
            check_in: isoDate,
            check_out: isoDate,
            budget_amount: { type: Type.NUMBER, description: "Total budget as the customer said it, e.g. 60000; don't convert." },
            budget_currency: { type: Type.STRING, enum: ["USD", "KES"], description: "As the customer said it; the server converts." },
            destination_preference: { type: Type.STRING, description: "e.g. Diani" },
            include_experience: { type: Type.BOOLEAN, description: "false only if the customer opts out." },
          },
          required: ["people", "check_in", "check_out", "budget_amount", "budget_currency"],
        },
      },
      {
        name: "check_service_availability",
        description: "Live availability of a car, chef, errand or experience on a date. A car day rental needs check_out; a shared experience its departure id.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            service_id: { type: Type.STRING },
            date: isoDate,
            check_out: isoDate,
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
          "Book a stay (with optional add-on services) and get its payment link. The server calculates the total: never pass a price. " +
          "The tool asks for anything missing.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: typed,
            customer_email: typed,
            customer_phone: typed,
            guests: { type: Type.NUMBER },
            check_in: isoDate,
            check_out: isoDate,
            stay_id: { type: Type.STRING },
            service_ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Add-on service ids." },
          },
          // Contact details are checked by the server against what the
          // customer typed; requiring them here pushed the model to invent them.
          required: ["guests", "check_in", "check_out", "stay_id"],
        },
      },
      {
        name: "create_custom_offer",
        description:
          "Create a custom request and its payment link, for something TBM doesn't list or when nothing listed fits the budget or needs. " +
          "Pass each detail as its own field; the tool asks for anything missing. Only after the customer agreed to the summary and the " +
          "request fee; give the fee exactly as fee_display. Not for checking listings found elsewhere.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ["stay", "transport", "experience", "dining", "event", "service", "other"],
              description: "experience includes tours, safaris and itineraries; dining includes restaurants; service e.g. a photographer.",
            },
            offer_type: { type: Type.STRING, description: "Short label, e.g. photographer, safari, restaurant_reservation." },
            request_details: { type: Type.STRING, description: "What the customer wants, in their words." },
            start_date: { type: Type.STRING, description: "YYYY-MM-DD: check-in, pickup or event date." },
            end_date: { type: Type.STRING, description: "YYYY-MM-DD: check-out, return or last day." },
            time: clockTime,
            guests: { type: Type.NUMBER, description: "Number of people." },
            location: { type: Type.STRING, description: "Area or place; for transport, pickup and drop-off." },
            preferences: { type: Type.STRING, description: "Must-haves: bedrooms, pool, beach, dietary needs, style." },
            tier: { type: Type.STRING, enum: ["intake", "proposal"], description: "proposal for a whole trip or itinerary, otherwise intake." },
            customer_name: typed,
            customer_email: typed,
            customer_phone: typed,
            listing_url: { type: Type.STRING, description: "A listing link the customer sent." },
            budget_amount: { type: Type.NUMBER, description: "As the customer said it; don't convert." },
            budget_currency: { type: Type.STRING, enum: ["USD", "KES"], description: "Required with budget_amount." },
            budget_basis: { type: Type.STRING, enum: ["total", "per_night", "per_day", "per_person"] },
            travel_dates: { type: Type.STRING, description: "Flexible dates in the customer's words, e.g. mid-December." },
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
          "Create a paid verification request for a stay, car or tour the customer found elsewhere (Airbnb, Facebook, Jiji, an agent), " +
          "with its link, its details, or both. Returns the fee and payment link.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            listing_url: { type: Type.STRING, description: "The listing link as the customer sent it." },
            verification_scope: { type: Type.STRING, description: "What to verify: the property, amenities, host documents, or all." },
            agent_contact: { type: Type.STRING, description: "The agent's or host's phone, WhatsApp or social page as given (not the customer's own)." },
            customer_name: typed,
            customer_email: typed,
            customer_phone: typed,
            location: { type: Type.STRING, description: "Area, if not clear from the link." },
            listing_context: { type: Type.STRING, description: "What the customer knows: name, area, price, what was promised, advert text. Required without a link." },
            travel_dates: { type: Type.STRING },
          },
          // Name and email are checked by the server against what the customer
          // wrote; requiring them here pushed the model to invent placeholders.
          required: ["verification_scope"],
        },
      },
      {
        name: "create_lead",
        description: "Note a customer's interest when they aren't ready to book.",
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
        name: "create_service_booking",
        description:
          "Book a service without a stay (car or chauffeur, MamaCare, chef, experience or errand) and get its payment link. " +
          "The server calculates the total: never pass a price.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            customer_name: typed,
            customer_email: typed,
            customer_phone: typed,
            service_id: { type: Type.STRING, description: "The car, chef, errand or experience id." },
            date: isoDate,
            check_out: { type: Type.STRING, description: "Car day rental: return date, YYYY-MM-DD." },
            mode: {
              type: Type.STRING,
              description:
                "MamaCare: errand-childcare. Cars: car-chauffeur-day, car-chauffeur-hourly, car-self-drive-day. " +
                "Chefs: cook-service-fee, cook-inclusive, cook-per-plate, cook-single-meal. " +
                "Errands: errand-base, errand-shopping, errand-laundry, errand-house-cleaning. " +
                "Experiences: experience-private, experience-shared.",
            },
            guests: { type: Type.NUMBER, description: "Default 1." },
            service_location: { type: Type.STRING },
            service_pickup_location: { type: Type.STRING, description: "Cars: pickup." },
            service_return_location: { type: Type.STRING, description: "Cars: return or drop-off." },
            service_zone: { type: Type.STRING, description: "Pricing zone from the car result." },
            service_start_time: clockTime,
            service_end_time: clockTime,
            service_request_details: { type: Type.STRING },
            service_budget_amount: { type: Type.NUMBER, description: "Shopping: budget for the items as the customer said it; don't convert." },
            service_budget_currency: { type: Type.STRING, enum: ["USD", "KES"], description: "Required with service_budget_amount." },
            service_bedrooms: { type: Type.NUMBER, description: "House cleaning: bedrooms, as the customer said." },
            service_laundry_weight_kg: { type: Type.NUMBER },
            service_addon_selections: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Add-on ids from search." },
            service_schedule_slots: {
              type: Type.ARRAY,
              items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, note: { type: Type.STRING } }, required: ["date"] },
            },
            service_departure_id: { type: Type.STRING, description: "Shared experience: a departure id from search." },
            mamacare_children: {
              type: Type.ARRAY,
              description: "MamaCare: children per age band.",
              items: {
                type: Type.OBJECT,
                properties: {
                  age_band_id: { type: Type.STRING, description: "From the errand's pricing, e.g. help-mama-toddler." },
                  count: { type: Type.NUMBER },
                },
                required: ["age_band_id", "count"],
              },
            },
            mamacare_care_mode: { type: Type.STRING, enum: ["hourly_daytime", "hourly_evening", "overnight", "full_day"] },
            mamacare_hours: { type: Type.NUMBER, description: "Hourly MamaCare: at least 3." },
            quantity: { type: Type.NUMBER, description: "Sessions or units, default 1." },
          },
          // Contact details are checked by the server against what the customer typed.
          required: ["service_id", "date", "mode"],
        },
      },
    ],
  },
];
