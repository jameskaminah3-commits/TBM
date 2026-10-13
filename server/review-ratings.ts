// Reviews from the database, for public reviews and ratings. Each row carries
// what's needed to decide whether it counts (shared/review-eligibility); the
// rows themselves never leave the server.
import { pool } from "./db";
import { publicRatingFields, ratingKey, summarizeRows, type ReviewRow } from "./public-reviews";
import type { RatingSummary } from "@shared/review-eligibility";

let columnsReady: Promise<void> | null = null;

// The columns from migration 0024, added here too so an older database keeps
// working before the deploy step has run.
export function ensureReviewColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = pool.query(`
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'published';
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_reason varchar;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_by varchar;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_at text;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply text;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_status varchar;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_at text;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_reviewed_by varchar;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_reviewed_at text;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_reply_review_note text;
    `).then(() => undefined).catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  return columnsReady;
}

type RawRow = {
  review_id: string;
  review_user_id: string;
  target_type: string;
  target_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  review_status: string | null;
  provider_reply: string | null;
  provider_reply_status: string | null;
  provider_reply_at: string | null;
  booking_id: string | null;
  booking_user_id: string | null;
  booking_status: string | null;
  payment_status: string | null;
  guest_name: string | null;
  reviewer_role: string | null;
  manager_user_id: string | null;
};

const reviewRowsSql = `
  SELECT r.id AS review_id, r.user_id AS review_user_id, r.target_type, r.target_id, r.rating, r.comment, r.created_at,
         r.status AS review_status, r.provider_reply, r.provider_reply_status, r.provider_reply_at,
         b.id AS booking_id, b.user_id AS booking_user_id, b.status AS booking_status, b.payment_status, b.guest_name,
         u.role AS reviewer_role,
         COALESCE(s.manager_user_id, c.manager_user_id, k.manager_user_id, e.manager_user_id, x.manager_user_id) AS manager_user_id
  FROM reviews r
  LEFT JOIN bookings b ON b.id = r.booking_id
  LEFT JOIN users u ON u.id = r.user_id
  LEFT JOIN stays s ON r.target_type = 'stay' AND s.id = r.target_id
  LEFT JOIN cars c ON r.target_type = 'car' AND c.id = r.target_id
  LEFT JOIN cooks k ON r.target_type = 'cook' AND k.id = r.target_id
  LEFT JOIN errands e ON r.target_type = 'errand' AND e.id = r.target_id
  LEFT JOIN experiences x ON r.target_type = 'experience' AND x.id = r.target_id`;

function toReviewRow(row: RawRow): ReviewRow {
  return {
    reviewId: row.review_id,
    reviewUserId: row.review_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    rating: Number(row.rating),
    comment: row.comment,
    createdAt: row.created_at,
    reviewStatus: row.review_status,
    providerReply: row.provider_reply,
    providerReplyStatus: row.provider_reply_status,
    providerReplyAt: row.provider_reply_at,
    guestName: row.guest_name,
    booking: row.booking_id ? { userId: row.booking_user_id, status: row.booking_status, paymentStatus: row.payment_status } : null,
    listingManagerUserId: row.manager_user_id,
    reviewerRole: row.reviewer_role,
  };
}

export async function getReviewRows(targetType: string, targetId: string): Promise<ReviewRow[]> {
  await ensureReviewColumns();
  const { rows } = await pool.query<RawRow>(`${reviewRowsSql} WHERE r.target_type = $1 AND r.target_id = $2`, [targetType, targetId]);
  return rows.map(toReviewRow);
}

export async function getAllReviewRows(): Promise<ReviewRow[]> {
  await ensureReviewColumns();
  const { rows } = await pool.query<RawRow>(reviewRowsSql);
  return rows.map(toReviewRow);
}

/** The source the public reviews endpoint reads from. */
export const reviewSource = { getReviewRows };

// Rating summaries for every listing, kept for a minute. Writing or hiding a
// review clears them at once on this server.
let summaryCache: { at: number; value: Promise<Map<string, RatingSummary>> } | null = null;
const SUMMARY_TTL_MS = 60_000;

export function getRatingSummaries(): Promise<Map<string, RatingSummary>> {
  if (!summaryCache || Date.now() - summaryCache.at > SUMMARY_TTL_MS) {
    const value = getAllReviewRows().then(summarizeRows);
    summaryCache = { at: Date.now(), value };
    value.catch(() => {
      if (summaryCache?.value === value) summaryCache = null;
    });
  }
  return summaryCache.value;
}

export function clearRatingSummaries() {
  summaryCache = null;
}

export async function getRatingSummary(targetType: string, targetId: string): Promise<RatingSummary> {
  return (await getRatingSummaries()).get(ratingKey(targetType, targetId)) ?? { count: 0, average: null };
}

/** Public listings with `rating` and `reviewCount` from eligible reviews, never the stored columns. */
export async function withPublicRatings<T extends { id: string }>(targetType: string, listings: T[]): Promise<T[]> {
  if (!listings.length) return listings;
  let summaries: Map<string, RatingSummary>;
  try {
    summaries = await getRatingSummaries();
  } catch (error) {
    // A ratings problem mustn't take the catalogue down: show no ratings instead.
    console.error("[REVIEWS] Couldn't load rating summaries:", error);
    summaries = new Map();
  }
  return listings.map((listing) => ({ ...listing, ...publicRatingFields(summaries.get(ratingKey(targetType, listing.id))) }));
}
