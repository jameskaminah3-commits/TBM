// shared/stay-rules.ts
//
// What a guest needs to know before booking a stay, set by each hotel or
// host for their own place: who can stay (children, and from what age), the
// shortest booking, what's needed at check-in, and the house rules. No two
// places have the same ones, so nothing here is assumed: a rule that isn't
// set isn't shown, and isn't applied.
//
// What a hotel charges for a child, and the ages that price is for, are
// with its rates (shared/hotel-rooms.ts). Refunds are TBM's, the same for
// every stay, and aren't set here.

import { formatKenyaClockTime } from "./calendar-dates.ts";
import { describeChildPolicy, hasChildRates, isHotelStay, type HotelPolicy, type RoomRate } from "./hotel-rooms.ts";

export const childrenRules = ["welcome", "adults_only"] as const;
export const allowedRules = ["allowed", "not_allowed"] as const;
export const smokingRules = ["allowed", "outside_only", "not_allowed"] as const;

export type StayRules = {
  /** The fewest nights one booking can be for. */
  minNights?: number | null;
  /** The youngest the guest making the booking can be (18, 21…). */
  minBookingAge?: number | null;
  /** Whether children can stay. */
  children?: typeof childrenRules[number] | null;
  /** Children are welcome from this age; unset, at any age. */
  minChildAge?: number | null;
  /** An entire place: children younger than this don't count towards its guests. */
  infantsUnderAge?: number | null;
  pets?: typeof allowedRules[number] | null;
  smoking?: typeof smokingRules[number] | null;
  /** Parties and events. */
  events?: typeof allowedRules[number] | null;
  /** Quiet hours, Kenya time ("22:00" to "07:00"). */
  quietFrom?: string | null;
  quietTo?: string | null;
  /** Guests show a national ID or passport when they arrive. */
  idAtCheckIn?: boolean | null;
  /** Anything else, in the host's own words. */
  note?: string | null;
};

export const STAY_RULES_NOTE_MAX = 600;

type StayForRules = {
  propertyType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  hotelPolicy?: HotelPolicy | null;
  rules?: StayRules | null;
  roomTypes?: Array<{ rates: RoomRate[] }> | null;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Whether a stay takes children at all. */
export function takesChildren(rules: StayRules | null | undefined): boolean {
  return rules?.children !== "adults_only";
}

/** A stay's rules as guests read them, in three groups; a group with nothing set is empty. */
export function describeStayRules(stay: StayForRules): {
  arrival: string[];
  children: string[];
  house: string[];
  note: string | null;
} {
  const rules = stay.rules ?? {};
  const hotel = isHotelStay(stay);
  const place = hotel ? "hotel" : "place";

  const arrival: string[] = [];
  if (stay.checkInTime) arrival.push(`Check-in from ${formatKenyaClockTime(stay.checkInTime)}`);
  if (stay.checkOutTime) arrival.push(`Check-out by ${formatKenyaClockTime(stay.checkOutTime)}`);
  if (rules.minNights && rules.minNights > 1) arrival.push(`Minimum stay: ${plural(rules.minNights, "night")}`);
  if (rules.minBookingAge) arrival.push(`The guest who books must be ${rules.minBookingAge} or older`);
  if (rules.idAtCheckIn) arrival.push("Bring your national ID or passport for check-in");

  const children: string[] = [];
  if (rules.children === "adults_only") {
    children.push(`Adults only: this ${place} doesn't take children`);
  } else {
    if (rules.minChildAge && rules.minChildAge > 0) {
      children.push(`Children aged ${rules.minChildAge} and over are welcome`);
    } else if (rules.children === "welcome") {
      children.push("Children of all ages are welcome");
    }
    if (hotel && (stay.hotelPolicy?.childMaxAge || stay.hotelPolicy?.freeUnderAge || hasChildRates(stay.roomTypes ?? []))) {
      // "Children are guests aged 3 to 11. Under 3s stay free."
      children.push(describeChildPolicy(stay.hotelPolicy).replace(/\.$/, "").replace(". ", "; ").replace("Under", "under"));
    }
    if (!hotel && rules.infantsUnderAge && rules.infantsUnderAge > 0) {
      children.push(`Children under ${rules.infantsUnderAge} don't count towards the guests`);
    }
  }

  const house: string[] = [];
  if (rules.pets) house.push(rules.pets === "allowed" ? "Pets are welcome" : "No pets");
  if (rules.smoking) {
    house.push(rules.smoking === "allowed" ? "Smoking is allowed" : rules.smoking === "outside_only" ? "Smoking outside only" : "No smoking");
  }
  if (rules.events) house.push(rules.events === "allowed" ? "Parties and events are allowed" : "No parties or events");
  if (rules.quietFrom && rules.quietTo) {
    house.push(`Quiet hours: ${formatKenyaClockTime(rules.quietFrom)} to ${formatKenyaClockTime(rules.quietTo)}`);
  }

  const note = (rules.note ?? "").trim();
  return { arrival, children, house, note: note || null };
}

/** Whether a stay has any rule to show. */
export function hasStayRules(stay: StayForRules): boolean {
  const described = describeStayRules(stay);
  return described.arrival.length + described.children.length + described.house.length > 0 || Boolean(described.note);
}

/**
 * Why a booking can't be made under a stay's rules, in words, or null when
 * it can: too few nights, or children at a place that takes adults only.
 */
export function checkBookingAgainstRules(params: {
  title: string;
  rules: StayRules | null | undefined;
  nights: number;
  /** How many of the guests are children, when the booking says. */
  children?: number | null;
}): string | null {
  const { rules, nights } = params;
  if (!rules) {
    return null;
  }
  if (rules.minNights && rules.minNights > 1 && nights < rules.minNights) {
    return `${params.title} takes bookings of ${plural(rules.minNights, "night")} or more. Please choose later check-out dates.`;
  }
  if (rules.children === "adults_only" && (params.children ?? 0) > 0) {
    return `${params.title} is for adults only, so children can't be booked in.`;
  }
  return null;
}
