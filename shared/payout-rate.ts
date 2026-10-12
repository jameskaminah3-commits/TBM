// TBM's rate is agreed with each provider for each service before any payout.
// There is no default rate: until one is recorded for that provider and
// service, the payout amount isn't known, so it can't be approved or paid and
// the provider sees "waiting for your agreed rate" rather than a figure.

export const payoutRateNotAgreedMessage =
  "Record the rate agreed with this provider for this service before approving or paying this payout.";

// A paid payout is final whatever the settings say now; any other payout
// counts only once a rate is recorded for its provider and service.
export function isPayoutRateAgreed(status: string, rateRecorded: boolean) {
  return status === "paid" || rateRecorded;
}

// Moving a payout to approved or paid needs a recorded rate.
export function payoutStatusNeedsAgreedRate(nextStatus: string | undefined, currentStatus: string, rateRecorded: boolean) {
  if (rateRecorded) return false;
  if (nextStatus !== "approved" && nextStatus !== "paid") return false;
  return nextStatus !== currentStatus;
}

export function commissionSettingKey(providerUserId: string, providerCategory: string) {
  return `${providerUserId}:${providerCategory}`;
}
