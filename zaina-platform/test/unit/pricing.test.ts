// The shared pricing module (I1): one quote for Zaina, the payment page, the
// team and the charge.

import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, toMinor } from "../../src/booking/money.ts";
import { fromNightly, nightsOf, quoteStay, validatePricingRules, withAgreedTotal, type DepositRule, type PricingRules, type TaxRule } from "../../src/booking/pricing.ts";

const KSH = (major: number) => major * 100;
const room = { maxGuests: 3 };

function quote(rules: PricingRules, stay: { checkIn: string; checkOut: string; guests: number; units?: number }, extra: { tax?: TaxRule | null; depositPercent?: number; deposit?: DepositRule; maxGuests?: number; maxNights?: number } = {}) {
  const percent = extra.depositPercent ?? 30;
  const result = quoteStay({
    rules,
    room: { maxGuests: extra.maxGuests ?? room.maxGuests },
    stay: { units: 1, ...stay },
    currency: "KES",
    tax: extra.tax ?? null,
    deposit: extra.deposit ?? (percent === 0 ? { type: "none" } : percent === 100 ? { type: "full" } : { type: "percent", percent }),
    maxNights: extra.maxNights,
  });
  return result;
}

test("a plain stay: nights × the nightly price, a 30% deposit and the balance", () => {
  const result = quote({ nightly: KSH(8000) }, { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 2 });
  assert.ok(result.ok);
  const { quote: q } = result;
  assert.equal(q.nights, 3);
  assert.equal(q.total, KSH(24000));
  assert.equal(q.deposit, KSH(7200));
  assert.equal(q.balance, KSH(16800));
  assert.equal(q.total_display, "KSh 24,000");
  assert.equal(q.deposit_display, "KSh 7,200");
  assert.deepEqual(q.lines.map((line) => [line.label, line.display]), [["3 nights (KSh 8,000 a night)", "KSh 24,000"]]);
});

test("Friday and Saturday nights take the weekend price", () => {
  // Thursday 1 October to Sunday 4 October: Thursday, Friday and Saturday nights.
  const result = quote({ nightly: KSH(8000), weekend_nightly: KSH(9500) }, { checkIn: "2026-10-01", checkOut: "2026-10-04", guests: 2 });
  assert.ok(result.ok);
  assert.deepEqual(result.quote.per_night.map((night) => night.room), [KSH(8000), KSH(9500), KSH(9500)]);
  assert.equal(result.quote.total, KSH(27000));
  assert.equal(result.quote.lines[0].label, "3 nights (KSh 8,000–KSh 9,500 a night)");
});

test("seasons may cross the new year, and bring their own minimum stay", () => {
  const rules: PricingRules = {
    nightly: KSH(8000),
    weekend_nightly: KSH(9500),
    seasons: [{ name: "Festive season", from: "12-15", to: "01-05", nightly: KSH(12000), min_nights: 3 }],
  };
  const festive = quote(rules, { checkIn: "2026-12-30", checkOut: "2027-01-02", guests: 2 });
  assert.ok(festive.ok);
  assert.deepEqual(festive.quote.per_night.map((night) => [night.night, night.room, night.season]), [
    ["2026-12-30", KSH(12000), "Festive season"],
    ["2026-12-31", KSH(12000), "Festive season"],
    ["2027-01-01", KSH(12000), "Festive season"],
  ]);
  // Two nights before the season, two in it (the season's minimum applies).
  const mixed = quote(rules, { checkIn: "2026-12-13", checkOut: "2026-12-17", guests: 2 });
  assert.ok(mixed.ok);
  assert.deepEqual(mixed.quote.per_night.map((night) => night.room), [KSH(8000), KSH(8000), KSH(12000), KSH(12000)]);
  const short = quote(rules, { checkIn: "2026-12-31", checkOut: "2027-01-02", guests: 2 });
  assert.equal(short.ok, false);
  assert.ok(!short.ok && short.error === "min_nights" && short.min_nights === 3);
  assert.match(!short.ok ? short.message : "", /minimum stay is 3 nights in Festive season/);
  // Outside the season the business's own minimum applies.
  assert.ok(quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 }).ok);
});

test("extra guests pay per night above the guests the price includes, across rooms", () => {
  const rules: PricingRules = { nightly: KSH(8000), included_guests: 2, extra_guest_nightly: KSH(1500) };
  const one = quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-04", guests: 3 });
  assert.ok(one.ok);
  assert.equal(one.quote.extra_guests_total, KSH(3000));
  assert.equal(one.quote.total, KSH(19000));
  assert.equal(one.quote.lines[1].label, "1 extra guest × 2 nights");
  // Two rooms include four guests; the fifth pays.
  const two = quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-04", guests: 5, units: 2 });
  assert.ok(two.ok);
  assert.equal(two.quote.rooms_total, KSH(32000));
  assert.equal(two.quote.extra_guests_total, KSH(3000));
  assert.equal(two.quote.lines[0].label, "2 rooms × 2 nights (KSh 8,000 a night)");
});

