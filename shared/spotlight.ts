// TBM's Spotlight: TBM shares a provider's public page (and, later, a
// partner's) on its own WhatsApp, social media and newsletters. It promotes
// TBM through the people on it, never in competition with them:
// - The provider is the hero and TBM is the stage: "book with them, through
//   TBM", never "book with us instead".
// - The link opens the provider's own page, which shows only their services.
// - Bookings from it are the provider's bookings; commission doesn't change.
// - Only true, checked facts: "Verified by TBM" only while verified, a rating
//   only from 3 eligible reviews, the Founding badge only once granted. No
//   urgency, scarcity or invented numbers.
// - The provider can say no (spotlight_opt_out_at) and hears when TBM
//   features them, and sees the visits and bookings it brought.
import { formatRating, RATING_MIN_REVIEWS } from "./review-eligibility.ts";

// "partner" is for agents and partner businesses once they have public pages.
export const spotlightSubjectKinds = ["provider", "partner"] as const;
export type SpotlightSubjectKind = (typeof spotlightSubjectKinds)[number];

export type SpotlightSubject = {
  kind: SpotlightSubjectKind;
  name: string;
  serviceTypes: string[];
  serviceAreas: string[];
  verified: boolean;
  rating: { average: number; count: number } | null;
  foundingProvider: boolean;
};

const list = (items: string[], max: number) => {
  const shown = items.map((item) => item.trim()).filter(Boolean).slice(0, max);
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] ?? "";
};

// "Stays and car hire in Diani and Mombasa"
export function spotlightLine(subject: SpotlightSubject) {
  const services = list(subject.serviceTypes, 3);
  const areas = list(subject.serviceAreas, 2);
  const sentence = [services ? services.charAt(0).toUpperCase() + services.slice(1).toLowerCase() : "", areas ? `in ${areas}` : ""].filter(Boolean).join(" ");
  return sentence || "On Tembea Bila Matata";
}

// The checked facts, and nothing else.
export function spotlightProof(subject: SpotlightSubject) {
  const facts: string[] = [];
  if (subject.verified) facts.push("Verified by TBM");
  if (subject.rating && subject.rating.count >= RATING_MIN_REVIEWS) {
    facts.push(`${formatRating(subject.rating.average)}★ from ${subject.rating.count} guest reviews`);
  }
  if (subject.foundingProvider && subject.kind === "provider") facts.push("One of TBM's Founding Providers");
  return facts;
}

export function spotlightHeadline(subject: SpotlightSubject) {
  return subject.kind === "partner" ? `Meet our partner: ${subject.name}` : `TBM Spotlight: ${subject.name}`;
}

// The message TBM posts with the link.
export function buildSpotlightMessage(subject: SpotlightSubject, url: string) {
  const proof = spotlightProof(subject);
  const invitation = subject.kind === "partner"
    ? `We're proud to partner with ${subject.name}. See what they offer and book with them through TBM: pay safely in your My Bookings checkout, with our team supporting you throughout.`
    : `We're proud to work with ${subject.name}. See their services and book with them through TBM: pay safely in your My Bookings checkout, with our team supporting you throughout.`;
  return [
    spotlightHeadline(subject),
    spotlightLine(subject),
    proof.length ? proof.join(" · ") : null,
    "",
    invitation,
    url,
  ].filter((line) => line !== null).join("\n");
}

// What the provider hears when TBM features them.
export const spotlightProviderNotice = {
  title: "TBM is featuring your page",
  body: "We've shared your page in TBM's Spotlight to bring you more guests. Bookings from it are yours, and your commission doesn't change. See the visits it brings in Your shares, and share it too.",
};

// What the provider is told about the Spotlight, beside their choice.
export const spotlightExplainer =
  "TBM shares live provider pages on its WhatsApp, social media and newsletters to bring you guests. The link opens your page, showing only your services. Bookings from it are yours, and your commission doesn't change.";
