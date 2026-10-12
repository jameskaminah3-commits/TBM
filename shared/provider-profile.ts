// A provider's business profile, payout details and verification, and the
// "get set up" steps Provider Hub shows until they're done. Payout details are
// private: only the provider and TBM's admins ever see them.
import { z } from "zod";

export const providerLanguages = ["English", "Swahili", "French", "German", "Italian", "Arabic", "Chinese", "Other"] as const;
export const providerServiceAreas = [
  "Mombasa",
  "Nyali",
  "Bamburi",
  "Shanzu",
  "Mtwapa",
  "Vipingo",
  "Kilifi",
  "Watamu",
  "Malindi",
  "Diani",
  "Tiwi",
  "Lamu",
] as const;

export const verificationStatuses = ["not-started", "in-review", "verified"] as const;
export type VerificationStatus = typeof verificationStatuses[number];
export const payoutMethods = ["mpesa", "bank"] as const;
export type PayoutMethod = typeof payoutMethods[number];
export type PayoutDetailsStatus = "none" | "unconfirmed" | "confirmed";

// Safaricom and Airtel numbers, written any common way, as 2547XXXXXXXX / 2541XXXXXXXX.
export function normalizeKenyanMobile(value: string): string | null {
  const digits = value.replace(/[\s()-]/g, "").replace(/^\+/, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}

export function maskPayoutNumber(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\s/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
}

const trimmed = (max: number) => z.string().trim().max(max);

export const providerBusinessProfileSchema = z.object({
  businessName: trimmed(80).default(""),
  bio: trimmed(600).default(""),
  photoUrl: trimmed(500)
    .refine((value) => value === "" || /^https:\/\//.test(value) || value.startsWith("/"), "Use an uploaded photo")
    .default(""),
  languages: z.array(z.enum(providerLanguages)).max(providerLanguages.length).default([]),
  serviceAreas: z.array(z.enum(providerServiceAreas)).max(providerServiceAreas.length).default([]),
});
export type ProviderBusinessProfileInput = z.infer<typeof providerBusinessProfileSchema>;

export const providerPayoutDetailsSchema = z.discriminatedUnion("payoutMethod", [
  z.object({
    payoutMethod: z.literal("mpesa"),
    mpesaNumber: z.string().transform((value, ctx) => {
      const normalized = normalizeKenyanMobile(value);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the M-Pesa number, for example 0712 345 678" });
        return z.NEVER;
      }
      return normalized;
    }),
    mpesaName: trimmed(80).min(2, "Enter the name the M-Pesa number is registered to"),
  }),
  z.object({
    payoutMethod: z.literal("bank"),
    bankName: trimmed(80).min(2, "Enter the bank"),
    bankAccountName: trimmed(80).min(2, "Enter the account name"),
    bankAccountNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{5,34}$/, "Enter the account number"),
    bankBranch: trimmed(80).default(""),
  }),
]);
export type ProviderPayoutDetailsInput = z.infer<typeof providerPayoutDetailsSchema>;

export type ProviderProfileView = {
  businessName: string;
  bio: string;
  photoUrl: string;
  languages: string[];
  serviceAreas: string[];
  payoutMethod: PayoutMethod | null;
  mpesaNumber: string | null;
  mpesaName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankBranch: string | null;
  payoutDetailsStatus: PayoutDetailsStatus;
  payoutDetailsUpdatedAt: string | null;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  verifiedAt: string | null;
};

export const emptyProviderProfile: ProviderProfileView = {
  businessName: "",
  bio: "",
  photoUrl: "",
  languages: [],
  serviceAreas: [],
  payoutMethod: null,
  mpesaNumber: null,
  mpesaName: null,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankBranch: null,
  payoutDetailsStatus: "none",
  payoutDetailsUpdatedAt: null,
  verificationStatus: "not-started",
  verificationNote: null,
  verifiedAt: null,
};

export function describePayoutDestination(profile: Pick<ProviderProfileView, "payoutMethod" | "mpesaNumber" | "bankName" | "bankAccountNumber">) {
  if (profile.payoutMethod === "mpesa" && profile.mpesaNumber) return `M-Pesa ${maskPayoutNumber(profile.mpesaNumber)}`;
  if (profile.payoutMethod === "bank" && profile.bankAccountNumber) return `${profile.bankName ?? "Bank"} ${maskPayoutNumber(profile.bankAccountNumber)}`;
  return null;
}

export type ProviderSetupStepKey = "business" | "payout" | "verification" | "listing" | "share";
export type ProviderSetupStep = {
  key: ProviderSetupStepKey;
  title: string;
  why: string;
  done: boolean;
  inProgress?: boolean;
  href: string;
  action: string;
};

// The steps between signing up and steady bookings, in the order that helps
// most. Each says why it matters, so providers see what they get for it.
export function getProviderSetupSteps(input: {
  profile: Pick<ProviderProfileView, "businessName" | "bio" | "payoutMethod" | "verificationStatus">;
  hasListing: boolean;
  hasPublicListing: boolean;
  hasShared: boolean;
}): ProviderSetupStep[] {
  const { profile } = input;
  return [
    {
      key: "business",
      title: "Introduce your business",
      why: "Tells TBM who you are and what you do best.",
      done: Boolean(profile.businessName.trim() && profile.bio.trim().length >= 40),
      href: "/provider/profile#business",
      action: "Add details",
    },
    {
      key: "payout",
      title: "Add where you get paid",
      why: "M-Pesa or bank, so payouts reach you without delay.",
      done: Boolean(profile.payoutMethod),
      href: "/provider/profile#payout",
      action: "Add payout details",
    },
    {
      key: "verification",
      title: "Get verified",
      why: "TBM checks your ID and that the service is yours to offer.",
      done: profile.verificationStatus === "verified",
      inProgress: profile.verificationStatus === "in-review",
      href: "/provider/profile#verification",
      action: profile.verificationStatus === "in-review" ? "In review" : "Ask TBM to verify",
    },
    {
      key: "listing",
      title: input.hasListing ? "Go live" : "Add your first listing",
      why: input.hasListing ? "TBM checks it and publishes it for guests." : "Photos, price and what's included.",
      done: input.hasPublicListing,
      inProgress: input.hasListing && !input.hasPublicListing,
      href: "/provider/dashboard?tab=listings",
      action: input.hasListing ? "See listings" : "Add a listing",
    },
    {
      key: "share",
      title: "Share a listing",
      why: "Bookings from your own link show in Share & grow.",
      done: input.hasShared,
      href: "/provider/share",
      action: "Share now",
    },
  ];
}
