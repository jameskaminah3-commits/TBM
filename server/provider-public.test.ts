import assert from "node:assert/strict";
import test from "node:test";
import {
  canShowPublicPhoto,
  isProviderPublicCode,
  makeProviderPublicCode,
  providerPageBlockers,
  providerPublicPath,
  publicArea,
  publicProviderDisplayName,
  publicProviderFields,
  publicProviderListingFields,
  publicProviderReviewFields,
  publicProviderSummaryFields,
} from "../shared/provider-public.ts";
import { getProviderPageBlockers, publicAbout, toPublicProviderProfile, toPublicProviderSummary, type ProviderPageSource } from "./provider-public.ts";
import type { ReviewRow } from "./public-reviews.ts";

const providerId = "6f1c2a9e-4b7d-4c3e-9a1f-2b3c4d5e6f70";

function review(index: number, overrides: Partial<ReviewRow> = {}): ReviewRow {
  const guestId = `0a1b2c3d-0000-4000-8000-00000000000${index}`;
  return {
    reviewId: `9d8c7b6a-0000-4000-8000-00000000000${index}`,
    reviewUserId: guestId,
    targetType: "stay",
    targetId: "stay-7f3e9c1a-uuid",
    rating: 5,
    comment: "Lovely, call me on 0712 345 678",
    createdAt: `2026-09-0${index}T08:00:00.000Z`,
    reviewStatus: "published",
    providerReply: null,
    providerReplyStatus: null,
    providerReplyAt: null,
    guestName: "Amina Wanjiru",
    booking: { userId: guestId, status: "completed", paymentStatus: "paid" },
    listingManagerUserId: providerId,
    reviewerRole: "customer",
    ...overrides,
  };
}

// Everything the database knows, private details included.
function source(overrides: Partial<ProviderPageSource> = {}, profile: Partial<ProviderPageSource["profile"]> = {}): ProviderPageSource {
  return {
    userId: providerId,
    role: "provider",
    isSuspended: false,
    firstName: "Mwinyi",
    lastName: "Hamisi Juma",
    email: "mwinyi.private@example.com",
    phone: "+254 712 999 888",
    accountCreatedAt: "2026-03-14T10:00:00.000Z",
    profile: {
      publicCode: "k7m2q9xw",
      publicEnabled: true,
      publicBlockedAt: null,
      businessName: "Mwinyi Coast Stays",
      bio: "Hosting in Diani since 2015. WhatsApp 0712 999 888, mwinyi.private@example.com, https://wa.me/254712999888 or @mwinyistays.",
      photoUrl: "https://cdn.example.com/approved-logo.jpg",
      photoApprovedAt: "2026-04-03T09:00:00.000Z",
      photoKind: "logo",
      languages: ["English", "Swahili"],
      serviceAreas: ["Diani"],
      verificationStatus: "verified",
      verifiedAt: "2026-04-02T09:00:00.000Z",
      foundingProviderAt: null,
      mpesaNumber: "254712999888",
      bankAccountNumber: "0123456789",
      verificationNote: "ID checked against passport A1234567",
      photoPendingKey: "provider-photo/2026-10/abcdef.jpg",
      ...profile,
    },
    listings: [
      { kind: "stay", id: "stay-7f3e9c1a-uuid", name: "Diani Breeze Villa", path: "/accommodation/stay-7f3e9c1a-uuid/diani-breeze-villa", area: "Plot 44, Beach Road, Diani, Kenya", priceFrom: 120, priceUnit: "a night", imageUrl: "https://cdn.example.com/villa.jpg" },
    ],
    reviewRows: [review(1), review(2, { rating: 4, guestName: "John Kamau" }), review(3)],
    ...overrides,
  };
}

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function assertNoPrivateData(json: string) {
  for (const leaked of [providerId, "mwinyi.private@example.com", "712 999 888", "712999888", "0123456789", "Hamisi", "Juma", "passport", "A1234567", "provider-photo/", "Wanjiru", "Kamau", "0712 345 678", "Plot 44", "Beach Road", "userId", "managerUserId", "bookingId", "reviewId", "mpesa", "bank", "wa.me", "@mwinyistays", "\"id\""]) {
    assert.ok(!json.includes(leaked), `public provider data leaked ${leaked}`);
  }
  assert.doesNotMatch(json, uuidPattern);
}

