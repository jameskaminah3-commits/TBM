// zaina-platform/src/booking/pricing.ts
//
// One pricing module for every booking (I1). What Zaina quotes in a chat,
// what the payment page shows, what the team sees and what the customer is
// charged all come from quoteStay(), so they can't disagree.
//
// A room type's rules (offerings.pricing), in the business's currency, in
// minor units (KSh 8,000 is 800000):
//
//   nightly               one room for one night, for up to included_guests
//   included_guests       guests the nightly price covers, per room (default:
//                         as many as the room sleeps)
//   extra_guest_nightly   each guest above that, per night
//   weekend_nightly       Friday and Saturday nights, when they cost more
//   seasons               date ranges ("12-15" to "01-05", inclusive; they may
//                         cross the new year) with their own nightly price,
//                         extra-guest price and minimum stay. The first
//                         season listed that covers a night applies to it.
//   min_nights, max_nights
//   fees                  fixed amounts: per booking, per room, per room per
//                         night, per guest, or per guest per night (a
//                         conservancy fee, a levy)
//   deposit_percent       instead of the business's usual deposit: a share
//   deposit_fixed         or a fixed amount per booking
//
// The deposit rule is the business's own (booking settings): nothing, a
// percentage, a fixed amount or the whole price. A business that hasn't
// chosen yet has no deposit charged online (not_set).
//
// Tax comes from the business's booking settings: a percentage already
// included in its prices (shown, not added), or added on top.

import { formatMoney } from "./money.ts";
import type { BookingCurrency } from "../db/schema.ts";

export const feeBases = ["booking", "room", "room_night", "guest", "guest_night"] as const;
export type FeeBasis = (typeof feeBases)[number];

export type Season = { name: string; from: string; to: string; nightly: number; extra_guest_nightly?: number; min_nights?: number };
export type Fee = { name: string; amount: number; per: FeeBasis };

export type PricingRules = {
  nightly: number;
  included_guests?: number;
  extra_guest_nightly?: number;
  weekend_nightly?: number;
  seasons?: Season[];
  min_nights?: number;
  max_nights?: number;
  fees?: Fee[];
  deposit_percent?: number;
  deposit_fixed?: number;
};

export type DepositRule = { type: "not_set" | "none" | "percent" | "fixed" | "full"; percent?: number | null; fixedMinor?: number | null };

export type TaxRule = { name: string; percent: number; included: boolean };

