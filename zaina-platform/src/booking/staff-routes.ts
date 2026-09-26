// zaina-platform/src/booking/staff-routes.ts
//
// Rooms, bookings and payment accounts, for a business's team
// (/v1/staff/businesses/:businessId/…), by role:
//
//   GET    booking-settings                    viewer   policy, payment accounts, webhook addresses
//   PATCH  booking-settings                    manager  { currency?, deposit_type?, deposit_percent?, deposit_fixed_minor?,
//                                                         payment_order?, method_max_minor?, pay_at_venue?,
//                                                         hold_minutes?, request_hold_hours?, accepted_hold_hours?,
//                                                         payment_hold_minutes?, code_check_hours?, booking_horizon_days?,
//                                                         max_nights?, min_notice_hours?, pay_attempts_limit?,
//                                                         mpesa_prompts_limit?, check_in_time?, check_out_time?,
//                                                         cancellation_policy?, tax_name?, tax_percent?, tax_included? }
//                                                       The deposit, ways to pay and limits are the business's own;
//                                                       the platform only keeps each within safe bounds.
//   PUT    payments/paystack                   owner    { mode: "own_keys", secret_key } | { mode: "subaccount", subaccount }
//   PUT    payments/mpesa-express              owner    { environment, type, shortcode, till?, consumer_key, consumer_secret, passkey }
//   PUT    payments/mpesa-manual               owner    { type: "paybill" | "till", number, account? }
//   DELETE payments/paystack | mpesa-express | mpesa-manual    owner
//
//   GET    offerings                           viewer   room types
//   POST   offerings                           manager  { name, description?, units, max_guests, booking_mode?, pricing, status?, sort_order? }
//   PUT    offerings/:offeringId               manager  the same, partly
//   DELETE offerings/:offeringId               manager  deleted, or hidden when it has bookings
//   POST   offerings/import                    manager  { csv }: room types from a spreadsheet
//   POST   quote                               viewer   { offering_id, check_in, check_out, guests, rooms? }: price and rooms free
//   GET    calendar?from=&days=                viewer   rooms booked, held, blocked and free per night
//   GET    blocks?from=&days=                  viewer   POST blocks (manager) { offering_id, starts_on, ends_on, units, reason? }
//   DELETE blocks/:blockId                     manager
//
//   GET    bookings?filter=                    viewer   upcoming | requests | unpaid | attention | past | cancelled | all
//   GET    bookings/:bookingId                 viewer   with its payments and payment link
//   POST   bookings                            agent    a booking for a customer (phone, walk-in)
//   POST   bookings/:bookingId/accept          agent    { total?, note? }: accept a request, at an agreed total
//   POST   bookings/:bookingId/decline         agent    { reason? }
//   POST   bookings/:bookingId/confirm         agent    { note?, force? (manager) }: paid in person, or pay at the venue
//   POST   bookings/:bookingId/cancel          manager  { reason?, tell_customer? }
//   POST   bookings/:bookingId/payments        agent    { method: cash | bank | mpesa_code | other, amount, receipt? }
//   POST   payments/:paymentId/confirm         agent    an M-Pesa code checked: the money is in
//   POST   payments/:paymentId/reject          agent    { reason? }: the code wasn't found

import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { deleteSecret, listSecrets, putSecret } from "../businesses/secrets.ts";
import { booksTime, offeringBlocks, offerings, payments, type Booking, type Business, type Offering, type Payment } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, ROLE_RANK, staffOf } from "../staff/auth.ts";
import { afterSettlement, amountDue, paystackAccountFor, platformPaystackKey } from "../payments/checkout.ts";
import { checkCredentials, type MpesaAccount } from "../payments/mpesa.ts";
import { checkSecretKey, checkSubaccount } from "../payments/paystack.ts";
import { calendar, roomsTaken } from "./availability.ts";
import {
  acceptBooking,
  bookingFilters,
  cancelBooking,
  confirmBooking,
  createBooking,
  createSlotBooking,
  declineBooking,
  getBooking,
  listBookings,
  paymentsOf,
  quoteFor,
  recordPendingPayment,
  settlePayment,
  shortenHold,
  type BookingFilter,
} from "./bookings.ts";
import { formatMoney, toMinor } from "./money.ts";
import { bookingWhen, payLink, tellCustomer } from "./notices.ts";
import { createOffering, getOffering, listOfferings, offeringKindFor, offeringLinks, publicOffering, removeOffering, roomsFromCsv, setOfferingResources, updateOffering, validateOffering, valuesOf } from "./offerings.ts";
import { getResource, listResources } from "./resources.ts";
import { localParts, TIME_PATTERN, zonedInstant } from "./local-time.ts";
import { addDays, isoDate, nightsOf, parseDate } from "./pricing.ts";
import { checkDepositRule, getBookingSettings, MPESA_SECRETS, PAYSTACK_SECRET, publicBookingSettings, saveBookingSettings, validatePolicyPatch } from "./settings.ts";
import { businessDay } from "../gateway/spend-cap.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Handler = (req: Request, res: Response, context: { business: Business; userId: string; role: string }) => Promise<unknown>;

