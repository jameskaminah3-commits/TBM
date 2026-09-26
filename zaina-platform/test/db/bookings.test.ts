// Rooms and bookings in the database (Phase 4): holds, the last room, holds
// that run out, late payments (C1), requests, and each business's bookings
// kept apart. Needs the same local *_test database as platform.test.ts (it
// is wiped).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { calendar, roomsTaken } from "../../src/booking/availability.ts";
import {
  acceptBooking,
  bookingByPayToken,
  businessForToken,
  cancelBooking,
  confirmBooking,
  createBooking,
  declineBooking,
  expireHolds,
  holdForPayment,
  listBookings,
  recordPendingPayment,
  settlePayment,
  type CreateBookingInput,
} from "../../src/booking/bookings.ts";
import { createOffering, removeOffering, roomsFromCsv, validateOffering } from "../../src/booking/offerings.ts";
import { addDays, isoDate, parseDate } from "../../src/booking/pricing.ts";
import { saveBookingSettings } from "../../src/booking/settings.ts";
import { clearBusinessCache } from "../../src/businesses/registry.ts";
import { loadSecretKeys, setSecretKeys } from "../../src/businesses/secrets.ts";
import { createBusinessSettings } from "../../src/businesses/settings.ts";
import { closePlatformDb, initPlatformDb, ownerPool } from "../../src/db/platform-db.ts";
import type { Offering } from "../../src/db/schema.ts";
import { inBusiness } from "../../src/db/tenant.ts";
import { migrate } from "../../src/db/migrate.ts";
import { businessDay } from "../../src/gateway/spend-cap.ts";
import { eraseCustomer } from "../../src/conversations/retention.ts";
import { runForBusiness } from "../../src/db/tenant.ts";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test";
if (!new URL(TEST_DB).pathname.endsWith("_test")) throw new Error("PLATFORM_TEST_DATABASE_URL must name a database ending in _test: it is wiped");

const ZONE = "Africa/Nairobi";
const KSH = (major: number) => major * 100;
/** A date n days from today, in Kenya. */
const day = (n: number) => isoDate(addDays(parseDate(businessDay(ZONE))!, n));

let deluxe: Offering;
let cottage: Offering;
let suite: Offering;

const jane = { name: "Jane Wanjiru", email: "jane@example.com", phone: "0712345678" };
const booking = (fields: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  businessId: "acme",
  timeZone: ZONE,
  offeringId: deluxe.id,
  checkIn: day(30),
  checkOut: day(33),
  guests: 2,
  units: 1,
  customer: jane,
  notes: null,
  source: "chat",
  sessionId: null,
  idempotencyKey: null,
  ...fields,
});

async function offering(businessId: string, input: Record<string, unknown>): Promise<Offering> {
  const checked = validateOffering(input);
  assert.ok(checked.ok, !checked.ok ? checked.error : "");
  const created = await createOffering(businessId, checked.value, null);
  assert.ok(typeof created === "object");
  return created;
}

const status = async (id: string) => (await ownerPool().query("select status, hold_expires_at, paid_minor, conflict from bookings where id = $1", [id])).rows[0];

