import { normalizeHelpMamaPricing } from "@shared/errand-pricing";
import type { ErrandAddon, HelpMamaPricing } from "@shared/schema";
import type { CurrencyCode } from "@/lib/currency";

type CurrencyConverter = (amount: number, currency?: CurrencyCode) => number;

function normalizeStoredAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.round(amount);
}

export function currencyLabel(currency: CurrencyCode) {
  return currency === "KES" ? "KSh" : "USD";
}

export function convertErrandAmountFromUsd(
  amountUsd: number,
  convertFromUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  return normalizeStoredAmount(convertFromUsd(amountUsd, currency));
}

export function convertErrandAmountToUsd(
  amount: number,
  convertToUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  return normalizeStoredAmount(convertToUsd(amount, currency));
}

export function convertErrandAddonsFromUsd(
  addons: ErrandAddon[] | null | undefined,
  convertFromUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  return (addons || []).map((addon) => ({
    ...addon,
    price: convertErrandAmountFromUsd(addon.price, convertFromUsd, currency),
  }));
}

export function convertErrandAddonsToUsd(
  addons: ErrandAddon[],
  convertToUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  return addons.map((addon) => ({
    ...addon,
    price: convertErrandAmountToUsd(addon.price, convertToUsd, currency),
  }));
}

export function convertHelpMamaPricingFromUsd(
  value: HelpMamaPricing | null | undefined,
  convertFromUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  const pricing = normalizeHelpMamaPricing(value);
  return normalizeHelpMamaPricing({
    ...pricing,
    hourlyDaytimePrice: convertErrandAmountFromUsd(pricing.hourlyDaytimePrice || 0, convertFromUsd, currency),
    hourlyEveningPrice: convertErrandAmountFromUsd(pricing.hourlyEveningPrice || 0, convertFromUsd, currency),
    overnightPrice: convertErrandAmountFromUsd(pricing.overnightPrice || 0, convertFromUsd, currency),
    fullDayPrice: convertErrandAmountFromUsd(pricing.fullDayPrice || 0, convertFromUsd, currency),
    ageBands: pricing.ageBands.map((band) => ({
      ...band,
      hourlyDaytimePrice: convertErrandAmountFromUsd(band.hourlyDaytimePrice || 0, convertFromUsd, currency),
      hourlyEveningPrice: convertErrandAmountFromUsd(band.hourlyEveningPrice || 0, convertFromUsd, currency),
      overnightPrice: convertErrandAmountFromUsd(band.overnightPrice || 0, convertFromUsd, currency),
      fullDayPrice: convertErrandAmountFromUsd(band.fullDayPrice || 0, convertFromUsd, currency),
    })),
  });
}

export function convertHelpMamaPricingToUsd(
  value: HelpMamaPricing,
  convertToUsd: CurrencyConverter,
  currency: CurrencyCode,
) {
  const pricing = normalizeHelpMamaPricing(value);
  return normalizeHelpMamaPricing({
    ...pricing,
    hourlyDaytimePrice: convertErrandAmountToUsd(pricing.hourlyDaytimePrice || 0, convertToUsd, currency),
    hourlyEveningPrice: convertErrandAmountToUsd(pricing.hourlyEveningPrice || 0, convertToUsd, currency),
    overnightPrice: convertErrandAmountToUsd(pricing.overnightPrice || 0, convertToUsd, currency),
    fullDayPrice: convertErrandAmountToUsd(pricing.fullDayPrice || 0, convertToUsd, currency),
    ageBands: pricing.ageBands.map((band) => ({
      ...band,
      hourlyDaytimePrice: convertErrandAmountToUsd(band.hourlyDaytimePrice || 0, convertToUsd, currency),
      hourlyEveningPrice: convertErrandAmountToUsd(band.hourlyEveningPrice || 0, convertToUsd, currency),
      overnightPrice: convertErrandAmountToUsd(band.overnightPrice || 0, convertToUsd, currency),
      fullDayPrice: convertErrandAmountToUsd(band.fullDayPrice || 0, convertToUsd, currency),
    })),
  });
}
