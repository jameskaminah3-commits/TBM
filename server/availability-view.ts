// Calendars show which dates are taken. Who took them is for TBM: a visitor
// sees "Booked", and a provider sees the booking reference of their own jobs.

type CalendarRange = {
  id: string;
  source: string;
  startDate: string;
  endDate: string;
  checkoutDate: string;
  status: string;
  guestName: string;
};

type CalendarSummary<R extends CalendarRange> = {
  blockedRanges: R[];
  [key: string]: unknown;
};

export function bookingReference(bookingId: string) {
  return bookingId.slice(0, 8).toUpperCase();
}

// Signed-out visitors: dates only, with no booking IDs or names.
export function toPublicAvailability<R extends CalendarRange, S extends CalendarSummary<R>>(summary: S) {
  return {
    ...summary,
    blockedRanges: summary.blockedRanges.map((range, index) => ({
      id: `taken-${index + 1}`,
      source: "booking" as const,
      startDate: range.startDate,
      endDate: range.endDate,
      checkoutDate: range.checkoutDate,
      status: "reserved",
      guestName: "Booked",
    })),
  };
}

// A provider's own calendar: their manual blocks as they are, their own jobs by
// booking reference, and anyone else's booking (an unpaid hold, a job from
// before the listing was theirs) as a hold with nothing that identifies it.
export function toPartnerAvailability<R extends CalendarRange, S extends CalendarSummary<R>>(
  summary: S,
  ownBookingIds: ReadonlySet<string>,
) {
  return {
    ...summary,
    blockedRanges: summary.blockedRanges.map((range, index) => {
      if (range.source !== "booking") {
        return range;
      }
      if (ownBookingIds.has(range.id)) {
        return { ...range, guestName: `Booking ${bookingReference(range.id)}` };
      }
      return { ...range, id: `held-${index + 1}`, status: "held", guestName: "Held for a guest" };
    }),
  };
}
