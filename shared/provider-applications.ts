// Joining TBM as a provider: what each kind of provider is asked, how an
// application is checked and tracked, and the honest example earnings shown on
// the Become a Provider page. Every service, vehicles included, uses the same
// short form; documents are asked for later, before a listing goes live.
import { z } from "zod";
import { addCalendarDays } from "./calendar-dates.ts";
import { normalizeKenyanMobile } from "./provider-profile.ts";

export const applicationServiceTypes = ["stays", "cars", "cooks", "errands", "experiences"] as const;
export type ApplicationServiceType = typeof applicationServiceTypes[number];
export type JoinableService = ApplicationServiceType;

export function isApplicationServiceType(value: unknown): value is ApplicationServiceType {
  return typeof value === "string" && (applicationServiceTypes as readonly string[]).includes(value);
}

export type ApplicationDetailField = {
  key: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "multi";
  options?: string[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  max?: number;
};

export const applicationDetailFields: Record<ApplicationServiceType, ApplicationDetailField[]> = {
  stays: [
    { key: "propertyName", label: "Name of the place", type: "text", required: true, placeholder: "For example, Pembe Villa" },
    { key: "propertyKind", label: "What kind of place", type: "select", required: true, options: ["Villa", "Apartment", "Cottage", "House", "Hotel or guest house", "Other"] },
    { key: "area", label: "Area", type: "text", required: true, placeholder: "For example, Galu Beach, Diani" },
    { key: "bedrooms", label: "Bedrooms", type: "number", required: true, max: 50 },
    { key: "maxGuests", label: "Most guests", type: "number", required: true, max: 200 },
    { key: "nightlyPriceKes", label: "Your price a night (KSh)", type: "number", required: true, max: 2_000_000 },
    { key: "relationship", label: "Is it yours?", type: "select", required: true, options: ["I own it", "I manage it for the owner"] },
    { key: "listedElsewhere", label: "Listed anywhere else?", type: "select", options: ["No", "Yes, on Airbnb or Booking.com", "Yes, somewhere else"] },
    { key: "about", label: "What guests love about it", type: "textarea", placeholder: "The view, the pool, the quiet, the beach a minute away…" },
  ],
  cars: [
    { key: "vehicle", label: "Make and model", type: "text", required: true, placeholder: "For example, Toyota Prado" },
    { key: "year", label: "Year", type: "number", max: 2100 },
    { key: "seats", label: "Passenger seats", type: "number", required: true, max: 80 },
    { key: "transmission", label: "Gearbox", type: "select", required: true, options: ["Automatic", "Manual"] },
    { key: "driver", label: "How you offer it", type: "select", required: true, options: ["With a driver", "Self-drive", "Both"] },
    { key: "area", label: "Where it's based", type: "text", required: true, placeholder: "For example, Nyali, Mombasa" },
    { key: "dayPriceKes", label: "Your price a day (KSh)", type: "number", required: true, max: 2_000_000 },
    { key: "relationship", label: "Is it yours?", type: "select", required: true, options: ["I own it", "I manage it for the owner"] },
    { key: "about", label: "Anything guests should know", type: "textarea", placeholder: "Airport runs, safaris, child seats, a driver who speaks French…" },
  ],
  cooks: [
    { key: "speciality", label: "What you cook", type: "text", required: true, placeholder: "For example, Swahili seafood and BBQ" },
    { key: "experienceYears", label: "Years cooking professionally", type: "number", required: true, max: 70 },
    { key: "dayRateKes", label: "Your fee for a day, before food (KSh)", type: "number", required: true, max: 1_000_000 },
    { key: "maxGuests", label: "Most guests you cook for", type: "number", required: true, max: 500 },
    { key: "foodHandler", label: "Food handler's certificate", type: "select", options: ["Yes", "Applying", "No"] },
    { key: "about", label: "A dish guests remember", type: "textarea", placeholder: "Tell us about the meal people ask you for again." },
  ],
  errands: [
    { key: "services", label: "What you do", type: "multi", required: true, options: ["House cleaning", "Shopping", "Laundry", "Help Mama (childcare)", "Cooking at home", "Other"] },
    { key: "experienceYears", label: "Years of experience", type: "number", required: true, max: 70 },
    { key: "visitPriceKes", label: "Your usual price for a visit (KSh)", type: "number", required: true, max: 500_000 },
    { key: "goodConduct", label: "Certificate of good conduct", type: "select", options: ["Yes", "Applying", "No"] },
    { key: "about", label: "About your work", type: "textarea", placeholder: "Who you've worked for, and what families say about you." },
  ],
  experiences: [
    { key: "title", label: "Name of the experience", type: "text", required: true, placeholder: "For example, Sunset dhow cruise" },
    { key: "whatGuestsDo", label: "What guests do", type: "textarea", required: true, placeholder: "Where you go, what they see, what's included." },
    { key: "durationHours", label: "How long (hours)", type: "number", required: true, max: 240 },
    { key: "pricePerPersonKes", label: "Price a person (KSh)", type: "number", required: true, max: 2_000_000 },
    { key: "maxGuests", label: "Most guests", type: "number", required: true, max: 500 },
    { key: "licence", label: "Licences", type: "select", options: ["I have the licences it needs", "No licence needed", "Not yet"] },
  ],
};

const detailValue = z.union([
  z.string().trim().max(1200),
  z.number().finite().min(0).max(10_000_000),
  z.array(z.string().trim().max(60)).max(12),
]);

export const providerApplicationSchema = z.object({
  serviceType: z.enum(applicationServiceTypes),
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  phone: z.string().transform((value, ctx) => {
    const normalized = normalizeKenyanMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter your phone number, for example 0712 345 678" });
      return z.NEVER;
    }
    return normalized;
  }),
  email: z.string().trim().toLowerCase().email("Enter your email address").max(160),
  town: z.string().trim().min(2, "Where are you based?").max(60),
  details: z.record(detailValue).refine((value) => Object.keys(value).length <= 20, "Too many answers"),
  photos: z.array(z.object({ label: z.string().trim().max(60), url: z.string().trim().max(300) })).max(8).default([]),
  consent: z.literal(true, { errorMap: () => ({ message: "Please agree so TBM can contact you" }) }),
}).superRefine((value, ctx) => {
  for (const field of applicationDetailFields[value.serviceType]) {
    const answer = value.details[field.key];
    const empty = answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0);
    if (field.required && empty) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details", field.key], message: `Add: ${field.label.toLowerCase()}` });
    }
    if (!empty && field.type === "number" && (typeof answer !== "number" || (field.max !== undefined && answer > field.max))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details", field.key], message: `Check: ${field.label.toLowerCase()}` });
    }
  }
});
export type ProviderApplicationInput = z.infer<typeof providerApplicationSchema>;

