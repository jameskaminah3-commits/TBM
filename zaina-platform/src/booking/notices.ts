// zaina-platform/src/booking/notices.ts
//
// Telling people about a booking.
//
//   The customer hears in the chat the booking came from (on WhatsApp the
//   message is delivered like any reply) and by email, when they gave one
//   and the platform sends email. Texts are in the chat's language; the
//   Swahili is a draft until a fluent speaker has checked it (as in
//   engine/messages.ts).
//   The team hears through its alerts: web push and email
//   (conversations/team-alerts.ts).
//
// Notices never hold anything up and never throw: a failure is logged.

import type { AlertEmailConfig } from "../config.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { requestDelivery } from "../channels/whatsapp/runtime.ts";
import { appendEvent, getSession } from "../conversations/store.ts";
import { timeZoneLabel } from "../conversations/staffed-hours.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { runForBusiness } from "../db/tenant.ts";
import type { Booking, Business, ChatLanguage, Offering } from "../db/schema.ts";
import { formatMoney } from "./money.ts";
import { nightsOf } from "./pricing.ts";
import { getBookingSettings } from "./settings.ts";

let config: { publicBaseUrl: string | null; alertEmail: AlertEmailConfig | null } = { publicBaseUrl: null, alertEmail: null };

export function configureBookingNotices(next: { publicBaseUrl: string | null; alertEmail: AlertEmailConfig | null }) {
  config = next;
}

/** The booking's payment page: whoever has the link can see and pay the booking. */
export function payLink(booking: Pick<Booking, "payToken">): string {
  return `${config.publicBaseUrl ?? ""}/pay/${booking.payToken}`;
}

/** "Fri 2 Oct 2026" ("Ijumaa, 2 Okt 2026" in Swahili). */
export function formatDay(date: string, language: ChatLanguage = "en", withYear = true): string {
  return dayOf(date, language, withYear);
}

