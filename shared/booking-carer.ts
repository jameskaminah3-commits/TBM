// Who's coming to help: on a confirmed home-help booking, the guest who made
// the booking sees the carer's first name and approved face photo, privately
// in My Bookings. Nobody else does, and nothing about the carer is public.
import { hasLockedInBookingDeposit, isBookingFullyPaid } from "./booking-payments.ts";

// Assignments for home help (errands: cleaning, shopping, childcare…).
export const CARER_PROVIDER_CATEGORY = "errands";

const activeStatuses = new Set(["upcoming", "in-progress"]);

export type CarerBookingSnapshot = {
  userId: string | null;
  status: string;
  totalPrice?: number | null;
  paymentStatus?: string | null;
  paymentDepositAmount?: number | null;
  paymentAmountPaid?: number | null;
  serviceMode?: string | null;
};

export type CarerAssignmentSnapshot = {
  providerUserId: string | null;
  providerCategory: string;
  providerResponse: string | null;
  status: string;
};

// A booking is confirmed for this once it's paid, or its deposit is in, and
// it hasn't finished or been cancelled.
export function isCarerDisclosureBooking(booking: CarerBookingSnapshot) {
  if (!activeStatuses.has(booking.status)) return false;
  return isBookingFullyPaid(booking) || hasLockedInBookingDeposit(booking);
}

// The carers the booking's own guest may see: providers who accepted a
// home-help job on it, one entry each.
export function carersToDisclose(viewerUserId: string, booking: CarerBookingSnapshot, assignments: CarerAssignmentSnapshot[]) {
  if (!viewerUserId || booking.userId !== viewerUserId || !isCarerDisclosureBooking(booking)) return [];
  const seen = new Set<string>();
  const carers: CarerAssignmentSnapshot[] = [];
  for (const assignment of assignments) {
    if (assignment.providerCategory !== CARER_PROVIDER_CATEGORY) continue;
    if (assignment.providerResponse !== "accepted" || assignment.status === "cancelled") continue;
    if (!assignment.providerUserId || seen.has(assignment.providerUserId)) continue;
    seen.add(assignment.providerUserId);
    carers.push(assignment);
  }
  return carers;
}

// Only a photo TBM approved as the provider's face says who's coming; a logo
// or a photo of their work doesn't.
export function carerPhotoAvailable(profile: { photoApprovedAt: string | null; photoKind: string | null; photoUrl: string | null; photoPrivateKey: string | null }) {
  return Boolean(profile.photoApprovedAt && profile.photoKind === "face" && (profile.photoPrivateKey || profile.photoUrl));
}

export type BookingCarer = {
  firstName: string;
  services: string[];
  idChecked: boolean;
  photoPath: string | null;
};

// Says TBM checked an ID only when it did.
export function carerDisclosureNote(idChecked: boolean) {
  return idChecked
    ? "Shared with you because your booking is confirmed. Please keep it private. TBM checked this provider's ID; that isn't a guarantee, so tell TBM straight away if anything doesn't feel right."
    : "Shared with you because your booking is confirmed. Please keep it private, and tell TBM straight away if anything doesn't feel right.";
}
