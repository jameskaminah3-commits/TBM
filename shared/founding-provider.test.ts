import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDING_PROVIDER_LIMIT, rankFoundingCandidates, type FoundingCandidateInput } from "./founding-provider.ts";

const day = 24 * 60 * 60 * 1000;
const at = (iso: string, plusDays = 0) => new Date(Date.parse(iso) + plusDays * day).toISOString();
const candidate = (index: number, overrides: Partial<FoundingCandidateInput> = {}): FoundingCandidateInput => {
  const approvedAt = at("2026-10-01T09:00:00.000Z", index);
  return { userId: `p${String(index).padStart(3, "0")}`, approvedAt, verifiedAt: at(approvedAt, 10), firstPublicListingAt: at(approvedAt, 5), isSuspended: false, grantedAt: null, revokedAt: null, ...overrides };
};
const now = new Date("2027-08-01T00:00:00.000Z");

test("the first 50 approved by the cut-off are the cohort; a place isn't passed to the 51st", () => {
  const ranked = rankFoundingCandidates(Array.from({ length: 52 }, (_, index) => candidate(index, index === 3 ? { verifiedAt: null } : {})), now);
  assert.equal(ranked.filter((item) => item.rank > 0 && item.rank <= FOUNDING_PROVIDER_LIMIT).length, 50);
  assert.equal(ranked[3].eligible, false);
  assert.deepEqual(ranked[3].reasons, ["not-verified-in-time"]);
  assert.deepEqual(ranked[50].reasons, ["outside-first-50"]);
  assert.deepEqual(ranked[51].reasons, ["outside-first-50"]);
  assert.equal(ranked.filter((item) => item.eligible).length, 49);
});

test("approval after 31 March 2027 (Kenya time) is outside, even with places left", () => {
  const [onTime, late] = rankFoundingCandidates([
    candidate(0, { approvedAt: "2027-03-31T20:00:00.000Z", verifiedAt: "2027-04-02T00:00:00.000Z", firstPublicListingAt: "2027-04-01T00:00:00.000Z" }),
    candidate(1, { approvedAt: "2027-03-31T21:30:00.000Z", verifiedAt: "2027-04-02T00:00:00.000Z", firstPublicListingAt: "2027-04-01T00:00:00.000Z" }),
  ], now);
  assert.equal(onTime.eligible, true);
  assert.deepEqual(late.reasons, ["approved-after-cutoff"]);
  assert.equal(late.rank, 0);
});

test("verified and listed within 60 days of approval; still waiting while the 60 days run", () => {
  const approvedAt = "2026-11-01T09:00:00.000Z";
  const [late] = rankFoundingCandidates([candidate(0, { approvedAt, verifiedAt: at(approvedAt, 61), firstPublicListingAt: at(approvedAt, 70) })], now);
  assert.deepEqual(late.reasons, ["not-verified-in-time", "no-listing-in-time"]);
  const [waiting] = rankFoundingCandidates([candidate(0, { approvedAt, verifiedAt: null, firstPublicListingAt: null })], new Date(at(approvedAt, 20)));
  assert.deepEqual(waiting.reasons, ["waiting-for-verification", "waiting-for-listing"]);
});

test("a suspended provider, or one whose badge was removed, isn't eligible", () => {
  const ranked = rankFoundingCandidates([candidate(0, { isSuspended: true }), candidate(1, { revokedAt: "2027-01-01T00:00:00.000Z" })], now);
  assert.deepEqual(ranked.map((item) => item.reasons), [["suspended"], ["revoked"]]);
});