// The Become a Provider page's example: the provider's own price times how
// often they might be booked, before TBM's commission. An example, not a promise.
export type EarningsExample = {
  priceLabel: string;
  unitLabel: string;
  unitNoun: [singular: string, plural: string];
  defaultPrice: number;
  defaultUnits: number;
  maxUnits: number;
};

export const earningsExamples: Record<JoinableService, EarningsExample> = {
  stays: { priceLabel: "Your price a night", unitLabel: "Nights booked a month", unitNoun: ["night", "nights"], defaultPrice: 9000, defaultUnits: 10, maxUnits: 30 },
  cars: { priceLabel: "Your price a day", unitLabel: "Days booked a month", unitNoun: ["day", "days"], defaultPrice: 7000, defaultUnits: 10, maxUnits: 30 },
  cooks: { priceLabel: "Your fee a day", unitLabel: "Days cooking a month", unitNoun: ["day", "days"], defaultPrice: 6000, defaultUnits: 8, maxUnits: 30 },
  errands: { priceLabel: "Your price a visit", unitLabel: "Visits a month", unitNoun: ["visit", "visits"], defaultPrice: 2500, defaultUnits: 12, maxUnits: 60 },
  experiences: { priceLabel: "Your price a person", unitLabel: "Guests a month", unitNoun: ["guest", "guests"], defaultPrice: 3500, defaultUnits: 25, maxUnits: 300 },
};

