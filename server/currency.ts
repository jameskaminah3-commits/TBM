// server/currency.ts
// Shared USD↔KES rate fetcher. Extracted from routes.ts so Zaina tools
// can use the same live rate as customer-facing pricing.

const CURRENCY_RATE_TTL_MS = 30 * 60 * 1000;
const USD_TO_KES_FALLBACK = Number(process.env.USD_TO_KES_FALLBACK ?? "130");

type CurrencyRateSource = {
  url: string;
  source: string;
  parse: (payload: unknown) => number | undefined;
};

const CURRENCY_RATE_SOURCES: CurrencyRateSource[] = [
  {
    url: "https://api.frankfurter.app/latest?from=USD&to=KES",
    source: "Frankfurter",
    parse: (payload: any) => payload?.rates?.KES,
  },
  {
    url: "https://api.frankfurter.app/v1/latest?base=USD&symbols=KES",
    source: "Frankfurter v1",
    parse: (payload: any) => payload?.rates?.KES,
  },
  {
    url: "https://api.exchangerate.host/latest?base=USD&symbols=KES",
    source: "ExchangeRate.host",
    parse: (payload: any) => payload?.rates?.KES,
  },
];

export type CurrencyRate = {
  usdToKes: number;
  fetchedAt: string;
  source: string;
  expiresAt: number;
  isFallback: boolean;
};

let currencyRateCache: CurrencyRate | null = null;

export async function getUsdToKesRate(): Promise<CurrencyRate> {
  const now = Date.now();
  if (currencyRateCache && currencyRateCache.expiresAt > now) {
    return currencyRateCache;
  }

  try {
    for (const candidate of CURRENCY_RATE_SOURCES) {
      const response = await fetch(candidate.url);
      if (!response.ok) continue;

      const payload = await response.json();
      const usdToKes = candidate.parse(payload);
      if (typeof usdToKes !== "number" || !Number.isFinite(usdToKes)) {
        continue;
      }

      currencyRateCache = {
        usdToKes,
        fetchedAt: (payload as any).date ?? new Date().toISOString(),
        source: candidate.source,
        expiresAt: now + CURRENCY_RATE_TTL_MS,
        isFallback: false,
      };
      return currencyRateCache;
    }

    throw new Error("No currency source returned a valid USD/KES rate");
  } catch (error) {
    if (currencyRateCache) return currencyRateCache;

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[CURRENCY] Falling back to static USD/KES rate (${message}).`);

    currencyRateCache = {
      usdToKes: USD_TO_KES_FALLBACK,
      fetchedAt: new Date().toISOString(),
      source: "fallback",
      expiresAt: now + CURRENCY_RATE_TTL_MS,
      isFallback: true,
    };
    return currencyRateCache;
  }
}

/**
 * Convenience helper for Zaina tools.
 * Returns a formatted price string in the requested currency.
 */
export function formatMoney(amountUsd: number, currency: "USD" | "KES", usdToKes: number): string {
  if (currency === "KES") {
    return `KSh ${Math.round(amountUsd * usdToKes).toLocaleString("en-KE")}`;
  }
  return `$${amountUsd.toLocaleString("en-US")}`;
}
