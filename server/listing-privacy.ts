// What the public and providers may see or set on a listing (stays, cars, cooks,
// errands, experiences).

// Only TBM and the listing's own provider see these: the owner's account, and a
// vehicle's papers and fleet details. Public listing responses never carry them.
export const privateListingFields = [
  "managerUserId",
  "documents",
  "registrationNumber",
  "ownershipType",
  "mileage",
  "availabilityPreference",
  "chauffeurArrangement",
] as const;

type PrivateListingField = (typeof privateListingFields)[number];

export function toPublicListing<T extends object>(listing: T): Omit<T, PrivateListingField> {
  const publicListing: Record<string, unknown> = { ...(listing as Record<string, unknown>) };
  for (const field of privateListingFields) {
    delete publicListing[field];
  }
  return publicListing as Omit<T, PrivateListingField>;
}

// Who owns a listing, whether it is public, and its rating and review count are
// TBM's to set. A provider's create or edit request can't change them.
export const providerProtectedListingFields = ["managerUserId", "isPublic", "rating", "reviewCount"] as const;

export function withoutProviderProtectedFields<T>(body: T, isAdmin: boolean): T {
  if (isAdmin || !body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const allowed: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of providerProtectedListingFields) {
    delete allowed[field];
  }
  return allowed as T;
}
