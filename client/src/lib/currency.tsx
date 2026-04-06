import React, { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type CurrencyCode = "USD" | "KES";

type CurrencyRatesResponse = {
  baseCurrency: "USD";
  displayCurrencies: CurrencyCode[];
  usdToKes: number;
  fetchedAt: string;
  source: string;
  isFallback: boolean;
};

type CurrencyContextValue = {
  selectedCurrency: CurrencyCode;
  alternateCurrency: CurrencyCode;
  setSelectedCurrency: (currency: CurrencyCode) => void;
  usdToKes: number;
  formatAmount: (amountUsd: number, currency?: CurrencyCode) => string;
  formatDualAmount: (amountUsd: number) => string;
  convertFromUsd: (amountUsd: number, currency?: CurrencyCode) => number;
  convertToUsd: (amount: number, currency?: CurrencyCode) => number;
};

const CURRENCY_STORAGE_KEY = "tembea-currency";
const FALLBACK_USD_TO_KES = 130;

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

function detectCurrencyFromBrowser(): CurrencyCode {
  if (typeof window === "undefined") {
    return "USD";
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = Intl.NumberFormat().resolvedOptions().locale;
  const languageMatchesKenya = navigator.languages.some((language) => /(^|-)KE($|-)/i.test(language));

  if (
    timeZone === "Africa/Nairobi" ||
    /(^|-)KE($|-)/i.test(locale) ||
    languageMatchesKenya
  ) {
    return "KES";
  }

  return "USD";
}

function formatUsd(amount: number) {
  const decimals = Number.isInteger(amount) ? 0 : 2;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 2,
  })}`;
}

function formatKes(amount: number) {
  return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
}

type CurrencyProviderProps = {
  children: React.ReactNode;
  preferredCurrency?: CurrencyCode;
};

export function CurrencyProvider({ children, preferredCurrency }: CurrencyProviderProps) {
  const [selectedCurrency, setSelectedCurrencyState] = useState<CurrencyCode>("USD");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedCurrency = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (storedCurrency === "USD" || storedCurrency === "KES") {
      setSelectedCurrencyState(storedCurrency);
      return;
    }

    setSelectedCurrencyState(preferredCurrency ?? detectCurrencyFromBrowser());
  }, [preferredCurrency]);

  const { data: rates } = useQuery<CurrencyRatesResponse>({
    queryKey: ["/api/currency/rates"],
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const usdToKes = rates?.usdToKes ?? FALLBACK_USD_TO_KES;
  const alternateCurrency: CurrencyCode = selectedCurrency === "USD" ? "KES" : "USD";

  const setSelectedCurrency = (currency: CurrencyCode) => {
    setSelectedCurrencyState(currency);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    }
  };

  const convertFromUsd = (amountUsd: number, currency: CurrencyCode = selectedCurrency) => (
    currency === "KES" ? amountUsd * usdToKes : amountUsd
  );

  const convertToUsd = (amount: number, currency: CurrencyCode = selectedCurrency) => (
    currency === "KES" ? amount / usdToKes : amount
  );

  const formatAmount = (amountUsd: number, currency: CurrencyCode = selectedCurrency) => {
    const convertedAmount = convertFromUsd(amountUsd, currency);
    return currency === "KES" ? formatKes(convertedAmount) : formatUsd(convertedAmount);
  };

  const formatDualAmount = (amountUsd: number) => (
    `${formatAmount(amountUsd, selectedCurrency)} (${formatAmount(amountUsd, alternateCurrency)})`
  );

  return (
    <CurrencyContext.Provider
      value={{
        selectedCurrency,
        alternateCurrency,
        setSelectedCurrency,
        usdToKes,
        formatAmount,
        formatDualAmount,
        convertFromUsd,
        convertToUsd,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
