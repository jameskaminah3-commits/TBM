// zaina-platform/src/engine/reply-policy.ts (from the TBM app's server/zaina/reply-policy.ts)
//
// Deterministic rules for what Zaina sends to customers. The model writes
// the conversational part; the server owns anything that must be exactly
// right — payment links, payment steps, and listing links.
//
// Pure module: no database or network access, so every rule is unit-tested.

import { bookingDepositPercent, bookingPaymentHoldMinutes } from "../../../shared/booking-payments.ts";
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from "../../../shared/support-contact.ts";
import type { ChatLanguage } from "../db/schema.ts";
import { texts } from "./messages.ts";

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
// LINK AND NUMBER SAFETY — what the model is allowed to pass on
// ═══════════════════════════════════════════════════════════════════
//
// Tool results include text written by listing owners, and the model can be
// talked into repeating anything. Customers act on links and phone numbers
// (including M-Pesa numbers), so those are checked deterministically:
//   • links: TBM's own site, WhatsApp, official Kenyan government sites
//     (*.go.ke), or a link the customer sent in this conversation;
//   • phone and M-Pesa numbers: TBM's official number, or a number the
//     customer gave;
//   • images are never sent, and non-web links (javascript:, data:) are dropped.

/** TBM's official phone / WhatsApp / M-Pesa send-money number. */
export const TBM_OFFICIAL_PHONE = SUPPORT_PHONE;
export const TBM_OFFICIAL_PHONE_DISPLAY = SUPPORT_PHONE_DISPLAY;

const TRUSTED_HOSTS = ["tembeabilamatata.com", "wa.me", "whatsapp.com", "api.whatsapp.com"];
const LINK_REMOVED = "(link removed)";
const NUMBER_REMOVED = "(number removed)";

export type SanitizeContext = {
  /** Everything the customer has written in this conversation. */
  customerTexts: string[];
  /**
   * The business's rules (from its settings). Left out, they are TBM's:
   * its site, WhatsApp and Kenyan government sites, and TBM's number.
   */
  allowedHosts?: string[];
  allowedHostSuffixes?: string[];
  officialPhones?: string[];
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function trimUrlPunctuation(url: string): { url: string; trailing: string } {
  const match = url.match(/[.,;:!?]+$/);
  return match ? { url: url.slice(0, -match[0].length), trailing: match[0] } : { url, trailing: "" };
}

/** Compares links loosely: protocol, "www.", case of the host, and a trailing "/" don't matter. */
function comparableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${normalizeHost(parsed.hostname)}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return null;
  }
}

