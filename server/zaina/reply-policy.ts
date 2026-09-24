// server/zaina/reply-policy.ts
//
// Deterministic rules for what Zaina sends to customers. The model writes
// the conversational part; the server owns anything that must be exactly
// right — payment links, payment steps, and listing links.
//
// Pure module: no database or network access, so every rule is unit-tested.

import { bookingDepositPercent } from "../../shared/booking-payments.ts";

/** The public site customers can open. */
export function getPublicSiteUrl(): string {
  return (process.env.APP_BASE_URL?.trim() || "https://tembeabilamatata.com").replace(/\/+$/, "");
}

function getPublicSiteHost(): string {
  try {
    return new URL(getPublicSiteUrl()).host;
  } catch {
    return "tembeabilamatata.com";
  }
}

// ═══════════════════════════════════════════════════════════════════
// LISTING AND PAYMENT LINKS
// ═══════════════════════════════════════════════════════════════════

export type CustomerLink = { kind: "listing" | "payment"; url: string };

export function collectCustomerLinks(value: any, links: CustomerLink[]): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "public_url" || key === "payment_link") && typeof child === "string") {
      const kind = key === "payment_link" ? "payment" : "listing";
      if (!links.some((link) => link.url === child)) links.push({ kind, url: child });
    }
    collectCustomerLinks(child, links);
  }
}

export function appendMissingCustomerLink(value: string, links: CustomerLink[]): string {
  if (links.length === 0 || links.some((link) => value.includes(link.url))) return value;
  const link = links.at(-1);
  if (!link) return value;
  const label = link.kind === "payment"
    ? "Complete your booking here"
    : "View the full listing here";
  return `${value.trim()}\n\n${label}:\n${link.url}`;
}

// Never let storage image URLs leak into the customer conversation. Listings
// have a public booking page; that is the only link Zaina should share.
// ")" is excluded so a markdown link's closing bracket is never swallowed.
const MEDIA_URL_PATTERN = /https?:\/\/[^\s"'<>)]+\/storage\/v1\/object\/public\/media\/[^\s"'<>)]+/gi;

export function redactMediaUrls(value: string): string {
  return value.replace(MEDIA_URL_PATTERN, "[image link omitted — use the public listing page link]");
}

export function redactMediaUrlsDeep(value: any): any {
  if (typeof value === "string") return redactMediaUrls(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactMediaUrlsDeep);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactMediaUrlsDeep(child)]),
  );
}

