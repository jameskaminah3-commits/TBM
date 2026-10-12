// Share credit for bookings made outside the Book button: custom requests and
// bookings Zaina makes in chat. The same rules decide it (R1 to R13), once,
// and a problem here never stops a booking. Reporting only: credit is written
// to the share columns alone, so it can't change a booking's price, promo or
// any provider's payout.
import { bookingShareClaimSchema, type BookingShareCredit } from "@shared/schema";
import { decideBookingShareCredit, getZainaShareClaim, saveZainaShareClaim } from "./share-links";
import { storage } from "./storage";

export async function recordShareCreditForBooking(args: {
  bookingId: string;
  claim: unknown;
  ip: string;
  // Already-hashed device and address, for a claim stored from a Zaina chat.
  hashes?: { deviceHash: string | null; ipHash: string | null };
  bookerUserId: string | null;
}): Promise<BookingShareCredit | null> {
  const parsed = bookingShareClaimSchema.safeParse(args.claim ?? {});
  if (!parsed.success) return null;
  const claim = parsed.data;
  if (!claim.code && !claim.olderLink && !claim.assistedCodes.length) return null;

  try {
    const booking = await storage.getBooking(args.bookingId);
    if (!booking) return null;
    // A booking already credited keeps its credit (R9).
    const [existing] = await storage.getBookingAttributionsByBookingIds([booking.id]);
    if (existing?.shareCredit) return null;
    const { decision, assistedCodes } = await decideBookingShareCredit({
      claim,
      deviceId: claim.deviceId,
      ip: args.ip,
      hashes: args.hashes,
      // A guest without an account can't be the link's own provider.
      bookerUserId: args.bookerUserId ?? `guest:${booking.id}`,
      booking,
    });
    const share: BookingShareCredit = { ...decision, assistedCodes };
    if (existing) {
      // Leave the booking's marketing and promo record exactly as it is.
      await storage.setBookingShareCredit(booking.id, share);
    } else {
      await storage.createBookingAttribution(booking.id, {
        sessionId: `booking-${booking.id}`,
        sourceType: "direct",
        originalSubtotal: booking.totalPrice,
        discountAmount: 0,
        finalRevenue: booking.totalPrice,
        share,
      });
    }
    return share;
  } catch (error) {
    console.error("[SHARES] Couldn't decide share credit for booking", args.bookingId, error);
    return null;
  }
}

// Zaina's chat sends the visitor's share claim with each message; the booking
// it makes later in the chat is credited with the latest one. Stored in the
// database (share-links.ts), so a restart doesn't lose it.
export async function rememberZainaShareClaim(sessionId: string, claim: unknown, ip: string) {
  const parsed = bookingShareClaimSchema.safeParse(claim ?? {});
  if (!parsed.success || !sessionId) return;
  if (!parsed.data.code && !parsed.data.olderLink && !parsed.data.assistedCodes.length) return;
  try {
    await saveZainaShareClaim(sessionId, parsed.data, ip);
  } catch (error) {
    console.error("[SHARES] Couldn't keep the chat's share claim", error);
  }
}

export async function creditZainaBooking(sessionId: string, bookingId: string) {
  try {
    const stored = await getZainaShareClaim(sessionId);
    if (!stored) return null;
    return recordShareCreditForBooking({ bookingId, claim: stored.claim, ip: "", hashes: stored.hashes, bookerUserId: null });
  } catch (error) {
    console.error("[SHARES] Couldn't credit the chat booking", bookingId, error);
    return null;
  }
}