export const DEFAULT_MAX_NIGHTS = 30;
const MAX_AMOUNT = 10_000_000_000; // 100 million in major units
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function validMonthDay(value: unknown): value is string {
  if (typeof value !== "string" || !MONTH_DAY.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  return day <= DAYS_IN_MONTH[month - 1];
}

/** Checks rules sent by staff or read back; returns clean rules or the first problem. */
export function validatePricingRules(input: unknown, room: { maxGuests: number }): { ok: true; rules: PricingRules } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "pricing is an object of rules" };
  const raw = input as Record<string, unknown>;
  const known = new Set(["nightly", "included_guests", "extra_guest_nightly", "weekend_nightly", "seasons", "min_nights", "max_nights", "fees", "deposit_percent", "deposit_fixed"]);
  const unknown = Object.keys(raw).find((key) => !known.has(key));
  if (unknown) return { ok: false, error: `pricing has an unknown rule: ${unknown}` };

  if (!isWhole(raw.nightly, 1, MAX_AMOUNT)) return { ok: false, error: "nightly is the price of one room for one night" };
  const rules: PricingRules = { nightly: raw.nightly };
  if (raw.included_guests !== undefined) {
    if (!isWhole(raw.included_guests, 1, room.maxGuests)) return { ok: false, error: `included_guests is 1 to ${room.maxGuests} (the guests the room sleeps)` };
    rules.included_guests = raw.included_guests;
  }
  if (raw.extra_guest_nightly !== undefined) {
    if (!isWhole(raw.extra_guest_nightly, 0, MAX_AMOUNT)) return { ok: false, error: "extra_guest_nightly is an amount" };
    rules.extra_guest_nightly = raw.extra_guest_nightly;
  }
  if (raw.weekend_nightly !== undefined) {
    if (!isWhole(raw.weekend_nightly, 1, MAX_AMOUNT)) return { ok: false, error: "weekend_nightly is an amount" };
    rules.weekend_nightly = raw.weekend_nightly;
  }
  if (raw.min_nights !== undefined) {
    if (!isWhole(raw.min_nights, 1, 60)) return { ok: false, error: "min_nights is 1 to 60" };
    rules.min_nights = raw.min_nights;
  }
  if (raw.max_nights !== undefined) {
    if (!isWhole(raw.max_nights, rules.min_nights ?? 1, 90)) return { ok: false, error: "max_nights is at least min_nights and at most 90" };
    rules.max_nights = raw.max_nights;
  }
  if (raw.deposit_percent !== undefined) {
    if (!isWhole(raw.deposit_percent, 0, 100)) return { ok: false, error: "deposit_percent is 0 to 100" };
    rules.deposit_percent = raw.deposit_percent;
  }
  if (raw.deposit_fixed !== undefined) {
    if (raw.deposit_percent !== undefined) return { ok: false, error: "a room type's deposit is a percentage or a fixed amount, not both" };
    if (!isWhole(raw.deposit_fixed, 1, MAX_AMOUNT)) return { ok: false, error: "deposit_fixed is an amount" };
    rules.deposit_fixed = raw.deposit_fixed;
  }
  if (raw.seasons !== undefined) {
    if (!Array.isArray(raw.seasons) || raw.seasons.length > 20) return { ok: false, error: "seasons is a list of up to 20" };
    rules.seasons = [];
    for (const [index, value] of raw.seasons.entries()) {
      const season = (value ?? {}) as Record<string, unknown>;
      const label = `season ${index + 1}`;
      if (typeof season.name !== "string" || !season.name.trim() || season.name.length > 40) return { ok: false, error: `${label} needs a name (up to 40 characters)` };
      if (!validMonthDay(season.from) || !validMonthDay(season.to)) return { ok: false, error: `${label}: from and to are month-day, like 12-15` };
      if (!isWhole(season.nightly, 1, MAX_AMOUNT)) return { ok: false, error: `${label} needs a nightly price` };
      const clean: Season = { name: season.name.trim(), from: season.from, to: season.to, nightly: season.nightly };
      if (season.extra_guest_nightly !== undefined) {
        if (!isWhole(season.extra_guest_nightly, 0, MAX_AMOUNT)) return { ok: false, error: `${label}: extra_guest_nightly is an amount` };
        clean.extra_guest_nightly = season.extra_guest_nightly;
      }
      if (season.min_nights !== undefined) {
        if (!isWhole(season.min_nights, 1, 60)) return { ok: false, error: `${label}: min_nights is 1 to 60` };
        clean.min_nights = season.min_nights;
      }
      rules.seasons.push(clean);
    }
  }
  if (raw.fees !== undefined) {
    if (!Array.isArray(raw.fees) || raw.fees.length > 10) return { ok: false, error: "fees is a list of up to 10" };
    rules.fees = [];
    for (const [index, value] of raw.fees.entries()) {
      const fee = (value ?? {}) as Record<string, unknown>;
      const label = `fee ${index + 1}`;
      if (typeof fee.name !== "string" || !fee.name.trim() || fee.name.length > 60) return { ok: false, error: `${label} needs a name (up to 60 characters)` };
      if (!isWhole(fee.amount, 1, MAX_AMOUNT)) return { ok: false, error: `${label} needs an amount` };
      if (!feeBases.includes(fee.per as FeeBasis)) return { ok: false, error: `${label}: per is one of ${feeBases.join(", ")}` };
      rules.fees.push({ name: fee.name.trim(), amount: fee.amount, per: fee.per as FeeBasis });
    }
  }
  return { ok: true, rules };
}

// ── Dates ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date ("2026-12-24") as a UTC midnight, or null if it isn't one. */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
export const nightsBetween = (checkIn: Date, checkOut: Date) => Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);