function handle(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = staffOf(req);
      await handler(req, res, { business: context.business!, userId: context.user.id, role: context.role! });
    } catch (error) {
      next(error);
    }
  };
}

export function publicBooking(booking: Booking, offeringName: string, extra: { codeToCheck?: boolean; timeZone?: string; resourceName?: string | null } = {}) {
  const money = (minor: number) => formatMoney(minor, booking.currency);
  return {
    id: booking.id,
    reference: booking.reference,
    offering_id: booking.offeringId,
    room_type: offeringName,
    check_in: booking.checkIn,
    check_out: booking.checkOut,
    nights: booking.startsAt ? 0 : nightsOf(booking.checkIn, booking.checkOut).length,
    starts_at: booking.startsAt,
    ends_at: booking.endsAt,
    resource_id: booking.resourceId,
    resource_name: extra.resourceName ?? null,
    when: extra.timeZone ? bookingWhen(booking, extra.timeZone) : null,
    time_range: booking.startsAt && booking.endsAt && extra.timeZone ? `${localParts(extra.timeZone, booking.startsAt).time}–${localParts(extra.timeZone, booking.endsAt).time}` : null,
    units: booking.units,
    guests: booking.guests,
    status: booking.status,
    hold_expires_at: booking.holdExpiresAt,
    customer: { name: booking.customerName, email: booking.customerEmail, phone: booking.customerPhone },
    notes: booking.customerNotes,
    currency: booking.currency,
    total_minor: booking.totalMinor,
    deposit_minor: booking.depositMinor,
    paid_minor: booking.paidMinor,
    due_minor: amountDue(booking),
    total_display: money(booking.totalMinor),
    deposit_display: money(booking.depositMinor),
    paid_display: money(booking.paidMinor),
    balance_display: money(Math.max(0, booking.totalMinor - booking.paidMinor)),
    source: booking.source,
    session_id: booking.sessionId,
    conflict: booking.conflict,
    staff_note: booking.staffNote,
    created_at: booking.createdAt,
    confirmed_at: booking.confirmedAt,
    cancelled_at: booking.cancelledAt,
    pay_link: payLink(booking),
    code_to_check: extra.codeToCheck ?? false,
  };
}

const publicPayment = (payment: Payment) => ({
  id: payment.id,
  method: payment.method,
  status: payment.status,
  amount_display: formatMoney(payment.amountMinor, payment.currency),
  amount_minor: payment.amountMinor,
  reference: payment.method === "paystack" ? null : payment.providerReference,
  receipt: payment.receipt,
  payer_phone: payment.payerPhone,
  failure: payment.failure,
  created_at: payment.createdAt,
  settled_at: payment.settledAt,
});

async function offeringNameOf(businessId: string, offeringId: string): Promise<string> {
  const [row] = await inBusiness((db) => db.select({ name: offerings.name }).from(offerings)
    .where(and(eq(offerings.businessId, businessId), eq(offerings.id, offeringId))).limit(1), businessId);
  return row?.name ?? "Room";
}

