import assert from "node:assert/strict";
import test from "node:test";
import {
  describePayoutDestination,
  emptyProviderProfile,
  getProviderSetupSteps,
  maskPayoutNumber,
  normalizeKenyanMobile,
  providerBusinessProfileSchema,
  providerPayoutDetailsSchema,
} from "./provider-profile.ts";

test("Kenyan mobile numbers are read however they're written", () => {
  assert.equal(normalizeKenyanMobile("0712 345 678"), "254712345678");
  assert.equal(normalizeKenyanMobile("+254 712-345-678"), "254712345678");
  assert.equal(normalizeKenyanMobile("254110345678"), "254110345678");
  assert.equal(normalizeKenyanMobile("0612345678"), null);
  assert.equal(normalizeKenyanMobile("12345"), null);
});

test("payout numbers are masked to the last four digits", () => {
  assert.equal(maskPayoutNumber("254712345678"), "•••• 5678");
  assert.equal(describePayoutDestination({ payoutMethod: "mpesa", mpesaNumber: "254712345678", bankName: null, bankAccountNumber: null }), "M-Pesa •••• 5678");
  assert.equal(describePayoutDestination({ payoutMethod: "bank", mpesaNumber: null, bankName: "Equity", bankAccountNumber: "0123456789" }), "Equity •••• 6789");
  assert.equal(describePayoutDestination({ payoutMethod: null, mpesaNumber: null, bankName: null, bankAccountNumber: null }), null);
});

test("M-Pesa payout details need a valid number and a name", () => {
  const ok = providerPayoutDetailsSchema.parse({ payoutMethod: "mpesa", mpesaNumber: "0712 345 678", mpesaName: "Kassim Mwinyi" });
  assert.equal(ok.payoutMethod === "mpesa" && ok.mpesaNumber, "254712345678");
  assert.throws(() => providerPayoutDetailsSchema.parse({ payoutMethod: "mpesa", mpesaNumber: "123", mpesaName: "Kassim" }));
  assert.throws(() => providerPayoutDetailsSchema.parse({ payoutMethod: "mpesa", mpesaNumber: "0712345678", mpesaName: "" }));
  assert.throws(() => providerPayoutDetailsSchema.parse({ payoutMethod: "bank", bankName: "Equity", bankAccountName: "K M", bankAccountNumber: "x" }));
});

test("a business photo must be an uploaded file, not any address", () => {
  assert.equal(providerBusinessProfileSchema.parse({ photoUrl: "/uploads/a.jpg" }).photoUrl, "/uploads/a.jpg");
  assert.equal(providerBusinessProfileSchema.parse({ photoUrl: "https://cdn.example.com/a.jpg" }).photoUrl, "https://cdn.example.com/a.jpg");
  assert.throws(() => providerBusinessProfileSchema.parse({ photoUrl: "javascript:alert(1)" }));
  assert.throws(() => providerBusinessProfileSchema.parse({ languages: ["Klingon"] }));
});

test("setup steps follow the provider's progress", () => {
  const fresh = getProviderSetupSteps({ profile: emptyProviderProfile, hasListing: false, hasPublicListing: false, hasShared: false });
  assert.deepEqual(fresh.map((step) => step.key), ["business", "payout", "verification", "listing", "share"]);
  assert.equal(fresh.every((step) => !step.done), true);
  assert.equal(fresh[3].title, "Add your first listing");

  const along = getProviderSetupSteps({
    profile: { businessName: "Diani Breeze", bio: "Two villas on Galu Beach, run by our family for ten years.", payoutMethod: "mpesa", verificationStatus: "in-review" },
    hasListing: true,
    hasPublicListing: false,
    hasShared: false,
  });
  assert.equal(along[0].done, true);
  assert.equal(along[1].done, true);
  assert.equal(along[2].done, false);
  assert.equal(along[2].inProgress, true);
  assert.equal(along[3].inProgress, true);
  assert.equal(along[3].title, "Go live");
});
