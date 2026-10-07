// TBM's published refund rules for stays (the Refund & Cancellation page),
// so a stay's page and checkout can say what a guest gets back, and until when.

import { addCalendarDays, daysBetweenCalendarDates } from "./calendar-dates.ts";

/** Refund for cancelling at least `daysBefore` days before arrival. */
export const stayRefundTiers = [
  { daysBefore: 31, refundPercent: 80 }, // more than 30 days
  { daysBefore: 21, refundPercent: 70 }, // 21 to 30 days
  { daysBefore: 14, refundPercent: 60 }, // 14 to 20 days
  { daysBefore: 7, refundPercent: 50 }, // 7 to 13 days
  { daysBefore: 2, refundPercent: 30 }, // 2 to 6 days
  { daysBefore: 0, refundPercent: 0 }, // less than 48 hours
] as const;

export type StayRefundNow = {
  /** What cancelling today returns, as a percentage of what was paid. */
  refundPercent: number;
  /** The last day that refund still applies, or null once there's no refund. */
  lastDay: string | null;
};

/** The refund a guest gets by cancelling today, for a stay arriving on `checkIn`. */
export function stayRefundIfCancelledToday(checkIn: string, today: string): StayRefundNow {
  const daysBefore = daysBetweenCalendarDates(today, checkIn);
  const tier = stayRefundTiers.find((candidate) => daysBefore >= candidate.daysBefore) ?? stayRefundTiers[stayRefundTiers.length - 1];
  return {
    refundPercent: tier.refundPercent,
    lastDay: tier.refundPercent > 0 ? addCalendarDays(checkIn, -tier.daysBefore) : null,
  };
}
