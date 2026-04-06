import type { Cook } from "./schema";
import { customMenuRequestFeeDefault, customMenuRequestFeeKesDefault } from "./schema";

const USD_TO_KES_FALLBACK = 130;

function resolveUsdToKesRate(usdToKes?: number) {
  if (typeof usdToKes !== "number" || !Number.isFinite(usdToKes) || usdToKes <= 0) {
    return USD_TO_KES_FALLBACK;
  }
  return usdToKes;
}

export function getCookServiceFee(cook: Pick<Cook, "serviceFee" | "pricePerSession">) {
  return cook.serviceFee || cook.pricePerSession;
}

export function getCookMinimumGuests(cook: Pick<Cook, "minimumGuests" | "maxGuests">) {
  return cook.minimumGuests || cook.maxGuests || 2;
}

export function getCookInclusivePrice(
  cook: Pick<Cook, "inclusivePrice" | "serviceFee" | "pricePerSession">,
) {
  return cook.inclusivePrice || getCookServiceFee(cook);
}

export function getCookExtraGuestServiceFee(
  cook: Pick<Cook, "extraGuestServiceFee">,
) {
  return cook.extraGuestServiceFee || 0;
}

export function getCookExtraGuestInclusivePrice(
  cook: Pick<Cook, "extraGuestInclusivePrice" | "extraGuestServiceFee">,
) {
  return cook.extraGuestInclusivePrice || getCookExtraGuestServiceFee(cook);
}

export function calculateCookServicePrice(
  cook: Pick<Cook, "serviceFee" | "pricePerSession" | "minimumGuests" | "maxGuests" | "extraGuestServiceFee">,
  guests: number,
) {
  const baseGuests = getCookMinimumGuests(cook);
  const additionalGuests = Math.max(0, guests - baseGuests);
  return getCookServiceFee(cook) + (additionalGuests * getCookExtraGuestServiceFee(cook));
}

export function calculateCookServiceTotal(
  cook: Pick<Cook, "serviceFee" | "pricePerSession" | "minimumGuests" | "maxGuests" | "extraGuestServiceFee">,
  guests: number,
  days: number,
) {
  return calculateCookServicePrice(cook, guests) * Math.max(1, days);
}

export function calculateCookInclusivePrice(
  cook: Pick<Cook, "inclusivePrice" | "serviceFee" | "pricePerSession" | "minimumGuests" | "maxGuests" | "extraGuestServiceFee" | "extraGuestInclusivePrice">,
  guests: number,
) {
  const baseGuests = getCookMinimumGuests(cook);
  const additionalGuests = Math.max(0, guests - baseGuests);
  return getCookInclusivePrice(cook) + (additionalGuests * getCookExtraGuestInclusivePrice(cook));
}

export function calculateCookInclusiveTotal(
  cook: Pick<Cook, "inclusivePrice" | "serviceFee" | "pricePerSession" | "minimumGuests" | "maxGuests" | "extraGuestServiceFee" | "extraGuestInclusivePrice">,
  guests: number,
  days: number,
) {
  return calculateCookInclusivePrice(cook, guests) * Math.max(1, days);
}

export function getCookCustomMenuRequestFee(
  cook: Pick<Cook, "customMenuRequestFee" | "customMenuRequestFeeKes">,
  usdToKes?: number,
) {
  if (cook.customMenuRequestFee) {
    return cook.customMenuRequestFee;
  }

  if (cook.customMenuRequestFeeKes) {
    return Math.max(1, Math.ceil(cook.customMenuRequestFeeKes / resolveUsdToKesRate(usdToKes)));
  }

  return customMenuRequestFeeDefault;
}

export function getCookCustomMenuRequestFeeKes(
  cook: Pick<Cook, "customMenuRequestFee" | "customMenuRequestFeeKes">,
  usdToKes?: number,
) {
  if (cook.customMenuRequestFeeKes) {
    return cook.customMenuRequestFeeKes;
  }

  if (cook.customMenuRequestFee) {
    return Math.round(cook.customMenuRequestFee * resolveUsdToKesRate(usdToKes));
  }

  return customMenuRequestFeeKesDefault;
}