before(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query("drop schema public cascade; create schema public;");
  await admin.end();
  initPlatformDb(TEST_DB, { max: 8 });
  await migrate(ownerPool());
  setSecretKeys(loadSecretKeys({ PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64") }));
  for (const [id, name] of [["acme", "Acme Guesthouse"], ["beta", "Beta Lodge"]]) {
    await ownerPool().query(
      `insert into businesses (id, name, public_key, allowed_origins, business_type, time_zone) values ($1, $2, $3, '{}', 'guesthouse', $4)`,
      [id, name, `pk_${id}`, ZONE],
    );
    await createBusinessSettings(id, name);
  }
  clearBusinessCache();
  // Acme takes deposits by M-Pesa (a paybill the team checks).
  await saveBookingSettings("acme", { mpesaManualType: "paybill", mpesaManualNumber: "123456", depositType: "percent", depositPercent: 30, holdMinutes: 30 }, null);
  deluxe = await offering("acme", { name: "Deluxe room", units: 2, max_guests: 3, pricing: { nightly: KSH(8000) } });
  cottage = await offering("acme", { name: "Garden cottage", units: 1, max_guests: 4, booking_mode: "request", pricing: { nightly: KSH(15000) } });
  suite = await offering("beta", { name: "Lake suite", units: 1, max_guests: 2, pricing: { nightly: KSH(20000) } });
});

after(async () => {
  await closePlatformDb();
});

test("an instant booking holds its rooms for the deposit, and the last room goes to one customer only", async () => {
  const first = await createBooking(booking({ checkIn: day(40), checkOut: day(42) }));
  assert.ok(first.ok);
  assert.equal(first.booking.status, "held");
  assert.equal(first.booking.totalMinor, KSH(16000));
  assert.equal(first.booking.depositMinor, KSH(4800));
  assert.match(first.booking.reference, /^[A-HJ-NP-Z2-9]{8}$/);
  const minutes = (first.booking.holdExpiresAt!.getTime() - Date.now()) / 60_000;
  assert.ok(minutes > 29 && minutes <= 30, `held ${minutes} minutes`);

  // One room left: three customers try for it at once.
  const racers = await Promise.all([1, 2, 3].map((n) => createBooking(booking({ checkIn: day(40), checkOut: day(42), customer: { ...jane, name: `Racer ${n}` } }))));
  assert.equal(racers.filter((result) => result.ok).length, 1, "exactly one gets the last room");
  const refused = racers.find((result) => !result.ok);
  assert.ok(refused && !refused.ok && refused.error === "unavailable" && refused.rooms_left === 0);
  assert.match(!refused!.ok ? refused!.message : "", /fully booked/);

  // An overlapping stay is refused too; the next nights are free.
  assert.ok(!(await createBooking(booking({ checkIn: day(41), checkOut: day(44) }))).ok);
  assert.ok((await createBooking(booking({ checkIn: day(42), checkOut: day(44) }))).ok, "check-out day is free for the next guest");
});

test("the same request twice gets one booking", async () => {
  const input = booking({ checkIn: day(50), checkOut: day(51), idempotencyKey: "zaina_same-request" });
  const [a, b] = await Promise.all([createBooking(input), createBooking(input)]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.booking.id, b.booking.id);
  assert.equal([a.replay, b.replay].filter(Boolean).length, 1);
});

test("a hold that runs out frees the rooms; a late payment still confirms while they're free", async () => {
  const created = await createBooking(booking({ checkIn: day(60), checkOut: day(62), units: 2, guests: 4 }));
  assert.ok(created.ok);
  const payment = await recordPendingPayment({ businessId: "acme", bookingId: created.booking.id, method: "paystack", amountMinor: created.booking.depositMinor, currency: "KES", providerReference: "ref-late-free" });
  await ownerPool().query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [created.booking.id]);
  await inBusiness(async (_db, client) => {
    assert.equal(await roomsTaken(client, { businessId: "acme", offeringId: deluxe.id, checkIn: day(60), checkOut: day(62) }), 0, "a lapsed hold takes nothing");
  }, "acme");
  const expired = await expireHolds();
  assert.ok(expired.some((entry) => entry.booking.id === created.booking.id));
  assert.equal((await status(created.booking.id)).status, "expired");

  const settled = await settlePayment("acme", payment.id, { succeeded: true, receipt: "PAYSTACK-1" });
  assert.ok(settled?.changed && settled.confirmed && !settled.conflict);
  assert.deepEqual({ ...(await status(created.booking.id)), hold_expires_at: undefined }, { status: "confirmed", hold_expires_at: undefined, paid_minor: String(created.booking.depositMinor), conflict: null });
  // A provider telling us twice changes nothing.
  const again = await settlePayment("acme", payment.id, { succeeded: true, receipt: "PAYSTACK-1" });
  assert.equal(again?.changed, false);
});

test("a late payment for rooms that went meanwhile is a conflict for the team (C1)", async () => {
  const late = await createBooking(booking({ checkIn: day(70), checkOut: day(72), units: 2, guests: 4 }));
  assert.ok(late.ok);
  const payment = await recordPendingPayment({ businessId: "acme", bookingId: late.booking.id, method: "mpesa_express", amountMinor: late.booking.depositMinor, currency: "KES", providerReference: "ws_CO_late" });
  await ownerPool().query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [late.booking.id]);
  const taker = await createBooking(booking({ checkIn: day(71), checkOut: day(73), customer: { ...jane, name: "Otieno" } }));
  assert.ok(taker.ok, "the room was free again, so someone else booked it");
  const settled = await settlePayment("acme", payment.id, { succeeded: true, receipt: "QK12ABC34D" });
  assert.ok(settled?.conflict && !settled.confirmed);
  const row = await status(late.booking.id);
  assert.equal(row.status, "conflict");
  assert.match(row.conflict, /Move the guest or refund/);
  assert.equal(row.paid_minor, String(late.booking.depositMinor));
  // The team resolves it: only with force once they've made room.
  const refused = await confirmBooking("acme", late.booking.id, "00000000-0000-4000-8000-000000000001");
  assert.ok(!refused.ok && refused.error === "rooms_gone");
  const forced = await confirmBooking("acme", late.booking.id, "00000000-0000-4000-8000-000000000001", { force: true, note: "Moved Otieno to the cottage" });
  assert.ok(forced.ok && forced.booking.status === "confirmed" && forced.booking.conflict === null);
});