test("a provider code is 8 characters without look-alikes, and makes the page address", () => {
  let next = 0;
  const code = makeProviderPublicCode((max) => (next++ * 7) % max);
  assert.ok(isProviderPublicCode(code));
  for (const bad of ["K7M2Q9XW", "k7m2q9x", "k7m2q9xw1", "k7m2q9x0", "k7m2q9xl", providerId, "", null]) {
    assert.ok(!isProviderPublicCode(bad), `${bad} should not be a code`);
  }
  assert.equal(providerPublicPath("k7m2q9xw", "Mwinyi Coast Stays"), "/p/k7m2q9xw/mwinyi-coast-stays");
  assert.equal(providerPublicPath("k7m2q9xw"), "/p/k7m2q9xw");
});

test("the public page carries exactly the allowlisted fields at every level", () => {
  const output = toPublicProviderProfile(source());
  assert.deepEqual(Object.keys(output).sort(), [...publicProviderFields].sort());
  for (const listing of output.listings) assert.deepEqual(Object.keys(listing).sort(), [...publicProviderListingFields].sort());
  for (const item of output.reviews) assert.deepEqual(Object.keys(item).sort(), [...publicProviderReviewFields].sort());
  assert.deepEqual(Object.keys(output.rating!).sort(), ["average", "count"]);
  const summary = toPublicProviderSummary(source());
  assert.deepEqual(Object.keys(summary).sort(), [...publicProviderSummaryFields].sort());
});

test("no IDs, contact details, payout fields, notes or surnames reach the public page", () => {
  assertNoPrivateData(JSON.stringify(toPublicProviderProfile(source())));
  assertNoPrivateData(JSON.stringify(toPublicProviderSummary(source())));
});

test("listings show an area name, never a street or plot", () => {
  assert.equal(toPublicProviderProfile(source()).listings[0].area, "Diani");
  assert.equal(publicArea("Plot 12, Links Road, Nyali, Mombasa"), "Nyali");
  assert.equal(publicArea("House 4, Old Town Road, Kenya"), "Old Town Road");
  assert.equal(publicArea(""), null);
});

test("the bio loses phone numbers, emails, links and social handles", () => {
  const about = toPublicProviderProfile(source()).about;
  assert.match(about, /^Hosting in Diani since 2015\./);
  assert.doesNotMatch(about, /0712|@example|https?:|wa\.me|@mwinyi/);
  assert.match(about, /\[contact details removed\]/);
  assert.equal(publicAbout("Visit www.mwinyi.co.ke today"), "Visit [contact details removed] today");
  assert.equal(publicAbout("Or https://wa.me/254712999888."), "Or [contact details removed]");
  assert.equal(publicAbout("Email me at amina@example.com, or @amina_stays"), "Email me at [contact details removed], or [contact details removed]");
  assert.equal(publicAbout(""), "");
});

test("the display name is the business name, or a first name, never a surname", () => {
  assert.equal(publicProviderDisplayName({ businessName: " Mwinyi  Coast Stays ", firstName: "Mwinyi" }), "Mwinyi Coast Stays");
  assert.equal(publicProviderDisplayName({ businessName: "", firstName: "Amina Wanjiru" }), "Amina");
  assert.equal(publicProviderDisplayName({ businessName: "", firstName: "" }), "TBM provider");
  assert.equal(toPublicProviderProfile(source({}, { businessName: "" })).displayName, "Mwinyi");
});

test("only a photo TBM approved is public; one waiting or never reviewed is not", () => {
  assert.equal(toPublicProviderProfile(source()).photoUrl, "https://cdn.example.com/approved-logo.jpg");
  // A photo saved before reviews existed, or with nothing approved yet.
  const unreviewed = toPublicProviderProfile(source({}, { photoApprovedAt: null, photoStatus: "pending" }));
  assert.equal(unreviewed.photoUrl, null);
  assert.equal(unreviewed.photoKind, null);
  // A newer photo waiting for TBM leaves the approved one in place; its private key is never sent.
  const waiting = toPublicProviderProfile(source({}, { photoStatus: "pending", photoPendingKey: "provider-photo/2026-10/new.jpg" }));
  assert.equal(waiting.photoUrl, "https://cdn.example.com/approved-logo.jpg");
  assert.ok(!JSON.stringify(waiting).includes("provider-photo/"));
});

