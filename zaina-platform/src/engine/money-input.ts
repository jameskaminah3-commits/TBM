// server/zaina/money-input.ts
//
// Converts money amounts that customers state in chat (budgets) into the
// platform's stored currency, USD. The model reports the amount and the
// currency the customer used; the server converts with the same rate the
// site uses for display. The model never does exchange-rate maths.

export type InputCurrency = "USD" | "KES";

export type MoneyInputResult =
  | {
      ok: true;
      /** Whole USD, for integer columns such as budgets on bookings. */
      usd: number;
      /** Unrounded USD, for comparisons and display. */
      exactUsd: number;
      amount: number;
      currency: InputCurrency;
    }
  | { ok: false; error: "amount_invalid" | "currency_required" | "currency_unsupported" };

export function normalizeInputCurrency(value: unknown): InputCurrency | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\.$/, "");
  if (["USD", "US$", "$", "DOLLARS"].includes(normalized)) return "USD";
  if (["KES", "KSH", "KSHS", "SHILLINGS"].includes(normalized)) return "KES";
  return null;
}

export function toUsdAmount(amount: unknown, currency: unknown, usdToKes: number): MoneyInputResult {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "amount_invalid" };
  }
  if (currency === undefined || currency === null || (typeof currency === "string" && !currency.trim())) {
    return { ok: false, error: "currency_required" };
  }
  const normalized = normalizeInputCurrency(currency);
  if (!normalized) {
    return { ok: false, error: "currency_unsupported" };
  }
  if (normalized === "KES" && (!Number.isFinite(usdToKes) || usdToKes <= 0)) {
    return { ok: false, error: "currency_unsupported" };
  }

  const exactUsd = normalized === "USD" ? amount : amount / usdToKes;
  return {
    ok: true,
    usd: Math.max(1, Math.round(exactUsd)),
    exactUsd,
    amount,
    currency: normalized,
  };
}

/** How the customer stated the amount, for staff-facing notes. */
export function describeInputAmount(amount: number, currency: InputCurrency): string {
  return currency === "KES"
    ? `KSh ${Math.round(amount).toLocaleString("en-KE")}`
    : `$${Math.round(amount).toLocaleString("en-US")}`;
}
