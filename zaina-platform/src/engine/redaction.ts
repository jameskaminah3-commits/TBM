// zaina-platform/src/engine/redaction.ts
//
// Card numbers never belong in a chat transcript (I17). A customer who pastes
// one gets it removed before the message is stored or sent to the model.
// Only Luhn-valid runs of 13 to 19 digits are treated as card numbers, so
// phone numbers, amounts and M-Pesa codes are left alone.

export const CARD_NUMBER_PLACEHOLDER = "[card number removed]";

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function redactCardNumbers(text: string): string {
  return text.replace(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? CARD_NUMBER_PLACEHOLDER : match;
  });
}
