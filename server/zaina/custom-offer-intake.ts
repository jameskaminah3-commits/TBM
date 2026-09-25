// server/zaina/custom-offer-intake.ts
//
// What the team needs before it can act on a custom request, by kind of
// request. A stay can't be sourced without check-in and check-out dates, the
// number of guests and the area, so a request missing any of them goes back
// to the customer as one friendly question instead of reaching the team (and
// the customer's request fee) half-finished. A budget is asked for once: a
// customer who would rather not give one can still go ahead.
//
// Pure module: no database or network access, so every rule is unit-tested.

export const CUSTOM_REQUEST_CATEGORIES = ["stay", "transport", "experience", "dining", "event", "service", "other"] as const;
export type CustomRequestCategory = (typeof CUSTOM_REQUEST_CATEGORIES)[number];

export const BUDGET_BASES = ["total", "per_night", "per_day", "per_person"] as const;
export type BudgetBasis = (typeof BUDGET_BASES)[number];

export type RequestDetail = "dates" | "guests" | "location" | "budget" | "budget_basis";

const NEEDS: Record<CustomRequestCategory, RequestDetail[]> = {
  stay: ["dates", "guests", "location", "budget"],
  transport: ["dates", "guests", "location", "budget"],
  experience: ["dates", "guests", "location", "budget"],
  dining: ["dates", "guests", "location", "budget"],
  event: ["dates", "guests", "location", "budget"],
  service: ["dates", "location", "budget"],
  other: ["budget"],
};

const LABELS: Record<CustomRequestCategory, string> = {
  stay: "Stay",
  transport: "Transport",
  experience: "Experience or trip",
  dining: "Dining",
  event: "Event",
  service: "Service",
  other: "Custom",
};

type Wording = { intro: string; dates: string; guests: string; location: string; budget: string };

const WORDING: Record<CustomRequestCategory, Wording> = {
  stay: {
    intro: "To find you the right place",
    dates: "your check-in and check-out dates",
    guests: "how many guests",
    location: "which area you'd like to stay in",
    budget: "roughly what budget you have in mind (per night or in total)",
  },
  transport: {
    intro: "To arrange the right ride",
    dates: "the date (and the return date, if you need it for more than a day)",
    guests: "how many passengers",
    location: "where to pick you up and drop you off",
    budget: "roughly what budget you have in mind",
  },
  experience: {
    intro: "To plan this properly",
    dates: "which date or dates",
    guests: "how many people",
    location: "which area or places you'd like to go",
    budget: "roughly what budget you have in mind",
  },
  dining: {
    intro: "To set this up",
    dates: "the date",
    guests: "how many people",
    location: "where you'd like it (your place, or which area)",
    budget: "roughly what budget you have in mind",
  },
  event: {
    intro: "To plan this properly",
    dates: "the date",
    guests: "roughly how many guests",
    location: "where you'd like to hold it",
    budget: "roughly what budget you have in mind",
  },
  service: {
    intro: "To arrange this",
    dates: "the date",
    guests: "how many people",
    location: "where you need it",
    budget: "roughly what budget you have in mind",
  },
  other: {
    intro: "To get this right for you",
    dates: "when you need it",
    guests: "how many people",
    location: "where you need it",
    budget: "roughly what budget you have in mind",
  },
};

const CATEGORY_WORDS: Array<[CustomRequestCategory, RegExp]> = [
  ["stay", /\b(stay|villa|apartment|house|home|hotel|room|airbnb|accommodation|cottage|bnb|studio|bedroom|guesthouse)s?\b/i],
  ["transport", /\b(car|transfer|driver|chauffeur|taxi|pick-?up|drop-?off|airport|sgr|shuttle|van|bus|ride)s?\b/i],
  ["event", /\b(wedding|birthday|party|event|retreat|proposal|anniversary|conference|celebration)s?\b/i],
  ["dining", /\b(chef|restaurant|dinner|lunch|breakfast|brunch|meal|menu|cook|table)s?\b/i],
  ["experience", /\b(safari|tour|trip|itinerary|excursion|snorkel\w*|dhow|boat|div(e|ing)|experience|activit(y|ies)|park)s?\b/i],
  ["service", /\b(photographer|photo(shoot|graphy)?|video\w*|massage|spa|cleaning|laundry|nanny|errand|shopping|salon|hair|make-?up)s?\b/i],
];

/** The kind of request: the category the model gave, or one read from the request's wording. */
export function customRequestCategory(value: unknown, requestText: string): CustomRequestCategory {
  const given = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((CUSTOM_REQUEST_CATEGORIES as readonly string[]).includes(given)) return given as CustomRequestCategory;
  return CATEGORY_WORDS.find(([, words]) => words.test(requestText))?.[0] ?? "other";
}

/** A calendar date written YYYY-MM-DD, or null. */
export function isoDateArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? date : null;
}

/** A number of people, given as a number or as digits. */
export function guestsArg(value: unknown): number | null {
  const count = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(count) && count >= 1 && count <= 1000 ? count : null;
}

export function budgetBasisArg(value: unknown): BudgetBasis | null {
  const basis = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (BUDGET_BASES as readonly string[]).includes(basis) ? (basis as BudgetBasis) : null;
}

