// How the provider dashboard counts work.

type QuoteDecisions = {
  customMenuClientDecision?: string | null;
  experienceCustomOfferClientDecision?: string | null;
};

// A custom menu or custom offer only becomes work once the guest accepts the
// quote; every other booking is agreed when it is made.
export function isAgreedOrder(serviceMode: string | null | undefined, booking: QuoteDecisions) {
  if (serviceMode === "cook-custom-menu") {
    return booking.customMenuClientDecision === "accepted";
  }
  if (serviceMode === "experience-custom-offer") {
    return booking.experienceCustomOfferClientDecision === "accepted";
  }
  return true;
}

// Work the provider still has to accept or decline.
export function awaitsProviderResponse(assignment: { status: string; providerResponse?: string | null }) {
  return assignment.status === "upcoming" && (assignment.providerResponse ?? "pending") === "pending";
}