function dayOf(date: string, language: ChatLanguage, withYear: boolean): string {
  const at = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat(language === "sw" ? "sw" : "en-GB", {
    weekday: language === "sw" ? "long" : "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = language === "sw" ? `${get("weekday")}, ${get("day")} ${get("month")}` : `${get("weekday")} ${get("day")} ${get("month")}`;
  return withYear ? `${day} ${get("year")}` : day;
}

/** "Fri 2 Oct – Mon 5 Oct 2026". */
export function stayDates(checkIn: string, checkOut: string, language: ChatLanguage = "en"): string {
  return `${dayOf(checkIn, language, checkIn.slice(0, 4) !== checkOut.slice(0, 4))} – ${dayOf(checkOut, language, true)}`;
}

/** "5:30 PM on Fri 2 Oct (Kenya time)". */
export function holdUntil(at: Date, timeZone: string, language: ChatLanguage = "en"): string {
  const time = at.toLocaleTimeString(language === "sw" ? "en-GB" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const day = at.toLocaleDateString("en-CA", { timeZone });
  const zone = timeZoneLabel(timeZone);
  return language === "sw"
    ? `saa ${time}, ${dayOf(day, "sw", false)} (${zone === "Kenya time" ? "saa za Kenya" : zone})`
    : `${time} on ${dayOf(day, "en", false)} (${zone})`;
}

/** A time slot: "Mon 26 Oct 2026 at 2:30 PM" ("Jumatatu, 26 Okt 2026 saa 14:30"). */
export function slotTime(startsAt: Date, timeZone: string, language: ChatLanguage = "en"): string {
  const day = startsAt.toLocaleDateString("en-CA", { timeZone });
  const time = startsAt.toLocaleTimeString(language === "sw" ? "en-GB" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  return language === "sw" ? `${dayOf(day, "sw", true)} saa ${time}` : `${dayOf(day, "en", true)} at ${time}`;
}

/** When a booking is, in words: its stay dates, or its time slot. */
export function bookingWhen(booking: Pick<Booking, "checkIn" | "checkOut" | "startsAt">, timeZone: string, language: ChatLanguage = "en"): string {
  return booking.startsAt ? slotTime(booking.startsAt, timeZone, language) : stayDates(booking.checkIn, booking.checkOut, language);
}

export type CustomerNotice = "confirmed" | "accepted" | "declined" | "cancelled" | "conflict" | "code_rejected";

type Context = { business: Business; booking: Booking; offering: Pick<Offering, "name">; language: ChatLanguage; businessName: string };

function customerText(notice: CustomerNotice, context: Context, detail: { reason?: string | null; checkInTime: string; checkOutTime: string }): string {
  const { booking, offering, language, businessName } = context;
  const sw = language === "sw";
  const money = (minor: number) => formatMoney(minor, booking.currency);
  const slot = booking.startsAt !== null;
  const nights = nightsOf(booking.checkIn, booking.checkOut).length;
  const dates = bookingWhen(booking, context.business.timeZone, language);
  const people = booking.guests > 1 ? (sw ? `, watu ${booking.guests}` : `, ${booking.guests} people`) : "";
  const stay = slot
    ? `${offering.name}, ${dates}${people}`
    : sw
      ? `${offering.name}, ${dates} (usiku ${nights}), wageni ${booking.guests}`
      : `${offering.name}, ${dates} (${nights} night${nights === 1 ? "" : "s"}), ${booking.guests} guest${booking.guests === 1 ? "" : "s"}`;
  const venue = slot ? (sw ? "ukifika" : "when you arrive") : (sw ? "ukifika" : "at the property");
  const reason = detail.reason?.trim() ? (sw ? `: ${detail.reason.trim()}` : `: ${detail.reason.trim()}`) : "";
  switch (notice) {
    case "confirmed": {
      const balance = booking.totalMinor - booking.paidMinor;
      const paid = booking.paidMinor > 0
        ? (sw ? `Umelipa ${money(booking.paidMinor)}. ` : `Paid: ${money(booking.paidMinor)}. `)
        : "";
      const rest = balance <= 0
        ? (sw ? "Umelipa kikamilifu." : "Paid in full.")
        : (sw ? `Salio la ${money(balance)} litalipwa ${venue}.` : `The balance of ${money(balance)} is paid ${venue}.`);
      const nothing = booking.totalMinor === 0 ? "" : `${paid}${rest} `;
      const times = slot ? "" : sw ? `Kuingia kuanzia saa ${detail.checkInTime}, kutoka kabla ya saa ${detail.checkOutTime}. ` : `Check-in from ${detail.checkInTime}, check-out by ${detail.checkOutTime}. `;
      return sw
        ? `Habari njema: uhifadhi wako ${booking.reference} katika ${businessName} umethibitishwa. ${stay}. ${nothing}${times}Maelezo ya uhifadhi wako: ${payLink(booking)}`
        : `Good news: your booking ${booking.reference} at ${businessName} is confirmed. ${stay}. ${nothing}${times}Your booking: ${payLink(booking)}`;
    }
    case "accepted": {
      const until = booking.holdExpiresAt ? holdUntil(booking.holdExpiresAt, context.business.timeZone, language) : null;
      return sw
        ? `${businessName} imekubali ombi lako la uhifadhi ${booking.reference}: ${stay}. Jumla: ${money(booking.totalMinor)}. Ili kulithibitisha, lipa amana ya ${money(booking.depositMinor)} hapa: ${payLink(booking)}${until ? ` ${slot ? "Muda huo" : "Vyumba"} vimehifadhiwa kwa ajili yako hadi ${until}.` : ""}`
        : `${businessName} has accepted your booking request ${booking.reference}: ${stay}. Total: ${money(booking.totalMinor)}. To confirm it, pay the deposit of ${money(booking.depositMinor)} here: ${payLink(booking)}${until ? ` ${slot ? "The time is" : "The rooms are"} kept for you until ${until}.` : ""}`;
    }
    case "declined":
      return sw
        ? `Samahani, ${businessName} haiwezi kupokea ombi lako la uhifadhi ${booking.reference} (${offering.name}, ${dates})${reason}. Jibu hapa ukipenda tarehe nyingine.`
        : `Sorry, ${businessName} can't take your booking request ${booking.reference} (${offering.name}, ${dates})${reason}. Reply here if you'd like to try ${slot ? "another time" : "other dates"}.`;
    case "cancelled": {
      const refund = booking.paidMinor > 0 ? (sw ? " Timu itawasiliana nawe kuhusu malipo yako." : " The team will be in touch about your payment.") : "";
      return sw
        ? `Uhifadhi wako ${booking.reference} katika ${businessName} (${offering.name}, ${dates}) umeghairiwa${reason}.${refund}`
        : `Your booking ${booking.reference} at ${businessName} (${offering.name}, ${dates}) has been cancelled${reason}.${refund}`;
    }
    case "code_rejected":
      return sw
        ? `Timu ya ${businessName} haikupata malipo ya M-Pesa ya nambari uliyotuma kwa uhifadhi ${booking.reference}${reason}. Tafadhali angalia nambari, au lipa hapa: ${payLink(booking)}`
        : `The team at ${businessName} couldn't find the M-Pesa payment for the code you sent for booking ${booking.reference}${reason}. Please check the code, or pay here: ${payLink(booking)}`;
    case "conflict":
      return sw
        ? `Tumepokea malipo yako ya ${money(booking.paidMinor)} kwa uhifadhi ${booking.reference}. Timu itawasiliana nawe hivi punde kuthibitisha chumba chako.`
        : `We've received your payment of ${money(booking.paidMinor)} for booking ${booking.reference}. The team will contact you shortly to confirm your ${slot ? "booking" : "room"}.`;
  }
}

const SUBJECTS: Record<CustomerNotice, (reference: string, name: string) => string> = {
  confirmed: (reference, name) => `Booking confirmed: ${reference} at ${name}`,
  accepted: (reference, name) => `${name} accepted your booking request ${reference}`,
  declined: (reference, name) => `Your booking request ${reference} at ${name}`,
  cancelled: (reference, name) => `Booking ${reference} at ${name} cancelled`,
  conflict: (reference, name) => `Payment received for booking ${reference} at ${name}`,
  code_rejected: (reference, name) => `Your M-Pesa payment for booking ${reference} at ${name}`,
};

async function sendCustomerEmail(to: string, subject: string, text: string, replyTo: string | null): Promise<void> {
  const email = config.alertEmail;
  if (!email) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${email.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: email.from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) console.warn(`[bookings] customer email refused (${response.status})`);
}

/** Tells the customer about their booking, in its chat and by email. Never throws. */
export async function tellCustomer(business: Business, booking: Booking, offering: Pick<Offering, "name">, notice: CustomerNotice, reason?: string | null): Promise<void> {
  try {
    await runForBusiness(business.id, async () => {
      const settings = await getBusinessSettings(business.id);
      const policy = await getBookingSettings(business.id);
      const session = booking.sessionId ? await getSession(booking.sessionId) : undefined;
      const language: ChatLanguage = session?.language ?? "en";
      const context: Context = { business, booking, offering, language, businessName: settings?.displayName ?? business.name };
      const text = customerText(notice, context, { reason, checkInTime: policy.checkInTime, checkOutTime: policy.checkOutTime });
      if (session) {
        await appendEvent({ businessId: business.id, sessionId: session.id, actor: "ZAINA_REASONING", content: text });
        if (session.channel === "whatsapp") void requestDelivery(business.id, session.id, 0);
      }
      if (booking.customerEmail) {
        // Emails are in English: they go to the address the customer typed, whatever the chat's language.
        const english = language === "en" ? text : customerText(notice, { ...context, language: "en" }, { reason, checkInTime: policy.checkInTime, checkOutTime: policy.checkOutTime });
        await sendCustomerEmail(booking.customerEmail, SUBJECTS[notice](booking.reference, context.businessName), `${english}\n\n— ${context.businessName}`, settings?.supportEmail ?? null);
      }
    });
  } catch (error) {
    console.error(`[bookings] telling the customer about ${booking.reference} (${notice}) failed:`, error);
  }
}

/** One line for the team: "ABC123 · Deluxe room · Fri 2 Oct – Mon 5 Oct 2026 · 2 guests · Jane W." */
export function bookingSummary(booking: Booking, offering: Pick<Offering, "name">, timeZone = "Africa/Nairobi"): string {
  const total = formatMoney(booking.totalMinor, booking.currency);
  const who = booking.startsAt ? (booking.guests > 1 ? ` · ${booking.guests} people` : "") : ` · ${booking.guests} guest${booking.guests === 1 ? "" : "s"}`;
  return `${booking.reference} · ${booking.units > 1 ? `${booking.units} × ` : ""}${offering.name} · ${bookingWhen(booking, timeZone)}${who} · ${booking.customerName} · ${total}`;
}

/** Tells the team about a booking. Never throws. */
export async function tellTeam(business: Business, booking: Booking, offering: Pick<Offering, "name">, what: "request" | "confirmed" | "conflict" | "code", extra = ""): Promise<void> {
  try {
    await alertTeam(business, {
      kind: "booking",
      what,
      bookingId: booking.id,
      sessionId: booking.sessionId,
      summary: `${bookingSummary(booking, offering, business.timeZone)}${extra ? `. ${extra}` : ""}`,
    });
  } catch (error) {
    console.error(`[bookings] alerting the team about ${booking.reference} failed:`, error);
  }
}
