// "Who's coming" on a confirmed home-help booking: the carer's first name,
// whether TBM checked their ID, and their approved face photo, for the guest
// who made the booking only. The photo is streamed from private storage when
// TBM kept a private copy, so it never needs a public link.
import { carerPhotoAvailable, carersToDisclose, type BookingCarer } from "@shared/booking-carer";
import { pool } from "./db";
import { ensureProviderPageColumns } from "./provider-pages";
import { storage } from "./storage";

type CarerProfileRow = {
  user_id: string;
  first_name: string | null;
  verification_status: string | null;
  photo_url: string | null;
  photo_kind: string | null;
  photo_approved_at: string | null;
  photo_private_key: string | null;
};

type LoadedCarer = { services: string[]; profile: CarerProfileRow | null };

async function loadDisclosedCarers(bookingId: string, viewerUserId: string): Promise<{ carers: LoadedCarer[] } | null> {
  const booking = await storage.getBooking(bookingId);
  if (!booking || booking.userId !== viewerUserId) return null;
  const assignments = await storage.getBookingServiceAssignmentsByBookingId(bookingId);
  const ordered = [...assignments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const disclosed = carersToDisclose(viewerUserId, booking, ordered);
  if (!disclosed.length) return { carers: [] };

  await ensureProviderPageColumns();
  const ids = disclosed.map((assignment) => assignment.providerUserId!);
  const { rows } = await pool.query<CarerProfileRow>(
    `SELECT u.id AS user_id, u.first_name, p.verification_status, p.photo_url, p.photo_kind, p.photo_approved_at, p.photo_private_key
     FROM users u LEFT JOIN provider_profiles p ON p.user_id = u.id
     WHERE u.id = ANY($1::varchar[])`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [row.user_id, row]));
  return {
    carers: disclosed.map((assignment) => ({
      services: ordered
        .filter((item) => item.providerUserId === assignment.providerUserId && item.providerResponse === "accepted" && item.status !== "cancelled")
        .map((item) => item.serviceName)
        .filter((name, index, all) => name && all.indexOf(name) === index),
      profile: byId.get(assignment.providerUserId!) ?? null,
    })),
  };
}

const firstNameOnly = (value: string | null | undefined) => (value ?? "").trim().split(/\s+/)[0]?.slice(0, 40) || "Your carer";

// null: not the viewer's booking (the route answers "not found").
export async function getBookingCarers(bookingId: string, viewerUserId: string): Promise<BookingCarer[] | null> {
  const loaded = await loadDisclosedCarers(bookingId, viewerUserId);
  if (!loaded) return null;
  return loaded.carers.map(({ profile, services }, index) => ({
    firstName: firstNameOnly(profile?.first_name),
    services,
    idChecked: profile?.verification_status === "verified",
    photoPath: profile && carerPhotoAvailable({
      photoApprovedAt: profile.photo_approved_at,
      photoKind: profile.photo_kind,
      photoUrl: profile.photo_url,
      photoPrivateKey: profile.photo_private_key,
    }) ? `/api/bookings/${encodeURIComponent(bookingId)}/carers/${index}/photo` : null,
  }));
}

// Where the n-th carer's photo is: a private file key, or (for a photo
// approved before TBM kept private copies) its stored link.
export async function getBookingCarerPhoto(bookingId: string, viewerUserId: string, index: number): Promise<{ privateKey: string } | { url: string } | null> {
  const loaded = await loadDisclosedCarers(bookingId, viewerUserId);
  const profile = loaded?.carers[index]?.profile;
  if (!profile || !carerPhotoAvailable({
    photoApprovedAt: profile.photo_approved_at,
    photoKind: profile.photo_kind,
    photoUrl: profile.photo_url,
    photoPrivateKey: profile.photo_private_key,
  })) return null;
  return profile.photo_private_key ? { privateKey: profile.photo_private_key } : { url: profile.photo_url! };
}
