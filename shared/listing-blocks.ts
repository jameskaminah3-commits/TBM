// Dates a provider marks unavailable on a home help or experience listing.
// Stays, cars and chefs already block dates through their reservations.
import { z } from "zod";

export const listingBlockKinds = ["errand", "experience"] as const;
export type ListingBlockKind = typeof listingBlockKinds[number];

export type ListingBlockView = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: string;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const listingBlockInputSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().trim().max(120).optional().nullable(),
}).refine((value) => value.endDate >= value.startDate, { message: "The last day can't be before the first", path: ["endDate"] });

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

// Every date from start to end, both included. Capped so a mistyped year
// can't produce a huge list.
export function expandBlockDates(startDate: string, endDate: string, maxDays = 400): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate && dates.length < maxDays; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

// The dates a home help or experience booking takes up: its scheduled visits
// when it has them, otherwise every day from start to end.
export function getServiceBookingDates(booking: { checkIn: string; checkOut?: string | null; serviceScheduleSlots?: Array<{ date: string }> | null }): string[] {
  const slotDates = (booking.serviceScheduleSlots ?? []).map((slot) => slot.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (slotDates.length) return Array.from(new Set(slotDates)).sort();
  const end = booking.checkOut && booking.checkOut >= booking.checkIn ? booking.checkOut : booking.checkIn;
  return expandBlockDates(booking.checkIn, end, 60);
}
