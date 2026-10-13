// What a review shows in public. The server builds every public review with
// toPublicReview, so only these fields can leave it: no account, booking or
// review IDs, and no full names.

export type PublicReview = {
  rating: number;
  comment: string | null;
  createdAt: string;
  /** "Amina W.": first name and surname initial. */
  guestName: string;
};

export const publicReviewFields = ["rating", "comment", "createdAt", "guestName"] as const;

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

export function toPublicReview(
  review: { rating: number; comment?: string | null; createdAt: string },
  guestName?: string | null,
): PublicReview {
  const comment = typeof review.comment === "string" && review.comment.trim() ? review.comment.trim() : null;
  return {
    rating: review.rating,
    comment,
    createdAt: review.createdAt,
    guestName: publicReviewerName(guestName),
  };
}
