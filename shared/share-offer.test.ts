import assert from "node:assert/strict";
import test from "node:test";
import { pickShareOffer, shareOfferMessageLine, shareOfferTerms, shareOfferValue, withPromoCode } from "./share-offer.ts";

const base = {
  name: "Friends of TBM",
  promoType: "percent",
  discountPercent: 10,
  discountAmount: null,
  minimumNights: null,
  minimumSpend: null,
  endAt: null,
};

test("only a guest-share promo with a code and a real discount is offered", () => {
  assert.equal(pickShareOffer([{ ...base, code: "HOME10", channel: "homepage" }]), null);
  assert.equal(pickShareOffer([{ ...base, code: null, channel: "guest-share" }]), null);
  assert.equal(pickShareOffer([{ ...base, code: "ZERO", channel: "guest-share", discountPercent: 0 }]), null);
  assert.equal(pickShareOffer([{ ...base, code: "BUNDLE", channel: "guest-share", promoType: "bundle" }]), null);
  const offer = pickShareOffer([{ ...base, code: "KARIBU10", channel: "guest-share" }]);
  assert.deepEqual(offer, { code: "KARIBU10", name: "Friends of TBM", promoType: "percent", discountPercent: 10, discountAmount: null, minimumNights: null, minimumSpend: null, endAt: null });
});

test("the newest guest-share promo wins, and nothing private leaks", () => {
  const offer = pickShareOffer([
    { ...base, code: "OLD5", channel: "guest-share", discountPercent: 5, updatedAt: "2026-09-01T00:00:00.000Z", id: "promo-1", redemptionCount: 4, notes: "internal" } as never,
    { ...base, code: "NEW10", channel: "guest-share", updatedAt: "2026-10-01T00:00:00.000Z" },
  ]);
  assert.equal(offer?.code, "NEW10");
  assert.equal(JSON.stringify(offer).includes("internal"), false);
  assert.equal("id" in (offer ?? {}), false);
});

test("value, terms and message read naturally", () => {
  const usd = (amount: number) => `KSh ${Math.round(amount * 129).toLocaleString("en-US")}`;
  const percent = pickShareOffer([{ ...base, code: "KARIBU10", channel: "guest-share", minimumNights: 2, endAt: "2026-12-31" }])!;
  assert.equal(shareOfferValue(percent, usd), "10%");
  assert.equal(shareOfferTerms(percent, usd), "on 2 nights or more · until 31 Dec");
  const fixed = pickShareOffer([{ ...base, code: "GIFT20", channel: "guest-share", promoType: "fixed", discountPercent: null, discountAmount: 20, minimumSpend: 200 }])!;
  assert.equal(shareOfferValue(fixed, usd), "KSh 2,580");
  assert.equal(shareOfferTerms(fixed, usd), "on bookings from KSh 25,800");
  assert.equal(shareOfferMessageLine("10%"), "Book through my link and you get 10% off with TBM:");
});

test("the code rides on the shared link", () => {
  assert.equal(
    withPromoCode("https://tembeabilamatata.com/accommodation/x/villa?utm_source=share", "KARIBU10"),
    "https://tembeabilamatata.com/accommodation/x/villa?utm_source=share&promoCode=KARIBU10",
  );
});
