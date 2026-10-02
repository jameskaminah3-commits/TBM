export const bookingPaymentPlanOptions = ["full", "deposit"] as const;
export type BookingPaymentPlan = typeof bookingPaymentPlanOptions[number];

// The commitment (deposit) that locks a booking's dates: 50% of the total,
// unless the team agrees another amount with the guest.
export const bookingDepositPercent = 50;

// Dates are reserved only once a payment is made. While a guest is paying
// (checkout open, or sending money by M-Pesa), their dates are held for them
// for this long, so another guest can't start paying for the same dates.
export const bookingPaymentHoldMinutes = 15;
// A manual M-Pesa payment the guest has already sent keeps the dates while
// the team checks the transaction code.
export const manualMpesaReviewHoldHours = 24;

/**
 * The team can also lock a booking's dates by hand, paid or not — a guest
 * paying by bank transfer, or on arrival, as agreed — until a moment it
 * chooses. The lock ends on its own then; a payment that comes in first
 * locks the dates as usual.
 */
export function hasActiveAdminLock(
  booking: { adminLockUntil?: string | null },
  now: number = Date.now(),
) {
  if (!booking.adminLockUntil) {
    return false;
  }

  const until = new Date(booking.adminLockUntil).getTime();
  return Number.isFinite(until) && until > now;
}

type BookingPaymentSnapshot = {
  totalPrice?: number | null;
  paymentStatus?: string | null;
  paymentDepositAmount?: number | null;
  paymentAmountPaid?: number | null;
  serviceMode?: string | null;
};

function normalizeMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

export function calculateBookingDepositAmount(
  totalPrice: number | null | undefined,
  percent: number = bookingDepositPercent,
) {
  const normalizedTotal = normalizeMoney(totalPrice);
  if (normalizedTotal <= 0) {
    return 0;
  }

  return Math.min(
    normalizedTotal,
    Math.max(1, Math.ceil((normalizedTotal * percent) / 100)),
  );
}

/**
 * The commitment the team agreed with a guest, as a percentage of the total
 * or as an amount in the booking's currency: at least 1, and less than the
 * total (paying everything is a full payment, not a commitment).
 */
export function resolveAgreedCommitment(
  totalPrice: number | null | undefined,
  agreed: { percent?: number | null; amount?: number | null },
): { amount: number } | { error: string } {
  const normalizedTotal = normalizeMoney(totalPrice);
  if (normalizedTotal <= 1) {
    return { error: "This booking's total is too small for a commitment." };
  }

  const hasPercent = typeof agreed.percent === "number";
  const hasAmount = typeof agreed.amount === "number";
  if (hasPercent === hasAmount) {
    return { error: "Give the commitment as a percentage or as an amount." };
  }

  if (hasPercent) {
    const percent = agreed.percent as number;
    if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
      return { error: "The commitment is between 1% and 99% of the total." };
    }
    return { amount: Math.min(normalizedTotal - 1, calculateBookingDepositAmount(normalizedTotal, percent)) };
  }

  const amount = agreed.amount as number;
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1 || amount >= normalizedTotal) {
    return { error: `The commitment is a whole amount from 1 to ${normalizedTotal - 1}: less than the total of ${normalizedTotal}.` };
  }
  return { amount };
}

export function isFullPaymentOnlyBooking(booking: Pick<BookingPaymentSnapshot, "serviceMode">) {
  return booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer" || booking.serviceMode === "listing-verification";
}

export function supportsBookingDeposit(booking: Pick<BookingPaymentSnapshot, "serviceMode">) {
  return !isFullPaymentOnlyBooking(booking);
}

export function getBookingAmountPaid(booking: BookingPaymentSnapshot) {
  const normalizedTotal = normalizeMoney(booking.totalPrice);
  const explicitPaidAmount = normalizeMoney(booking.paymentAmountPaid);

  if (explicitPaidAmount > 0) {
    return Math.min(normalizedTotal, explicitPaidAmount);
  }

  if ((booking.paymentStatus ?? "paid") === "paid") {
    return normalizedTotal;
  }

  return 0;
}

export function getBookingOutstandingAmount(booking: BookingPaymentSnapshot) {
  const normalizedTotal = normalizeMoney(booking.totalPrice);
  return Math.max(0, normalizedTotal - getBookingAmountPaid(booking));
}

export function getBookingCheckoutAmount(booking: BookingPaymentSnapshot) {
  const normalizedTotal = normalizeMoney(booking.totalPrice);
  if (normalizedTotal <= 0) {
    return 0;
  }

  const outstandingAmount = getBookingOutstandingAmount(booking);
  const amountPaid = getBookingAmountPaid(booking);
  const depositAmount = supportsBookingDeposit(booking) ? normalizeMoney(booking.paymentDepositAmount) : 0;
  if (depositAmount > 0 && depositAmount < normalizedTotal) {
    if (amountPaid < depositAmount) {
      return Math.min(outstandingAmount, depositAmount - amountPaid);
    }

    return outstandingAmount;
  }

  if (amountPaid > 0) {
    return outstandingAmount;
  }

  return normalizedTotal;
}

export function hasLockedInBookingDeposit(booking: BookingPaymentSnapshot) {
  const normalizedTotal = normalizeMoney(booking.totalPrice);
  const depositAmount = supportsBookingDeposit(booking) ? normalizeMoney(booking.paymentDepositAmount) : 0;
  if (depositAmount <= 0 || depositAmount >= normalizedTotal) {
    return false;
  }

  return getBookingAmountPaid(booking) >= depositAmount && getBookingOutstandingAmount(booking) > 0;
}

export function isBookingFullyPaid(booking: BookingPaymentSnapshot) {
  return getBookingOutstandingAmount(booking) === 0;
}

type RequestFeeSnapshot = BookingPaymentSnapshot & {
  serviceRequestFeeKes?: number | null;
  experienceCustomOfferClientDecision?: string | null;
};

/**
 * A request fee quoted in KSh — a custom request or a listing verification —
 * while the booking's total is that fee. Shown as quoted, paid or not: a
 * KSh 2,500 fee reads KSh 2,500, not its dollar value converted back at the
 * day's rate. Null for everything else, which is priced in USD.
 */
export function getRequestFeeKes(booking: RequestFeeSnapshot): number | null {
  const feeKes = normalizeMoney(booking.serviceRequestFeeKes);
  if (feeKes <= 0) {
    return null;
  }

  if (booking.serviceMode === "listing-verification") {
    return feeKes;
  }

  // Once a custom request's quote is accepted, the total is the balance instead.
  if (booking.serviceMode === "experience-custom-offer" && booking.experienceCustomOfferClientDecision !== "accepted") {
    return feeKes;
  }

  return null;
}

/**
 * The exact KSh amount due when what's owed is a request fee quoted in KSh.
 * The guest pays what they were told: a KSh 2,500 fee is charged as KSh 2,500.
 */
export function getRequestFeeKesDue(booking: RequestFeeSnapshot): number | null {
  return getBookingAmountPaid(booking) > 0 ? null : getRequestFeeKes(booking);
}
