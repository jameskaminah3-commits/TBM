// zaina-platform/src/knowledge/money.ts
//
// Prices never come from knowledge (the audit's C3: money facts written in
// two places drift apart). Amounts in a business's documents are hidden from
// Zaina: currency amounts, "per night" style prices, and percentages next to
// words like deposit, discount or refund. Prices come from the booking tools,
// or from the team.

export const HIDDEN_AMOUNT = "(amount not given here)";

// 4,500 · 4500 · 1.5 (a thousands comma belongs to the number, a trailing one doesn't)
const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
// "per night", "a person", "/day" after an amount goes with it.
const UNIT = String.raw`(?:\s?(?:per|a|an|\/)\s?(?:night|person|pax|day|hour|plate|meal|kg|guest|adult|child)\b)?`;

const CURRENCY_AMOUNT = new RegExp(
  [
    // KSh 4,500 · KES 4500 · US$ 35 · $35 · €20 · USD 1.5k
    String.raw`(?:\b(?:KShs?|Kshs?|KES|USD|US\$|EUR|GBP|TZS|UGX)\.?\s?|[$€£]\s?)${AMOUNT}(?:\s?[kKmM]\b)?${UNIT}`,
    // 4,500 KSh · 35 dollars · 2k shillings
    String.raw`\b${AMOUNT}\s?[kK]?\s?(?:KShs?|Kshs?|KES|USD|shillings?|bob|dollars?|euros?|pounds?)\b${UNIT}`,
    // 4,500 per night · 1200/person · 3,000 a day
    String.raw`\b(?:\d{1,3}(?:,\d{3})+|\d{2,})(?:\.\d+)?\s?(?:per|a|an|\/)\s?(?:night|person|pax|day|hour|plate|meal|kg|guest|adult|child)\b`,
  ].join("|"),
  "gi",
);

const MONEY_WORDS = /\b(?:deposit|discount|refund|fee|commission|tax|vat|service charge|off|surcharge|markup|price|rate)\b/i;
const PERCENT = /\b\d{1,3}(?:\.\d+)?\s?%|\b\d{1,3}(?:\.\d+)?\s?percent\b/gi;

/** The text with amounts hidden, and how many were hidden. */
export function hideAmounts(text: string): { text: string; hidden: number } {
  let hidden = 0;
  const withoutAmounts = text.replace(CURRENCY_AMOUNT, () => {
    hidden += 1;
    return HIDDEN_AMOUNT;
  });
  // Percentages only in sentences about money: "30% deposit", not "90% of guests".
  const result = withoutAmounts.replace(/[^.!?\n]+[.!?]?/g, (sentence) => {
    if (!MONEY_WORDS.test(sentence)) return sentence;
    return sentence.replace(PERCENT, () => {
      hidden += 1;
      return HIDDEN_AMOUNT;
    });
  });
  return { text: result, hidden };
}