function customerSentUrl(url: string, context: SanitizeContext): boolean {
  const target = comparableUrl(url);
  if (!target) return false;
  return context.customerTexts.some((text) =>
    (text.match(/https?:\/\/[^\s<>"'\])]+/gi) ?? []).some((sent) => comparableUrl(trimUrlPunctuation(sent).url) === target));
}

export function isAllowedCustomerUrl(rawUrl: string, context: SanitizeContext): boolean {
  const url = rawUrl.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true; // a path on TBM's own site
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = normalizeHost(parsed.hostname);
  if (context.allowedHosts) {
    const hosts = context.allowedHosts.map(normalizeHost);
    if (hosts.includes(host) || (context.allowedHostSuffixes ?? []).some((suffix) => host.endsWith(suffix.toLowerCase()))) return true;
    return customerSentUrl(url, context);
  }
  const siteHost = normalizeHost(getPublicSiteHost().split(":")[0]);
  if (host === siteHost || TRUSTED_HOSTS.includes(host) || host.endsWith(".go.ke")) return true;
  return customerSentUrl(url, context);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Kenyan numbers in any common spelling compare equal: 0718…, +254 718…, 254718…. */
function canonicalPhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`;
  return digits;
}

function customerNumbers(context: SanitizeContext): Set<string> {
  const numbers = new Set<string>();
  for (const text of context.customerTexts) {
    for (const match of text.match(/\+?\d[\d\s-]{5,16}\d/g) ?? []) {
      numbers.add(canonicalPhone(match));
      numbers.add(digitsOnly(match));
    }
  }
  return numbers;
}

// Kenyan mobile numbers (07…, 01…, +254 7…, 254 1…) and other international "+" numbers.
const PHONE_PATTERN = /(?<![\w+])(?:(?:\+?254[\s-]?|0)[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}|\+\d{1,3}[\s-]?\d[\d\s-]{6,13}\d)(?![\w])/g;
// M-Pesa paybill / till / account numbers, e.g. "Paybill 522522, account no. 1234".
// "till" needs an explicit "number"/"no." so "till 2026-10-12" (a date) is left alone.
const PAYMENT_NUMBER_PATTERN = /\b(pay\s?bill(?:\s+(?:no\.?|number))?|till\s+(?:no\.?|number)|buy\s+goods(?:\s+(?:till|number|no\.?))?|business\s+(?:no\.?|number)|account\s+(?:no\.?|number))(\s*[:#-]?\s*)(\d[\d\s-]{2,14}\d)/gi;

function sanitizePlainText(text: string, context: SanitizeContext): string {
  const allowedNumbers = customerNumbers(context);
  for (const phone of context.officialPhones ?? [TBM_OFFICIAL_PHONE]) allowedNumbers.add(canonicalPhone(phone));

  return text
    .replace(PHONE_PATTERN, (match) => (allowedNumbers.has(canonicalPhone(match)) ? match : NUMBER_REMOVED))
    .replace(PAYMENT_NUMBER_PATTERN, (match, label: string, separator: string, number: string) => (
      allowedNumbers.has(digitsOnly(number)) || allowedNumbers.has(canonicalPhone(number))
        ? match
        : `${label}${separator}${NUMBER_REMOVED}`
    ));
}

// Markdown images, markdown links, and bare URLs — in that order of precedence.
// Link targets may contain one level of parentheses, e.g. javascript:alert(1).
// A bare "https://" with no host after it (as in "a link beginning with
// https://") is plain text, not a link.
const LINK_TOKEN_PATTERN = /!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\b(?:https?:\/\/[a-z0-9][^\s<>"'\])]*|(?:javascript|data|vbscript):[^\s<>"'\])]+)/gi;

/**
 * Applies the link and number rules to text written by the model. Server-built
 * sections (payment steps, listing links) are appended after this runs.
 */
export function sanitizeModelText(text: string, context: SanitizeContext): string {
  let result = "";
  let lastIndex = 0;
  for (const match of Array.from(text.matchAll(LINK_TOKEN_PATTERN))) {
    const index = match.index ?? 0;
    result += sanitizePlainText(text.slice(lastIndex, index), context);
    lastIndex = index + match[0].length;

    const token = match[0];
    if (token.startsWith("!")) continue; // images are never sent
    if (match[1] !== undefined && match[2] !== undefined) {
      const label = sanitizePlainText(match[1], context);
      result += isAllowedCustomerUrl(match[2], context) ? `[${label}](${match[2]})` : label;
      continue;
    }
    const { url, trailing } = trimUrlPunctuation(token);
    result += (isAllowedCustomerUrl(url, context) ? url : LINK_REMOVED) + trailing;
  }
  result += sanitizePlainText(text.slice(lastIndex), context);
  return result;
}

/**
 * Customer messages are replayed to the model next to earlier tool results.
 * A customer must not be able to pass their own text off as a tool result.
 */
export function neutralizeToolMarkers(text: string): string {
  return text
    .replace(/<(\/?)(tool_result|turn_context)/gi, "‹$1$2")
    .replace(/\[earlier tool\]/gi, "(earlier tool)")
    .replace(/\[earlier in this chat/gi, "(earlier in this chat");
}

/**
 * How an earlier tool call is replayed to the model: clearly delimited data.
 * Text inside it (a listing owner's description, a knowledge passage) can't
 * close the block early or pose as the system's turn context.
 */
export function formatToolHistoryEntry(toolName: string, argsText: string, resultText: string): string {
  return `<tool_result name="${toolName.replace(/[^\w-]/g, "")}">\nargs: ${neutralizeToolMarkers(argsText)}\nresult: ${neutralizeToolMarkers(resultText)}\n</tool_result>`;
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENT SECTIONS — appended by the server, never written by the model
// ═══════════════════════════════════════════════════════════════════

export type PaymentKind = "booking" | "custom_request" | "listing_verification" | "room_booking";

export type PaymentDetails = {
  kind: PaymentKind;
  url: string;
  bookingId?: string;
  /** Deposit for a booking, already formatted in the customer's currency. */
  depositDisplay?: string;
  /** Request or verification fee, already formatted. */
  feeDisplay?: string;
  /** A room booking on the platform (Phase 4): its reference, total, deposit share, hold and ways to pay. */
  reference?: string;
  totalDisplay?: string;
  depositPercent?: number;
  holdUntil?: string;
  payBy?: string;
};

const PAYMENT_TOOL_KINDS: Record<string, PaymentKind> = {
  create_draft_booking: "booking",
  create_service_booking: "booking",
  create_custom_offer: "custom_request",
  create_listing_verification_request: "listing_verification",
  create_booking: "room_booking",
};

/** Returns payment details when a tool call created (or replayed) something payable. */
export function paymentDetailsFromToolResult(toolName: string, result: any): PaymentDetails | null {
  const kind = PAYMENT_TOOL_KINDS[toolName];
  if (!kind || !result || result.ok !== true || typeof result.payment_link !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  if (kind === "room_booking") {
    return {
      kind,
      url: result.payment_link,
      bookingId: text(result.booking_id),
      depositDisplay: text(result.deposit_display),
      reference: text(result.reference),
      totalDisplay: text(result.total_display),
      depositPercent: typeof result.deposit_percent === "number" ? result.deposit_percent : undefined,
      holdUntil: text(result.hold_until),
      payBy: text(result.pay_by),
    };
  }
  return {
    kind,
    url: result.payment_link,
    bookingId: text(result.booking_id),
    depositDisplay: kind === "booking" ? text(result.deposit_display) : undefined,
    feeDisplay: kind === "booking" ? undefined : text(result.fee_display),
  };
}

/**
 * The payment section for a room booking on the platform: the business's own
 * payment page (its link carries the booking), its deposit and hold, and the
 * way the customer hears it's confirmed.
 */
function roomBookingSection(details: PaymentDetails, language: ChatLanguage): string {
  const host = (() => {
    try {
      return new URL(details.url).host;
    } catch {
      return "";
    }
  })();
  const sw = language === "sw";
  const reference = details.reference ?? "";
  const percent = details.depositPercent !== undefined && details.depositPercent < 100 ? details.depositPercent : null;
  if (sw) {
    return [
      `Uhifadhi ${reference} umeshikiliwa kwa ajili yako. Lipa amana${percent !== null ? ` ya asilimia ${percent}` : ""}${details.depositDisplay ? `, yaani ${details.depositDisplay},` : ""} hapa ili kuuthibitisha:`,
      details.url,
      "",
      "Kinachofuata:",
      `• Ukurasa unaonyesha uhifadhi wako na jumla yake${details.totalDisplay ? ` (${details.totalDisplay})` : ""}.${details.payBy ? ` Lipa kwa ${details.payBy === "card or M-Pesa" ? "kadi au M-Pesa" : details.payBy === "card" ? "kadi" : details.payBy}.` : ""}`,
      "• Amana ikifika, uhifadhi wako unathibitishwa na utapata ujumbe hapa. Kiasi kilichobaki kinalipwa ukifika.",
      details.holdUntil ? `• Vyumba vimeshikiliwa hadi ${details.holdUntil}; baada ya hapo vinaweza kupewa mtu mwingine.` : null,
      host ? `• Kila mara hakikisha anwani inaanza na ${host} kabla ya kulipa.` : null,
    ].filter((line) => line !== null).join("\n");
  }
  return [
    `Booking ${reference} is held for you. Pay the${percent !== null ? ` ${percent}%` : ""} deposit${details.depositDisplay ? ` of ${details.depositDisplay}` : ""} here to confirm it:`,
    details.url,
    "",
    "What happens next:",
    `• The page shows your booking and its total${details.totalDisplay ? ` (${details.totalDisplay})` : ""}.${details.payBy ? ` Pay by ${details.payBy}.` : ""}`,
    "• Once the deposit arrives, your booking is confirmed and you'll get a message here. The rest is paid at the property.",
    details.holdUntil ? `• The rooms are held until ${details.holdUntil}; after that they may go to someone else.` : null,
    host ? `• Always check the address starts with ${host} before you pay.` : null,
  ].filter((line) => line !== null).join("\n");
}

// The same wording for every customer: it never depends on whether the email
// already has an account (see the account-enumeration rule in the prompt).
function signInStep(item: "booking" | "request", language: ChatLanguage): string {
  if (language === "sw") {
    return (
      `Ingia kwenye akaunti yako, au fungua akaunti ukitumia barua pepe ile ile uliyotoa kwa ${item === "booking" ? "uhifadhi huu" : "ombi hili"}. ` +
      "Tutakutumia nambari ya tarakimu 6 kwa barua pepe — iweke ili kuthibitisha. Umesahau nenosiri? Tumia \"Forgot password\" kwenye ukurasa wa kuingia."
    );
  }
  return (
    `Sign in, or create an account using the same email you gave for this ${item}. ` +
    "We'll email you a 6-digit code — enter it to verify. Forgot your password? Use \"Forgot password\" on the sign-in page."
  );
}

/**
 * The payment link and "what happens next" steps for something payable. The
 * Swahili is a draft until a fluent speaker has checked it (see messages.ts).
 */
export function buildPaymentSection(details: PaymentDetails, language: ChatLanguage = "en"): string {
  if (details.kind === "room_booking") return roomBookingSection(details, language);
  const host = getPublicSiteHost();
  const sw = language === "sw";
  const safetyStep = sw
    ? `Tunatumia HTTPS salama na hatuhifadhi maelezo ya kadi yako. Kila mara hakikisha anwani ya ukurasa inaanza na ${host} kabla ya kuingia.`
    : `We use secure HTTPS and never store your card details. Always check the address bar starts with ${host} before signing in.`;
  const supportStep = sw
    ? `Una shida kulipa? Timu yetu ya usaidizi inaweza kukusaidia — WhatsApp au piga simu ${SUPPORT_PHONE_DISPLAY}.`
    : `Trouble paying? Our support team can help — WhatsApp or call ${SUPPORT_PHONE_DISPLAY}.`;
  const next = sw ? "Kinachofuata:" : "What happens next:";

  if (details.kind === "custom_request") {
    return (sw
      ? [
          `Ombi lako limehifadhiwa. Unaweza kulipa ada ya ombi${details.feeDisplay ? ` ya ${details.feeDisplay}` : ""} hapa:`,
          details.url,
          "",
          next,
          `• Kiungo kinafungua ombi lako kwenye My Bookings. ${signInStep("request", language)}`,
          "• Bonyeza \"Pay now\" kulipa ada ya ombi. Itahesabiwa kikamilifu katika bei yako ya mwisho ukiendelea.",
          "• Timu yetu itapitia ombi lako na kukutumia bei ya mwisho. Hakuna kinachothibitishwa hadi ukubali na kulipa bei hiyo.",
          `• ${supportStep}`,
        ]
      : [
          `Your request is saved. You can pay the request fee${details.feeDisplay ? ` of ${details.feeDisplay}` : ""} here:`,
          details.url,
          "",
          next,
          `• The link opens your request in My Bookings. ${signInStep("request", language)}`,
          "• Tap \"Pay now\" to pay the request fee. It's credited in full against your final quotation if you go ahead.",
          "• Our team reviews your request and sends the final quotation. Nothing is confirmed until you accept and pay that quotation.",
          `• ${supportStep}`,
        ]).join("\n");
  }

  if (details.kind === "listing_verification") {
    return (sw
      ? [
          `Ombi lako la uthibitisho limehifadhiwa. Unaweza kulipa ada ya uthibitisho${details.feeDisplay ? ` ya ${details.feeDisplay}` : ""} hapa:`,
          details.url,
          "",
          next,
          `• Kiungo kinafungua ombi kwenye My Bookings. ${signInStep("request", language)}`,
          "• Bonyeza \"Pay now\" kulipa ada. Timu yetu ya uwanjani inatumwa tu baada ya malipo kukamilika.",
          "• Utapokea ripoti yenye matokeo ya kuthibitishwa au tahadhari — si hakikisho la papo hapo. Ukiweka nafasi na TBM baadaye, ada hii itahesabiwa katika bei yako ya mwisho.",
          `• ${supportStep}`,
        ]
      : [
          `Your verification request is saved. You can pay the verification fee${details.feeDisplay ? ` of ${details.feeDisplay}` : ""} here:`,
          details.url,
          "",
          next,
          `• The link opens the request in My Bookings. ${signInStep("request", language)}`,
          "• Tap \"Pay now\" to pay the fee. Our on-ground team is dispatched only after the payment clears.",
          "• You'll get a report with either a verified outcome or a warning flag — not an instant guarantee. If you then book with TBM, the fee is credited to your final quotation.",
          `• ${supportStep}`,
        ]).join("\n");
  }

  if (sw) {
    const payLine = details.depositDisplay
      ? `Unaweza kulipa amana yako ya ${bookingDepositPercent}%, yaani ${details.depositDisplay}, kwa usalama hapa:`
      : "Unaweza kukamilisha malipo yako kwa usalama hapa:";
    const summaryStep = details.depositDisplay
      ? `• Kisha utaona muhtasari wa uhifadhi wako na kitufe cha "Pay now". Amana ya ${bookingDepositPercent}% inathibitisha uhifadhi wako.`
      : "• Kisha utaona muhtasari wa uhifadhi wako na kitufe cha \"Pay now\".";
    const holdStep =
      `• Tarehe zako zinahifadhiwa tu baada ya kulipa${details.depositDisplay ? " amana" : ""}. ` +
      `Ukibonyeza "Pay now", tunazishikilia kwa ajili yako kwa dakika ${bookingPaymentHoldMinutes} ukikamilisha malipo.`;
    return [payLine, details.url, "", next, `• ${signInStep("booking", language)}`, summaryStep, holdStep, `• ${safetyStep}`, `• ${supportStep}`].join("\n");
  }

  const payLine = details.depositDisplay
    ? `You can pay your ${bookingDepositPercent}% deposit of ${details.depositDisplay} securely here:`
    : "You can complete your payment securely here:";
  const summaryStep = details.depositDisplay
    ? `• You'll then see your booking summary and a "Pay now" button. The ${bookingDepositPercent}% deposit secures your booking.`
    : "• You'll then see your booking summary and a \"Pay now\" button.";
  const holdStep =
    `• Your dates are reserved only once you've paid${details.depositDisplay ? " the deposit" : ""}. ` +
    `When you tap "Pay now", we hold them for you for ${bookingPaymentHoldMinutes} minutes while you complete the payment.`;
  return [
    payLine,
    details.url,
    "",
    next,
    `• ${signInStep("booking", language)}`,
    summaryStep,
    holdStep,
    `• ${safetyStep}`,
    `• ${supportStep}`,
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

  const stepsHeading = result.search(/^[ \t>#*_]*(?:what happens next|kinachofuata)\b/im);
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
export function composeCustomerReply(modelText: string, payments: PaymentDetails[], language: ChatLanguage = "en"): string {
  let text = stripMarkdownEmphasis(modelText);
  if (payments.length === 0) return text;

  text = removeModelPaymentCopies(text, payments);
  const unique = payments.filter((payment, index) => payments.findIndex((other) => other.url === payment.url) === index);
  const sections = unique.map((payment) => buildPaymentSection(payment, language));
  return [text, ...sections].filter((part) => part.trim().length > 0).join("\n\n");
}

/** What the customer sees if the turn fails after something payable was created. */
export function paymentRecoveryMessage(payments: PaymentDetails[], language: ChatLanguage = "en"): string {
  return composeCustomerReply(texts(language).paymentRecovery, payments, language);
}
