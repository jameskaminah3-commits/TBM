// What a review shows in public. The server builds every public review with
// toPublicReview, so only these fields can leave it: no account, booking or
// review IDs, no full names, and no phone numbers or emails in the text.
import { PUBLIC_CONTACT_REMOVED, removeContactDetails } from "./contact-redaction.ts";

export type PublicReviewReply = {
  text: string;
  createdAt: string | null;
};

export type PublicReview = {
  rating: number;
  comment: string | null;
  createdAt: string;
  /** "Amina W.": first name and surname initial. */
  guestName: string;
  /** The provider's reply, once TBM has approved it. */
  reply: PublicReviewReply | null;
};

export const publicReviewFields = ["rating", "comment", "createdAt", "guestName", "reply"] as const;

const fallbackName = "Verified guest";

/** "Amina Wanjiru Otieno" → "Amina O."; "Amina" → "Amina"; empty → "Verified guest". */
export function publicReviewerName(fullName?: string | null) {
  const parts = (fullName ?? "")
    .replace(/[\d@.,;:!?#$%^&*()+=<>[\]{}|\\/"`~_]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return fallbackName;
  const first = parts[0];
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1])[0]?.toLocaleUpperCase("en-GB");
  return initial ? `${first} ${initial}.` : first;
}

/** Free text shown in public: trimmed, with phone numbers and emails taken out. */
export function publicText(value?: string | null) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? removeContactDetails(trimmed, PUBLIC_CONTACT_REMOVED) : null;
}

export function toPublicReview(
  review: {
    rating: number;
    comment?: string | null;
    createdAt: string;
    providerReply?: string | null;
    providerReplyStatus?: string | null;
    providerReplyAt?: string | null;
  },
  guestName?: string | null,
): PublicReview {
  const replyText = review.providerReplyStatus === "approved" ? publicText(review.providerReply) : null;
  return {
    rating: review.rating,
    comment: publicText(review.comment),
    createdAt: review.createdAt,
    guestName: publicReviewerName(guestName),
    reply: replyText ? { text: replyText, createdAt: review.providerReplyAt ?? null } : null,
  };
}