test("starting to pay re-checks the rooms: a lapsed hold is renewed if they're free, refused if they've gone", async () => {
  const lapsed = await createBooking(booking({ checkIn: day(80), checkOut: day(81) }));
  assert.ok(lapsed.ok);
  await ownerPool().query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [lapsed.booking.id]);
  const renewed = await holdForPayment("acme", lapsed.booking.id);
  assert.ok(renewed.ok);
  assert.ok(renewed.booking.holdExpiresAt!.getTime() - Date.now() > 14 * 60_000, "held at least 15 minutes to pay");

  const gone = await createBooking(booking({ checkIn: day(85), checkOut: day(86), units: 2, guests: 2 }));
  assert.ok(gone.ok);
  await ownerPool().query("update bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [gone.booking.id]);
  const other = await createBooking(booking({ checkIn: day(85), checkOut: day(86), customer: { ...jane, name: "Achieng" } }));
  assert.ok(other.ok);
  const refused = await holdForPayment("acme", gone.booking.id);
  assert.ok(!refused.ok && refused.error === "rooms_gone");
  assert.equal((await status(gone.booking.id)).status, "expired");
  // Nothing to pay on a confirmed booking.
  const confirmed = await confirmBooking("acme", other.booking.id, "00000000-0000-4000-8000-000000000001");
  assert.ok(confirmed.ok);
  const nothing = await holdForPayment("acme", other.booking.id);
  assert.ok(!nothing.ok && nothing.error === "wrong_status");
});

test("a request waits for the team: accepted at an agreed price it waits for the deposit; declined it frees the room", async () => {
  const asked = await createBooking(booking({ offeringId: cottage.id, checkIn: day(90), checkOut: day(93), guests: 4 }));
  assert.ok(asked.ok);
  assert.equal(asked.booking.status, "requested");
  const hours = (asked.booking.holdExpiresAt!.getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 23.9 && hours <= 24, "a request keeps the room for 24 hours");
  assert.equal(asked.booking.totalMinor, KSH(45000));

  const accepted = await acceptBooking("acme", asked.booking.id, "00000000-0000-4000-8000-000000000001", { agreedTotal: KSH(40000), note: "three nights for the price of" });
  assert.ok(accepted.ok);
  assert.equal(accepted.booking.status, "awaiting_payment");
  assert.equal(accepted.booking.totalMinor, KSH(40000));
  assert.equal(accepted.booking.depositMinor, KSH(12000));
  assert.ok(!(await acceptBooking("acme", asked.booking.id, "00000000-0000-4000-8000-000000000001")).ok, "accepted once");

  const second = await createBooking(booking({ offeringId: cottage.id, checkIn: day(95), checkOut: day(97), guests: 2 }));
  assert.ok(second.ok);
  const declined = await declineBooking("acme", second.booking.id, "00000000-0000-4000-8000-000000000001", "closed for a private event");
  assert.ok(declined.ok && declined.booking.status === "declined");
  assert.ok((await createBooking(booking({ offeringId: cottage.id, checkIn: day(95), checkOut: day(97), guests: 2 }))).ok, "the room is free again");
});

