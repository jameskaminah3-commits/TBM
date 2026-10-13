// The stored `rating` and `review_count` columns on listings, checked against
// eligible reviews. Public pages already recompute from eligible reviews, so
// these columns only feed TBM's own screens; they can still hold old or
// seeded numbers. TBM sees the differences first and recounts on purpose —
// never automatically — because a seeded rating with no eligible reviews
// behind it goes to zero.
import { storedRatingFields } from "@shared/review-eligibility";
import { pool } from "./db";
import { ratingKey } from "./public-reviews";
import { clearRatingSummaries, getRatingSummaries } from "./review-ratings";

const tables = [
  { kind: "stay", table: "stays", name: "title" },
  { kind: "car", table: "cars", name: "trim(concat_ws(' ', make, model))" },
  { kind: "cook", table: "cooks", name: "title" },
  { kind: "errand", table: "errands", name: "service_name" },
  { kind: "experience", table: "experiences", name: "title" },
] as const;

export type StoredRatingDifference = {
  kind: (typeof tables)[number]["kind"];
  id: string;
  name: string;
  isPublic: boolean;
  stored: { rating: number; reviewCount: number };
  eligible: { rating: number; reviewCount: number };
};

export async function checkStoredRatings() {
  clearRatingSummaries();
  const summaries = await getRatingSummaries();
  const differences: StoredRatingDifference[] = [];
  let checked = 0;
  for (const { kind, table, name } of tables) {
    const { rows } = await pool.query<{ id: string; name: string | null; is_public: boolean; rating: number; review_count: number }>(
      `SELECT id, ${name} AS name, is_public, rating, review_count FROM ${table} ORDER BY id`,
    );
    for (const row of rows) {
      checked += 1;
      const eligible = storedRatingFields(summaries.get(ratingKey(kind, row.id)) ?? { count: 0, average: null });
      if (Number(row.rating) !== eligible.rating || Number(row.review_count) !== eligible.reviewCount) {
        differences.push({
          kind,
          id: row.id,
          name: row.name?.trim() || "Untitled",
          isPublic: Boolean(row.is_public),
          stored: { rating: Number(row.rating), reviewCount: Number(row.review_count) },
          eligible,
        });
      }
    }
  }
  return { checked, differences };
}

// Writes the eligible numbers into every listing that differs. Only these two
// columns change; nothing else about the listing does.
export async function recountStoredRatings() {
  const { checked, differences } = await checkStoredRatings();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const difference of differences) {
      const { table } = tables.find((entry) => entry.kind === difference.kind)!;
      await client.query(`UPDATE ${table} SET rating = $2, review_count = $3 WHERE id = $1`, [difference.id, difference.eligible.rating, difference.eligible.reviewCount]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { checked, updated: differences.length };
}