/** The nights of a stay: each date slept, check-in included, check-out not. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const start = parseDate(checkIn);
  const end = parseDate(checkOut);
  if (!start || !end) return [];
  const nights: string[] = [];
  for (let night = start; night < end; night = addDays(night, 1)) nights.push(isoDate(night));
  return nights;
}

function seasonFor(night: string, seasons: Season[] | undefined): Season | null {
  const day = night.slice(5);
  return seasons?.find((season) => (season.from <= season.to ? day >= season.from && day <= season.to : day >= season.from || day <= season.to)) ?? null;
}

// ── Quotes ────────────────────────────────────────────────────────────

export type QuoteLine = { label: string; amount: number; display: string; kind: "rooms" | "extra_guests" | "service" | "people" | "fee" | "tax"; included?: boolean };

export type StayQuote = {
  currency: BookingCurrency;
  check_in: string;
  check_out: string;
  nights: number;
  units: number;
  guests: number;
  /** Each night: one room's price, and the extra guests' charge for the booking. */
  per_night: Array<{ night: string; room: number; extra_guests: number; season: string | null }>;
  lines: QuoteLine[];
  rooms_total: number;
  extra_guests_total: number;
  fees_total: number;
  tax: { name: string; percent: number; included: boolean; amount: number } | null;
  total: number;
  /** How the deposit was worked out; older quotes have only deposit_percent. */
  deposit_rule?: DepositRule["type"];
  /** The deposit's share of the total, when it is a percentage (0 none, 100 in full). */
  deposit_percent: number | null;
  deposit: number;
  balance: number;
  total_display: string;
  deposit_display: string;
  balance_display: string;
};

export type QuoteProblem = { error: "invalid_dates" | "min_nights" | "max_nights" | "too_many_guests" | "too_few_guests"; message: string; min_nights?: number; max_nights?: number; max_guests?: number };

export type StayRequest = { checkIn: string; checkOut: string; guests: number; units: number };

/**
 * The price of a stay: every night priced by its season or weekday, extra
 * guests, fees, tax and the deposit. Checks the stay fits the room's rules
 * (nights and guests), not whether rooms are free (availability.ts does).
 */
