// The Founding Provider badge from the database: TBM's list of providers in
// approval order with whether each is eligible and why not, granting it once,
// and removing it permanently. The rules are in shared/founding-provider.ts.
import { pool } from "./db";
import { ensureProviderHubTables } from "./provider-hub";
import { clearProviderPageCache, ensureProviderPageColumns } from "./provider-pages";
import { ensureListingPublishedTracking } from "./listing-published";
import {
  FOUNDING_COHORT,
  rankFoundingCandidates,
  type FoundingCandidate,
  type FoundingRevokeReason,
} from "@shared/founding-provider";

type Row = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  is_suspended: boolean | null;
  account_created_at: Date | string | null;
  application_approved_at: string | null;
  verified_at: string | null;
  verification_status: string | null;
  founding_provider_at: string | null;
  founding_revoked_at: string | null;
  founding_revoked_reason: string | null;
  first_public_listing_at: string | null;
  first_public_listing_estimated: boolean | null;
};

const iso = (value: Date | string | null) => (value instanceof Date ? value.toISOString() : value);
// Creation dates are stored as Postgres text ("2026-10-11 03:40:40.86+00"):
// sent on as ISO, which every browser reads.
const isoText = (value: string | null) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? value : new Date(time).toISOString();
};

export type FoundingListEntry = FoundingCandidate & {
  name: string;
  approvedFrom: "application" | "account";
  revokedReason: string | null;
};

export async function listFoundingCandidates(): Promise<FoundingListEntry[]> {
  await ensureProviderHubTables();
  await ensureProviderPageColumns();
  await ensureListingPublishedTracking();
  // The earliest public listing by when it was first published. A listing
  // already public before that was recorded counts from its creation date,
  // and the list says the date is an estimate.
  const { rows } = await pool.query<Row>(`
    WITH public_listings AS (
      SELECT manager_user_id, first_published_at, created_at FROM stays WHERE is_public
      UNION ALL SELECT manager_user_id, first_published_at, created_at FROM cars WHERE is_public
      UNION ALL SELECT manager_user_id, first_published_at, created_at FROM cooks WHERE is_public
      UNION ALL SELECT manager_user_id, first_published_at, created_at FROM errands WHERE is_public
      UNION ALL SELECT manager_user_id, first_published_at, created_at FROM experiences WHERE is_public
    ), firsts AS (
      SELECT DISTINCT ON (manager_user_id) manager_user_id,
             COALESCE(first_published_at, created_at) AS first_public_listing_at,
             first_published_at IS NULL AS first_public_listing_estimated
      FROM public_listings WHERE manager_user_id IS NOT NULL
      ORDER BY manager_user_id, COALESCE(first_published_at, created_at)
    )
    SELECT u.id, u.first_name, u.last_name, u.is_suspended, u.created_at AS account_created_at,
           p.business_name, p.verified_at, p.verification_status, p.founding_provider_at, p.founding_revoked_at, p.founding_revoked_reason,
           (SELECT min(COALESCE(a.decided_at, a.updated_at)) FROM provider_applications a WHERE a.created_user_id = u.id AND a.status = 'approved') AS application_approved_at,
           f.first_public_listing_at, f.first_public_listing_estimated
    FROM users u LEFT JOIN provider_profiles p ON p.user_id = u.id LEFT JOIN firsts f ON f.manager_user_id = u.id
    WHERE u.role = 'provider'`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ranked = rankFoundingCandidates(rows.map((row) => ({
    userId: row.id,
    approvedAt: row.application_approved_at ?? iso(row.account_created_at) ?? new Date(0).toISOString(),
    verifiedAt: row.verification_status === "verified" ? row.verified_at : null,
    firstPublicListingAt: isoText(row.first_public_listing_at),
    firstPublicListingEstimated: Boolean(row.first_public_listing_estimated),
    isSuspended: Boolean(row.is_suspended),
    grantedAt: row.founding_provider_at,
    revokedAt: row.founding_revoked_at,
  })));
  return ranked.map((candidate) => {
    const row = byId.get(candidate.userId)!;
    return {
      ...candidate,
      name: row.business_name?.trim() || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Provider",
      approvedFrom: row.application_approved_at ? "application" as const : "account" as const,
      revokedReason: row.founding_revoked_reason,
    };
  });
}

// Granted once, to an eligible provider; never recalculated afterwards.
export async function grantFoundingProvider(userId: string) {
  const candidate = (await listFoundingCandidates()).find((entry) => entry.userId === userId);
  if (!candidate) return { ok: false as const, status: 404, error: "Provider not found" };
  if (candidate.grantedAt) return { ok: false as const, status: 409, error: "They already have the badge." };
  if (!candidate.eligible) return { ok: false as const, status: 409, error: "This provider isn't eligible.", reasons: candidate.reasons };
  await pool.query(
    "UPDATE provider_profiles SET founding_provider_at = $2, founding_cohort = $3, updated_at = $2 WHERE user_id = $1",
    [userId, new Date().toISOString(), FOUNDING_COHORT],
  );
  clearProviderPageCache();
  return { ok: true as const };
}

// Removed permanently for fraud, safety or impersonation, or a removed
// account. A suspension for other reasons, or a page switched off, only hides
// the badge while the page is down.
export async function revokeFoundingProvider(userId: string, reason: FoundingRevokeReason) {
  await ensureProviderPageColumns();
  const { rowCount } = await pool.query(
    "UPDATE provider_profiles SET founding_provider_at = NULL, founding_revoked_at = $2, founding_revoked_reason = $3, updated_at = $2 WHERE user_id = $1 AND founding_provider_at IS NOT NULL",
    [userId, new Date().toISOString(), reason],
  );
  if (!rowCount) return { ok: false as const, status: 409, error: "They don't have the badge." };
  clearProviderPageCache();
  return { ok: true as const };
}
