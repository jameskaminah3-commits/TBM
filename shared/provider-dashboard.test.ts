import assert from "node:assert/strict";
import test from "node:test";
import { awaitsProviderResponse, canStartJob, formatInboxDates, getJobAlertPriority, getJobStartDate, isAgreedOrder } from "./provider-dashboard.ts";

test("ordinary bookings are agreed, finished or not", () => {
  assert.equal(isAgreedOrder("car-chauffeur-day", {}), true);
  assert.equal(isAgreedOrder(null, {}), true);
});

test("custom menus and custom offers count once the guest accepts the quote", () => {
  assert.equal(isAgreedOrder("cook-custom-menu", { customMenuClientDecision: null }), false);
  assert.equal(isAgreedOrder("cook-custom-menu", { customMenuClientDecision: "accepted" }), true);
  assert.equal(isAgreedOrder("experience-custom-offer", { experienceCustomOfferClientDecision: "declined" }), false);
  assert.equal(isAgreedOrder("experience-custom-offer", { experienceCustomOfferClientDecision: "accepted" }), true);
});

test("upcoming work the provider hasn't answered needs a response", () => {
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: "pending" }), true);
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: null }), true);
  assert.equal(awaitsProviderResponse({ status: "upcoming", providerResponse: "accepted" }), false);
  assert.equal(awaitsProviderResponse({ status: "completed", providerResponse: "pending" }), false);
});

test("a job starts on its first visit, or on the booking's first day", () => {
  assert.equal(getJobStartDate({ checkIn: "2026-11-20", serviceScheduleSlots: [] }), "2026-11-20");
  assert.equal(getJobStartDate({ checkIn: "2026-11-20", serviceScheduleSlots: [{ date: "2026-11-24" }, { date: "2026-11-22" }] }), "2026-11-22");
  assert.equal(getJobStartDate({ checkIn: null, serviceScheduleSlots: null }), null);
});

test("a job can't be marked in progress before its first day in Kenya", () => {
  assert.equal(canStartJob("2026-11-20", "2026-11-19"), false);
  assert.equal(canStartJob("2026-11-20", "2026-11-20"), true);
  assert.equal(canStartJob("2026-11-20", "2026-11-25"), true);
  assert.equal(canStartJob(null, "2026-11-25"), false);
});

test("new-job alerts are high only when the job is two days away or less", () => {
  assert.equal(getJobAlertPriority("2026-10-12", "2026-10-12"), "high");
  assert.equal(getJobAlertPriority("2026-10-14", "2026-10-12"), "high");
  assert.equal(getJobAlertPriority("2026-10-15", "2026-10-12"), "normal");
  assert.equal(getJobAlertPriority("2026-11-20", "2026-10-12"), "normal");
  assert.equal(getJobAlertPriority(null, "2026-10-12"), "normal");
});

test("older alerts read day first", () => {
  assert.equal(formatInboxDates("Jane T. needs Chef Amina on 2026-11-20 to 2026-11-22."), "Jane T. needs Chef Amina on 20 Nov – 22 Nov 2026.");
  assert.equal(formatInboxDates("Dhow trip on 2026-11-13."), "Dhow trip on 13 Nov 2026.");
  assert.equal(formatInboxDates("From 2026-12-30 to 2027-01-02"), "From 30 Dec 2026 – 2 Jan 2027");
  assert.equal(formatInboxDates("Paid at 2026-11-13T10:00:00Z"), "Paid at 2026-11-13T10:00:00Z");
});