export function quoteStay(input: {
  rules: PricingRules;
  room: { maxGuests: number };
  stay: StayRequest;
  currency: BookingCurrency;
  tax: TaxRule | null;
  deposit: DepositRule;
  /** The longest stay, unless the room type says otherwise. */
  maxNights?: number;
}): { ok: true; quote: StayQuote } | ({ ok: false } & QuoteProblem) {
  const { rules, room, stay, currency } = input;
  const start = parseDate(stay.checkIn);
  const end = parseDate(stay.checkOut);
  if (!start || !end || end <= start) {
    return { ok: false, error: "invalid_dates", message: "Check-out must be a date after check-in (YYYY-MM-DD)." };
  }
  const nights = nightsOf(stay.checkIn, stay.checkOut);
  const units = stay.units;
  if (!Number.isInteger(units) || units < 1) return { ok: false, error: "too_few_guests", message: "At least one room." };
  if (!Number.isInteger(stay.guests) || stay.guests < units) {
    return { ok: false, error: "too_few_guests", message: `${units} room${units === 1 ? "" : "s"} need at least ${units} guest${units === 1 ? "" : "s"}.` };
  }
  const maxGuests = room.maxGuests * units;
  if (stay.guests > maxGuests) {
    return { ok: false, error: "too_many_guests", max_guests: maxGuests, message: `${units === 1 ? "This room sleeps" : `${units} of these rooms sleep`} up to ${maxGuests} guest${maxGuests === 1 ? "" : "s"}.` };
  }

  const seasonal = nights.map((night) => seasonFor(night, rules.seasons));
  const minNights = Math.max(rules.min_nights ?? 1, ...seasonal.map((season) => season?.min_nights ?? 1));
  if (nights.length < minNights) {
    const season = seasonal.find((entry) => (entry?.min_nights ?? 0) === minNights);
    return { ok: false, error: "min_nights", min_nights: minNights, message: `The minimum stay is ${minNights} nights${season ? ` in ${season.name}` : ""}.` };
  }
  const maxNights = rules.max_nights ?? input.maxNights ?? DEFAULT_MAX_NIGHTS;
  if (nights.length > maxNights) {
    return { ok: false, error: "max_nights", max_nights: maxNights, message: `The longest stay that can be booked is ${maxNights} nights.` };
  }

  const included = (rules.included_guests ?? room.maxGuests) * units;
  const extraGuests = Math.max(0, stay.guests - included);
  const perNight = nights.map((night, index) => {
    const season = seasonal[index];
    const weekday = parseDate(night)!.getUTCDay();
    const weekend = weekday === 5 || weekday === 6;
    const roomPrice = season?.nightly ?? (weekend && rules.weekend_nightly ? rules.weekend_nightly : rules.nightly);
    const extraRate = season?.extra_guest_nightly ?? rules.extra_guest_nightly ?? 0;
    return { night, room: roomPrice, extra_guests: extraGuests * extraRate, season: season?.name ?? null };
  });

  const roomsTotal = perNight.reduce((sum, night) => sum + night.room * units, 0);
  const extraTotal = perNight.reduce((sum, night) => sum + night.extra_guests, 0);
  const fees = (rules.fees ?? []).map((fee) => {
    const count = { booking: 1, room: units, room_night: units * nights.length, guest: stay.guests, guest_night: stay.guests * nights.length }[fee.per];
    return { fee, amount: fee.amount * count, count };
  });
  const feesTotal = fees.reduce((sum, entry) => sum + entry.amount, 0);
  const gross = roomsTotal + extraTotal + feesTotal;

  let tax: StayQuote["tax"] = null;
  let total = gross;
  if (input.tax && input.tax.percent > 0) {
    const amount = input.tax.included
      ? Math.round((gross * input.tax.percent) / (100 + input.tax.percent))
      : Math.round((gross * input.tax.percent) / 100);
    tax = { name: input.tax.name, percent: input.tax.percent, included: input.tax.included, amount };
    if (!input.tax.included) total = gross + amount;
  }

  const rule = depositRuleFor(rules, input.deposit);
  const deposit = depositOf(total, rule);
  const money = (amount: number) => formatMoney(amount, currency);

  const rates = [...new Set(perNight.map((night) => night.room))].sort((a, b) => a - b);
  const rateText = rates.length === 1 ? `${money(rates[0])} a night` : `${money(rates[0])}–${money(rates.at(-1)!)} a night`;
  const nightsText = `${nights.length} night${nights.length === 1 ? "" : "s"}`;
  const lines: QuoteLine[] = [
    { kind: "rooms", label: `${units > 1 ? `${units} rooms × ` : ""}${nightsText} (${rateText})`, amount: roomsTotal, display: money(roomsTotal) },
  ];
  if (extraTotal > 0) {
    lines.push({ kind: "extra_guests", label: `${extraGuests} extra guest${extraGuests === 1 ? "" : "s"} × ${nightsText}`, amount: extraTotal, display: money(extraTotal) });
  }
  const basisText: Record<FeeBasis, (count: number) => string> = {
    booking: () => "",
    room: (count) => (count > 1 ? ` (${count} rooms)` : ""),
    room_night: (count) => ` (${count} room night${count === 1 ? "" : "s"})`,
    guest: (count) => ` (${count} guest${count === 1 ? "" : "s"})`,
    guest_night: (count) => ` (${count} guest night${count === 1 ? "" : "s"})`,
  };
  for (const entry of fees) {
    lines.push({ kind: "fee", label: `${entry.fee.name}${basisText[entry.fee.per](entry.count)}`, amount: entry.amount, display: money(entry.amount) });
  }
  if (tax) {
    lines.push(tax.included
      ? { kind: "tax", label: `Includes ${tax.name} ${tax.percent}%`, amount: tax.amount, display: money(tax.amount), included: true }
      : { kind: "tax", label: `${tax.name} ${tax.percent}%`, amount: tax.amount, display: money(tax.amount) });
  }

  return {
    ok: true,
    quote: {
      currency,
      check_in: stay.checkIn,
      check_out: stay.checkOut,
      nights: nights.length,
      units,
      guests: stay.guests,
      per_night: perNight,
      lines,
      rooms_total: roomsTotal,
      extra_guests_total: extraTotal,
      fees_total: feesTotal,
      tax,
      total,
      deposit_rule: rule.type,
      deposit_percent: depositPercentOf(rule),
      deposit,
      balance: total - deposit,
      total_display: money(total),
      deposit_display: money(deposit),
      balance_display: money(total - deposit),
    },
  };
}

/** The deposit rule for a room type: its own, or the business's. */
export function depositRuleFor(rules: Pick<PricingRules, "deposit_percent" | "deposit_fixed">, business: DepositRule): DepositRule {
  if (rules.deposit_fixed !== undefined) return { type: "fixed", fixedMinor: rules.deposit_fixed };
  if (rules.deposit_percent !== undefined) {
    return rules.deposit_percent === 0 ? { type: "none" } : rules.deposit_percent >= 100 ? { type: "full" } : { type: "percent", percent: rules.deposit_percent };
  }
  return business;
}

/** The deposit on a total, rounded to whole shillings (or dollars). */
export function depositOf(total: number, rule: DepositRule): number {
  switch (rule.type) {
    case "full":
      return total;
    case "percent": {
      const percent = rule.percent ?? 0;
      return percent >= 100 ? total : Math.min(total, Math.round((total * percent) / 10_000) * 100);
    }
    case "fixed":
      return Math.min(total, rule.fixedMinor ?? 0);
    default:
      return 0;
  }
}

