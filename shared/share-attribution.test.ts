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

const link = { code: "k7m2x9qa4p", listingKind: "stay" as const, listingId: "ux-villa-diani", createdByUserId: "provider-kassim", stoppedAt: null };
const villaBooking = { bookingType: "accommodation", accommodationId: "ux-villa-diani", selectedServices: [] };
const decide = (overrides: Partial<Parameters<typeof decideShareCredit>[0]> = {}) => decideShareCredit({
  claim: { code: link.code, olderLink: null, assistedCodes: [] },
  link,
  listing: { isPublic: true, managerUserId: "provider-kassim" },
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

test("R1: an older share link without a code is credited to the listing's provider, unverified", () => {
  const touches = visit([], "utm_source=provider&utm_medium=copy&utm_campaign=listing_share", start);
  const claim = getShareClaim(touches, start + day);
  assert.deepEqual(claim.olderLink, { kind: "stay", id: "ux-villa-diani" });
  const decision = decide({ claim, link: null, lastVisitAt: null });
  assert.equal(decision.credit, "unverified");
  assert.equal(decision.creditedUserId, "provider-kassim");
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
  assert.equal(decide({ listing: { isPublic: false, managerUserId: "provider-kassim" } }).reason, "not-public");
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

test("R9b: a provider page link credits a booking of any listing that provider manages", () => {
  const pageLink = { code: "p4g3l1nk8z", listingKind: "provider" as const, listingId: "k7m2q9xw", createdByUserId: "provider-kassim", stoppedAt: null };
  const page = (overrides: Partial<Parameters<typeof decideShareCredit>[0]> = {}) => decide({
    claim: { code: pageLink.code, olderLink: null, assistedCodes: [] },
    link: pageLink,
    listing: { isPublic: true, managerUserId: "provider-kassim" },
    ...overrides,
  });
  // The car is also Kassim's: credited, with the page as the source.
  const credited = page({ booking: { bookingType: "service", selectedServices: ["ux-car-prado"] }, bookingManagerUserIds: ["provider-kassim"] });
  assert.equal(credited.credit, "credited");
  assert.equal(credited.creditedUserId, "provider-kassim");
  assert.deepEqual([credited.listingKind, credited.listingId], ["provider", "k7m2q9xw"]);
  // A stay with another provider's chef: still credited, because the stay is Kassim's.
  assert.equal(page({ bookingManagerUserIds: ["provider-amina", "provider-kassim"] }).credit, "credited");
  // Someone else's listing only: helped, not credited.
  const other = page({ bookingManagerUserIds: ["provider-amina"] });
  assert.equal(other.credit, "assisted");
  assert.equal(other.creditedUserId, null);
  assert.equal(page({ bookingManagerUserIds: [] }).credit, "assisted");
  assert.equal(page({ bookingManagerUserIds: undefined }).credit, "assisted");
  // R8, R10 and R3 apply as for listing links.
  assert.equal(page({ listing: { isPublic: false, managerUserId: "provider-kassim" }, bookingManagerUserIds: ["provider-kassim"] }).reason, "not-public");
  assert.equal(page({ link: { ...pageLink, stoppedAt: new Date(start).toISOString() }, bookingManagerUserIds: ["provider-kassim"] }).reason, "stopped");
  assert.equal(page({ bookerUserId: "provider-kassim", bookingManagerUserIds: ["provider-kassim"] }).reason, "own-link");
  assert.equal(page({ lastVisitAt: null, bookingManagerUserIds: ["provider-kassim"] }).reason, "no-recent-visit");
});

test("a provider page link is never read as an older listing link", () => {
  const touch = touchFromParams(new URLSearchParams("ref=p4g3l1nk8z&utm_source=provider&utm_medium=qr&utm_campaign=provider_page"), { path: "/p/k7m2q9xw/kassim-stays" }, start);
  assert.equal(touch?.shareCode, "p4g3l1nk8z");
  assert.deepEqual(getShareClaim([touch!], start + day), { code: "p4g3l1nk8z", olderLink: null, assistedCodes: [] });
});

test("R10: the person who created the link gets the credit, but not for their own booking", () => {
  const decision = decide();
  assert.equal(decision.credit, "credited");
  assert.equal(decision.creditedUserId, "provider-kassim");
  assert.equal(decide({ bookerUserId: "provider-kassim" }).reason, "own-link");
  const older = decide({ claim: { code: null, olderLink: { kind: "stay", id: "ux-villa-diani" }, assistedCodes: [] }, link: null, bookerUserId: "provider-kassim" });
  assert.equal(older.reason, "own-link");
});

test("R11: a booking counts once fully paid or its required deposit is paid", () => {
  const stay = { status: "upcoming", totalPrice: 1000, paymentDepositAmount: 500, serviceMode: null };
  // Paid in full.
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "paid", paymentAmountPaid: 1000 }), "confirmed");
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "paid", paymentAmountPaid: 0 }), "confirmed");
  // The required deposit, or more.
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "pending", paymentAmountPaid: 500 }), "confirmed");
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "pending", paymentAmountPaid: 700 }), "confirmed");
  // Less than the deposit, or nothing yet.
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "pending", paymentAmountPaid: 320 }), "pending");
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "pending", paymentAmountPaid: 0 }), "pending");
  // No deposit set: only full payment counts.
  assert.equal(getShareBookingState({ ...stay, paymentDepositAmount: null, paymentStatus: "pending", paymentAmountPaid: 500 }), "pending");
  // Custom menus take full payment only, so half doesn't count.
  assert.equal(getShareBookingState({ ...stay, serviceMode: "cook-custom-menu", paymentStatus: "pending", paymentAmountPaid: 500 }), "pending");
  // Nothing to pay isn't a paid booking.
  assert.equal(getShareBookingState({ ...stay, totalPrice: 0, paymentStatus: "paid", paymentAmountPaid: 0 }), "pending");
  // Cancelled or refunded stop counting.
  assert.equal(getShareBookingState({ ...stay, status: "cancelled", paymentStatus: "paid", paymentAmountPaid: 1000 }), "cancelled");
  assert.equal(getShareBookingState({ ...stay, paymentStatus: "refunded", paymentAmountPaid: 1000 }), "cancelled");
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
