// shared/hotel-rooms.ts
//
// TBM lists two kinds of stay.
//
// An entire place (an apartment, a villa, a home in the Airbnb style) is
// booked whole: one booking takes the whole place, at one price per night.
//
// A hotel (or a lodge, resort or guest house) sells rooms. It has room types,
// such as "Deluxe Double" or "Family Suite", each with a number of rooms and a
// price per room per night for each meal plan it offers: room only, bed and
// breakfast, half board, full board or all inclusive. A booking takes one or
// more rooms of one type on one meal plan, and other guests can still book the
// rooms that are left.

import { addCalendarDays } from "./calendar-dates.ts";

export const stayPropertyTypes = ["entire_place", "hotel"] as const;
export type StayPropertyType = typeof stayPropertyTypes[number];

export const stayPropertyTypeLabels: Record<StayPropertyType, string> = {
  entire_place: "Entire place",
  hotel: "Hotel",
};

export function isHotelStay(stay: { propertyType?: string | null } | null | undefined): boolean {
  return stay?.propertyType === "hotel";
}

export const mealPlanCodes = ["RO", "BB", "HB", "FB", "AI"] as const;
export type MealPlanCode = typeof mealPlanCodes[number];

export const mealPlans: Record<MealPlanCode, { name: string; includes: string }> = {
  RO: { name: "Room only", includes: "No meals included" },
  BB: { name: "Bed & breakfast", includes: "Breakfast every morning" },
  HB: { name: "Half board", includes: "Breakfast and dinner every day" },
  FB: { name: "Full board", includes: "Breakfast, lunch and dinner every day" },
  AI: { name: "All inclusive", includes: "All meals, snacks and selected drinks" },
};

export function isMealPlanCode(value: unknown): value is MealPlanCode {
  return typeof value === "string" && (mealPlanCodes as readonly string[]).includes(value);
}

/** "Half board (HB)". */
export function formatMealPlan(code: string | null | undefined): string {
  return isMealPlanCode(code) ? `${mealPlans[code].name} (${code})` : "";
}

export type RoomRate = {
  mealPlan: MealPlanCode;
  /** USD per room per night, for up to the room's maximum number of guests. */
  price: number;
  /** USD per room per night when one guest has the room. The full price applies when it's unset. */
  singlePrice?: number | null;
};

/** What pricing and availability need to know about a room type. */
export type RoomTypeForPricing = {
  id: string;
  name: string;
  maxGuests: number;
  roomCount: number;
  rates: RoomRate[];
  isActive?: boolean | null;
};

/** The room, meal plan and prices a hotel booking was made at: kept with the booking. */
export type HotelStaySnapshot = {
  roomTypeId: string;
  roomTypeName: string;
  mealPlan: MealPlanCode;
  rooms: number;
  /** Guests in each room, fullest first. */
  guestsPerRoom: number[];
  /** USD per night for each room, in the same order. */
  nightlyRoomPrices: number[];
  nights: number;
  /** The rooms for every night: the accommodation part of the booking's total. */
  accommodationTotal: number;
};

/** Rates in the order guests read them: room only first, all inclusive last. */
export function sortRoomRates<T extends { mealPlan: string }>(rates: T[]): T[] {
  const order = (code: string) => {
    const index = (mealPlanCodes as readonly string[]).indexOf(code);
    return index === -1 ? mealPlanCodes.length : index;
  };
  return [...rates].sort((left, right) => order(left.mealPlan) - order(right.mealPlan));
}

export function getRoomRate(roomType: Pick<RoomTypeForPricing, "rates">, mealPlan: string | null | undefined): RoomRate | undefined {
  return (roomType.rates ?? []).find((rate) => rate.mealPlan === mealPlan);
}

/** A room type guests can book: on sale, with rooms, and with at least one rate. */
export function isBookableRoomType(roomType: RoomTypeForPricing): boolean {
  return roomType.isActive !== false
    && roomType.roomCount > 0
    && roomType.maxGuests > 0
    && (roomType.rates ?? []).some((rate) => rate.price > 0);
}

/** Guests spread over the rooms as evenly as possible, fullest room first: 5 in 3 rooms is [2, 2, 1]. */
export function splitGuestsAcrossRooms(guests: number, rooms: number): number[] {
  if (!Number.isInteger(guests) || !Number.isInteger(rooms) || rooms < 1 || guests < 0) {
    return [];
  }
  const base = Math.floor(guests / rooms);
  const extra = guests % rooms;
  return Array.from({ length: rooms }, (_, index) => base + (index < extra ? 1 : 0));
}

/** One room's price for a night, by how many guests have it. */
export function getRoomNightPrice(rate: RoomRate, guestsInRoom: number): number {
  return guestsInRoom === 1 && rate.singlePrice && rate.singlePrice > 0 ? rate.singlePrice : rate.price;
}

