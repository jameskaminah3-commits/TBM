// What a provider's save changed on a listing, for TBM to review afterwards.

// Bookkeeping fields that change on every save and say nothing about the listing.
const ignoredFields = new Set(["updatedAt", "createdAt"]);

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function diffListingFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of Object.keys(after)) {
    if (ignoredFields.has(field) || !(field in before)) {
      continue;
    }
    if (!sameValue(before[field], after[field])) {
      changes[field] = { before: before[field] ?? null, after: after[field] ?? null };
    }
  }
  return changes;
}
