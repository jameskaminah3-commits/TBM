// zaina-platform/web/console/format.ts — how the console shows times, numbers and money.

export function timeAgo(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function clock(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function count(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toLocaleString("en-US");
}

export function percent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

export function money(total: { currency: "KES" | "USD"; amount: number }): string {
  return total.currency === "KES"
    ? `KSh ${Math.round(total.amount).toLocaleString("en-US")}`
    : `$${total.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function usd(value: number | null): string {
  if (value === null) return "—";
  if (value < 0.01 && value > 0) return "< $0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function day(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** An instant's date, like "1 Oct 2026". */
export function date(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** An amount in cents, like "KSh 2,500" or "$29". */
export const cents = (amount: number, currency: "KES" | "USD") => money({ currency, amount: amount / 100 });
