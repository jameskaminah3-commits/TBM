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

// The day a job starts: its first scheduled visit when it has them,
// otherwise the booking's first day.
export function getJobStartDate(booking: { checkIn?: string | null; serviceScheduleSlots?: Array<{ date?: string | null } | null> | null }) {
  const slotDates = (booking.serviceScheduleSlots ?? [])
    .map((slot) => slot?.date ?? "")
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return slotDates[0] ?? (booking.checkIn ? booking.checkIn.slice(0, 10) : null);
}

// A job can only be marked in progress (or done) from its start day, in
// Kenya time. `today` is a calendar date such as "2026-11-12".
export function canStartJob(startDate: string | null | undefined, today: string) {
  return Boolean(startDate) && today >= String(startDate).slice(0, 10);
}

// New-job alerts are only "high" when the job starts within two days (Kenya
// time); anything further off can wait for the provider's next look.
export function getJobAlertPriority(startDate: string | null | undefined, today: string): "high" | "normal" {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(startDate)) return "normal";
  const [y1, m1, d1] = today.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = startDate.slice(0, 10).split("-").map(Number);
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  return days <= 2 ? "high" : "normal";
}

// Calendar dates written into older alerts ("2026-11-20") read day first.
export function formatInboxDates(text: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2}) to (\d{4})-(\d{2})-(\d{2})\b/g, (_match, y1, m1, d1, y2, m2, d2) =>
      `${Number(d1)} ${months[Number(m1) - 1]}${y1 === y2 ? "" : ` ${y1}`} – ${Number(d2)} ${months[Number(m2) - 1]} ${y2}`)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})(?![\d:T])/g, (_match, y, m, d) => `${Number(d)} ${months[Number(m) - 1]} ${y}`);
}
