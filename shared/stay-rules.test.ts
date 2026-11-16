import assert from "node:assert/strict";
import test from "node:test";
import { checkBookingAgainstRules, describeStayRules, hasStayRules, takesChildren } from "./stay-rules.ts";
import { getAreaMapsLink, isExactLocationPublic, normalizeGoogleMapsLink } from "./stay-location.ts";
import { insertStaySchema, stayRulesSchema } from "./schema.ts";

test("a hotel's rules read in three groups, with its own children's ages", () => {
  const described = describeStayRules({
    propertyType: "hotel",
    checkInTime: "14:00",
    checkOutTime: "10:30",
    hotelPolicy: { childMaxAge: 12, freeUnderAge: 3 },
    rules: { minNights: 2, minBookingAge: 18, idAtCheckIn: true, children: "welcome", pets: "not_allowed", smoking: "outside_only", events: "not_allowed", quietFrom: "22:00", quietTo: "07:00", note: "The pool closes at 7pm." },
  });
  assert.deepEqual(described.arrival, [
    "Check-in from 2:00 PM",
    "Check-out by 10:30 AM",
    "Minimum stay: 2 nights",
    "The guest who books must be 18 or older",
    "Bring your national ID or passport for check-in",
  ]);
  assert.deepEqual(described.children, ["Children of all ages are welcome", "Children are guests aged 3 to 12; under 3s stay free"]);
  assert.deepEqual(described.house, ["No pets", "Smoking outside only", "No parties or events", "Quiet hours: 10:00 PM to 7:00 AM"]);
  assert.equal(described.note, "The pool closes at 7pm.");
});

test("an entire place has its own rules about children, and nothing is shown that isn't set", () => {
  const home = describeStayRules({ propertyType: "entire_place", rules: { minChildAge: 6, infantsUnderAge: 2, pets: "allowed" } });
  assert.deepEqual(home.arrival, []);
  assert.deepEqual(home.children, ["Children aged 6 and over are welcome", "Children under 2 don't count towards the guests"]);
  assert.deepEqual(home.house, ["Pets are welcome"]);
  assert.equal(hasStayRules({ propertyType: "entire_place", rules: null }), false);
  assert.equal(hasStayRules({ propertyType: "entire_place", rules: {} }), false);
  // A hotel with no child price and no ages says nothing about children's ages.
  assert.deepEqual(describeStayRules({ propertyType: "hotel", rules: {}, roomTypes: [{ rates: [{ mealPlan: "BB", price: 100 }] }] }).children, []);
});

test("adults only: the place says so, and says nothing more about children", () => {
  const described = describeStayRules({ propertyType: "hotel", hotelPolicy: { childMaxAge: 11 }, rules: { children: "adults_only", minChildAge: 6 } });
  assert.deepEqual(described.children, ["Adults only: this hotel doesn't take children"]);
  assert.equal(takesChildren({ children: "adults_only" }), false);
  assert.equal(takesChildren(null), true);
});

test("a booking is held to the stay's rules: its shortest stay, and adults only", () => {
  const title = "Coral Cove";
  assert.equal(checkBookingAgainstRules({ title, rules: null, nights: 1 }), null);
  assert.equal(checkBookingAgainstRules({ title, rules: { minNights: 3 }, nights: 3 }), null);
  assert.match(checkBookingAgainstRules({ title, rules: { minNights: 3 }, nights: 2 }) ?? "", /Coral Cove takes bookings of 3 nights or more/);
  assert.match(checkBookingAgainstRules({ title, rules: { children: "adults_only" }, nights: 2, children: 1 }) ?? "", /adults only/);
  assert.equal(checkBookingAgainstRules({ title, rules: { children: "adults_only" }, nights: 2, children: 0 }), null);
});

test("rules are checked when saved, and a note never carries a phone number or email", () => {
  const rules = stayRulesSchema.parse({ minNights: 2, children: "welcome", quietFrom: "22:00", quietTo: "07:00", note: "Call me on 0712 345 678 or host@example.com for late check-in." });
  assert.doesNotMatch(rules.note ?? "", /0712|example\.com/);
  assert.match(rules.note ?? "", /late check-in/);
  assert.throws(() => stayRulesSchema.parse({ minNights: 0 }));
  assert.throws(() => stayRulesSchema.parse({ children: "sometimes" }));
  assert.throws(() => stayRulesSchema.parse({ quietFrom: "10pm" }));
});

test("only a Google Maps link is taken for a stay's place on the map", () => {
  for (const good of [
    "https://maps.app.goo.gl/AbC123xyz",
    "maps.app.goo.gl/AbC123xyz?g_st=ic",
    "https://goo.gl/maps/AbC123",
    "https://www.google.com/maps/place/Diani+Beach/@-4.3181,39.5732,17z",
    "http://maps.google.com/?q=-4.3181,39.5732",
    "https://www.google.co.ke/maps/@-4.05,39.66,15z",
  ]) {
    const link = normalizeGoogleMapsLink(good);
    assert.equal(link.ok, true, good);
    assert.match(link.ok ? link.url : "", /^https:\/\//);
  }
  for (const bad of [
    "",
    "https://evil.example/maps/place/x",
    "https://www.google.com/search?q=diani",
    "https://google.com.evil.example/maps",
    "https://wa.me/254712345678",
    "javascript:alert(1)",
    "https://user:pass@www.google.com/maps",
    "https://goo.gl/abc",
  ]) {
    assert.equal(normalizeGoogleMapsLink(bad).ok, false, bad);
  }
  const saved = insertStaySchema.partial().parse({ mapUrl: " maps.app.goo.gl/AbC123xyz " });
  assert.equal(saved.mapUrl, "https://maps.app.goo.gl/AbC123xyz");
  assert.equal(insertStaySchema.partial().parse({ mapUrl: "" }).mapUrl, null);
  assert.throws(() => insertStaySchema.partial().parse({ mapUrl: "https://evil.example/x" }), /Google Maps/);
});

test("a hotel's pin is public; a home's is for guests who booked, unless its owner says otherwise", () => {
  assert.equal(isExactLocationPublic({ propertyType: "hotel" }), true);
  assert.equal(isExactLocationPublic({ propertyType: "entire_place" }), false);
  assert.equal(isExactLocationPublic({ propertyType: "entire_place", showExactLocation: true }), true);
  assert.equal(isExactLocationPublic({ propertyType: "hotel", showExactLocation: false }), false);
  assert.equal(getAreaMapsLink("Galu Beach, Diani"), "https://www.google.com/maps/search/?api=1&query=Galu%20Beach%2C%20Diani%2C%20Kenya");
  assert.equal(getAreaMapsLink("Nyali, Mombasa, Kenya"), "https://www.google.com/maps/search/?api=1&query=Nyali%2C%20Mombasa%2C%20Kenya");
});
