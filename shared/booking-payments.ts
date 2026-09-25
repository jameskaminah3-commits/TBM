export const bookingPaymentPlanOptions = ["full", "deposit"] as const;
export type BookingPaymentPlan = typeof bookingPaymentPlanOptions[number];

export const bookingDepositPercent = 50;

// Dates are reserved only once a payment is made. While a guest is paying
// (checkout open, or sending money by M-Pesa), their dates are held for them
// for this long, so another guest can't start paying for the same dates.
export const bookingPaymentHoldMinutes = 15;
// A manual M-Pesa payment the guest has already sent keeps the dates while
// the team checks the transaction code.
export const manualMpesaReviewHoldHours = 24;

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

export function calculateBookingDepositAmount(totalPrice: number | null | undefined) {
  const normalizedTotal = normalizeMoney(totalPrice);
  if (normalizedTotal <= 0) {
    return 0;
  }

  return Math.min(
    normalizedTotal,
    Math.max(1, Math.ceil((normalizedTotal * bookingDepositPercent) / 100)),
  );
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
