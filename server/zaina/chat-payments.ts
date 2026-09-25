// server/zaina/chat-payments.ts
//
// M-Pesa codes typed in the chat (C5). When a card payment fails, Zaina tells
// the customer to send M-Pesa and reply with the code. The code used to sit
// in the transcript with nothing recorded and no one told. Now a code for the
// booking made in this chat is recorded the way TBM's "I paid by M-Pesa" form
// records one:
//   - the booking's payment is marked "processing" with the code;
//   - its dates are held for the team's review, unless another guest has
//     already paid for them — then the code is still recorded and the team is
//     told to move or refund;
//   - a message on the booking and TBM's payment emails tell the team.
// A code already used for another booking isn't recorded again. Only
// bookings this conversation created are touched.

import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { queueNotificationTask, sendBookingPaymentNotificationEmails, sendOpsAlertEmail } from "../notifications";
import { storage } from "../storage";
import { getUsdToKesRate } from "../currency";
import { bookings, cars, cooks, zainaAuditLogs } from "@shared/schema";
import {
  getBookingAmountPaid,
  getBookingCheckoutAmount,
  getRequestFeeKesDue,
  hasLockedInBookingDeposit,
  manualMpesaReviewHoldHours,
} from "@shared/booking-payments";
import { findMpesaCodes, mentionsPayment } from "./mpesa-codes";
import { bookingBlocksAvailability } from "./tools";

const BOOKING_TOOLS = ["create_draft_booking", "create_service_booking", "create_custom_offer", "create_listing_verification_request"];

type Booking = typeof bookings.$inferSelect;
type ReservedItem = { kind: "stay" | "service"; id: string; lockKey: string };

/** The bookings this conversation created, newest first. */
async function bookingsCreatedInChat(sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ response: zainaAuditLogs.toolResponse })
    .from(zainaAuditLogs)
    .where(and(
      eq(zainaAuditLogs.sessionId, sessionId),
      inArray(zainaAuditLogs.toolName, BOOKING_TOOLS),
      sql`(${zainaAuditLogs.toolResponse}->>'ok')::boolean is true`,
    ))
    .orderBy(desc(zainaAuditLogs.timestamp));
  const ids = rows
    .map((row) => (row.response as { booking_id?: unknown } | null)?.booking_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set(ids));
}

async function zainaMentionedMpesa(sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ text: zainaAuditLogs.messageContent })
    .from(zainaAuditLogs)
    .where(and(eq(zainaAuditLogs.sessionId, sessionId), eq(zainaAuditLogs.actor, "ZAINA_REASONING")))
    .orderBy(desc(zainaAuditLogs.timestamp))
    .limit(3);
  return rows.some((row) => /m-?pesa/i.test(row.text ?? ""));
}

/** The stay, cars and chefs a booking reserves, with the lock keys TBM's payment code uses. */
async function reservedItems(booking: Booking): Promise<ReservedItem[]> {
  // A deposit already paid holds the dates; a chef's custom-menu request fee reserves nothing.
  if (getBookingAmountPaid(booking) > 0) return [];
  if (booking.serviceMode === "cook-custom-menu" && booking.customMenuClientDecision !== "accepted") return [];
  const items: ReservedItem[] = [];
  if (booking.accommodationId) items.push({ kind: "stay", id: booking.accommodationId, lockKey: `stay:${booking.accommodationId}` });
  for (const serviceId of Array.from(new Set(booking.selectedServices ?? []))) {
    const [car] = await db.select({ id: cars.id }).from(cars).where(eq(cars.id, serviceId)).limit(1);
    const [cook] = car ? [undefined] : await db.select({ id: cooks.id }).from(cooks).where(eq(cooks.id, serviceId)).limit(1);
    if (car || cook) items.push({ kind: "service", id: serviceId, lockKey: `service:${serviceId}` });
  }
  return items;
}

