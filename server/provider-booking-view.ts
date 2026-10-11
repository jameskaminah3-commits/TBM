// What a provider sees of a guest's booking: who is coming, when, and what to
// deliver. The guest's email, payment details, totals and TBM's internal notes
// stay with TBM. The provider gets a payment stage instead of payment fields.

export const providerBookingFields = [
  "id",
  "bookingType",
  "accommodationId",
  "status",
  "createdAt",
  "checkIn",
  "checkOut",
  "guests",
  "roomCount",
  "roomTypeId",
  "mealPlan",
  "guestName",
  "guestPhone",
  "selectedServices",
  "stayServiceSelections",
  "serviceMode",
  "serviceAddonSelections",
  "serviceLocation",
  "servicePickupLocation",
  "serviceReturnLocation",
  "serviceStartTime",
  "serviceEndTime",
  "serviceHours",
  "serviceScheduleSlots",
  "serviceZone",
  "serviceDepartureId",
  "serviceLaundryWeightKg",
  "serviceRequestDetails",
  "serviceResponseMessage",
  "serviceBudgetAmount",
  "customMenuProposalStatus",
  "customMenuProposalMessage",
  "customMenuProposedAmount",
  "customMenuDeclineReason",
  "customMenuClientDecision",
  "customMenuClientRespondedAt",
  "experienceCustomOfferStatus",
  "experienceCustomOfferMessage",
  "experienceCustomOfferAmount",
  "experienceCustomOfferDeclineReason",
  "experienceCustomOfferClientDecision",
  "experienceCustomOfferClientRespondedAt",
  "providerStatusRequest",
  "providerStatusRequestedAt",
  "providerStatusReviewedAt",
] as const;

export type ProviderPaymentStage = "paid" | "deposit-paid" | "unpaid";

type PaymentFields = {
  paymentStatus?: string | null;
  paymentAmountPaid?: number | null;
};

export function getProviderPaymentStage(booking: PaymentFields): ProviderPaymentStage {
  if ((booking.paymentStatus ?? "paid") === "paid") {
    return "paid";
  }
  return (booking.paymentAmountPaid ?? 0) > 0 ? "deposit-paid" : "unpaid";
}

export type ProviderBooking = Record<(typeof providerBookingFields)[number], unknown> & {
  paymentStage: ProviderPaymentStage;
};

export function toProviderBooking(booking: object): ProviderBooking {
  const source = booking as Record<string, unknown> & PaymentFields;
  const view: Record<string, unknown> = {};
  for (const field of providerBookingFields) {
    if (field in source) {
      view[field] = source[field];
    }
  }
  view.paymentStage = getProviderPaymentStage(source);
  return view as ProviderBooking;
}
