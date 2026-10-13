// Replies and moderation (plan section 4). A provider replies once to each
// public review of their listings; the reply is public only after TBM
// approves it, and they can change it until then. TBM can hide a review only
// for abuse, personal details or the wrong booking, with the reason recorded:
// never for being negative. Providers and admins see first names and initials
// only, and never a reviewer's account or booking ID.
import { pool } from "./db";
import { clearRatingSummaries, ensureReviewColumns } from "./review-ratings";
import { isEligibleRow, type ReviewRow } from "./public-reviews";
import { clearProviderPageCache } from "./provider-pages";
import { publicReviewerName, publicText } from "@shared/public-review";
import { canEditReviewReply, cleanReviewReply, type ReviewReplyStatus } from "@shared/review-replies";
import { summarizeRatings, type ReviewHideReason } from "@shared/review-eligibility";
import { getCarDisplayName } from "@shared/listing-share";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";

type RawRow = {
  review_id: string;
  review_user_id: string;
  target_type: string;
  target_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  review_status: string | null;
  hidden_reason: string | null;
  hidden_at: string | null;
  provider_reply: string | null;
  provider_reply_status: string | null;
  provider_reply_at: string | null;
  provider_reply_review_note: string | null;
  booking_id: string | null;
  booking_user_id: string | null;
  booking_status: string | null;
  payment_status: string | null;
  guest_name: string | null;
  reviewer_role: string | null;
  manager_user_id: string | null;
  listing_title: string | null;
  car_make: string | null;
  car_model: string | null;
};

const managerSql = "COALESCE(s.manager_user_id, c.manager_user_id, k.manager_user_id, e.manager_user_id, x.manager_user_id)";
const moderationSql = `
  SELECT r.id AS review_id, r.user_id AS review_user_id, r.target_type, r.target_id, r.rating, r.comment, r.created_at,
         r.status AS review_status, r.hidden_reason, r.hidden_at,
         r.provider_reply, r.provider_reply_status, r.provider_reply_at, r.provider_reply_review_note,
         b.id AS booking_id, b.user_id AS booking_user_id, b.status AS booking_status, b.payment_status, b.guest_name,
         u.role AS reviewer_role,
         ${managerSql} AS manager_user_id,
         COALESCE(s.title, k.title, e.service_name, x.title) AS listing_title, c.make AS car_make, c.model AS car_model
  FROM reviews r
  LEFT JOIN bookings b ON b.id = r.booking_id
  LEFT JOIN users u ON u.id = r.user_id
  LEFT JOIN stays s ON r.target_type = 'stay' AND s.id = r.target_id
  LEFT JOIN cars c ON r.target_type = 'car' AND c.id = r.target_id
  LEFT JOIN cooks k ON r.target_type = 'cook' AND k.id = r.target_id
  LEFT JOIN errands e ON r.target_type = 'errand' AND e.id = r.target_id
  LEFT JOIN experiences x ON r.target_type = 'experience' AND x.id = r.target_id`;

function toEligibilityRow(row: RawRow, published = true): ReviewRow {
  return {
    reviewId: row.review_id,
    reviewUserId: row.review_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    rating: Number(row.rating),
    comment: row.comment,
    createdAt: row.created_at,
    // Whether it would count if it weren't hidden: hidden is shown separately.
    reviewStatus: published ? "published" : row.review_status,
    providerReply: row.provider_reply,
    providerReplyStatus: row.provider_reply_status,
    providerReplyAt: row.provider_reply_at,
    guestName: row.guest_name,
    booking: row.booking_id ? { userId: row.booking_user_id, status: row.booking_status, paymentStatus: row.payment_status } : null,
    listingManagerUserId: row.manager_user_id,
    reviewerRole: row.reviewer_role,
  };
}

export type ModeratedReview = {
  id: string;
  listingKind: PublicListingKind;
  listingName: string;
  listingPath: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  guestName: string;
  /** Counts for the rating (a genuine completed booking, not the provider's own). */
  eligible: boolean;
  hidden: { reason: string | null; at: string | null } | null;
  reply: { text: string; status: ReviewReplyStatus; at: string | null; note: string | null } | null;
};

function toModerated(row: RawRow): ModeratedReview {
  const kind = row.target_type as PublicListingKind;
  const name = kind === "car" ? getCarDisplayName({ make: row.car_make, model: row.car_model }) : row.listing_title ?? "Listing";
  return {
    id: row.review_id,
    listingKind: kind,
    listingName: name,
    listingPath: getPublicListingPath(kind, row.target_id, name),
    rating: Number(row.rating),
    comment: publicText(row.comment),
    createdAt: row.created_at,
    guestName: publicReviewerName(row.guest_name),
    eligible: isEligibleRow(toEligibilityRow(row)),
    hidden: row.review_status === "hidden" ? { reason: row.hidden_reason, at: row.hidden_at } : null,
    reply: row.provider_reply
      ? { text: row.provider_reply, status: (row.provider_reply_status ?? "pending") as ReviewReplyStatus, at: row.provider_reply_at, note: row.provider_reply_review_note }
      : null,
  };
}

async function getRow(reviewId: string) {
  await ensureReviewColumns();
  const { rows } = await pool.query<RawRow>(`${moderationSql} WHERE r.id = $1`, [reviewId]);
  return rows[0] ?? null;
}