test("home help never shows a face in public; a logo or a photo of their work is fine", () => {
  const homeHelp = { kind: "errand" as const, id: "errand-1", name: "Help Mama", path: "/errand/errand-1/help-mama", area: "Nyali", priceFrom: 20, priceUnit: "to start", imageUrl: null };
  const face = toPublicProviderProfile(source({ listings: [homeHelp] }, { photoKind: "face" }));
  assert.equal(face.photoUrl, null);
  assert.equal(toPublicProviderSummary(source({ listings: [homeHelp] }, { photoKind: "face" })).photoUrl, null);
  assert.equal(toPublicProviderProfile(source({ listings: [homeHelp] }, { photoKind: "work" })).photoKind, "work");
  // A stay host's own face is fine once approved.
  assert.equal(toPublicProviderProfile(source({}, { photoKind: "face" })).photoKind, "face");
  assert.ok(!canShowPublicPhoto({ photoApprovedAt: "2026-04-03", photoKind: null, photoUrl: "x.jpg", offersHomeHelp: true }));
  assert.ok(!canShowPublicPhoto({ photoApprovedAt: null, photoKind: "logo", photoUrl: "x.jpg", offersHomeHelp: false }));
});

test("verification shows only while verified, with the month only", () => {
  const verified = toPublicProviderProfile(source());
  assert.equal(verified.verified, true);
  assert.equal(verified.verifiedSince, "2026-04");
  assert.equal(verified.memberSince, "2026-03");
  for (const verificationStatus of ["in-review", "not-started"]) {
    const output = toPublicProviderProfile(source({}, { verificationStatus }));
    assert.equal(output.verified, false);
    assert.equal(output.verifiedSince, null);
  }
});

test("the rating counts eligible reviews from 3, to one decimal place", () => {
  assert.deepEqual(toPublicProviderProfile(source()).rating, { average: 4.7, count: 3 });
  // A self-review and a cancelled booking don't count, so only two remain.
  const rows = [review(1), review(2), review(3, { reviewUserId: providerId, booking: { userId: providerId, status: "completed", paymentStatus: "paid" } }), review(4, { booking: { userId: "0a1b2c3d-0000-4000-8000-000000000004", status: "cancelled", paymentStatus: "paid" } })];
  const output = toPublicProviderProfile(source({ reviewRows: rows }));
  assert.equal(output.rating, null);
  assert.equal(output.reviews.length, 2);
  // Reviews of listings that aren't this provider's public ones are left out.
  const elsewhere = toPublicProviderProfile(source({ reviewRows: [review(1, { targetId: "someone-elses-stay" })] }));
  assert.equal(elsewhere.reviews.length, 0);
});

test("reviews show a first name and initial, the listing name, and contact details removed", () => {
  const [first] = toPublicProviderProfile(source()).reviews;
  assert.equal(first.guestName, "Amina W.");
  assert.equal(first.listingName, "Diani Breeze Villa");
  assert.match(first.comment!, /\[contact details removed\]/);
});

test("the page is shown only for a provider who isn't suspended, switched it on, and has a public listing", () => {
  assert.deepEqual(getProviderPageBlockers(source()), []);
  assert.deepEqual(getProviderPageBlockers(source({ isSuspended: true })), ["suspended"]);
  assert.deepEqual(getProviderPageBlockers(source({}, { publicEnabled: false })), ["switched-off"]);
  assert.deepEqual(getProviderPageBlockers(source({}, { publicBlockedAt: "2026-10-01T00:00:00.000Z" })), ["blocked-by-tbm"]);
  assert.deepEqual(getProviderPageBlockers(source({ listings: [] })), ["no-public-listings"]);
  assert.deepEqual(getProviderPageBlockers(source({ role: "customer" })), ["not-provider"]);
  assert.deepEqual(providerPageBlockers({ role: "provider", isSuspended: true, blockedByTbm: true, publicEnabled: false, publicListingCount: 0 }), ["suspended", "blocked-by-tbm", "switched-off", "no-public-listings"]);
});