/** A time written HH:MM (24-hour), or null. */
export function timeArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

export type CustomRequestDetails = {
  category: CustomRequestCategory;
  startDate: string | null;
  endDate: string | null;
  guests: number | null;
  location: string;
  /** The budget as the customer stated it ("KSh 3,000"), when they gave one. */
  budgetLabel: string | null;
  budgetBasis: BudgetBasis | null;
};

export type DetailsCheck =
  | { ok: true }
  | { ok: false; missing: RequestDetail[]; question: string };

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function nightsBetween(startDate: string, endDate: string): number {
  const [start, end] = [startDate, endDate].map((date) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  });
  return Math.round((end - start) / 86_400_000);
}

function joinList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * Whether the request has what the team needs. When it doesn't, the question
 * asks for everything missing at once, in words that fit the request.
 * `alreadyAsked` lists details asked for earlier in this conversation: a
 * budget is never asked for twice, while dates, guests and the area are
 * asked for until the customer gives them.
 */
export function checkCustomRequestDetails(
  details: CustomRequestDetails,
  options: { today: string; alreadyAsked: RequestDetail[] },
): DetailsCheck {
  const wording = WORDING[details.category];
  const needs = NEEDS[details.category];
  const missing: RequestDetail[] = [];
  const asks: string[] = [];

  if (needs.includes("dates")) {
    const { startDate, endDate } = details;
    const isStay = details.category === "stay";
    if (!startDate || (isStay && !endDate)) {
      missing.push("dates");
      asks.push(wording.dates);
    } else if (startDate < options.today) {
      missing.push("dates");
      asks.push(`${wording.dates} again, as ${formatDay(startDate)} has already passed`);
    } else if (isStay && endDate && endDate <= startDate) {
      missing.push("dates");
      asks.push(`${wording.dates} again, as check-out needs to be after check-in`);
    } else if (endDate && endDate < startDate) {
      missing.push("dates");
      asks.push(`${wording.dates} again, as the end date comes before the start date`);
    }
  }
  if (needs.includes("guests") && !details.guests) {
    missing.push("guests");
    asks.push(wording.guests);
  }
  if (needs.includes("location") && details.location.trim().length < 2) {
    missing.push("location");
    asks.push(wording.location);
  }
  if (needs.includes("budget") && !options.alreadyAsked.includes("budget")) {
    if (!details.budgetLabel) {
      missing.push("budget");
      asks.push(wording.budget);
    } else if (details.category === "stay" && !details.budgetBasis && !options.alreadyAsked.includes("budget_basis")) {
      missing.push("budget_basis");
      asks.push(`whether your budget of ${details.budgetLabel} is per night or for the whole stay`);
    }
  }

  if (missing.length === 0) return { ok: true };
  const optional = missing.includes("budget") ? " If you'd rather not set a budget, that's fine too." : "";
  return { ok: false, missing, question: `${wording.intro}, could you tell me ${joinList(asks)}?${optional}` };
}

const BASIS_WORDS: Record<BudgetBasis, string> = {
  total: "in total",
  per_night: "per night",
  per_day: "per day",
  per_person: "per person",
};

/** The request written out for the team, one detail per line. */
export function describeCustomRequest(request: {
  category: CustomRequestCategory;
  startDate: string | null;
  endDate: string | null;
  time: string | null;
  guests: number | null;
  location: string;
  /** The budget as the customer stated it ("KSh 3,000"), and its conversion ("≈ $23"). */
  budget: { stated: string; converted: string | null } | null;
  budgetBasis: BudgetBasis | null;
  flexibleDates: string;
  preferences: string;
  requestDetails: string;
  listingUrl: string;
}): string {
  const lines = [`${LABELS[request.category]} request`];
  const { startDate, endDate } = request;
  if (startDate && endDate && endDate !== startDate) {
    const nights = nightsBetween(startDate, endDate);
    const length = request.category === "stay" ? ` (${nights} night${nights === 1 ? "" : "s"})` : "";
    lines.push(`Dates: ${formatDay(startDate)} to ${formatDay(endDate)}${length}`);
  } else if (startDate) {
    lines.push(`Date: ${formatDay(startDate)}`);
  }
  if (request.flexibleDates) lines.push(`Dates as the customer put them: ${request.flexibleDates}`);
  if (request.time) lines.push(`Time: ${request.time}`);
  if (request.guests) lines.push(`${request.category === "transport" ? "Passengers" : "Guests"}: ${request.guests}`);
  if (request.location.trim()) {
    lines.push(`${request.category === "transport" ? "Pickup and drop-off" : "Area"}: ${request.location.trim()}`);
  }
  const budget = request.budget;
  lines.push(`Budget: ${budget
    ? [budget.stated, request.budgetBasis ? BASIS_WORDS[request.budgetBasis] : "", budget.converted ? `(${budget.converted})` : ""]
      .filter(Boolean).join(" ")
    : "not given"}`);
  if (request.preferences) lines.push(`Preferences: ${request.preferences}`);
  lines.push(`Details: ${request.requestDetails}`);
  if (request.listingUrl) lines.push(`Listing URL: ${request.listingUrl}`);
  return lines.join("\n");
}
