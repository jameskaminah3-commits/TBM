import type { Errand, HelpMamaPricing } from "./schema";

export const HELP_MAMA_TIME_RATE_IDS = {
  hourlyDaytime: "help-mama-hourly-daytime",
  hourlyEvening: "help-mama-hourly-evening",
  overnight: "help-mama-overnight",
  fullDay: "help-mama-full-day",
} as const;

export const DEFAULT_HELP_MAMA_AGE_BANDS = [
  { id: "help-mama-infant", label: "Infant (0-12 months)", price: 0, hourlyDaytimePrice: 0, hourlyEveningPrice: 0, overnightPrice: 0, fullDayPrice: 0 },
  { id: "help-mama-toddler", label: "Toddler (1-3 years)", price: 0, hourlyDaytimePrice: 0, hourlyEveningPrice: 0, overnightPrice: 0, fullDayPrice: 0 },
  { id: "help-mama-child", label: "Child (4-12 years)", price: 0, hourlyDaytimePrice: 0, hourlyEveningPrice: 0, overnightPrice: 0, fullDayPrice: 0 },
] as const;

type HelpMamaRateKey = keyof typeof HELP_MAMA_TIME_RATE_IDS;

const HELP_MAMA_RATE_FIELDS: Record<HelpMamaRateKey, keyof HelpMamaPricing["ageBands"][number]> = {
  hourlyDaytime: "hourlyDaytimePrice",
  hourlyEvening: "hourlyEveningPrice",
  overnight: "overnightPrice",
  fullDay: "fullDayPrice",
};

const HELP_MAMA_LEGACY_RATE_FIELDS: Record<HelpMamaRateKey, keyof HelpMamaPricing> = {
  hourlyDaytime: "hourlyDaytimePrice",
  hourlyEvening: "hourlyEveningPrice",
  overnight: "overnightPrice",
  fullDay: "fullDayPrice",
};

