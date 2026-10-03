import assert from "node:assert/strict";
import test from "node:test";
import {
  countRoomsLeft,
  describeHotelStay,
  findSoldOutNights,
  formatMealPlan,
  getOccupiedNights,
  isBookableRoomType,
  quoteHotelRooms,
  sortRoomRates,
  splitGuestsAcrossRooms,
  summarizeHotelRooms,
  type RoomClaim,
  type RoomTypeForPricing,
} from "./hotel-rooms.ts";
import { insertStayRoomTypeSchema, publicBookingRequestSchema } from "./schema.ts";

const deluxe: RoomTypeForPricing = {
  id: "rt-deluxe",
  name: "Deluxe Double",
  maxGuests: 2,
  roomCount: 3,
  rates: [
    { mealPlan: "HB", price: 140, singlePrice: 100 },
    { mealPlan: "BB", price: 110 },
  ],
};

const family: RoomTypeForPricing = {
  id: "rt-family",
  name: "Family Suite",
  maxGuests: 4,
  roomCount: 1,
  rates: [{ mealPlan: "FB", price: 260 }],
};

test("guests are spread over rooms as evenly as possible, fullest first", () => {
  assert.deepEqual(splitGuestsAcrossRooms(5, 3), [2, 2, 1]);
  assert.deepEqual(splitGuestsAcrossRooms(4, 2), [2, 2]);
  assert.deepEqual(splitGuestsAcrossRooms(1, 1), [1]);
  assert.deepEqual(splitGuestsAcrossRooms(3, 0), []);
});

test("a hotel quote charges each room for each night on the chosen meal plan", () => {
  const quote = quoteHotelRooms({ roomType: deluxe, mealPlan: "BB", rooms: 2, guests: 4, nights: 3 });
  assert.equal(quote.ok, true);
  if (!quote.ok) return;
  assert.equal(quote.nightlyTotal, 220);
  assert.equal(quote.snapshot.accommodationTotal, 660);
  assert.deepEqual(quote.snapshot.guestsPerRoom, [2, 2]);
  assert.deepEqual(quote.snapshot.nightlyRoomPrices, [110, 110]);
  assert.equal(quote.snapshot.roomTypeName, "Deluxe Double");
  assert.equal(quote.snapshot.mealPlan, "BB");
});

test("a room with one guest is charged the single price when the hotel set one", () => {
  const quote = quoteHotelRooms({ roomType: deluxe, mealPlan: "HB", rooms: 2, guests: 3, nights: 2 });
  assert.equal(quote.ok, true);
  if (!quote.ok) return;
  assert.deepEqual(quote.snapshot.guestsPerRoom, [2, 1]);
  assert.deepEqual(quote.snapshot.nightlyRoomPrices, [140, 100]);
  assert.equal(quote.snapshot.accommodationTotal, 480);

  // No single price on bed & breakfast: one guest pays the room's price.
  const solo = quoteHotelRooms({ roomType: deluxe, mealPlan: "BB", rooms: 1, guests: 1, nights: 1 });
  assert.equal(solo.ok && solo.snapshot.accommodationTotal, 110);
});