/** The fewest rooms that fit the guests, given how many one room sleeps. */
export function getRoomsNeeded(guests: number, maxGuestsPerRoom: number): number {
  return maxGuestsPerRoom > 0 ? Math.max(1, Math.ceil(guests / maxGuestsPerRoom)) : 0;
}

export type HotelRoomQuote =
  | { ok: true; snapshot: HotelStaySnapshot; nightlyTotal: number }
  | { ok: false; error: string };

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Prices rooms of one type on one meal plan for a number of nights. The
 * guests are spread over the rooms as evenly as possible; a room with one
 * guest is charged its single price when the hotel set one.
 */
export function quoteHotelRooms(params: {
  roomType: RoomTypeForPricing;
  mealPlan: string | null | undefined;
  rooms: number | null | undefined;
  guests: number;
  nights: number;
}): HotelRoomQuote {
  const { roomType, guests, nights } = params;
  if (!isBookableRoomType(roomType)) {
    return { ok: false, error: `${roomType.name} can't be booked at the moment. Please choose another room.` };
  }
  if (!isMealPlanCode(params.mealPlan)) {
    return { ok: false, error: "Choose a meal plan for your room." };
  }
  const rate = getRoomRate(roomType, params.mealPlan);
  if (!rate || !(rate.price > 0)) {
    return { ok: false, error: `${roomType.name} isn't offered on ${mealPlans[params.mealPlan].name.toLowerCase()} (${params.mealPlan}). Please choose another meal plan.` };
  }
  const rooms = params.rooms ?? 1;
  if (!Number.isInteger(rooms) || rooms < 1) {
    return { ok: false, error: "Choose how many rooms you need." };
  }
  if (rooms > roomType.roomCount) {
    return { ok: false, error: `Up to ${plural(roomType.roomCount, "room")} of the ${roomType.name} type can be booked.` };
  }
  if (!Number.isInteger(guests) || guests < 1) {
    return { ok: false, error: "Tell us how many guests are staying." };
  }
  if (guests < rooms) {
    return { ok: false, error: `Each room needs at least one guest: choose fewer rooms, or add guests.` };
  }
  if (guests > rooms * roomType.maxGuests) {
    const needed = getRoomsNeeded(guests, roomType.maxGuests);
    return {
      ok: false,
      error: `${roomType.name} sleeps up to ${plural(roomType.maxGuests, "guest")} per room, so ${plural(guests, "guest")} need ${plural(needed, "room")}.`,
    };
  }
  if (!Number.isInteger(nights) || nights < 1) {
    return { ok: false, error: "Choose your check-in and check-out dates." };
  }

  const guestsPerRoom = splitGuestsAcrossRooms(guests, rooms);
  const nightlyRoomPrices = guestsPerRoom.map((guestsInRoom) => getRoomNightPrice(rate, guestsInRoom));
  const nightlyTotal = nightlyRoomPrices.reduce((sum, price) => sum + price, 0);
  return {
    ok: true,
    nightlyTotal,
    snapshot: {
      roomTypeId: roomType.id,
      roomTypeName: roomType.name,
      mealPlan: params.mealPlan,
      rooms,
      guestsPerRoom,
      nightlyRoomPrices,
      nights,
      accommodationTotal: nightlyTotal * nights,
    },
  };
}

/** "2 × Deluxe Double · Half board (HB)". */
export function describeHotelStay(snapshot: Pick<HotelStaySnapshot, "rooms" | "roomTypeName" | "mealPlan"> | null | undefined): string {
  if (!snapshot) {
    return "";
  }
  const rooms = snapshot.rooms > 1 ? `${snapshot.rooms} × ${snapshot.roomTypeName}` : snapshot.roomTypeName;
  const plan = formatMealPlan(snapshot.mealPlan);
  return plan ? `${rooms} · ${plan}` : rooms;
}

export type HotelSummary = {
  /** The lowest price of a room for a night, on any meal plan: "from USD …". */
  fromPrice: number | null;
  totalRooms: number;
  /** The most guests the hotel's bookable rooms sleep together. */
  guestCapacity: number;
  /** The most guests one room sleeps. */
  largestRoom: number;
  mealPlans: MealPlanCode[];
  roomTypeCount: number;
};

export function summarizeHotelRooms(roomTypes: RoomTypeForPricing[]): HotelSummary {
  const bookable = roomTypes.filter(isBookableRoomType);
  const prices = bookable.flatMap((roomType) => roomType.rates.map((rate) => rate.price).filter((price) => price > 0));
  const offered = new Set(bookable.flatMap((roomType) => roomType.rates.filter((rate) => rate.price > 0).map((rate) => rate.mealPlan)));
  return {
    fromPrice: prices.length ? Math.min(...prices) : null,
    totalRooms: bookable.reduce((sum, roomType) => sum + roomType.roomCount, 0),
    guestCapacity: bookable.reduce((sum, roomType) => sum + roomType.roomCount * roomType.maxGuests, 0),
    largestRoom: bookable.reduce((most, roomType) => Math.max(most, roomType.maxGuests), 0),
    mealPlans: mealPlanCodes.filter((code) => offered.has(code)),
    roomTypeCount: bookable.length,
  };
}

