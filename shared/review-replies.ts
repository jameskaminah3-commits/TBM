// A provider's reply to a review: one per review, written in the Provider Hub,
// public only once TBM approves it. Contact details, links and handles are
// taken out when it's saved, so guests keep reaching providers through TBM.
import { removeContactRoutes } from "./contact-redaction.ts";

export const REVIEW_REPLY_MAX = 500;
export const reviewReplyStatuses = ["pending", "approved", "rejected"] as const;
export type ReviewReplyStatus = typeof reviewReplyStatuses[number];

export const reviewReplyStatusLabels: Record<ReviewReplyStatus, string> = {
  pending: "Waiting for TBM",
  approved: "Public",
  rejected: "Not approved",
};

export const reviewReplyGuidance =
  "Thank the guest and answer what they raised. Keep it about the stay or service. Phone numbers, emails and links are taken out: guests reach you through TBM.";

/** The reply as it will be kept: trimmed, contact routes removed, at most 500 characters. Null when empty. */
export function cleanReviewReply(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 2) return null;
  return removeContactRoutes(text).slice(0, REVIEW_REPLY_MAX).trim();
}

/** The provider can write or change their reply until TBM approves it. */
export function canEditReviewReply(status: string | null | undefined) {
  return status !== "approved";
}
