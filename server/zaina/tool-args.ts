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

/** The phone number, if the customer typed it (compared by its last nine digits). */
function phoneTheCustomerTyped(value: unknown, written: string): string | null {
  const phone = textArg(value);
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 7) return null;
  const typed = (written.match(/\+?\d[\d\s().-]{5,}\d/g) ?? []).map((number) => number.replace(/\D/g, ""));
  return typed.some((digits) => digits.length >= 7 && digits.endsWith(tail)) ? phone : null;
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