test("a stay must fit the rooms: guests, rooms and nights", () => {
  const rules: PricingRules = { nightly: KSH(8000), min_nights: 2 };
  const crowded = quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 7, units: 2 });
  assert.ok(!crowded.ok && crowded.error === "too_many_guests" && crowded.max_guests === 6);
  assert.match(!crowded.ok ? crowded.message : "", /2 of these rooms sleep up to 6 guests/);
  assert.ok(!quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 1, units: 2 }).ok, "each room needs a guest");
  const short = quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 2 });
  assert.ok(!short.ok && short.error === "min_nights" && short.min_nights === 2);
  const long = quote({ nightly: KSH(8000) }, { checkIn: "2026-11-01", checkOut: "2026-12-02", guests: 2 });
  assert.ok(!long.ok && long.error === "max_nights" && long.max_nights === 30);
  for (const [checkIn, checkOut] of [["2026-11-05", "2026-11-05"], ["2026-11-05", "2026-11-02"], ["2026-02-30", "2026-03-02"], ["5 Nov", "7 Nov"]]) {
    const bad = quote(rules, { checkIn, checkOut, guests: 2 });
    assert.ok(!bad.ok && bad.error === "invalid_dates", `${checkIn} → ${checkOut}`);
  }
});

test("fees by the booking, the room, the room night, the guest and the guest night", () => {
  const rules: PricingRules = {
    nightly: KSH(10000),
    fees: [
      { name: "Booking fee", amount: KSH(500), per: "booking" },
      { name: "Cleaning", amount: KSH(2000), per: "room" },
      { name: "Linen", amount: KSH(300), per: "room_night" },
      { name: "Welcome pack", amount: KSH(250), per: "guest" },
      { name: "Conservancy fee", amount: KSH(1000), per: "guest_night" },
    ],
  };
  const result = quote(rules, { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 4, units: 2 });
  assert.ok(result.ok);
  const fees = result.quote.lines.filter((line) => line.kind === "fee").map((line) => [line.label, line.amount]);
  assert.deepEqual(fees, [
    ["Booking fee", KSH(500)],
    ["Cleaning (2 rooms)", KSH(4000)],
    ["Linen (6 room nights)", KSH(1800)],
    ["Welcome pack (4 guests)", KSH(1000)],
    ["Conservancy fee (12 guest nights)", KSH(12000)],
  ]);
  assert.equal(result.quote.fees_total, KSH(19300));
  assert.equal(result.quote.total, KSH(60000 + 19300));
});

test("tax already in the prices is shown; tax on top is added", () => {
  const included = quote({ nightly: KSH(11600) }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 }, { tax: { name: "VAT", percent: 16, included: true } });
  assert.ok(included.ok);
  assert.equal(included.quote.total, KSH(11600));
  assert.deepEqual(included.quote.tax, { name: "VAT", percent: 16, included: true, amount: KSH(1600) });
  assert.deepEqual(included.quote.lines.at(-1), { kind: "tax", label: "Includes VAT 16%", amount: KSH(1600), display: "KSh 1,600", included: true });

  const added = quote({ nightly: KSH(10000) }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 }, { tax: { name: "VAT", percent: 16, included: false } });
  assert.ok(added.ok);
  assert.equal(added.quote.total, KSH(11600));
  assert.equal(added.quote.lines.at(-1)?.label, "VAT 16%");
});

test("the deposit is whole shillings, the room type's own percentage wins, and 0% and 100% are exact", () => {
  const odd = quote({ nightly: 1_000_100 }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 });
  assert.ok(odd.ok);
  assert.equal(odd.quote.deposit, KSH(3000), "30% of KSh 10,001 is KSh 3,000.30, rounded to KSh 3,000");
  assert.equal(odd.quote.balance, odd.quote.total - odd.quote.deposit);
  const own = quote({ nightly: KSH(10000), deposit_percent: 50 }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 });
  assert.ok(own.ok && own.quote.deposit === KSH(5000) && own.quote.deposit_percent === 50);
  const full = quote({ nightly: 1_000_155 }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 }, { depositPercent: 100 });
  assert.ok(full.ok && full.quote.deposit === 1_000_155 && full.quote.balance === 0);
  const none = quote({ nightly: KSH(10000) }, { checkIn: "2026-11-02", checkOut: "2026-11-03", guests: 1 }, { depositPercent: 0 });
  assert.ok(none.ok && none.quote.deposit === 0 && none.quote.balance === KSH(10000));
});