function changed() {
  clearRatingSummaries();
  clearProviderPageCache();
}

// ── The provider ────────────────────────────────────────────────────────────

// Reviews that count, on the provider's own listings, with their replies.
export async function listProviderReviews(userId: string) {
  await ensureReviewColumns();
  const { rows } = await pool.query<RawRow>(`${moderationSql} WHERE ${managerSql} = $1 ORDER BY r.created_at DESC`, [userId]);
  const reviews = rows.map(toModerated).filter((review) => review.eligible && !review.hidden);
  const summary = summarizeRatings(reviews.map((review) => review.rating));
  return { reviews, rating: summary.average === null ? null : { average: summary.average, count: summary.count }, count: reviews.length };
}

type Result = { ok: true; review: ModeratedReview } | { ok: false; status: number; error: string };

async function ownReview(userId: string, reviewId: string): Promise<{ row: RawRow } | { ok: false; status: number; error: string }> {
  const row = await getRow(reviewId);
  // Someone else's review looks the same as one that doesn't exist.
  if (!row || row.manager_user_id !== userId) return { ok: false, status: 404, error: "Review not found" };
  const review = toModerated(row);
  if (!review.eligible || review.hidden) return { ok: false, status: 409, error: "This review isn't public, so it can't have a reply." };
  return { row };
}

export async function saveProviderReply(userId: string, reviewId: string, text: unknown): Promise<Result> {
  const found = await ownReview(userId, reviewId);
  if (!("row" in found)) return found;
  if (!canEditReviewReply(found.row.provider_reply_status)) return { ok: false, status: 409, error: "Your reply is already public. Message TBM to change it." };
  const reply = cleanReviewReply(text);
  if (!reply) return { ok: false, status: 400, error: "Write a short reply first." };
  await pool.query(
    `UPDATE reviews SET provider_reply = $2, provider_reply_status = 'pending', provider_reply_at = $3, provider_reply_review_note = NULL,
       provider_reply_reviewed_by = NULL, provider_reply_reviewed_at = NULL WHERE id = $1`,
    [reviewId, reply, new Date().toISOString()],
  );
  changed();
  return { ok: true, review: toModerated((await getRow(reviewId))!) };
}

export async function withdrawProviderReply(userId: string, reviewId: string): Promise<Result> {
  const found = await ownReview(userId, reviewId);
  if (!("row" in found)) return found;
  if (!canEditReviewReply(found.row.provider_reply_status)) return { ok: false, status: 409, error: "Your reply is already public. Message TBM to change it." };
  await pool.query(
    "UPDATE reviews SET provider_reply = NULL, provider_reply_status = NULL, provider_reply_at = NULL, provider_reply_review_note = NULL WHERE id = $1",
    [reviewId],
  );
  changed();
  return { ok: true, review: toModerated((await getRow(reviewId))!) };
}

// ── TBM ─────────────────────────────────────────────────────────────────────

export async function listAdminReviews() {
  await ensureReviewColumns();
  const { rows } = await pool.query<RawRow & { provider_name: string | null }>(
    `SELECT q.*, NULLIF(trim(concat_ws(' ', pu.first_name, pu.last_name)), '') AS provider_name
     FROM (${moderationSql}) q LEFT JOIN users pu ON pu.id = q.manager_user_id
     ORDER BY (q.provider_reply_status = 'pending') DESC NULLS LAST, q.created_at DESC LIMIT 300`,
  );
  return rows.map((row) => ({ ...toModerated(row), providerName: row.provider_name ?? "No provider", managerUserId: row.manager_user_id }));
}

export async function decideReviewReply(reviewId: string, args: { decision: "approve" | "reject"; note: string | null; adminId: string }) {
  const row = await getRow(reviewId);
  if (!row?.provider_reply) return { ok: false as const, status: 404, error: "There's no reply to review." };
  await pool.query(
    `UPDATE reviews SET provider_reply_status = $2, provider_reply_review_note = $3, provider_reply_reviewed_by = $4, provider_reply_reviewed_at = $5 WHERE id = $1`,
    [reviewId, args.decision === "approve" ? "approved" : "rejected", args.note, args.adminId, new Date().toISOString()],
  );
  changed();
  return { ok: true as const, providerUserId: row.manager_user_id, review: toModerated((await getRow(reviewId))!) };
}

export async function setReviewHidden(reviewId: string, args: { reason: ReviewHideReason | null; adminId: string }) {
  const row = await getRow(reviewId);
  if (!row) return { ok: false as const, status: 404, error: "Review not found" };
  const now = new Date().toISOString();
  await pool.query(
    args.reason
      ? "UPDATE reviews SET status = 'hidden', hidden_reason = $2, hidden_by = $3, hidden_at = $4 WHERE id = $1"
      : "UPDATE reviews SET status = 'published', hidden_reason = NULL, hidden_by = NULL, hidden_at = NULL WHERE id = $1",
    args.reason ? [reviewId, args.reason, args.adminId, now] : [reviewId],
  );
  changed();
  return { ok: true as const, providerUserId: row.manager_user_id, review: toModerated((await getRow(reviewId))!) };
}