test("no deposit confirms at once; a deposit with no way to pay makes it a request", async () => {
  await saveBookingSettings("acme", { depositType: "none" }, null);
  const free = await createBooking(booking({ checkIn: day(100), checkOut: day(101) }));
  assert.ok(free.ok && free.booking.status === "confirmed" && free.booking.depositMinor === 0 && free.booking.holdExpiresAt === null);
  await saveBookingSettings("acme", { depositType: "percent", depositPercent: 30, mpesaManualType: null, mpesaManualNumber: null }, null);
  const noWayToPay = await createBooking(booking({ checkIn: day(102), checkOut: day(103) }));
  assert.ok(noWayToPay.ok && noWayToPay.booking.status === "requested");
  await saveBookingSettings("acme", { mpesaManualType: "paybill", mpesaManualNumber: "123456" }, null);
});

test("the deposit, holds and limits are the business's: nothing is charged until it chooses", async () => {
  await saveBookingSettings("acme", { depositType: "not_set" }, null);
  const unset = await createBooking(booking({ checkIn: day(200), checkOut: day(201) }));
  assert.ok(unset.ok && unset.booking.status === "requested" && unset.booking.depositMinor === 0, "a request for the team, nothing to pay");
  const byTeam = await createBooking(booking({ checkIn: day(202), checkOut: day(203), source: "staff" }));
  assert.ok(byTeam.ok && byTeam.booking.status === "confirmed", "the team's own booking: they arrange payment");

  await saveBookingSettings("acme", { depositType: "fixed", depositFixedMinor: KSH(1000), acceptedHoldHours: 2, paymentHoldMinutes: 60 }, null);
  const fixed = await createBooking(booking({ checkIn: day(204), checkOut: day(206) }));
  assert.ok(fixed.ok && fixed.booking.status === "held" && fixed.booking.depositMinor === KSH(1000));
  const held = await holdForPayment("acme", fixed.booking.id);
  assert.ok(held.ok);
  const heldMinutes = (held.booking.holdExpiresAt!.getTime() - Date.now()) / 60_000;
  assert.ok(heldMinutes > 59 && heldMinutes <= 60, `paying holds the business's ${heldMinutes} minutes`);
  const asked = await createBooking(booking({ offeringId: cottage.id, checkIn: day(207), checkOut: day(208), guests: 2 }));
  assert.ok(asked.ok && asked.booking.status === "requested");
  const accepted = await acceptBooking("acme", asked.booking.id, "00000000-0000-4000-8000-000000000001");
  assert.ok(accepted.ok);
  const acceptedHours = (accepted.booking.holdExpiresAt!.getTime() - Date.now()) / 3_600_000;
  assert.ok(acceptedHours > 1.9 && acceptedHours <= 2, `accepted requests are held ${acceptedHours} hours`);

  // Only a card: a deposit over the card limit can't be paid online, so it's a request.
  await saveBookingSettings("acme", { methodMaxMinor: { mpesa_manual: KSH(500) } }, null);
  const overLimit = await createBooking(booking({ checkIn: day(209), checkOut: day(210) }));
  assert.ok(overLimit.ok && overLimit.booking.status === "requested", "over every way's limit");

  await saveBookingSettings("acme", { methodMaxMinor: {}, bookingHorizonDays: 30, minNoticeHours: 72 }, null);
  const far = await createBooking(booking({ checkIn: day(40), checkOut: day(41) }));
  assert.ok(!far.ok && far.error === "too_far");
  const soon = await createBooking(booking({ checkIn: day(1), checkOut: day(2) }));
  assert.ok(!soon.ok && soon.error === "too_soon" && /72 hours' notice/.test(soon.message));
  const walkIn = await createBooking(booking({ checkIn: day(1), checkOut: day(2), source: "staff", confirmNow: true }));
  assert.ok(walkIn.ok, "the team isn't held to the online notice");

  await saveBookingSettings("acme", { depositType: "percent", depositPercent: 30, depositFixedMinor: null, acceptedHoldHours: 24, paymentHoldMinutes: 15, bookingHorizonDays: 548, minNoticeHours: 0 }, null);
});

test("stays must fit the calendar and the room", async () => {
  const past = await createBooking(booking({ checkIn: day(-1), checkOut: day(1) }));
  assert.ok(!past.ok && past.error === "too_soon");
  const far = await createBooking(booking({ checkIn: day(600), checkOut: day(601) }));
  assert.ok(!far.ok && far.error === "too_far");
  const crowded = await createBooking(booking({ guests: 4 }));
  assert.ok(!crowded.ok && crowded.error === "too_many_guests");
  const hidden = await createBooking(booking({ offeringId: suite.id }));
  assert.ok(!hidden.ok && hidden.error === "not_found", "another business's room type is not found");
});

test("blocks close rooms, and the calendar counts booked, held, blocked and free", async () => {
  await ownerPool().query(
    "insert into offering_blocks (business_id, offering_id, starts_on, ends_on, units, reason) values ('acme', $1, $2, $3, 1, 'Painting')",
    [deluxe.id, day(110), day(112)],
  );
  const one = await createBooking(booking({ checkIn: day(110), checkOut: day(111) }));
  assert.ok(one.ok, "one room is still free");
  const none = await createBooking(booking({ checkIn: day(111), checkOut: day(112) }));
  assert.ok(none.ok, "the second night has one free room too");
  const full = await createBooking(booking({ checkIn: day(110), checkOut: day(111), customer: { ...jane, name: "Late" } }));
  assert.ok(!full.ok && full.error === "unavailable");
  await confirmBooking("acme", one.booking.id, "00000000-0000-4000-8000-000000000001");
  const grid = await calendar("acme", day(110), 3);
  const row = grid.rooms.find((room) => room.offering_id === deluxe.id)!;
  assert.deepEqual(row.nights.map(({ booked, held, blocked, free: open }) => [booked, held, blocked, open]), [[1, 0, 1, 0], [0, 1, 1, 0], [0, 0, 0, 2]]);
});

test("each business sees only its own rooms, bookings and payments; tokens find their business", async () => {
  const betaBooking = await createBooking(booking({ businessId: "beta", offeringId: suite.id }));
  assert.ok(betaBooking.ok);
  const seenByAcme = await inBusiness(async (_db, client) => (await client.query("select count(*)::int as n from bookings where id = $1", [betaBooking.booking.id])).rows[0].n, "acme");
  assert.equal(seenByAcme, 0);
  const acmeRows = await inBusiness(async (_db, client) => (await client.query("select distinct business_id from bookings")).rows.map((row) => row.business_id), "acme");
  assert.deepEqual(acmeRows, ["acme"]);
  await assert.rejects(
    () => inBusiness((_db, client) => client.query("insert into bookings (business_id, reference, offering_id, check_in, check_out, guests, status, customer_name, quote, currency, total_minor, deposit_minor, pay_token, source) values ('beta', 'ZZZZZZ', $1, $2, $3, 1, 'confirmed', 'X', '{}', 'KES', 0, 0, $4, 'staff')", [suite.id, day(5), day(6), "t".repeat(24)]), "acme"),
    /row-level security/,
  );
  assert.equal(await businessForToken("pay", betaBooking.booking.payToken), "beta");
  assert.equal(await businessForToken("pay", "not-a-real-token-at-all-000000"), null);
  assert.equal((await bookingByPayToken("acme", betaBooking.booking.payToken)), undefined, "a token is looked up inside its own business");
  const list = await listBookings("acme", "all", ZONE);
  assert.ok(list.length > 0 && list.every((row) => row.booking.businessId === "acme" && row.offeringName));
});

test("room types: a spreadsheet makes them, and one with bookings is hidden rather than deleted", async () => {
  const csv = "name,units,max_guests,nightly,weekend_nightly,min_nights,booking_mode,description\n" +
    "Twin room,3,2,\"6,500\",7500,2,instant,\"Two beds, garden view\"\n" +
    "Family room,1,5,12000,,,request,\n";
  const parsed = roomsFromCsv(csv);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.rooms.map((room) => room.input), [
    { name: "Twin room", units: 3, max_guests: 2, booking_mode: "instant", description: "Two beds, garden view", pricing: { nightly: KSH(6500), weekend_nightly: KSH(7500), min_nights: 2 } },
    { name: "Family room", units: 1, max_guests: 5, booking_mode: "request", pricing: { nightly: KSH(12000) } },
  ]);
  assert.match((roomsFromCsv("name,units\nX,1") as { error: string }).error, /max_guests/);
  assert.match((roomsFromCsv("name,units,max_guests,nightly\nX,1,2,lots") as { error: string }).error, /Line 2: nightly "lots"/);

  const twin = await offering("acme", parsed.rooms[0].input);
  assert.equal(await removeOffering("acme", twin.id), "deleted");
  assert.equal(await removeOffering("acme", deluxe.id), "hidden", "Deluxe has bookings");
  assert.equal(await createOffering("acme", { ...validateOfferingValue({ name: "garden COTTAGE", units: 1, max_guests: 2, pricing: { nightly: KSH(1000) } }) }, null), "name_taken");
  await ownerPool().query("update offerings set status = 'active' where id = $1", [deluxe.id]);
});