test("the deposit is the business's rule: a fixed amount, in full, none, or not chosen yet", () => {
  const stay = { checkIn: "2026-11-02", checkOut: "2026-11-04", guests: 1 };
  const fixed = quote({ nightly: KSH(10000) }, stay, { deposit: { type: "fixed", fixedMinor: KSH(5000) } });
  assert.ok(fixed.ok && fixed.quote.deposit === KSH(5000) && fixed.quote.deposit_rule === "fixed" && fixed.quote.deposit_percent === null);
  const capped = quote({ nightly: KSH(2000) }, { ...stay, checkOut: "2026-11-03" }, { deposit: { type: "fixed", fixedMinor: KSH(5000) } });
  assert.ok(capped.ok && capped.quote.deposit === KSH(2000), "a fixed deposit is never more than the total");
  const unset = quote({ nightly: KSH(10000) }, stay, { deposit: { type: "not_set" } });
  assert.ok(unset.ok && unset.quote.deposit === 0 && unset.quote.deposit_rule === "not_set");
  const roomFixed = quote({ nightly: KSH(10000), deposit_fixed: KSH(3000) }, stay, { deposit: { type: "full" } });
  assert.ok(roomFixed.ok && roomFixed.quote.deposit === KSH(3000), "the room type's own rule wins");
  const agreed = withAgreedTotal(fixed.ok ? fixed.quote : (null as never), KSH(15000), null);
  assert.equal(agreed.deposit, KSH(5000), "a fixed deposit stays fixed when the team agrees a price");
  const longStay = quote({ nightly: KSH(1000) }, { ...stay, checkOut: "2026-11-20" }, { maxNights: 14 });
  assert.ok(!longStay.ok && longStay.error === "max_nights" && longStay.max_nights === 14, "the business's longest stay");
  assert.match((validatePricingRules({ nightly: 100, deposit_percent: 20, deposit_fixed: 100 }, room) as { error: string }).error, /not both/);
});

test("the team's agreed price replaces the total; the deposit and included tax follow it", () => {
  const result = quote({ nightly: KSH(8000) }, { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 2 }, { tax: { name: "VAT", percent: 16, included: true } });
  assert.ok(result.ok);
  const agreed = withAgreedTotal(result.quote, KSH(20000), "returning guest");
  assert.equal(agreed.total, KSH(20000));
  assert.equal(agreed.deposit, KSH(6000));
  assert.equal(agreed.balance, KSH(14000));
  assert.deepEqual(agreed.lines.map((line) => [line.label, line.amount]), [
    ["3 nights (KSh 8,000 a night)", KSH(24000)],
    ["Agreed price: returning guest", -KSH(4000)],
    ["Includes VAT 16%", Math.round((KSH(20000) * 16) / 116)],
  ]);
  assert.equal(withAgreedTotal(result.quote, result.quote.total, null), result.quote, "the same total changes nothing");
});

test("rules from staff are checked, and nothing unknown gets in", () => {
  const ok = validatePricingRules({
    nightly: KSH(8000), included_guests: 2, extra_guest_nightly: KSH(1500), weekend_nightly: KSH(9500),
    seasons: [{ name: " Leap day ", from: "02-29", to: "03-01", nightly: KSH(9000) }],
    min_nights: 2, max_nights: 14, fees: [{ name: "Cleaning", amount: KSH(2000), per: "room" }], deposit_percent: 50,
  }, room);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.rules.seasons?.[0].name, "Leap day");
  const problems: Array<[unknown, RegExp]> = [
    [null, /object/],
    [{ nightly: 0 }, /nightly/],
    [{ nightly: 8000.5 }, /nightly/],
    [{ nightly: KSH(8000), discount: 10 }, /unknown rule: discount/],
    [{ nightly: KSH(8000), included_guests: 4 }, /1 to 3/],
    [{ nightly: KSH(8000), min_nights: 5, max_nights: 3 }, /max_nights/],
    [{ nightly: KSH(8000), seasons: [{ name: "Bad", from: "02-30", to: "03-01", nightly: KSH(9000) }] }, /month-day/],
    [{ nightly: KSH(8000), seasons: [{ name: "", from: "01-01", to: "01-02", nightly: KSH(9000) }] }, /needs a name/],
    [{ nightly: KSH(8000), fees: [{ name: "Tip", amount: KSH(100), per: "stay" }] }, /per is one of/],
    [{ nightly: KSH(8000), deposit_percent: 120 }, /0 to 100/],
  ];
  for (const [input, message] of problems) {
    const result = validatePricingRules(input, room);
    assert.ok(!result.ok, JSON.stringify(input));
    assert.match(!result.ok ? result.error : "", message);
  }
});

test("money is shown the way customers read it, and typed the way staff type it", () => {
  assert.equal(formatMoney(800000, "KES"), "KSh 8,000");
  assert.equal(formatMoney(9950, "USD"), "$99.50");
  assert.equal(formatMoney(-400000, "KES"), "-KSh 4,000");
  assert.equal(toMinor("8,000"), 800000);
  assert.equal(toMinor(8000), 800000);
  assert.equal(toMinor("99.5"), 9950);
  for (const bad of ["", "abc", "-5", "1.234", null, undefined, "8 000"]) assert.equal(toMinor(bad), null, String(bad));
  assert.equal(fromNightly({ nightly: KSH(8000), seasons: [{ name: "Low", from: "04-01", to: "06-30", nightly: KSH(6500) }] }), KSH(6500));
  assert.deepEqual(nightsOf("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01"]);
});
