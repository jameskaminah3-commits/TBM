// zaina-platform/src/connectors/tbm/payments.ts
//
// An M-Pesa code sent in the chat is recorded against the booking made in
// that chat (C5), the way TBM's "I paid by M-Pesa" form records one:
//   - the booking's payment is marked "processing" with the code, so the team
//     checks it and the booking shows it;
//   - its dates are held for the team's review, unless another guest has
//     already paid for them — then the code is still recorded and the team is
//     told to move or refund;
//   - a message on the booking and TBM's payment emails tell the team.
// Only bookings created in this conversation are touched.

import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import {
  getBookingAmountPaid,
  getBookingCheckoutAmount,
  getRequestFeeKesDue,
  hasLockedInBookingDeposit,
  manualMpesaReviewHoldHours,
} from "../../../../shared/booking-payments";
import { toolSuccesses } from "../../conversations/store.ts";
import type { ChatPaymentResult } from "../types.ts";
import {
  bookings,
  cars,
  cooks,
  db,
  getUsdToKesRate,
  queueNotificationTask,
  sendBookingPaymentNotificationEmails,
  storage,
} from "./tbm-app.ts";
import { bookingBlocksAvailability } from "./tools.ts";

const BOOKING_TOOLS = ["create_draft_booking", "create_service_booking", "create_custom_offer", "create_listing_verification_request"];

type Booking = typeof bookings.$inferSelect;

/** The stay, cars and chefs a booking reserves, with the lock keys TBM's own payment code uses. */
async function reservedItems(booking: Booking): Promise<Array<{ kind: "stay" | "service"; id: string; lockKey: string }>> {
  // A deposit already paid holds the dates; a chef's custom-menu request fee reserves nothing.
  if (getBookingAmountPaid(booking) > 0) return [];
  if (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision !== "accepted") return [];
  const items: Array<{ kind: "stay" | "service"; id: string; lockKey: string }> = [];
  if (booking.accommodationId) items.push({ kind: "stay", id: booking.accommodationId, lockKey: `stay:${booking.accommodationId}` });
  for (const serviceId of Array.from(new Set(booking.selectedServices ?? []))) {
    const [car] = await db.select({ id: cars.id }).from(cars).where(eq(cars.id, serviceId)).limit(1);
    const [cook] = car ? [undefined] : await db.select({ id: cooks.id }).from(cooks).where(eq(cooks.id, serviceId)).limit(1);
    if (car || cook) items.push({ kind: "service", id: serviceId, lockKey: `service:${serviceId}` });
  }
  return items;
}

/** Another booking on the same dates that already holds them with money: paid, a deposit, or an M-Pesa code under review. */
function holdsDatesWithPayment(other: Booking): boolean {
  if (!bookingBlocksAvailability(other)) return false;
  const manualPaymentUnderReview = other.paymentProvider === "mpesa-manual" && other.paymentStatus === "processing";
  return getBookingAmountPaid(other) > 0 || hasLockedInBookingDeposit(other) || manualPaymentUnderReview;
}

async function takenMeanwhile(executor: any, booking: Booking, item: { kind: "stay" | "service"; id: string }): Promise<boolean> {
  const others: Booking[] = await executor
    .select()
    .from(bookings)
    .where(and(
      item.kind === "stay"
        ? eq(bookings.accommodationId, item.id)
        : sql`${bookings.selectedServices} @> ARRAY[${item.id}]::text[]`,
      ne(bookings.id, booking.id),
      ne(bookings.status, "cancelled"),
      // Nights overlap: another stay may start on this one's check-out day.
      item.kind === "stay" ? sql`${bookings.checkIn} < ${booking.checkOut}` : lte(bookings.checkIn, booking.checkOut),
      item.kind === "stay" ? sql`${bookings.checkOut} > ${booking.checkIn}` : gte(bookings.checkOut, booking.checkIn),
    ));
  return others.some(holdsDatesWithPayment);
}

