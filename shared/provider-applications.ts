// Joining TBM as a provider: what each kind of provider is asked, how an
// application is checked, and the honest example earnings shown on the
// Become a Provider page. Vehicles keep their own fleet form.
import { z } from "zod";
import { normalizeKenyanMobile } from "./provider-profile.ts";

export const applicationServiceTypes = ["stays", "cooks", "errands", "experiences"] as const;
export type ApplicationServiceType = typeof applicationServiceTypes[number];
export type JoinableService = ApplicationServiceType | "cars";

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
// often they might be booked, before TBM's agreed rate. An example, not a promise.
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
