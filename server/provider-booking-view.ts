// What a provider sees of a guest's booking: the booking reference, when, how
// many guests, and what to deliver. Guests pay TBM and talk to TBM, so the
// guest's phone, email, payment details, totals and TBM's internal notes stay
// with TBM. The provider gets a payment stage instead of payment fields, and the
// guest's first name and surname initial so they can greet them; TBM shares the
// full name only through a recorded release. Contact details a guest writes into
// a request are removed before a provider sees it.

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

// "Jane Wanjiru" → "Jane W."; one name stays as it is. A name that looks like an
// email or a phone number is not passed on.
export function partnerGuestName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || /@|\d{5,}/.test(parts.join(" "))) {
    return "Guest";
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

// Older alerts were written with the guest's full name.
export function withPartnerGuestName(text: string, fullName: string | null | undefined) {
  const name = fullName?.trim();
  return name ? text.split(name).join(partnerGuestName(name)) : text;
}

export const CONTACT_REMOVED = "[contact details removed – message TBM]";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Nine or more digits, allowing a leading +, spaces, dots, dashes and brackets
// between them: 0712 345 678, +254 (0) 712-345-678, wa.me/254712345678.
const phonePattern = /\+?\d(?:[\s().-]*\d){8,}/g;

// Guests sometimes type their number or email into a request. Providers reach
// guests through TBM, so those details are taken out of what a provider reads.
export function removeContactDetails(text: string): string;
export function removeContactDetails(text: string | null | undefined): string | null | undefined;
export function removeContactDetails(text: string | null | undefined) {
  if (!text) {
    return text;
  }
  return text.replace(emailPattern, CONTACT_REMOVED).replace(phonePattern, CONTACT_REMOVED);
}

function withoutContactInSelections(selections: unknown) {
  if (!Array.isArray(selections)) {
    return selections;
  }
  return selections.map((selection) =>
    selection && typeof selection === "object" && "serviceRequestDetails" in selection
      ? { ...selection, serviceRequestDetails: removeContactDetails((selection as { serviceRequestDetails?: string | null }).serviceRequestDetails) }
      : selection,
  );
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
  if ("guestName" in view) {
    view.guestName = partnerGuestName(view.guestName as string | null);
  }
  if ("serviceRequestDetails" in view) {
    view.serviceRequestDetails = removeContactDetails(view.serviceRequestDetails as string | null);
  }
  if ("stayServiceSelections" in view) {
    view.stayServiceSelections = withoutContactInSelections(view.stayServiceSelections);
  }
  view.paymentStage = getProviderPaymentStage(source);
  return view as ProviderBooking;
}

// The job itself, without what the guest paid for it.
export function toProviderAssignment<T extends { grossAmount?: unknown; serviceConfig?: unknown }>(assignment: T): Omit<T, "grossAmount"> {
  const { grossAmount: _gross, ...rest } = assignment;
  const config = rest.serviceConfig as { serviceRequestDetails?: string | null } | null | undefined;
  if (config && typeof config === "object" && config.serviceRequestDetails) {
    return { ...rest, serviceConfig: { ...config, serviceRequestDetails: removeContactDetails(config.serviceRequestDetails) } } as Omit<T, "grossAmount">;
  }
  return rest;
}

// A provider's payout statement: what TBM pays them, the value of the service
// it comes from, their agreed rate, and where each payout stands. Not TBM's fee
// amount, the guest's payment total or details, the provider's own email or
// TBM's internal notes.
export const providerPayoutFields = [
  "id",
  "assignmentId",
  "bookingId",
  "providerCategory",
  "serviceId",
  "serviceName",
  "commissionPercent",
  "payoutAmount",
  "status",
  "dueAt",
  "paidAt",
  "paymentMethod",
  "paymentReference",
  "createdAt",
  "updatedAt",
  "rateAgreed",
] as const;

export type ProviderPayout = Record<(typeof providerPayoutFields)[number], unknown>;

export function toProviderPayout(payout: object): ProviderPayout & { serviceValue: number | null } {
  const source = payout as Record<string, unknown>;
  const view: Record<string, unknown> = {};
  for (const field of providerPayoutFields) {
    if (field in source) {
      view[field] = source[field];
    }
  }
  view.serviceValue = typeof source.grossAmount === "number" ? source.grossAmount : null;
  // Until a rate is agreed, a payout has no amount to show, not a 0% one.
  if (source.rateAgreed === false) {
    view.payoutAmount = null;
    view.commissionPercent = null;
  }
  return view as ProviderPayout & { serviceValue: number | null };
}

type PaymentData = {
  totalProjectedPayouts: number;
  totalPendingPayouts: number;
  totalApprovedPayouts: number;
  totalPaidOut: number;
  unpaidPayoutCount: number;
  paidPayoutCount: number;
  awaitingRateCount: number;
  awaitingRateValue: number;
  serviceFeePercents: number[];
  payouts: object[];
};

export function toProviderPaymentData(data: PaymentData) {
  return {
    totalProjectedPayouts: data.totalProjectedPayouts,
    totalPendingPayouts: data.totalPendingPayouts,
    totalApprovedPayouts: data.totalApprovedPayouts,
    totalPaidOut: data.totalPaidOut,
    unpaidPayoutCount: data.unpaidPayoutCount,
    paidPayoutCount: data.paidPayoutCount,
    awaitingRateCount: data.awaitingRateCount,
    awaitingRateValue: data.awaitingRateValue,
    serviceFeePercents: data.serviceFeePercents,
    payouts: data.payouts.map(toProviderPayout),
  };
}

type InboxText = { title: string; body: string; actorRole?: string | null; metadata?: Record<string, unknown> | null };

// An inbox alert as a provider reads it: the guest's short name, and no contact
// details unless TBM wrote them. Covers alerts written before these rules.
export function toPartnerInboxItem<T extends InboxText>(item: T): T {
  const fullName = typeof item.metadata?.guestName === "string" ? item.metadata.guestName : null;
  const clean = (text: string) => {
    const named = withPartnerGuestName(text, fullName);
    return item.actorRole === "admin" ? named : removeContactDetails(named);
  };
  return {
    ...item,
    title: clean(item.title),
    body: clean(item.body),
    metadata: item.metadata && fullName ? { ...item.metadata, guestName: partnerGuestName(fullName) } : item.metadata,
  };
}
