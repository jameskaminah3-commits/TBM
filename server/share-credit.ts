// Share credit for bookings made outside the Book button: custom requests and
// bookings Zaina makes in chat. The same rules decide it (R1 to R13), once,
// and a problem here never stops a booking.
import { bookingShareClaimSchema, type BookingShareCredit } from "@shared/schema";
import { decideBookingShareCredit } from "./share-links";
import { storage } from "./storage";

export async function recordShareCreditForBooking(args: {
  bookingId: string;
  claim: unknown;
  ip: string;
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
      // A guest without an account can't be the link's own provider.
      bookerUserId: args.bookerUserId ?? `guest:${booking.id}`,
      booking,
    });
    const share: BookingShareCredit = { ...decision, assistedCodes };
    if (!existing) {
      await storage.createBookingAttribution(booking.id, {
        sessionId: `booking-${booking.id}`,
        sourceType: "direct",
        originalSubtotal: booking.totalPrice,
        discountAmount: 0,
        finalRevenue: booking.totalPrice,
        share,
      });
    } else {
      await storage.createBookingAttribution(booking.id, {
        sessionId: existing.sessionId ?? `booking-${booking.id}`,
        sourceType: existing.sourceType as "direct",
        sourceId: existing.sourceId,
        sourceSlug: existing.sourceSlug,
        sourcePath: existing.sourcePath,
        sourceTitle: existing.sourceTitle,
        promoId: existing.promoId,
        promoCode: existing.promoCode,
        promoName: existing.promoName,
        landingPath: existing.landingPath,
        referrerPath: existing.referrerPath,
        entryPath: existing.entryPath,
        utmSource: existing.utmSource,
        utmMedium: existing.utmMedium,
        utmCampaign: existing.utmCampaign,
        utmContent: existing.utmContent,
        originalSubtotal: existing.originalSubtotal,
        discountAmount: existing.discountAmount,
        finalRevenue: existing.finalRevenue,
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
// it makes later in the chat is credited with the latest one. Kept for a few
// hours in memory: a lost claim only means a booking isn't credited.
const zainaClaims = new Map<string, { claim: unknown; ip: string; at: number }>();
const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

export function rememberZainaShareClaim(sessionId: string, claim: unknown, ip: string) {
  if (!claim || typeof claim !== "object") return;
  const now = Date.now();
  zainaClaims.set(sessionId, { claim, ip, at: now });
  if (zainaClaims.size > 5000) {
    for (const [key, value] of Array.from(zainaClaims.entries())) {
      if (now - value.at > CLAIM_TTL_MS) zainaClaims.delete(key);
    }
  }
}

export async function creditZainaBooking(sessionId: string, bookingId: string) {
  const entry = zainaClaims.get(sessionId);
  if (!entry || Date.now() - entry.at > CLAIM_TTL_MS) return null;
  return recordShareCreditForBooking({ bookingId, claim: entry.claim, ip: entry.ip, bookerUserId: null });
}