export function estimateMonthlyGross(price: number, units: number) {
  if (!Number.isFinite(price) || !Number.isFinite(units) || price <= 0 || units <= 0) return 0;
  return Math.round(price) * Math.round(units);
}

// Real numbers on the page only once there are enough to mean something.
export const PROVIDER_STATS_THRESHOLD = 20;

// Weekdays an open application has waited since it arrived (Kenya dates), so
// TBM's team can reply promptly. For TBM only: applicants aren't promised a time.
export function workingDaysWaiting(appliedOn: string, today: string) {
  let days = 0;
  for (let day = addCalendarDays(appliedOn, 1); day <= today && days < 99; day = addCalendarDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

// ── Tracking an application ─────────────────────────────────────────────────

export const applicationStatuses = ["new", "contacted", "needs-info", "approved", "declined"] as const;
export type ApplicationStatus = typeof applicationStatuses[number];

// What the applicant sees on their status page, in order.
export const applicationStages: Array<{ status: ApplicationStatus; label: string; next: string }> = [
  { status: "new", label: "Received", next: "Our team reviews applications in the order they arrive, then calls or WhatsApps you." },
  { status: "contacted", label: "In review", next: "We're checking your details. We'll be in touch if we need anything." },
  { status: "needs-info", label: "More information needed", next: "Reply to our email or WhatsApp TBM with what we've asked for." },
  { status: "approved", label: "Approved", next: "Check your email for the link to set up your account." },
  { status: "declined", label: "Not approved", next: "You're welcome to apply again when things change." },
];

export function applicationStage(status: string) {
  return applicationStages.find((stage) => stage.status === status) ?? applicationStages[0];
}

export const applicationDeclineReasons = ["outside-area", "service-not-offered", "could-not-verify", "could-not-reach", "other"] as const;
export type ApplicationDeclineReason = typeof applicationDeclineReasons[number];

export const applicationDeclineReasonLabels: Record<ApplicationDeclineReason, string> = {
  "outside-area": "It's outside the areas TBM covers for now.",
  "service-not-offered": "It isn't a service TBM offers yet.",
  "could-not-verify": "We couldn't confirm the details we need.",
  "could-not-reach": "We couldn't reach you by phone or WhatsApp.",
  other: "It isn't the right fit for TBM at the moment.",
};

/** What TBM checks before a listing goes live, by service. Never needed to apply. */
export const verificationDocuments: Record<ApplicationServiceType, string> = {
  stays: "a title deed, lease or the owner's written permission for each stay",
  cars: "the logbook and insurance for each vehicle",
  cooks: "a food handler's certificate if you have one",
  errands: "a certificate of good conduct if you have one",
  experiences: "any licence your activity needs (for example a boat licence)",
};

/** Why each one is asked for, in a sentence. */
export const verificationDocumentsWhy: Record<ApplicationServiceType, string> = {
  stays: "so TBM knows the place is yours to let",
  cars: "so TBM knows the car is yours and insured",
  cooks: "so guests can book you with confidence",
  errands: "because you'll work in guests' homes, sometimes with children",
  experiences: "so guests know the activity runs legally and safely",
};

const referenceAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "TBM-P-7K3Q9X": random, so it reveals nothing about how many apply. */
export function makeApplicationReference(randomBytes: Uint8Array) {
  const chars = Array.from(randomBytes.slice(0, 6), (byte) => referenceAlphabet[byte % referenceAlphabet.length]).join("");
  return `TBM-P-${chars}`;
}

export function isApplicationReference(value: unknown) {
  return typeof value === "string" && /^TBM-P-[A-Z2-9]{6}$/.test(value);
}

/** Status links work for this long after the application. */
export const APPLICATION_STATUS_LINK_DAYS = 90;
/** Account set-up links work for this long. */
export const ACCOUNT_SETUP_LINK_HOURS = 72;

export const officialContactLine = "TBM's official number is +254 718 475 264. TBM never asks for a joining fee, your password or a sign-in code.";
