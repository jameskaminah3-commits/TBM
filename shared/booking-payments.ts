export const bookingPaymentPlanOptions = ["full", "deposit"] as const;
export type BookingPaymentPlan = typeof bookingPaymentPlanOptions[number];

export const bookingDepositPercent = 50;

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
  return booking.serviceMode === "cook-custom-menu" || booking.serviceMode === "experience-custom-offer";
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