function normalizePrice(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

export function normalizeHelpMamaPricing(pricing?: Partial<HelpMamaPricing> | null): HelpMamaPricing {
  const legacyRates = {
    hourlyDaytimePrice: normalizePrice(pricing?.hourlyDaytimePrice),
    hourlyEveningPrice: normalizePrice(pricing?.hourlyEveningPrice),
    overnightPrice: normalizePrice(pricing?.overnightPrice),
    fullDayPrice: normalizePrice(pricing?.fullDayPrice),
  };

  const ageBands = (pricing?.ageBands?.length ? pricing.ageBands : DEFAULT_HELP_MAMA_AGE_BANDS) as Array<Partial<HelpMamaPricing["ageBands"][number]> & {
    id: string;
    label: string;
  }>;

  return {
    enabled: Boolean(pricing?.enabled),
    ...legacyRates,
    ageBands: ageBands.map((band) => ({
      id: band.id,
      label: band.label,
      price: normalizePrice(band.price),
      hourlyDaytimePrice: normalizePrice(band.hourlyDaytimePrice ?? (legacyRates.hourlyDaytimePrice ? legacyRates.hourlyDaytimePrice + normalizePrice(band.price) : 0)),
      hourlyEveningPrice: normalizePrice(band.hourlyEveningPrice ?? (legacyRates.hourlyEveningPrice ? legacyRates.hourlyEveningPrice + normalizePrice(band.price) : 0)),
      overnightPrice: normalizePrice(band.overnightPrice ?? (legacyRates.overnightPrice ? legacyRates.overnightPrice + normalizePrice(band.price) : 0)),
      fullDayPrice: normalizePrice(band.fullDayPrice ?? (legacyRates.fullDayPrice ? legacyRates.fullDayPrice + normalizePrice(band.price) : 0)),
    })),
  };
}

export function getHelpMamaAgeBandId(addonSelections: string[] | null | undefined, pricing?: HelpMamaPricing | null) {
  const selected = new Set(addonSelections || []);
  return normalizeHelpMamaPricing(pricing).ageBands.find((band) => selected.has(band.id))?.id;
}

function getBandRatePrice(band: HelpMamaPricing["ageBands"][number], rateKey: HelpMamaRateKey) {
  return normalizePrice(band[HELP_MAMA_RATE_FIELDS[rateKey]]);
}

function getRatePrice(pricing: HelpMamaPricing, rateKey: HelpMamaRateKey, ageBandId?: string | null) {
  const selectedBand = ageBandId ? pricing.ageBands.find((band) => band.id === ageBandId) : null;
  if (selectedBand) {
    return getBandRatePrice(selectedBand, rateKey);
  }

  const bandPrices = pricing.ageBands
    .map((band) => getBandRatePrice(band, rateKey))
    .filter((price) => price > 0);

  if (bandPrices.length) {
    return Math.min(...bandPrices);
  }

  return normalizePrice(pricing[HELP_MAMA_LEGACY_RATE_FIELDS[rateKey]]);
}

export function getHelpMamaRateOptions(pricing?: HelpMamaPricing | null, ageBandId?: string | null) {
  const normalized = normalizeHelpMamaPricing(pricing);
  return [
    { id: HELP_MAMA_TIME_RATE_IDS.hourlyDaytime, label: "Hourly daytime", price: getRatePrice(normalized, "hourlyDaytime", ageBandId), unit: "hour" },
    { id: HELP_MAMA_TIME_RATE_IDS.hourlyEvening, label: "Hourly evening", price: getRatePrice(normalized, "hourlyEvening", ageBandId), unit: "hour" },
    { id: HELP_MAMA_TIME_RATE_IDS.overnight, label: "Overnight", price: getRatePrice(normalized, "overnight", ageBandId), unit: "night" },
    { id: HELP_MAMA_TIME_RATE_IDS.fullDay, label: "Full day", price: getRatePrice(normalized, "fullDay", ageBandId), unit: "day" },
  ].filter((option) => option.price > 0);
}

export function hasHelpMamaPricing(errand: Pick<Errand, "helpMamaPricing">) {
  const pricing = normalizeHelpMamaPricing(errand.helpMamaPricing);
  return pricing.enabled && getHelpMamaRateOptions(pricing).length > 0;
}

export function getHelpMamaStartingPrice(pricing?: HelpMamaPricing | null) {
  const prices = getHelpMamaRateOptions(pricing).map((option) => option.price);
  return prices.length ? Math.min(...prices) : 0;
}

export function isHelpMamaHourlyRate(rateId?: string | null) {
  return rateId === HELP_MAMA_TIME_RATE_IDS.hourlyDaytime || rateId === HELP_MAMA_TIME_RATE_IDS.hourlyEvening;
}

export function getHelpMamaRateId(addonSelections: string[] | null | undefined) {
  return (addonSelections || []).find((selection) =>
    Object.values(HELP_MAMA_TIME_RATE_IDS).includes(selection as typeof HELP_MAMA_TIME_RATE_IDS[keyof typeof HELP_MAMA_TIME_RATE_IDS]),
  );
}

export function getHelpMamaAgeBandTotal(pricing: HelpMamaPricing | null | undefined, addonSelections: string[] | null | undefined) {
  const selected = new Set(addonSelections || []);
  return normalizeHelpMamaPricing(pricing).ageBands
    .filter((band) => selected.has(band.id))
    .reduce((sum, band) => sum + band.price, 0);
}

export function calculateHelpMamaPackagePrice(
  errand: Pick<Errand, "basePrice" | "helpMamaPricing">,
  addonSelections: string[] | null | undefined,
  serviceHours?: number | null,
) {
  const rateId = getHelpMamaRateId(addonSelections);
  const ageBandId = getHelpMamaAgeBandId(addonSelections, errand.helpMamaPricing);
  const rate = getHelpMamaRateOptions(errand.helpMamaPricing, ageBandId).find((option) => option.id === rateId);

  if (!rate) {
    return errand.basePrice;
  }

  const quantity = isHelpMamaHourlyRate(rate.id) ? Math.max(1, serviceHours || 1) : 1;
  return rate.price * quantity;
}