export async function recordTbmChatPayment(input: { sessionId: string; code: string }): Promise<ChatPaymentResult> {
  try {
    // The bookings this chat created, newest first.
    const created = await toolSuccesses(input.sessionId, BOOKING_TOOLS);
    const bookingIds = Array.from(new Set(created
      .map((result) => result.response?.booking_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)));
    if (bookingIds.length === 0) return { ok: false, reason: "no_booking" };

    let booking: Booking | undefined;
    for (const bookingId of bookingIds) {
      const [candidate] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (!candidate) continue;
      if (candidate.paymentProvider === "mpesa-manual" && candidate.paymentReference === input.code) {
        return {
          ok: true,
          bookingRef: candidate.id.slice(0, 8).toUpperCase(),
          expectedAmount: "",
          conflict: null,
          datesHeld: false,
          alreadyRecorded: true,
        };
      }
      if (!booking && !["cancelled", "completed"].includes(candidate.status) && getBookingCheckoutAmount(candidate) > 0) {
        booking = candidate;
      }
    }
    if (!booking) return { ok: false, reason: "already_paid" };

    const dueUsd = getBookingCheckoutAmount(booking);
    const dueKes = getRequestFeeKesDue(booking) ?? Math.round(dueUsd * (await getUsdToKesRate()).usdToKes);
    const expectedAmount = `KSh ${dueKes.toLocaleString("en-KE")}`;
    const previousStatus = booking.paymentStatus;
    const previousAmountPaid = getBookingAmountPaid(booking);
    const items = await reservedItems(booking);
    const reviewHoldUntil = new Date(Date.now() + manualMpesaReviewHoldHours * 60 * 60 * 1000).toISOString();
    const current = booking;

    // Same locks as TBM's payment code, so a website payment for the same
    // dates is handled one at a time with this one.
    await storage.ensureBookingWriteTables();
    const conflict = await db.transaction(async (tx) => {
      for (const lockKey of Array.from(new Set(items.map((item) => item.lockKey))).sort()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      }
      let taken: string | null = null;
      for (const item of items) {
        if (await takenMeanwhile(tx, current, item)) {
          taken = item.kind === "stay" ? "The stay was paid for by another guest meanwhile." : "The service was paid for by another guest meanwhile.";
          break;
        }
      }
      await tx.update(bookings).set({
        paymentStatus: "processing",
        paymentProvider: "mpesa-manual",
        paymentReference: input.code,
        paymentSessionId: null,
        paymentCheckoutAmount: dueUsd,
        paymentFailedAt: null,
        paymentHoldExpiresAt: items.length > 0 && !taken ? reviewHoldUntil : null,
      }).where(eq(bookings.id, current.id));
      return taken;
    });

    await storage.createBookingMessage({
      bookingId: current.id,
      userId: current.userId ?? "zaina",
      senderRole: "customer",
      message: [
        "Customer sent an M-Pesa code in the Zaina chat for review.",
        `Expected amount: ${expectedAmount}`,
        `M-Pesa code: ${input.code}`,
        conflict ? `Dates: ${conflict} Move the booking or refund.` : null,
      ].filter(Boolean).join("\n"),
    });

    const [updated] = await db.select().from(bookings).where(eq(bookings.id, current.id)).limit(1);
    if (updated) {
      queueNotificationTask(
        `payment emails for booking ${current.id}`,
        sendBookingPaymentNotificationEmails(updated, { previousStatus, previousAmountPaid }),
      );
    }

    return {
      ok: true,
      bookingRef: current.id.slice(0, 8).toUpperCase(),
      expectedAmount,
      conflict,
      datesHeld: items.length > 0 && !conflict,
      alreadyRecorded: false,
    };
  } catch (error) {
    console.error("[tbm-connector] recording a chat M-Pesa code failed:", error);
    return { ok: false, reason: "failed", detail: (error as Error).message };
  }
}