export function registerBookingRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: "viewer" | "agent" | "manager" | "owner") => [staff, requireBusinessRole(minimum)];
  const origin = config.publicBaseUrl ?? "";

  // ── Settings and payment accounts ────────────────────────────────────
  async function settingsView(business: Business) {
    const [settings, secrets] = await Promise.all([getBookingSettings(business.id), listSecrets(business.id)]);
    return {
      ...publicBookingSettings(settings, new Set(secrets.map((secret) => secret.name))),
      webhooks: {
        paystack: settings.paystackMode === "subaccount" ? `${origin}/v1/payments/paystack` : `${origin}/v1/payments/paystack/${business.id}`,
      },
      platform_paystack: platformPaystackKey() !== null,
    };
  }

  app.get(`${base}/booking-settings`, ...role("viewer"), handle(async (_req, res, { business }) => {
    res.json(await settingsView(business));
  }));

  app.patch(`${base}/booking-settings`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const checked = validatePolicyPatch(req.body ?? {});
    if (!checked.ok) return res.status(400).json({ error: "invalid_settings", message: checked.error });
    const current = await getBookingSettings(business.id);
    const problem = checkDepositRule({ ...current, ...checked.patch });
    if (problem) return res.status(400).json({ error: "invalid_settings", message: problem });
    const patch = { ...checked.patch };
    if (patch.depositType !== undefined) patch.rulesConfirmedAt = new Date();
    await saveBookingSettings(business.id, patch, userId);
    res.json(await settingsView(business));
  }));

  app.put(`${base}/payments/paystack`, ...role("owner"), handle(async (req, res, { business, userId }) => {
    const mode = req.body?.mode;
    if (mode === "own_keys") {
      const key = typeof req.body?.secret_key === "string" ? req.body.secret_key.trim() : "";
      const checked = await checkSecretKey(key);
      if (!checked.ok) return res.status(400).json({ error: "paystack_refused", message: `Paystack didn't accept the key: ${checked.message}` });
      await putSecret(business.id, PAYSTACK_SECRET, key, userId);
      await saveBookingSettings(business.id, { paystackMode: "own_keys", paystackSubaccount: null }, userId);
      return res.json({ ...(await settingsView(business)), live: checked.live });
    }
    if (mode === "subaccount") {
      const code = typeof req.body?.subaccount === "string" ? req.body.subaccount.trim() : "";
      const platformKey = platformPaystackKey();
      if (!platformKey) return res.status(400).json({ error: "platform_paystack_off", message: "This platform has no Paystack account of its own: connect the business's own keys instead." });
      if (!/^ACCT_[A-Za-z0-9]{4,40}$/.test(code)) return res.status(400).json({ error: "invalid_subaccount", message: "A subaccount code looks like ACCT_xxxxxxxx." });
      const checked = await checkSubaccount(platformKey, code);
      if (!checked.ok) return res.status(400).json({ error: "paystack_refused", message: `Paystack didn't find that subaccount: ${checked.message}` });
      await saveBookingSettings(business.id, { paystackMode: "subaccount", paystackSubaccount: code }, userId);
      return res.json(await settingsView(business));
    }
    res.status(400).json({ error: "invalid_mode", message: "mode is own_keys or subaccount." });
  }));

  app.put(`${base}/payments/mpesa-express`, ...role("owner"), handle(async (req, res, { business, userId }) => {
    const body = req.body ?? {};
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const environment = body.environment === "sandbox" ? "sandbox" : body.environment === "production" ? "production" : null;
    const type = body.type === "paybill" || body.type === "till" ? body.type : null;
    const shortcode = text(body.shortcode);
    const till = text(body.till) || null;
    if (!environment || !type) return res.status(400).json({ error: "invalid_account", message: "environment is sandbox or production; type is paybill or till." });
    if (!/^\d{5,10}$/.test(shortcode) || (type === "till" && !/^\d{5,10}$/.test(till ?? ""))) {
      return res.status(400).json({ error: "invalid_account", message: type === "till" ? "Give the store number (shortcode) and the till number." : "Give the paybill number (shortcode)." });
    }
    const account: MpesaAccount = {
      environment, type, shortcode, till: type === "till" ? till : null,
      consumerKey: text(body.consumer_key), consumerSecret: text(body.consumer_secret), passkey: text(body.passkey),
    };
    if (!account.consumerKey || !account.consumerSecret || !account.passkey) return res.status(400).json({ error: "keys_required", message: "The consumer key, consumer secret and passkey are all needed." });
    const checked = await checkCredentials(account);
    if (!checked.ok) return res.status(400).json({ error: "mpesa_refused", message: `M-Pesa didn't accept the keys: ${checked.message}` });
    await putSecret(business.id, MPESA_SECRETS.consumerKey, account.consumerKey, userId);
    await putSecret(business.id, MPESA_SECRETS.consumerSecret, account.consumerSecret, userId);
    await putSecret(business.id, MPESA_SECRETS.passkey, account.passkey, userId);
    await saveBookingSettings(business.id, { mpesaExpress: true, mpesaEnvironment: environment, mpesaType: type, mpesaShortcode: shortcode, mpesaTill: account.till }, userId);
    res.json(await settingsView(business));
  }));

  app.put(`${base}/payments/mpesa-manual`, ...role("owner"), handle(async (req, res, { business, userId }) => {
    const type = req.body?.type === "paybill" || req.body?.type === "till" ? req.body.type : null;
    const number = typeof req.body?.number === "string" ? req.body.number.trim() : "";
    const account = typeof req.body?.account === "string" && req.body.account.trim() ? req.body.account.trim() : null;
    if (!type || !/^\d{5,10}$/.test(number)) return res.status(400).json({ error: "invalid_account", message: "type is paybill or till, and number is its 5 to 10 digits." });
    if (account && account.length > 40) return res.status(400).json({ error: "invalid_account", message: "The account is up to 40 characters." });
    await saveBookingSettings(business.id, { mpesaManualType: type, mpesaManualNumber: number, mpesaManualAccount: type === "paybill" ? account : null }, userId);
    res.json(await settingsView(business));
  }));

  app.delete(`${base}/payments/:method`, ...role("owner"), handle(async (req, res, { business, userId }) => {
    switch (req.params.method) {
      case "paystack":
        await saveBookingSettings(business.id, { paystackMode: "off", paystackSubaccount: null }, userId);
        await deleteSecret(business.id, PAYSTACK_SECRET);
        break;
      case "mpesa-express":
        await saveBookingSettings(business.id, { mpesaExpress: false, mpesaType: null, mpesaShortcode: null, mpesaTill: null }, userId);
        for (const name of Object.values(MPESA_SECRETS)) await deleteSecret(business.id, name);
        break;
      case "mpesa-manual":
        await saveBookingSettings(business.id, { mpesaManualType: null, mpesaManualNumber: null, mpesaManualAccount: null }, userId);
        break;
      default:
        return res.status(404).json({ error: "not_found" });
    }
    res.json(await settingsView(business));
  }));

  // ── Room types ───────────────────────────────────────────────────────
  app.get(`${base}/offerings`, ...role("viewer"), handle(async (_req, res, { business }) => {
    const settings = await getBookingSettings(business.id);
    const links = await offeringLinks(business.id);
    const linked = (id: string) => links.filter((link) => link.offeringId === id).map((link) => link.resourceId);
    res.json({ currency: settings.currency, offerings: (await listOfferings(business.id)).map((offering) => publicOffering(offering, settings.currency, linked(offering.id))) });
  }));

  /** The resources a service may be done by (resource_ids), checked to be the business's own. */
  async function resourceIdsFrom(business: Business, input: unknown): Promise<string[] | null | "invalid"> {
    if (input === undefined) return null;
    if (!Array.isArray(input) || input.length > 100) return "invalid";
    const own = new Set((await listResources(business.id)).map((resource) => resource.id));
    const ids = [...new Set(input.map(String))];
    return ids.every((id) => own.has(id)) ? ids : "invalid";
  }

  async function offeringView(business: Business, offering: Offering) {
    const links = await offeringLinks(business.id);
    return publicOffering(offering, (await getBookingSettings(business.id)).currency, links.filter((link) => link.offeringId === offering.id).map((link) => link.resourceId));
  }

  const noun = (business: Business) => (business.businessType === "guesthouse" ? "room type" : business.businessType === "restaurant" ? "table booking" : "service");

  app.post(`${base}/offerings`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const checked = validateOffering(req.body ?? {}, undefined, offeringKindFor(business.businessType));
    if (!checked.ok) return res.status(400).json({ error: "invalid_offering", message: checked.error });
    const resourceIds = await resourceIdsFrom(business, req.body?.resource_ids);
    if (resourceIds === "invalid") return res.status(400).json({ error: "invalid_offering", message: "resource_ids lists your own people, chairs or tables." });
    const created = await createOffering(business.id, checked.value, userId);
    if (created === "name_taken") return res.status(409).json({ error: "name_taken", message: `Another ${noun(business)} has that name.` });
    if (resourceIds) await setOfferingResources(business.id, created.id, resourceIds);
    res.status(201).json({ offering: await offeringView(business, created) });
  }));

  app.put(`${base}/offerings/:offeringId`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const current = await getOffering(business.id, String(req.params.offeringId));
    if (!current) return res.status(404).json({ error: "not_found" });
    const checked = validateOffering(req.body ?? {}, valuesOf(current));
    if (!checked.ok) return res.status(400).json({ error: "invalid_offering", message: checked.error });
    const resourceIds = await resourceIdsFrom(business, req.body?.resource_ids);
    if (resourceIds === "invalid") return res.status(400).json({ error: "invalid_offering", message: "resource_ids lists your own people, chairs or tables." });
    const updated = await updateOffering(business.id, current.id, checked.value, userId);
    if (updated === "name_taken") return res.status(409).json({ error: "name_taken", message: `Another ${noun(business)} has that name.` });
    if (!updated) return res.status(404).json({ error: "not_found" });
    if (resourceIds) await setOfferingResources(business.id, updated.id, resourceIds);
    res.json({ offering: await offeringView(business, updated) });
  }));

  app.delete(`${base}/offerings/:offeringId`, ...role("manager"), handle(async (req, res, { business }) => {
    const result = await removeOffering(business.id, String(req.params.offeringId));
    if (result === "not_found") return res.status(404).json({ error: "not_found" });
    res.json({ result });
  }));

  app.post(`${base}/offerings/import`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csv.trim() || csv.length > 100_000) return res.status(400).json({ error: "csv_required", message: "Paste the spreadsheet as CSV (up to 100 KB)." });
    const parsed = roomsFromCsv(csv);
    if (!parsed.ok) return res.status(400).json({ error: "invalid_csv", message: parsed.error });
    const existing = await listOfferings(business.id);
    const plan: Array<{ line: number; current: Offering | undefined; value: ReturnType<typeof valuesOf> }> = [];
    for (const room of parsed.rooms) {
      const current = existing.find((offering) => offering.name.toLowerCase() === String(room.input.name ?? "").trim().toLowerCase());
      const checked = validateOffering(room.input, current ? valuesOf(current) : undefined);
      if (!checked.ok) return res.status(400).json({ error: "invalid_csv", message: `Line ${room.line}: ${checked.error}` });
      plan.push({ line: room.line, current, value: checked.value });
    }
    let created = 0;
    let updated = 0;
    for (const entry of plan) {
      if (entry.current) {
        await updateOffering(business.id, entry.current.id, entry.value, userId);
        updated += 1;
      } else {
        const made = await createOffering(business.id, entry.value, userId);
        if (made === "name_taken") return res.status(409).json({ error: "name_taken", message: `Line ${entry.line}: the spreadsheet names a room type twice.` });
        created += 1;
      }
    }
    res.json({ created, updated });
  }));

  // ── Prices, rooms free, the calendar, blocks ─────────────────────────
  app.post(`${base}/quote`, ...role("viewer"), handle(async (req, res, { business }) => {
    const offering = await getOffering(business.id, String(req.body?.offering_id ?? ""));
    if (!offering) return res.status(404).json({ error: "not_found" });
    const stay = { checkIn: String(req.body?.check_in ?? ""), checkOut: String(req.body?.check_out ?? ""), guests: Number(req.body?.guests), units: Number(req.body?.rooms ?? 1) };
    const priced = quoteFor(offering, await getBookingSettings(business.id), stay);
    if (!priced.ok) return res.status(400).json({ error: priced.error, message: priced.message });
    const taken = await inBusiness((_db, client) => roomsTaken(client, { businessId: business.id, offeringId: offering.id, checkIn: stay.checkIn, checkOut: stay.checkOut }), business.id);
    res.json({ quote: priced.quote, rooms_free: Math.max(0, offering.units - taken) });
  }));

  const window = (req: Request, business: Business) => {
    const from = typeof req.query.from === "string" && parseDate(req.query.from) ? req.query.from : businessDay(business.timeZone);
    const days = Math.min(62, Math.max(1, Number(req.query.days) || 14));
    return { from, days };
  };

  app.get(`${base}/calendar`, ...role("viewer"), handle(async (req, res, { business }) => {
    const { from, days } = window(req, business);
    res.json(await calendar(business.id, from, days));
  }));

  app.get(`${base}/blocks`, ...role("viewer"), handle(async (req, res, { business }) => {
    const { from, days } = window(req, business);
    const until = isoDate(addDays(parseDate(from)!, days));
    const rows = await inBusiness((db) => db.select().from(offeringBlocks)
      .where(and(eq(offeringBlocks.businessId, business.id), sql`${offeringBlocks.startsOn} < ${until}::date and ${offeringBlocks.endsOn} > ${from}::date`))
      .orderBy(asc(offeringBlocks.startsOn)), business.id);
    res.json({ blocks: rows.map((row) => ({ id: row.id, offering_id: row.offeringId, starts_on: row.startsOn, ends_on: row.endsOn, units: row.units, reason: row.reason })) });
  }));

  app.post(`${base}/blocks`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const offering = await getOffering(business.id, String(req.body?.offering_id ?? ""));
    if (!offering) return res.status(404).json({ error: "not_found" });
    const startsOn = String(req.body?.starts_on ?? "");
    const endsOn = String(req.body?.ends_on ?? "");
    const units = req.body?.units === undefined ? offering.units : Number(req.body.units);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
    const start = parseDate(startsOn);
    const end = parseDate(endsOn);
    if (!start || !end || end <= start || (end.getTime() - start.getTime()) / 86_400_000 > 366) {
      return res.status(400).json({ error: "invalid_dates", message: "ends_on is the first night open again, after starts_on, within a year." });
    }
    if (!Number.isInteger(units) || units < 1 || units > offering.units) return res.status(400).json({ error: "invalid_units", message: `units is 1 to ${offering.units}.` });
    const [row] = await inBusiness((db) => db.insert(offeringBlocks).values({ businessId: business.id, offeringId: offering.id, startsOn, endsOn, units, reason, createdBy: userId }).returning(), business.id);
    res.status(201).json({ block: { id: row.id, offering_id: row.offeringId, starts_on: row.startsOn, ends_on: row.endsOn, units: row.units, reason: row.reason } });
  }));

  app.delete(`${base}/blocks/:blockId`, ...role("manager"), handle(async (req, res, { business }) => {
    const id = String(req.params.blockId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: "not_found" });
    const rows = await inBusiness((db) => db.delete(offeringBlocks).where(and(eq(offeringBlocks.businessId, business.id), eq(offeringBlocks.id, id))).returning({ id: offeringBlocks.id }), business.id);
    res.status(rows.length ? 200 : 404).json({ deleted: rows.length > 0 });
  }));

  // ── Bookings ─────────────────────────────────────────────────────────
  app.get(`${base}/bookings`, ...role("viewer"), handle(async (req, res, { business }) => {
    const filter = (typeof req.query.filter === "string" ? req.query.filter : "upcoming") as BookingFilter;
    if (!bookingFilters.includes(filter)) return res.status(400).json({ error: "invalid_filter", message: `filter is one of ${bookingFilters.join(", ")}.` });
    const rows = await listBookings(business.id, filter, business.timeZone);
    const names = new Map((await listResources(business.id)).map((resource) => [resource.id, resource.name]));
    res.json({ bookings: rows.map((row) => publicBooking(row.booking, row.offeringName, { codeToCheck: row.codeToCheck, timeZone: business.timeZone, resourceName: row.booking.resourceId ? names.get(row.booking.resourceId) ?? null : null })) });
  }));

  async function bookingView(business: Business, booking: Booking) {
    const [name, list, resource] = await Promise.all([
      offeringNameOf(business.id, booking.offeringId),
      paymentsOf(business.id, booking.id),
      booking.resourceId ? getResource(business.id, booking.resourceId) : Promise.resolve(undefined),
    ]);
    return {
      booking: {
        ...publicBooking(booking, name, { codeToCheck: list.some((payment) => payment.method === "mpesa_code" && payment.status === "pending"), timeZone: business.timeZone, resourceName: resource?.name ?? null }),
        quote: booking.quote,
      },
      payments: list.map(publicPayment),
    };
  }

  app.get(`${base}/bookings/:bookingId`, ...role("viewer"), handle(async (req, res, { business }) => {
    const booking = await getBooking(business.id, String(req.params.bookingId));
    if (!booking) return res.status(404).json({ error: "not_found" });
    res.json(await bookingView(business, booking));
  }));

  app.post(`${base}/bookings`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const body = req.body ?? {};
    const name = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const email = typeof body.customer_email === "string" && body.customer_email.trim() ? body.customer_email.trim().toLowerCase() : null;
    const phone = typeof body.customer_phone === "string" && body.customer_phone.trim() ? body.customer_phone.trim().slice(0, 40) : null;
    if (!name || name.length > 120) return res.status(400).json({ error: "name_required", message: "The customer's name is needed." });
    if (email && !EMAIL.test(email)) return res.status(400).json({ error: "invalid_email" });
    if (!email && !phone) return res.status(400).json({ error: "contact_required", message: "A phone number or email is needed." });
    if (booksTime(business.businessType)) {
      // A time slot: { offering_id, date, time, party?, resource_id? }.
      const date = String(body.date ?? "");
      const time = String(body.time ?? "");
      if (!parseDate(date) || !TIME_PATTERN.test(time)) return res.status(400).json({ error: "invalid_time", message: "date is YYYY-MM-DD and time HH:MM." });
      const slot = await createSlotBooking({
        businessId: business.id,
        timeZone: business.timeZone,
        offeringId: String(body.offering_id ?? ""),
        startsAt: zonedInstant(date, time, business.timeZone),
        party: Number(body.party ?? 1),
        resourceId: typeof body.resource_id === "string" && body.resource_id ? body.resource_id : null,
        customer: { name, email, phone },
        notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null,
        source: "staff",
        sessionId: null,
        idempotencyKey: null,
        confirmNow: body.confirm_now === true,
        staffUserId: userId,
      });
      if (!slot.ok) return res.status(slot.error === "not_found" ? 404 : 409).json({ error: slot.error, message: slot.message });
      return res.status(201).json(await bookingView(business, slot.booking));
    }
    const created = await createBooking({
      businessId: business.id,
      timeZone: business.timeZone,
      offeringId: String(body.offering_id ?? ""),
      checkIn: String(body.check_in ?? ""),
      checkOut: String(body.check_out ?? ""),
      guests: Number(body.guests),
      units: Number(body.rooms ?? 1),
      customer: { name, email, phone },
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null,
      source: "staff",
      sessionId: null,
      idempotencyKey: null,
      confirmNow: body.confirm_now === true,
      staffUserId: userId,
    });
    if (!created.ok) return res.status(created.error === "not_found" ? 404 : 409).json({ error: created.error, message: created.message });
    res.status(201).json(await bookingView(business, created.booking));
  }));

  const decided = async (res: Response, business: Business, result: Awaited<ReturnType<typeof acceptBooking>>, notice: Parameters<typeof tellCustomer>[3] | null, reason?: string | null) => {
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 409).json({ error: result.error, message: result.message });
    if (notice) {
      const name = await offeringNameOf(business.id, result.booking.offeringId);
      void tellCustomer(business, result.booking, { name }, notice, reason);
    }
    res.json(await bookingView(business, result.booking));
  };

  app.post(`${base}/bookings/:bookingId/accept`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const total = req.body?.total === undefined || req.body?.total === null || req.body?.total === "" ? null : toMinor(req.body.total);
    if (req.body?.total !== undefined && req.body?.total !== null && req.body?.total !== "" && total === null) return res.status(400).json({ error: "invalid_total", message: "total is an amount, like 20000." });
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 200) : null;
    const result = await acceptBooking(business.id, String(req.params.bookingId), userId, { agreedTotal: total, note });
    await decided(res, business, result, result.ok ? (result.booking.status === "confirmed" ? "confirmed" : "accepted") : null);
  }));

  app.post(`${base}/bookings/:bookingId/decline`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 300) : null;
    await decided(res, business, await declineBooking(business.id, String(req.params.bookingId), userId, reason), "declined", reason);
  }));

  app.post(`${base}/bookings/:bookingId/confirm`, ...role("agent"), handle(async (req, res, { business, userId, role: staffRole }) => {
    const force = req.body?.force === true;
    if (force && ROLE_RANK[staffRole as keyof typeof ROLE_RANK] < ROLE_RANK.manager) return res.status(403).json({ error: "forbidden", message: "Confirming without free rooms needs the manager role." });
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 300) : null;
    await decided(res, business, await confirmBooking(business.id, String(req.params.bookingId), userId, { note, force }), "confirmed");
  }));

  app.post(`${base}/bookings/:bookingId/cancel`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 300) : null;
    const result = await cancelBooking(business.id, String(req.params.bookingId), userId, reason);
    await decided(res, business, result, req.body?.tell_customer === false ? null : "cancelled", reason);
  }));

  app.post(`${base}/bookings/:bookingId/payments`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const booking = await getBooking(business.id, String(req.params.bookingId));
    if (!booking) return res.status(404).json({ error: "not_found" });
    const method = ["cash", "bank", "mpesa_code", "other"].includes(req.body?.method) ? req.body.method as Payment["method"] : null;
    const amount = toMinor(req.body?.amount);
    const receipt = typeof req.body?.receipt === "string" && req.body.receipt.trim() ? req.body.receipt.trim().toUpperCase().slice(0, 40) : null;
    if (!method) return res.status(400).json({ error: "invalid_method", message: "method is cash, bank, mpesa_code or other." });
    if (!amount) return res.status(400).json({ error: "invalid_amount", message: "amount is what was paid, like 7500." });
    if (["cancelled", "declined"].includes(booking.status)) return res.status(409).json({ error: "wrong_status", message: `This booking is ${booking.status}.` });
    let payment: Payment;
    try {
      payment = await recordPendingPayment({ businessId: business.id, bookingId: booking.id, method, amountMinor: amount, currency: booking.currency, providerReference: method === "mpesa_code" ? receipt : null, recordedBy: userId });
    } catch (error) {
      const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string };
      if (database.code === "23505") return res.status(409).json({ error: "code_used", message: "That M-Pesa code is already recorded." });
      throw error;
    }
    const settled = await settlePayment(business.id, payment.id, { succeeded: true, receipt, recordedBy: userId });
    await afterSettlement(business, settled);
    res.status(201).json(await bookingView(business, settled?.booking ?? booking));
  }));

  async function pendingCode(business: Business, paymentId: string): Promise<Payment | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return undefined;
    const [row] = await inBusiness((db) => db.select().from(payments).where(and(eq(payments.businessId, business.id), eq(payments.id, paymentId))).limit(1), business.id);
    return row;
  }

  app.post(`${base}/payments/:paymentId/confirm`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const payment = await pendingCode(business, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ error: "not_found" });
    if (payment.status !== "pending" || payment.method !== "mpesa_code") return res.status(409).json({ error: "wrong_status", message: "Only an M-Pesa code waiting for the team can be confirmed." });
    const receipt = typeof req.body?.receipt === "string" && req.body.receipt.trim() ? req.body.receipt.trim().toUpperCase().slice(0, 40) : payment.providerReference;
    const settled = await settlePayment(business.id, payment.id, { succeeded: true, receipt, recordedBy: userId });
    await afterSettlement(business, settled);
    res.json(await bookingView(business, settled!.booking));
  }));

  app.post(`${base}/payments/:paymentId/reject`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const payment = await pendingCode(business, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ error: "not_found" });
    if (payment.status !== "pending" || payment.method !== "mpesa_code") return res.status(409).json({ error: "wrong_status", message: "Only an M-Pesa code waiting for the team can be rejected." });
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 200) : null;
    const settled = await settlePayment(business.id, payment.id, { succeeded: false, rejected: true, failure: reason ?? "The team didn't find this payment in the M-Pesa statement.", recordedBy: userId });
    const settings = await getBookingSettings(business.id);
    await shortenHold(business.id, payment.bookingId, settings.holdMinutes);
    const booking = (await getBooking(business.id, payment.bookingId))!;
    void tellCustomer(business, booking, { name: await offeringNameOf(business.id, booking.offeringId) }, "code_rejected", reason);
    res.json(await bookingView(business, settled?.booking ?? booking));
  }));

  // Paystack for this business, for the console's "is it working" check.
  app.get(`${base}/payments/paystack/check`, ...role("owner"), handle(async (_req, res, { business }) => {
    const account = await paystackAccountFor(business.id, await getBookingSettings(business.id));
    res.json({ connected: account !== null });
  }));
}