export function depositPercentOf(rule: DepositRule): number | null {
  if (rule.type === "percent") return rule.percent ?? 0;
  if (rule.type === "full") return 100;
  if (rule.type === "none" || rule.type === "not_set") return 0;
  return null;
}

/** A quote's deposit rule, including quotes saved before rules had types. */
export function ruleOfQuote(quote: Pick<StayQuote, "deposit_rule" | "deposit_percent" | "deposit">): DepositRule {
  if (quote.deposit_rule === "fixed") return { type: "fixed", fixedMinor: quote.deposit };
  if (quote.deposit_rule) return { type: quote.deposit_rule, percent: quote.deposit_percent };
  const percent = quote.deposit_percent ?? 0;
  return percent === 0 ? { type: "none" } : percent >= 100 ? { type: "full" } : { type: "percent", percent };
}

/** The lowest price a room type is ever offered at, for a night: "from KSh 6,500". */
export function fromNightly(rules: PricingRules): number {
  return Math.min(rules.nightly, ...(rules.seasons ?? []).map((season) => season.nightly));
}

/**
 * A quote the team changed when accepting a request (request then quote):
 * the new total replaces the calculated one, and the deposit follows it.
 */
export function withAgreedTotal(quote: StayQuote, total: number, note: string | null): StayQuote {
  const deposit = depositOf(total, ruleOfQuote(quote));
  const money = (amount: number) => formatMoney(amount, quote.currency);
  const difference = total - quote.total;
  if (difference === 0) return quote;
  // Tax included in prices is shown for the new total; tax added on top stays
  // a line of the sum, and the difference is its own line.
  const tax = quote.tax?.included ? { ...quote.tax, amount: Math.round((total * quote.tax.percent) / (100 + quote.tax.percent)) } : quote.tax;
  const lines: QuoteLine[] = [
    ...quote.lines.filter((line) => !(line.kind === "tax" && line.included)),
    { kind: "fee", label: `${difference < 0 ? "Agreed price" : "Agreed extras"}${note ? `: ${note}` : ""}`, amount: difference, display: money(difference) },
    ...(tax?.included ? [{ kind: "tax" as const, label: `Includes ${tax.name} ${tax.percent}%`, amount: tax.amount, display: money(tax.amount), included: true }] : []),
  ];
  return { ...quote, lines, tax, total, deposit, balance: total - deposit, total_display: money(total), deposit_display: money(deposit), balance_display: money(total - deposit) };
}

// ── Time slots (Phase 5) ──────────────────────────────────────────────
//
// A service or table booking's rules (offerings.pricing), in minor units:
//
//   price            per booking (a haircut: KSh 1,500); absent: nothing
//   per_person       per person in the party (a set menu, a class)
//   fees             fixed amounts, per booking or per person
//   deposit_percent  or deposit_fixed: instead of the business's usual deposit
//
// A table booking is usually free (no price), so it has no deposit; a
// restaurant that wants one prices the booking (per person, or a fee).

export const slotFeeBases = ["booking", "guest"] as const;

export type SlotPricing = {
  price?: number;
  per_person?: number;
  fees?: Array<{ name: string; amount: number; per: (typeof slotFeeBases)[number] }>;
  deposit_percent?: number;
  deposit_fixed?: number;
};