// ─── Rooms left ─────────────────────────────────────────────────────────

/** A booking or calendar block holding hotel rooms on some nights. */
export type RoomClaim = {
  /** The room type held. Null holds every room in the hotel: the hotel is closed, or the booking took the whole stay. */
  roomTypeId: string | null;
  /** How many rooms. Null holds every room of the type. */
  rooms: number | null;
  /** The first and last nights held, inclusive ("YYYY-MM-DD"). */
  firstNight: string;
  lastNight: string;
};

/**
 * The nights a stay occupies: from check-in to the night before check-out.
 * A stay that starts and ends on the same day occupies that day.
 */
export function getOccupiedNights(checkIn: string, checkOut: string): { firstNight: string; lastNight: string } {
  return {
    firstNight: checkIn,
    lastNight: checkOut > checkIn ? addCalendarDays(checkOut, -1) : checkIn,
  };
}

/** The rooms a booking holds at a hotel. A booking with no room type took the whole stay. */
export function getBookingRoomClaim(booking: {
  checkIn: string;
  checkOut: string;
  roomTypeId?: string | null;
  roomCount?: number | null;
}): RoomClaim {
  return {
    roomTypeId: booking.roomTypeId ?? null,
    rooms: booking.roomTypeId ? Math.max(1, booking.roomCount ?? 1) : null,
    ...getOccupiedNights(booking.checkIn, booking.checkOut),
  };
}

/** The rooms a calendar block closes. Like a check-out, its end date is the day they're free again. */
export function getBlockRoomClaim(block: {
  startDate: string;
  endDate: string;
  roomTypeId?: string | null;
  roomCount?: number | null;
}): RoomClaim {
  return {
    roomTypeId: block.roomTypeId ?? null,
    rooms: block.roomTypeId ? block.roomCount ?? null : null,
    ...getOccupiedNights(block.startDate, block.endDate),
  };
}

// A guard against runaway loops on a bad date: no stay or search spans more than this.
const MAX_NIGHTS_COUNTED = 731;

function listNights(firstNight: string, lastNight: string): string[] {
  const nights: string[] = [];
  for (let night = firstNight; night <= lastNight && nights.length < MAX_NIGHTS_COUNTED; night = addCalendarDays(night, 1)) {
    nights.push(night);
  }
  return nights;
}

function roomsHeldOnNight(roomType: { id: string; roomCount: number }, claims: RoomClaim[], night: string): number {
  let held = 0;
  for (const claim of claims) {
    if (claim.firstNight > night || claim.lastNight < night) {
      continue;
    }
    if (claim.roomTypeId === null) {
      return roomType.roomCount;
    }
    if (claim.roomTypeId === roomType.id) {
      held += claim.rooms ?? roomType.roomCount;
    }
  }
  return held;
}

/** Rooms of a type still free on every night from `firstNight` to `lastNight`. */
export function countRoomsLeft(
  roomType: { id: string; roomCount: number },
  claims: RoomClaim[],
  firstNight: string,
  lastNight: string,
): number {
  let fewest = roomType.roomCount;
  for (const night of listNights(firstNight, lastNight)) {
    fewest = Math.min(fewest, roomType.roomCount - roomsHeldOnNight(roomType, claims, night));
    if (fewest <= 0) {
      return 0;
    }
  }
  return Math.max(0, fewest);
}

/**
 * The nights from `firstNight` to `lastNight` when no bookable room is left
 * in the hotel, as ranges of nights ("YYYY-MM-DD", inclusive).
 */
export function findSoldOutNights(
  roomTypes: RoomTypeForPricing[],
  claims: RoomClaim[],
  firstNight: string,
  lastNight: string,
): Array<{ startDate: string; endDate: string }> {
  const bookable = roomTypes.filter(isBookableRoomType);
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  if (bookable.length === 0) {
    return ranges;
  }
  for (const night of listNights(firstNight, lastNight)) {
    const soldOut = bookable.every((roomType) => roomsHeldOnNight(roomType, claims, night) >= roomType.roomCount);
    if (!soldOut) {
      continue;
    }
    const last = ranges[ranges.length - 1];
    if (last && addCalendarDays(last.endDate, 1) === night) {
      last.endDate = night;
    } else {
      ranges.push({ startDate: night, endDate: night });
    }
  }
  return ranges;
}
