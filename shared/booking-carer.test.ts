import test from "node:test";
import assert from "node:assert/strict";
import { carerDisclosureNote, carerPhotoAvailable, carersToDisclose, isCarerDisclosureBooking } from "./booking-carer.ts";

const paid = { userId: "guest-1", status: "upcoming", totalPrice: 100, paymentStatus: "paid", paymentAmountPaid: 100, paymentDepositAmount: 0 };
const job = (overrides: Partial<{ providerUserId: string | null; providerCategory: string; providerResponse: string | null; status: string }> = {}) => ({
  providerUserId: "carer-1",
  providerCategory: "errands",
  providerResponse: "accepted",
  status: "upcoming",
  ...overrides,
});

test("a paid, upcoming or in-progress booking is confirmed for disclosure", () => {
  assert.equal(isCarerDisclosureBooking(paid), true);
  assert.equal(isCarerDisclosureBooking({ ...paid, status: "in-progress" }), true);
});

test("a deposit that locks the dates counts; nothing paid doesn't", () => {
  assert.equal(isCarerDisclosureBooking({ ...paid, paymentStatus: "pending", paymentAmountPaid: 50, paymentDepositAmount: 50 }), true);
  assert.equal(isCarerDisclosureBooking({ ...paid, paymentStatus: "pending", paymentAmountPaid: 0 }), false);
  assert.equal(isCarerDisclosureBooking({ ...paid, paymentStatus: "pending", paymentAmountPaid: 20, paymentDepositAmount: 50 }), false);
});

test("cancelled and completed bookings show nobody", () => {
  assert.equal(isCarerDisclosureBooking({ ...paid, status: "cancelled" }), false);
  assert.equal(isCarerDisclosureBooking({ ...paid, status: "completed" }), false);
});

test("only the booking's own guest sees the carer", () => {
  assert.equal(carersToDisclose("guest-1", paid, [job()]).length, 1);
  assert.deepEqual(carersToDisclose("someone-else", paid, [job()]), []);
  assert.deepEqual(carersToDisclose("", { ...paid, userId: "" }, [job()]), []);
});

test("only accepted home-help jobs, one entry per carer", () => {
  const carers = carersToDisclose("guest-1", paid, [
    job(),
    job({ providerCategory: "errands" }),
    job({ providerUserId: "carer-2", providerResponse: null }),
    job({ providerUserId: "carer-3", providerCategory: "cooks" }),
    job({ providerUserId: "carer-4", status: "cancelled" }),
    job({ providerUserId: null }),
  ]);
  assert.deepEqual(carers.map((carer) => carer.providerUserId), ["carer-1"]);
});

test("only an approved face photo says who's coming", () => {
  const base = { photoApprovedAt: "2026-10-01T00:00:00Z", photoKind: "face", photoUrl: "/uploads/a.jpg", photoPrivateKey: "provider-photo/2026-10/x.jpg" };
  assert.equal(carerPhotoAvailable(base), true);
  assert.equal(carerPhotoAvailable({ ...base, photoUrl: "" }), true);
  assert.equal(carerPhotoAvailable({ ...base, photoPrivateKey: null }), true);
  assert.equal(carerPhotoAvailable({ ...base, photoApprovedAt: null }), false);
  assert.equal(carerPhotoAvailable({ ...base, photoKind: "logo" }), false);
  assert.equal(carerPhotoAvailable({ ...base, photoKind: "work" }), false);
  assert.equal(carerPhotoAvailable({ ...base, photoUrl: "", photoPrivateKey: null }), false);
});

test("the note mentions TBM's ID check only when there was one", () => {
  assert.match(carerDisclosureNote(true), /TBM checked this provider's ID; that isn't a guarantee/);
  assert.doesNotMatch(carerDisclosureNote(false), /ID/);
  for (const note of [carerDisclosureNote(true), carerDisclosureNote(false)]) assert.match(note, /keep it private/);
});
