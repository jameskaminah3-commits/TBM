// server/zaina/tool-args.ts
//
// Reading Zaina's tool arguments safely. The model returns arguments as JSON:
// a field declared as text can still arrive as a number (a phone number), a
// null, or a list — and a required field the customer never filled in can
// arrive with a placeholder the model made up ("Guest", "guest@example.com").
// Tools read arguments through these helpers so a malformed call gets an
// answer instead of a crash, and nothing is recorded that the customer didn't
// actually say.

/** A text argument, trimmed. Numbers become text; anything else is empty. */
export function textArg(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

// Words a model uses in place of a name it doesn't have, and titles, which
// don't identify anyone on their own.
const PLACEHOLDER_NAME_WORDS = new Set([
  "guest", "customer", "client", "traveller", "traveler", "user", "visitor", "unknown", "anonymous",
  "na", "none", "null", "not", "provided", "given", "tbd", "sir", "madam", "friend",
  "mr", "mrs", "ms", "miss", "dr",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Letters of any script, plus apostrophes and hyphens inside names.
const NAME_WORD_PATTERN = new RegExp("[\\p{L}'-]{2,}", "gu");

export type CustomerContact =
  | { ok: true; name: string; email: string; phone: string | null }
  | { ok: false; missing: Array<"name" | "email"> };

function mentionsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "u").test(text);
}

/** Phone numbers in a piece of text, as written ("0712 345 678"). */
export function phoneNumbersWritten(text: string): string[] {
  return (text.match(/\+?\d[\d\s().-]{5,}\d/g) ?? [])
    .map((number) => number.trim())
    .filter((number) => number.replace(/\D/g, "").length >= 7);
}

/** Phone numbers in a piece of text, as digits only ("0712 345 678" → "0712345678"). */
function phoneNumbersIn(text: string): string[] {
  return phoneNumbersWritten(text).map((number) => number.replace(/\D/g, ""));
}

// "0712 345 678" and "+254 712 345 678" are the same number: compare the
// last nine digits.
function isSameNumber(a: string, b: string): boolean {
  const length = Math.min(9, a.length, b.length);
  return a.slice(-length) === b.slice(-length);
}

/** Whether two pieces of text contain the same phone number. */
export function sharesPhoneNumber(a: string, b: string): boolean {
  const numbers = phoneNumbersIn(b);
  return phoneNumbersIn(a).some((number) => numbers.some((other) => isSameNumber(number, other)));
}

/** The phone number, if the customer typed it. */
function phoneTheCustomerTyped(value: unknown, written: string): string | null {
  const phone = textArg(value);
  return sharesPhoneNumber(phone, written) ? phone : null;
}

/**
 * How to reach the agent or host behind a listing — a phone number, an
 * @handle, or a profile link — if it is one the customer actually gave.
 */
export function resolveAgentContact(value: unknown, customerTexts: string[]): string | null {
  const contact = textArg(value).replace(/\s+/g, " ");
  if (!contact) return null;
  const written = customerTexts.join("\n").toLowerCase();
  if (sharesPhoneNumber(contact, written)) return contact;
  const handles = contact.toLowerCase().match(/@[\w.]{3,}|(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S+/g) ?? [];
  return handles.some((handle) => written.includes(handle.replace(/^https?:\/\//, ""))) ? contact : null;
}

/**
 * The name, email, and phone the customer actually gave in this conversation.
 * The email must appear in something the customer wrote; the name must share
 * a word with what they wrote and not be a placeholder such as "Guest"; a
 * phone number is kept only if they typed it.
 */
export function resolveCustomerContact(
  args: { name: unknown; email: unknown; phone?: unknown },
  customerTexts: string[],
): CustomerContact {
  const written = customerTexts.join("\n").toLowerCase();
  const missing: Array<"name" | "email"> = [];

  const name = textArg(args.name).replace(/\s+/g, " ");
  const nameWords = (name.toLowerCase().match(NAME_WORD_PATTERN) ?? [])
    .filter((word) => !PLACEHOLDER_NAME_WORDS.has(word));
  if (!nameWords.some((word) => mentionsWord(written, word))) missing.push("name");

  const email = textArg(args.email).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || !written.replace(/\s+/g, "").includes(email)) missing.push("email");

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, name, email, phone: phoneTheCustomerTyped(args.phone, written) };
}