/** Another booking on the same dates that already holds them with money. */
function holdsDatesWithPayment(other: Booking): boolean {
  if (!bookingBlocksAvailability(other)) return false;
  const manualPaymentUnderReview = other.paymentProvider === "mpesa-manual" && other.paymentStatus === "processing";
  return getBookingAmountPaid(other) > 0 || hasLockedInBookingDeposit(other) || manualPaymentUnderReview;
}

async function takenMeanwhile(executor: any, booking: Booking, item: ReservedItem): Promise<boolean> {
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

function alertTeam(sessionId: string, summary: string, details: Record<string, unknown>) {
  queueNotificationTask(`zaina M-Pesa alert for ${sessionId}`, sendOpsAlertEmail({ kind: "system-error", sessionId, summary, details }));
}

/**
 * When the customer sends an M-Pesa code for this chat's booking, records it
 * and returns the reply to send. Returns null to let Zaina answer as usual:
 * no code, not about paying, no booking in this chat, or it's already paid.
 */
export async function recordChatPaymentCode(sessionId: string, message: string): Promise<string | null> {
  const codes = findMpesaCodes(message);
  if (codes.length !== 1) return null;
  const code = codes[0];
  try {
    if (!mentionsPayment(message) && !(await zainaMentionedMpesa(sessionId))) return null;
    const bookingIds = await bookingsCreatedInChat(sessionId);
    if (bookingIds.length === 0) return null;

    let booking: Booking | undefined;
    for (const bookingId of bookingIds) {
      const [candidate] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (!candidate) continue;
      if (candidate.paymentProvider === "mpesa-manual" && candidate.paymentReference === code) {
        return `I already have M-Pesa code ${code} for booking ${candidate.id.slice(0, 8).toUpperCase()} — the team is checking it and will confirm by email.`;
      }
      if (!booking && !["cancelled", "completed"].includes(candidate.status) && getBookingCheckoutAmount(candidate) > 0) {
        booking = candidate;
      }
    }
    if (!booking) return null;
    const current = booking;

    // A code already used for another booking is checked by the team, not recorded twice.
    const [elsewhere] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.paymentReference, code), ne(bookings.id, current.id)))
      .orderBy(asc(bookings.createdAt))
      .limit(1);
    if (elsewhere) {
      alertTeam(sessionId, `M-Pesa code ${code} was sent again for a different booking`, {
        Code: code,
        "Booking in this chat": current.id,
        "Booking that already has the code": elsewhere.id,
      });
      return "That M-Pesa code has already been used for another booking, so I've asked the team to check it. If you sent a new payment, please share its code.";
    }

    const dueUsd = getBookingCheckoutAmount(current);
    const dueKes = getRequestFeeKesDue(current) ?? Math.round(dueUsd * (await getUsdToKesRate()).usdToKes);
    const expectedAmount = `KSh ${dueKes.toLocaleString("en-KE")}`;
    const previousStatus = current.paymentStatus;
    const previousAmountPaid = getBookingAmountPaid(current);
    const items = await reservedItems(current);
    const reviewHoldUntil = new Date(Date.now() + manualMpesaReviewHoldHours * 60 * 60 * 1000).toISOString();

    // The same locks as TBM's payment code: a website payment for the same
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
        paymentReference: code,
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
        `M-Pesa code: ${code}`,
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

    const reference = current.id.slice(0, 8).toUpperCase();
    const dates = conflict
      ? " One thing: another guest paid for those dates in the meantime, so the team will contact you to move your booking or refund you."
      : items.length > 0
        ? " Your dates are held while they check."
        : "";
    return `Thanks! I've passed M-Pesa code ${code} to our team to match with booking ${reference} (${expectedAmount}). You'll get a confirmation by email once it's verified.${dates}`;
  } catch (error) {
    console.error("[zaina] recording a chat M-Pesa code failed:", error);
    alertTeam(sessionId, `Couldn't record M-Pesa code ${code} sent in the chat`, { Code: code, Error: (error as Error).message });
    return `Thanks — I couldn't match code ${code} to your booking automatically, so I've passed it to the team to check. They'll confirm by email.`;
  }
}