export function replaceMediaUrls(value: string, latestCustomerLink: string | undefined): string {
  return value.replace(
    MEDIA_URL_PATTERN,
    latestCustomerLink ?? "[public listing or payment link unavailable]",
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENT SECTIONS — appended by the server, never written by the model
// ═══════════════════════════════════════════════════════════════════

export type PaymentKind = "booking" | "custom_request" | "listing_verification";

export type PaymentDetails = {
  kind: PaymentKind;
  url: string;
  bookingId?: string;
  /** Deposit for a booking, already formatted in the customer's currency. */
  depositDisplay?: string;
  /** Request or verification fee, already formatted. */
  feeDisplay?: string;
};

const PAYMENT_TOOL_KINDS: Record<string, PaymentKind> = {
  create_draft_booking: "booking",
  create_service_booking: "booking",
  create_custom_offer: "custom_request",
  create_listing_verification_request: "listing_verification",
};

/** Returns payment details when a tool call created (or replayed) something payable. */
export function paymentDetailsFromToolResult(toolName: string, result: any): PaymentDetails | null {
  const kind = PAYMENT_TOOL_KINDS[toolName];
  if (!kind || !result || result.ok !== true || typeof result.payment_link !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  return {
    kind,
    url: result.payment_link,
    bookingId: text(result.booking_id),
    depositDisplay: kind === "booking" ? text(result.deposit_display) : undefined,
    feeDisplay: kind === "booking" ? undefined : text(result.fee_display),
  };
}

// The same wording for every customer: it never depends on whether the email
// already has an account (see the account-enumeration rule in the prompt).
function signInStep(item: "booking" | "request"): string {
  return (
    `Sign in, or create an account using the same email you gave for this ${item}. ` +
    "We'll email you a 6-digit code — enter it to verify. Forgot your password? Use \"Forgot password\" on the sign-in page."
  );
}

export function buildPaymentSection(details: PaymentDetails): string {
  const host = getPublicSiteHost();
  const safetyStep =
    `We use secure HTTPS and never store your card details. Always check the address bar starts with ${host} before signing in.`;

  if (details.kind === "custom_request") {
    return [
      `Your request is saved. You can pay the request fee${details.feeDisplay ? ` of ${details.feeDisplay}` : ""} here:`,
      details.url,
      "",
      "What happens next:",
      `• The link opens your request in My Bookings. ${signInStep("request")}`,
      "• Tap \"Pay now\" to pay the request fee. It's credited in full against your final quotation if you go ahead.",
      "• Our team reviews your request and sends the final quotation. Nothing is confirmed until you accept and pay that quotation.",
    ].join("\n");
  }

  if (details.kind === "listing_verification") {
    return [
      `Your verification request is saved. You can pay the verification fee${details.feeDisplay ? ` of ${details.feeDisplay}` : ""} here:`,
      details.url,
      "",
      "What happens next:",
      `• The link opens the request in My Bookings. ${signInStep("request")}`,
      "• Tap \"Pay now\" to pay the fee. Our on-ground team is dispatched only after the payment clears.",
      "• You'll get a report with either a verified outcome or a warning flag — not an instant guarantee. If you then book with TBM, the fee is credited to your final quotation.",
    ].join("\n");
  }

  const payLine = details.depositDisplay
    ? `You can pay your ${bookingDepositPercent}% deposit of ${details.depositDisplay} securely here:`
    : "You can complete your payment securely here:";
  const summaryStep = details.depositDisplay
    ? `• You'll then see your booking summary and a "Pay now" button. The ${bookingDepositPercent}% deposit secures your booking.`
    : "• You'll then see your booking summary and a \"Pay now\" button.";
  return [
    payLine,
    details.url,
    "",
    "What happens next:",
    `• ${signInStep("booking")}`,
    summaryStep,
    `• ${safetyStep}`,
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes the model's own copies of payment links (full, markdown, or a
 * shortened /bookings path) and its own "What happens next" section, so the
 * server-built section is the only one the customer sees.
 */
export function removeModelPaymentCopies(text: string, payments: PaymentDetails[]): string {
  let result = text;

  const stepsHeading = result.search(/^[ \t>#*_]*what happens next\b/im);
  if (stepsHeading >= 0) result = result.slice(0, stepsHeading);

  const targets = new Set<string>();
  for (const payment of payments) {
    targets.add(payment.url);
    if (payment.bookingId) targets.add(`/bookings?bookingId=${payment.bookingId}`);
  }
  if (targets.size === 0) return result.trim();

  const targetPattern = Array.from(targets).map(escapeRegExp).join("|");
  // A markdown link to the payment page, then any bare URL or path containing it.
  const markdownLink = new RegExp(`\\[[^\\]]*\\]\\((?:https?:\\/\\/[^\\s)]*)?(?:${targetPattern})[^\\s)]*\\)`, "g");
  const bareLink = new RegExp(`(?:https?:\\/\\/[^\\s)]*?)?(?:${targetPattern})[^\\s)]*`, "g");

  const lines = result.split("\n").map((line) => {
    const withoutLink = line.replace(markdownLink, "").replace(bareLink, "");
    if (withoutLink === line) return line;
    const trimmed = withoutLink.trim();
    const core = trimmed.replace(/[\s()[\]<>:.,;–—-]+$/, "").trim();
    // A line that only labelled the link ("Pay here:", "Or here:") goes entirely.
    const onlyALabel = core.length === 0
      || (core.length <= 40 && (/[:–—-]$/.test(trimmed) || /\b(here|link|below|now)$/i.test(core)));
    return onlyALabel ? null : withoutLink.replace(/ {2,}/g, " ").trimEnd();
  });

  return lines.filter((line): line is string => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Markdown bold/underline markers render as literal symbols in the widget. */
export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/\*\*/g, "");
}

/**
 * Final shaping of the model's text for this turn: plain text, no model-made
 * payment copies, and exactly one server-built payment section per payable
 * item created in this turn.
 */
export function composeCustomerReply(modelText: string, payments: PaymentDetails[]): string {
  let text = stripMarkdownEmphasis(modelText);
  if (payments.length === 0) return text;

  text = removeModelPaymentCopies(text, payments);
  const unique = payments.filter((payment, index) => payments.findIndex((other) => other.url === payment.url) === index);
  const sections = unique.map(buildPaymentSection);
  return [text, ...sections].filter((part) => part.trim().length > 0).join("\n\n");
}

/** What the customer sees if the turn fails after something payable was created. */
export function paymentRecoveryMessage(payments: PaymentDetails[]): string {
  return composeCustomerReply(
    "Your request was saved, but I hit a snag finishing my reply — here are the details you need.",
    payments,
  );
}
