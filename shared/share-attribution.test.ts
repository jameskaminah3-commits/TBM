import assert from "node:assert/strict";
import test from "node:test";
import {
  addTouch,
  bookingIncludesListing,
  currentTouch,
  decideShareCredit,
  getShareBookingState,
  getShareClaim,
  isShareCode,
  touchFromParams,
  type AttributionTouch,
} from "./share-attribution.ts";

const day = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-10-01T09:00:00Z");
const villa = { listingKind: "stay" as const, listingId: "ux-villa-diani" };
const shareParams = (code: string) => new URLSearchParams(`ref=${code}&utm_source=provider&utm_medium=whatsapp&utm_campaign=listing_share`);
const visit = (touches: AttributionTouch[], query: string | URLSearchParams, at: number, context = villa) => {
  const touch = touchFromParams(typeof query === "string" ? new URLSearchParams(query) : query, { ...context, path: "/accommodation/ux-villa-diani" }, at);
  return touch ? addTouch(touches, touch, at) : touches;
};

const link = { code: "k7m2x9qa4p", listingKind: "stay" as const, listingId: "ux-villa-diani", createdByUserId: "partner-kassim", stoppedAt: null };
const villaBooking = { bookingType: "accommodation", accommodationId: "ux-villa-diani", selectedServices: [] };
const decide = (overrides: Partial<Parameters<typeof decideShareCredit>[0]> = {}) => decideShareCredit({
  claim: { code: link.code, olderLink: null, assistedCodes: [] },
  link,
  listing: { isPublic: true, managerUserId: "partner-kassim" },
  lastVisitAt: new Date(start).toISOString(),
  bookerUserId: "guest-jane",
  booking: villaBooking,
  now: new Date(start + 2 * day),
  ...overrides,
});

test("R1: share codes are 10 random lowercase letters and digits, nothing else", () => {
  assert.equal(isShareCode("k7m2x9qa4p"), true);
  for (const bad of ["K7M2X9QA4P", "k7m2x9qa4", "k7m2x9qa4p1", "ux-villa-d", "../../etc", 1234567890, null]) {
    assert.equal(isShareCode(bad), false, String(bad));
  }
  // An address with a malformed code is still a tagged visit, but carries no code.
  const touch = touchFromParams(new URLSearchParams("ref=DROP TABLE&utm_source=provider"), villa, start);
  assert.equal(touch?.shareCode, null);
});

test("R1: an older share link without a code is credited to the listing's partner, unverified", () => {
  const touches = visit([], "utm_source=provider&utm_medium=copy&utm_campaign=listing_share", start);
  const claim = getShareClaim(touches, start + day);
  assert.deepEqual(claim.olderLink, { kind: "stay", id: "ux-villa-diani" });
  const decision = decide({ claim, link: null, lastVisitAt: null });
  assert.equal(decision.credit, "unverified");
  assert.equal(decision.creditedUserId, "partner-kassim");
  // A guest's own share (utm_source=share) is a tagged visit with no credit.
  const guestShare = getShareClaim(visit([], "utm_source=share&utm_medium=copy&utm_campaign=listing_share", start), start);
  assert.equal(guestShare.code, null);
  assert.equal(guestShare.olderLink, null);
});

test("R2: a direct visit isn't a share visit; a tagged one is", () => {
  assert.equal(touchFromParams(new URLSearchParams(""), villa, start), null);
  assert.equal(touchFromParams(new URLSearchParams("guests=2&checkIn=2026-11-01"), villa, start), null);
  assert.equal(touchFromParams(shareParams(link.code), villa, start)?.shareCode, link.code);
});

test("R3: credit lasts 30 days from the latest share visit, on the device and on the server", () => {
  let touches = visit([], shareParams(link.code), start);
  assert.equal(getShareClaim(touches, start + 29 * day).code, link.code);
  assert.equal(getShareClaim(touches, start + 31 * day).code, null, "expired on the device");
  // Opening the same link again restarts the 30 days.
  touches = visit(touches, shareParams(link.code), start + 20 * day);
  assert.equal(touches.length, 1);
  assert.equal(getShareClaim(touches, start + 45 * day).code, link.code);
  // The server checks its own record of the visit.
  assert.equal(decide({ now: new Date(start + 29 * day) }).credit, "credited");
  assert.equal(decide({ now: new Date(start + 31 * day) }).reason, "no-recent-visit");
});

test("R4: with several share links the latest gets the credit and earlier ones are assisted", () => {
  let touches = visit([], shareParams("aaaaaaaaaa"), start);
  touches = visit(touches, shareParams("bbbbbbbbbb"), start + day);
  const claim = getShareClaim(touches, start + 2 * day);
  assert.equal(claim.code, "bbbbbbbbbb");
  assert.deepEqual(claim.assistedCodes, ["aaaaaaaaaa"]);
});