test("a hotel quote refuses what the room can't take, and says why", () => {
  const cases: Array<[Parameters<typeof quoteHotelRooms>[0], RegExp]> = [
    [{ roomType: deluxe, mealPlan: "FB", rooms: 1, guests: 2, nights: 1 }, /isn't offered on full board \(FB\)\./],
    [{ roomType: deluxe, mealPlan: null, rooms: 1, guests: 2, nights: 1 }, /Choose a meal plan/],
    [{ roomType: deluxe, mealPlan: "BB", rooms: 1, guests: 3, nights: 1 }, /sleeps up to 2 guests per room, so 3 guests need 2 rooms/],
    [{ roomType: deluxe, mealPlan: "BB", rooms: 3, guests: 2, nights: 1 }, /Each room needs at least one guest/],
    [{ roomType: deluxe, mealPlan: "BB", rooms: 4, guests: 8, nights: 1 }, /Up to 3 rooms/],
    [{ roomType: deluxe, mealPlan: "BB", rooms: 0, guests: 2, nights: 1 }, /how many rooms/],
    [{ roomType: deluxe, mealPlan: "BB", rooms: 1, guests: 2, nights: 0 }, /check-in and check-out/],
    [{ roomType: { ...deluxe, isActive: false }, mealPlan: "BB", rooms: 1, guests: 2, nights: 1 }, /can't be booked/],
  ];
  for (const [params, message] of cases) {
    const quote = quoteHotelRooms(params);
    assert.equal(quote.ok, false, `expected a refusal for ${JSON.stringify(params)}`);
    if (!quote.ok) assert.match(quote.error, message);
  }
});

test("meal plans read as words, in the order guests expect", () => {
  assert.equal(formatMealPlan("HB"), "Half board (HB)");
  assert.equal(formatMealPlan("nope"), "");
  assert.deepEqual(sortRoomRates([{ mealPlan: "AI" }, { mealPlan: "BB" }, { mealPlan: "RO" }]).map((rate) => rate.mealPlan), ["RO", "BB", "AI"]);
  assert.equal(describeHotelStay({ rooms: 2, roomTypeName: "Deluxe Double", mealPlan: "HB" }), "2 × Deluxe Double · Half board (HB)");
  assert.equal(describeHotelStay({ rooms: 1, roomTypeName: "Family Suite", mealPlan: "FB" }), "Family Suite · Full board (FB)");
});

test("a hotel's summary: lowest room price, rooms, guests and meal plans on offer", () => {
  const closed: RoomTypeForPricing = { id: "rt-closed", name: "Closed", maxGuests: 2, roomCount: 5, rates: [{ mealPlan: "RO", price: 20 }], isActive: false };
  const summary = summarizeHotelRooms([deluxe, family, closed]);
  assert.equal(summary.fromPrice, 110);
  assert.equal(summary.totalRooms, 4);
  assert.equal(summary.guestCapacity, 3 * 2 + 4);
  assert.equal(summary.largestRoom, 4);
  assert.deepEqual(summary.mealPlans, ["BB", "HB", "FB"]);
  assert.equal(summary.roomTypeCount, 2);
  assert.equal(isBookableRoomType(closed), false);
  assert.equal(isBookableRoomType({ ...deluxe, rates: [] }), false);
  assert.equal(summarizeHotelRooms([]).fromPrice, null);
});

test("a stay occupies the nights from check-in to the night before check-out", () => {
  assert.deepEqual(getOccupiedNights("2027-03-10", "2027-03-13"), { firstNight: "2027-03-10", lastNight: "2027-03-12" });
  assert.deepEqual(getOccupiedNights("2027-03-10", "2027-03-10"), { firstNight: "2027-03-10", lastNight: "2027-03-10" });
  assert.deepEqual(getOccupiedNights("2027-12-31", "2028-01-02"), { firstNight: "2027-12-31", lastNight: "2028-01-01" });
});

test("rooms left are the fewest free on any night of the stay", () => {
  const claims: RoomClaim[] = [
    { roomTypeId: "rt-deluxe", rooms: 1, firstNight: "2027-03-10", lastNight: "2027-03-12" },
    { roomTypeId: "rt-deluxe", rooms: 1, firstNight: "2027-03-12", lastNight: "2027-03-14" },
    { roomTypeId: "rt-family", rooms: 1, firstNight: "2027-03-01", lastNight: "2027-03-30" },
  ];
  assert.equal(countRoomsLeft(deluxe, claims, "2027-03-10", "2027-03-11"), 2);
  // On the 12th both bookings hold a room.
  assert.equal(countRoomsLeft(deluxe, claims, "2027-03-10", "2027-03-14"), 1);
  assert.equal(countRoomsLeft(deluxe, claims, "2027-03-15", "2027-03-16"), 3);
  assert.equal(countRoomsLeft(family, claims, "2027-03-10", "2027-03-11"), 0);
  // A claim with no count holds every room of its type; with no type, the whole hotel.
  assert.equal(countRoomsLeft(deluxe, [{ roomTypeId: "rt-deluxe", rooms: null, firstNight: "2027-03-10", lastNight: "2027-03-10" }], "2027-03-10", "2027-03-10"), 0);
  assert.equal(countRoomsLeft(deluxe, [{ roomTypeId: null, rooms: null, firstNight: "2027-03-11", lastNight: "2027-03-11" }], "2027-03-10", "2027-03-12"), 0);
  // Never negative, even if more rooms were sold than the hotel now lists.
  assert.equal(countRoomsLeft({ id: "rt-deluxe", roomCount: 1 }, claims, "2027-03-12", "2027-03-12"), 0);
});

test("sold-out nights are the nights no bookable room is left anywhere in the hotel", () => {
  const claims: RoomClaim[] = [
    { roomTypeId: "rt-deluxe", rooms: 3, firstNight: "2027-04-01", lastNight: "2027-04-03" },
    { roomTypeId: "rt-family", rooms: 1, firstNight: "2027-04-02", lastNight: "2027-04-05" },
    { roomTypeId: null, rooms: null, firstNight: "2027-04-08", lastNight: "2027-04-08" },
  ];
  assert.deepEqual(findSoldOutNights([deluxe, family], claims, "2027-03-30", "2027-04-10"), [
    { startDate: "2027-04-02", endDate: "2027-04-03" },
    { startDate: "2027-04-08", endDate: "2027-04-08" },
  ]);
  assert.deepEqual(findSoldOutNights([], claims, "2027-03-30", "2027-04-10"), []);
});

test("a room type needs a name, rooms, guests and a price for each meal plan it offers", () => {
  const valid = insertStayRoomTypeSchema.parse({
    name: "Deluxe Double",
    maxGuests: 2,
    roomCount: 3,
    rates: [{ mealPlan: "BB", price: 110 }, { mealPlan: "HB", price: 140, singlePrice: 100 }],
  });
  assert.equal(valid.rates.length, 2);

  const refusals: Array<[Record<string, unknown>, RegExp]> = [
    [{ name: "Deluxe", maxGuests: 2, roomCount: 3, rates: [] }, /at least one meal plan/],
    [{ name: "Deluxe", maxGuests: 2, roomCount: 3, rates: [{ mealPlan: "BB", price: 100 }, { mealPlan: "BB", price: 90 }] }, /only one price/],
    [{ name: "Deluxe", maxGuests: 2, roomCount: 3, rates: [{ mealPlan: "BB", price: 100, singlePrice: 120 }] }, /can't be more than the room's price/],
    [{ name: "Deluxe", maxGuests: 2, roomCount: 3, rates: [{ mealPlan: "XX", price: 100 }] }, /Invalid enum value/],
    [{ name: "Deluxe", maxGuests: 0, roomCount: 3, rates: [{ mealPlan: "BB", price: 100 }] }, /at least one guest/],
    [{ name: "Deluxe", maxGuests: 2, roomCount: 0, rates: [{ mealPlan: "BB", price: 100 }] }, /at least one room/],
  ];
  for (const [input, message] of refusals) {
    const result = insertStayRoomTypeSchema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error.issues.map((issue) => issue.message).join(" | "), message);
  }
});

test("a guest's booking request may name a room type, rooms and meal plan, never the hotel's prices", () => {
  const payload = publicBookingRequestSchema.parse({
    accommodationId: "stay-hotel",
    guestName: "Jane Doe",
    checkIn: "2027-05-01",
    checkOut: "2027-05-03",
    guests: 2,
    selectedServices: [],
    roomTypeId: "rt-deluxe",
    roomCount: 1,
    mealPlan: "HB",
    hotelStay: { accommodationTotal: 1 },
  });
  assert.equal(payload.roomTypeId, "rt-deluxe");
  assert.equal(payload.roomCount, 1);
  assert.equal(payload.mealPlan, "HB");
  assert.equal("hotelStay" in payload, false);
  assert.throws(() => publicBookingRequestSchema.parse({
    accommodationId: "stay-hotel",
    guestName: "Jane Doe",
    checkIn: "2027-05-01",
    checkOut: "2027-05-03",
    guests: 2,
    selectedServices: [],
    mealPlan: "XX",
  }));
});