test("a cancelled booking frees its rooms", async () => {
  const made = await createBooking(booking({ checkIn: day(120), checkOut: day(121), units: 2, guests: 2 }));
  assert.ok(made.ok);
  assert.ok(!(await createBooking(booking({ checkIn: day(120), checkOut: day(121) }))).ok);
  const cancelled = await cancelBooking("acme", made.booking.id, "00000000-0000-4000-8000-000000000001", "Guest called");
  assert.ok(cancelled.ok && cancelled.booking.status === "cancelled" && cancelled.booking.cancelledAt);
  assert.ok((await createBooking(booking({ checkIn: day(120), checkOut: day(121) }))).ok);
});

test("a guest's deletion request keeps their bookings' money and nights, without who they were", async () => {
  const made = await createBooking(booking({ checkIn: day(130), checkOut: day(132), customer: { name: "Mary Njeri", email: "mary@example.com", phone: "0798 111 222" }, notes: "Allergic to nuts" }));
  assert.ok(made.ok);
  const payment = await recordPendingPayment({ businessId: "acme", bookingId: made.booking.id, method: "mpesa_express", amountMinor: made.booking.depositMinor, currency: "KES", providerReference: "ws_CO_mary", payerPhone: "254798111222" });
  await settlePayment("acme", payment.id, { succeeded: true, receipt: "SJ00000099" });
  const erased = await runForBusiness("acme", () => eraseCustomer({ phone: "+254 798 111 222" }));
  assert.equal(erased.bookings, 1);
  const { rows: [row] } = await ownerPool().query("select customer_name, customer_email, customer_phone, customer_notes, status, total_minor, check_in::text from bookings where id = $1", [made.booking.id]);
  assert.deepEqual(row, { customer_name: "Erased on request", customer_email: null, customer_phone: null, customer_notes: null, status: "confirmed", total_minor: String(made.booking.totalMinor), check_in: day(130) });
  const { rows: [paid] } = await ownerPool().query("select payer_phone, receipt from payments where id = $1", [payment.id]);
  assert.deepEqual(paid, { payer_phone: null, receipt: "SJ00000099" });
});

function validateOfferingValue(input: Record<string, unknown>) {
  const checked = validateOffering(input);
  assert.ok(checked.ok);
  return checked.value;
}