export function validateSlotPricing(input: unknown): { ok: true; rules: SlotPricing } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, rules: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "pricing is an object of rules" };
  const raw = input as Record<string, unknown>;
  const known = new Set(["price", "per_person", "fees", "deposit_percent", "deposit_fixed"]);
  const unknown = Object.keys(raw).find((key) => !known.has(key));
  if (unknown) return { ok: false, error: `pricing has an unknown rule: ${unknown}` };
  const rules: SlotPricing = {};
  for (const key of ["price", "per_person"] as const) {
    if (raw[key] === undefined) continue;
    if (!isWhole(raw[key], 0, MAX_AMOUNT)) return { ok: false, error: `${key} is an amount` };
    rules[key] = raw[key] as number;
  }
  if (raw.deposit_percent !== undefined) {
    if (!isWhole(raw.deposit_percent, 0, 100)) return { ok: false, error: "deposit_percent is 0 to 100" };
    rules.deposit_percent = raw.deposit_percent;
  }
  if (raw.deposit_fixed !== undefined) {
    if (raw.deposit_percent !== undefined) return { ok: false, error: "the deposit is a percentage or a fixed amount, not both" };
    if (!isWhole(raw.deposit_fixed, 1, MAX_AMOUNT)) return { ok: false, error: "deposit_fixed is an amount" };
    rules.deposit_fixed = raw.deposit_fixed;
  }
  if (raw.fees !== undefined) {
    if (!Array.isArray(raw.fees) || raw.fees.length > 10) return { ok: false, error: "fees is a list of up to 10" };
    rules.fees = [];
    for (const [index, value] of raw.fees.entries()) {
      const fee = (value ?? {}) as Record<string, unknown>;
      const label = `fee ${index + 1}`;
      if (typeof fee.name !== "string" || !fee.name.trim() || fee.name.length > 60) return { ok: false, error: `${label} needs a name (up to 60 characters)` };
      if (!isWhole(fee.amount, 1, MAX_AMOUNT)) return { ok: false, error: `${label} needs an amount` };
      if (!slotFeeBases.includes(fee.per as (typeof slotFeeBases)[number])) return { ok: false, error: `${label}: per is booking or guest` };
      rules.fees.push({ name: fee.name.trim(), amount: fee.amount, per: fee.per as (typeof slotFeeBases)[number] });
    }
  }
  return { ok: true, rules };
}

export type SlotQuote = {
  kind: "slot";
  currency: BookingCurrency;
  service: string;
  starts_at: string;
  duration_minutes: number;
  party: number;
  lines: QuoteLine[];
  fees_total: number;
  tax: StayQuote["tax"];
  total: number;
  deposit_rule: DepositRule["type"];
  deposit_percent: number | null;
  deposit: number;
  balance: number;
  total_display: string;
  deposit_display: string;
  balance_display: string;
};

/** The price of a time slot: the service, the party, fees, tax and the deposit. */
export function quoteSlot(input: {
  rules: SlotPricing;
  service: string;
  startsAt: Date;
  durationMinutes: number;
  party: number;
  currency: BookingCurrency;
  tax: TaxRule | null;
  deposit: DepositRule;
}): SlotQuote {
  const { rules, party, currency } = input;
  const money = (amount: number) => formatMoney(amount, currency);
  const lines: QuoteLine[] = [];
  const price = rules.price ?? 0;
  if (price > 0) lines.push({ kind: "service", label: input.service, amount: price, display: money(price) });
  const people = (rules.per_person ?? 0) * party;
  if (people > 0) lines.push({ kind: "people", label: `${party} ${party === 1 ? "person" : "people"} × ${money(rules.per_person!)}`, amount: people, display: money(people) });
  const fees = (rules.fees ?? []).map((fee) => ({ fee, amount: fee.amount * (fee.per === "guest" ? party : 1) }));
  for (const entry of fees) {
    lines.push({ kind: "fee", label: `${entry.fee.name}${entry.fee.per === "guest" && party > 1 ? ` (${party} people)` : ""}`, amount: entry.amount, display: money(entry.amount) });
  }
  const feesTotal = fees.reduce((sum, entry) => sum + entry.amount, 0);
  const gross = price + people + feesTotal;
  let tax: StayQuote["tax"] = null;
  let total = gross;
  if (input.tax && input.tax.percent > 0 && gross > 0) {
    const amount = input.tax.included ? Math.round((gross * input.tax.percent) / (100 + input.tax.percent)) : Math.round((gross * input.tax.percent) / 100);
    tax = { name: input.tax.name, percent: input.tax.percent, included: input.tax.included, amount };
    if (!input.tax.included) total = gross + amount;
    lines.push(tax.included
      ? { kind: "tax", label: `Includes ${tax.name} ${tax.percent}%`, amount, display: money(amount), included: true }
      : { kind: "tax", label: `${tax.name} ${tax.percent}%`, amount, display: money(amount) });
  }
  const rule = depositRuleFor(rules, input.deposit);
  // Never more than the total: a free booking (most tables) has nothing to pay.
  const deposit = depositOf(total, rule);
  return {
    kind: "slot",
    currency,
    service: input.service,
    starts_at: input.startsAt.toISOString(),
    duration_minutes: input.durationMinutes,
    party,
    lines,
    fees_total: feesTotal,
    tax,
    total,
    deposit_rule: rule.type,
    deposit_percent: depositPercentOf(rule),
    deposit,
    balance: total - deposit,
    total_display: money(total),
    deposit_display: money(deposit),
    balance_display: money(total - deposit),
  };
}