test("R5: coming back directly keeps the credit; a later ad or promo link takes over", () => {
  let touches = visit([], shareParams(link.code), start);
  touches = visit(touches, "", start + 3 * day); // a bookmark
  assert.equal(getShareClaim(touches, start + 3 * day).code, link.code);
  touches = visit(touches, "utm_source=facebook&utm_medium=paid&utm_campaign=december", start + 4 * day);
  const claim = getShareClaim(touches, start + 4 * day);
  assert.equal(claim.code, null, "the ad is now the source");
  assert.deepEqual(claim.assistedCodes, [link.code]);
  assert.equal(currentTouch(touches, start + 4 * day)?.utmSource, "facebook");
  // And sharing again after the ad takes the credit back.
  touches = visit(touches, shareParams(link.code), start + 5 * day);
  assert.equal(getShareClaim(touches, start + 5 * day).code, link.code);
});

test("R6: refreshing or returning from sign-in doesn't add a second visit, and keeps where the guest landed", () => {
  let touches = visit([], shareParams(link.code), start);
  touches = visit(touches, shareParams(link.code), start + 60_000, { listingKind: "stay", listingId: "ux-villa-diani" });
  assert.equal(touches.length, 1);
  assert.equal(touches[0].entryPath, "/accommodation/ux-villa-diani");
  assert.equal(touches[0].at, start + 60_000);
});

test("R7: another device has no visit on record, so no credit", () => {
  assert.equal(decide({ lastVisitAt: null }).reason, "no-recent-visit");
});

test("R8: no credit for a stopped link, or a listing that isn't public", () => {
  assert.equal(decide({ link: { ...link, stoppedAt: new Date(start + day).toISOString() } }).reason, "stopped");
  assert.equal(decide({ listing: { isPublic: false, managerUserId: "partner-kassim" } }).reason, "not-public");
  assert.equal(decide({ link: null }).reason, "unknown-link");
});

test("R9: the shared listing must be in the booking; another listing counts as assisted", () => {
  assert.equal(bookingIncludesListing(villaBooking, "stay", "ux-villa-diani"), true);
  assert.equal(bookingIncludesListing({ selectedServices: ["ux-car-noah"] }, "car", "ux-car-noah"), true);
  assert.equal(bookingIncludesListing({ accommodationId: "ux-car-noah", selectedServices: [] }, "car", "ux-car-noah"), false);
  const chefBooking = { bookingType: "service", accommodationId: null, selectedServices: ["ux-chef-amina"] };
  const decision = decide({ booking: chefBooking });
  assert.equal(decision.credit, "assisted");
  assert.equal(decision.creditedUserId, null);
});

test("R10: the person who created the link gets the credit, but not for their own booking", () => {
  const decision = decide();
  assert.equal(decision.credit, "credited");
  assert.equal(decision.creditedUserId, "partner-kassim");
  assert.equal(decide({ bookerUserId: "partner-kassim" }).reason, "own-link");
  const older = decide({ claim: { code: null, olderLink: { kind: "stay", id: "ux-villa-diani" }, assistedCodes: [] }, link: null, bookerUserId: "partner-kassim" });
  assert.equal(older.reason, "own-link");
});

test("R11: a booking counts once paid or deposit-paid; pending and cancelled are separate", () => {
  assert.equal(getShareBookingState({ status: "upcoming", paymentStatus: "paid" }), "confirmed");
  assert.equal(getShareBookingState({ status: "upcoming", paymentStatus: "pending", paymentAmountPaid: 320 }), "confirmed");
  assert.equal(getShareBookingState({ status: "upcoming", paymentStatus: "pending", paymentAmountPaid: 0 }), "pending");
  assert.equal(getShareBookingState({ status: "cancelled", paymentStatus: "paid" }), "cancelled");
  assert.equal(getShareBookingState({ status: "upcoming", paymentStatus: "refunded" }), "cancelled");
});

test("no share at all is recorded as no share", () => {
  assert.equal(decide({ claim: { code: null, olderLink: null, assistedCodes: [] }, link: null }).reason, "no-share");
});

test("the device keeps at most ten recent sources", () => {
  let touches: AttributionTouch[] = [];
  for (let index = 0; index < 14; index += 1) {
    touches = visit(touches, `utm_source=campaign&utm_campaign=c${index}`, start + index * 1000);
  }
  assert.equal(touches.length, 10);
  assert.equal(touches.at(-1)?.utmCampaign, "c13");
});
