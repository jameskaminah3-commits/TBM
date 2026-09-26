// zaina-platform/src/booking/money.ts
//
// Amounts in bookings are whole numbers of the currency's smallest unit
// (cents): KSh 8,000 is 800000. Staff type and customers read major units.

import type { BookingCurrency } from "../db/schema.ts";

/** "KSh 8,000", "$120", "$99.50". */
export function formatMoney(minor: number, currency: BookingCurrency | string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  const number = Math.abs(major).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  const sign = major < 0 ? "-" : "";
  if (currency === "KES") return `${sign}KSh ${number}`;
  if (currency === "USD") return `${sign}$${number}`;
  return `${sign}${currency} ${number}`;
}

/** An amount staff typed in major units ("8,000", 8000, "99.50") as minor units, or null. */
export function toMinor(input: unknown): number | null {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim().replace(/,/g, "") : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** Minor units as a major-unit number, for forms (800000 → 8000). */
export function toMajor(minor: number): number {
  return minor / 100;
}
