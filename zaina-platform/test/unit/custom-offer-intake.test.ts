import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetBasisArg,
  checkCustomRequestDetails,
  customRequestCategory,
  describeCustomRequest,
  guestsArg,
  isoDateArg,
  timeArg,
  type CustomRequestDetails,
} from "../../src/engine/custom-offer-intake.ts";

const today = "2026-09-25";
const stay: CustomRequestDetails = {
  category: "stay",
  startDate: "2026-11-12",
  endDate: "2026-11-15",
  guests: 4,
  location: "Nyali",
  budgetLabel: "KSh 3,000",
  budgetBasis: "per_night",
};

test("a stay with dates, guests, area and budget goes through", () => {
  assert.deepEqual(checkCustomRequestDetails(stay, { today, alreadyAsked: [] }), { ok: true });
});

test("a stay missing everything asks for it all in one question", () => {
  const check = checkCustomRequestDetails(
    { ...stay, startDate: null, endDate: null, guests: null, location: "", budgetLabel: null, budgetBasis: null },
    { today, alreadyAsked: [] },
  );
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.deepEqual(check.missing, ["dates", "guests", "location", "budget"]);
  assert.equal(
    check.question,
    "To find you the right place, could you tell me your check-in and check-out dates, how many guests, " +
      "which area you'd like to stay in and roughly what budget you have in mind (per night or in total)? " +
      "If you'd rather not set a budget, that's fine too.",
  );
});

test("a stay needs a check-out date, after check-in, and not in the past", () => {
  const noCheckOut = checkCustomRequestDetails({ ...stay, endDate: null }, { today, alreadyAsked: [] });
  assert.equal(noCheckOut.ok, false);
  if (!noCheckOut.ok) assert.deepEqual(noCheckOut.missing, ["dates"]);

  const sameDay = checkCustomRequestDetails({ ...stay, endDate: stay.startDate }, { today, alreadyAsked: [] });
  assert.equal(sameDay.ok, false);
  if (!sameDay.ok) assert.match(sameDay.question, /check-out needs to be after check-in/);

  const past = checkCustomRequestDetails({ ...stay, startDate: "2025-11-12", endDate: "2025-11-15" }, { today, alreadyAsked: [] });
  assert.equal(past.ok, false);
  if (!past.ok) assert.match(past.question, /12 Nov 2025 has already passed/);
});

test("the budget is asked for once, and a stay budget's basis is asked for once", () => {
  const noBudget = { ...stay, budgetLabel: null, budgetBasis: null };
  const first = checkCustomRequestDetails(noBudget, { today, alreadyAsked: [] });
  assert.equal(first.ok, false);
  if (!first.ok) assert.deepEqual(first.missing, ["budget"]);
  assert.deepEqual(checkCustomRequestDetails(noBudget, { today, alreadyAsked: ["budget"] }), { ok: true });

  const noBasis = { ...stay, budgetBasis: null };
  const basis = checkCustomRequestDetails(noBasis, { today, alreadyAsked: [] });
  assert.equal(basis.ok, false);
  if (!basis.ok) {
    assert.deepEqual(basis.missing, ["budget_basis"]);
    assert.match(basis.question, /whether your budget of KSh 3,000 is per night or for the whole stay/);
  }
  assert.deepEqual(checkCustomRequestDetails(noBasis, { today, alreadyAsked: ["budget_basis"] }), { ok: true });
});

test("dates, guests and the area are asked for until given", () => {
  const check = checkCustomRequestDetails({ ...stay, guests: null }, { today, alreadyAsked: ["guests", "budget"] });
  assert.equal(check.ok, false);
  if (!check.ok) assert.deepEqual(check.missing, ["guests"]);
});

test("each kind of request asks in its own words", () => {
  const transport = checkCustomRequestDetails(
    { ...stay, category: "transport", startDate: null, endDate: null, guests: null, location: "", budgetLabel: "KSh 5,000" },
    { today, alreadyAsked: [] },
  );
  assert.equal(transport.ok, false);
  if (!transport.ok) {
    assert.match(transport.question, /^To arrange the right ride, could you tell me the date/);
    assert.match(transport.question, /how many passengers and where to pick you up and drop you off\?$/);
  }

  // A one-day request needs no end date; a service needs no guest count.
  const service = checkCustomRequestDetails(
    { ...stay, category: "service", endDate: null, guests: null, budgetLabel: "$100", budgetBasis: null },
    { today, alreadyAsked: [] },
  );
  assert.deepEqual(service, { ok: true });

  const other = checkCustomRequestDetails(
    { category: "other", startDate: null, endDate: null, guests: null, location: "", budgetLabel: null, budgetBasis: null },
    { today, alreadyAsked: [] },
  );
  assert.equal(other.ok, false);
  if (!other.ok) assert.deepEqual(other.missing, ["budget"]);
});

test("the category comes from the model, or from the request's wording", () => {
  assert.equal(customRequestCategory("stay", ""), "stay");
  assert.equal(customRequestCategory(" Dining ", ""), "dining");
  assert.equal(customRequestCategory(undefined, "stay_within_budget: 2-bedroom villa in Diani"), "stay");
  assert.equal(customRequestCategory("bogus", "Airport transfer to Diani"), "transport");
  assert.equal(customRequestCategory(null, "Beach photographer for 2 hours"), "service");
  assert.equal(customRequestCategory(null, "Find me a SIM card"), "other");
});

test("arguments are read safely", () => {
  assert.equal(isoDateArg("2026-11-12"), "2026-11-12");
  assert.equal(isoDateArg("2026-02-30"), null);
  assert.equal(isoDateArg("12/11/2026"), null);
  assert.equal(isoDateArg(20261112), null);
  assert.equal(guestsArg(4), 4);
  assert.equal(guestsArg("6"), 6);
  assert.equal(guestsArg(0), null);
  assert.equal(guestsArg(2.5), null);
  assert.equal(guestsArg("four"), null);
  assert.equal(budgetBasisArg("per night"), "per_night");
  assert.equal(budgetBasisArg("weekly"), null);
  assert.equal(timeArg("7:30"), "07:30");
  assert.equal(timeArg("19:30"), "19:30");
  assert.equal(timeArg("25:00"), null);
});

test("the team gets every detail on its own line", () => {
  const brief = describeCustomRequest({
    category: "stay",
    startDate: "2026-11-12",
    endDate: "2026-11-15",
    time: null,
    guests: 4,
    location: "Nyali",
    budget: { stated: "KSh 3,000", converted: "≈ $23" },
    budgetBasis: "per_night",
    flexibleDates: "",
    preferences: "Pool, walking distance to the beach",
    requestDetails: "2-bedroom apartment for a family",
    listingUrl: "",
  });
  assert.equal(
    brief,
    [
      "Stay request",
      "Dates: 12 Nov 2026 to 15 Nov 2026 (3 nights)",
      "Guests: 4",
      "Area: Nyali",
      "Budget: KSh 3,000 per night (≈ $23)",
      "Preferences: Pool, walking distance to the beach",
      "Details: 2-bedroom apartment for a family",
    ].join("\n"),
  );

  const ride = describeCustomRequest({
    category: "transport",
    startDate: "2026-11-12",
    endDate: null,
    time: "06:30",
    guests: 3,
    location: "Moi Airport to Diani",
    budget: null,
    budgetBasis: null,
    flexibleDates: "",
    preferences: "",
    requestDetails: "Airport pickup",
    listingUrl: "",
  });
  assert.match(ride, /^Transport request\nDate: 12 Nov 2026\nTime: 06:30\nPassengers: 3\nPickup and drop-off: Moi Airport to Diani\nBudget: not given\n/);
});
