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

/**
 * The published rules for services, a line each, as the Refund & Cancellation
 * Policy states them (the full policy is at /refund-cancellation).
 */
export const serviceCancellationSummaries = {
  /** Chauffeur services and airport transfers. */
  chauffeur: "Cancel more than 24 hours before for a full refund. Within 24 hours up to 50% may be charged, and there's no refund for a no-show.",
  /** Car rentals (self-drive). */
  selfDrive: "Cancel more than 72 hours before pickup for a full refund. Between 24 and 72 hours up to 50% is charged; within 24 hours, or for a no-show, there's no refund.",
  /** Curated experiences and tours. */
  experience: "More than 7 days before, you get a full or partial refund, depending on the operator. Between 2 and 7 days a partial refund may apply; within 48 hours there's no refund unless agreed.",
  /** Concierge, errands, childcare and private chefs. */
  concierge: "Cancel before any preparation starts and you may get a full refund. Once preparation or the service has begun, the refund may be reduced or unavailable.",
} as const;

export type ServiceCancellationKind = keyof typeof serviceCancellationSummaries;
