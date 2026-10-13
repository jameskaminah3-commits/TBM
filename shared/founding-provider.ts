// The Founding Provider badge (plan section 7, decision 3): the first 50
// providers approved, or those approved by 31 March 2027, whichever comes
// first. TBM grants it once from a list of eligible providers; it's never
// recalculated, so it can't drift. It says when a provider joined, not how
// good or safe they are.

export const FOUNDING_PROVIDER_LIMIT = 50;
// The end of 31 March 2027 in Kenya (UTC+3).
export const FOUNDING_PROVIDER_CUTOFF = "2027-03-31T20:59:59.999Z";
export const FOUNDING_WINDOW_DAYS = 60;
export const FOUNDING_COHORT = "2026-27";

export const foundingRevokeReasons = ["fraud", "safety", "impersonation", "account-removed"] as const;
export type FoundingRevokeReason = typeof foundingRevokeReasons[number];
export const foundingRevokeReasonLabels: Record<FoundingRevokeReason, string> = {
  fraud: "Suspended for fraud",
  safety: "Suspended for a safety issue",
  impersonation: "Suspended for impersonation",
  "account-removed": "Account removed",
};

export type FoundingIneligibleReason =
  | "approved-after-cutoff"
  | "outside-first-50"
  | "waiting-for-verification"
  | "not-verified-in-time"
  | "waiting-for-listing"
  | "no-listing-in-time"
  | "suspended"
  | "revoked";

export const foundingReasonLabels: Record<FoundingIneligibleReason, string> = {
  "approved-after-cutoff": "Approved after 31 March 2027",
  "outside-first-50": "Not among the first 50 approved",
  "waiting-for-verification": "Not verified yet (60 days from approval)",
  "not-verified-in-time": "Not verified within 60 days of approval",
  "waiting-for-listing": "No public listing yet (60 days from approval)",
  "no-listing-in-time": "No public listing within 60 days of approval",
  suspended: "Suspended",
  revoked: "Badge removed",
};

export type FoundingCandidateInput = {
  userId: string;
  // When TBM approved their application, or when TBM created the account.
  approvedAt: string;
  verifiedAt: string | null;
  // When their earliest public listing was first published. For a listing
  // public before that was recorded (migration 0027), its creation date.
  firstPublicListingAt: string | null;
  firstPublicListingEstimated?: boolean;
  isSuspended: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
};

export type FoundingCandidate = FoundingCandidateInput & {
  rank: number;
  eligible: boolean;
  reasons: FoundingIneligibleReason[];
};

const dayMs = 24 * 60 * 60 * 1000;
const within = (from: string, to: string | null) => Boolean(to) && Date.parse(to!) - Date.parse(from) <= FOUNDING_WINDOW_DAYS * dayMs;

// Ranked by approval date. The first 50 approved by the cut-off are the
// cohort; the other conditions decide who in it gets the badge. A place isn't
// passed down to the 51st.
export function rankFoundingCandidates(inputs: FoundingCandidateInput[], now = new Date()): FoundingCandidate[] {
  const cutoff = Date.parse(FOUNDING_PROVIDER_CUTOFF);
  const sorted = [...inputs].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.userId.localeCompare(b.userId));
  let rank = 0;
  return sorted.map((input) => {
    const reasons: FoundingIneligibleReason[] = [];
    const approved = Date.parse(input.approvedAt);
    const windowOpen = now.getTime() - approved <= FOUNDING_WINDOW_DAYS * dayMs;
    if (approved > cutoff) reasons.push("approved-after-cutoff");
    else {
      rank += 1;
      if (rank > FOUNDING_PROVIDER_LIMIT) reasons.push("outside-first-50");
    }
    if (!within(input.approvedAt, input.verifiedAt)) reasons.push(windowOpen && !input.verifiedAt ? "waiting-for-verification" : "not-verified-in-time");
    if (!within(input.approvedAt, input.firstPublicListingAt)) reasons.push(windowOpen && !input.firstPublicListingAt ? "waiting-for-listing" : "no-listing-in-time");
    if (input.isSuspended) reasons.push("suspended");
    if (input.revokedAt) reasons.push("revoked");
    return { ...input, rank: approved > cutoff ? 0 : rank, eligible: reasons.length === 0, reasons };
  });
}
