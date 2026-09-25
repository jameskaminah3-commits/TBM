// server/zaina/mpesa-codes.ts
//
// Spotting an M-Pesa transaction code in a chat message (C5). When a card
// payment fails, Zaina asks the customer to send M-Pesa and reply with the
// code; the code is then recorded against their booking instead of being
// lost in the transcript.
//
// A code is 10 letters and digits, starting with a letter and mixing both
// (e.g. QGH7X8Y9Z1). Tokens inside an email address, a link or a longer word
// don't count.

const CODE_PATTERN = /(?<![A-Za-z0-9@._\/-])([A-Za-z][A-Za-z0-9]{9})(?![A-Za-z0-9@_\/-]|\.[A-Za-z0-9])/g;

export function findMpesaCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const match of Array.from(text.matchAll(CODE_PATTERN))) {
    const code = match[1].toUpperCase();
    const letters = code.replace(/[^A-Z]/g, "").length;
    const digits = code.replace(/[^0-9]/g, "").length;
    if (letters >= 2 && digits >= 2) codes.add(code);
  }
  return Array.from(codes);
}

/** Whether a message is about paying ("sent", "paid", "mpesa", "code"…). */
export function mentionsPayment(text: string): boolean {
  return /\bm-?pesa\b|\bmpesa\b|\bpaid\b|\bsent\b|\bpayment\b|\btransaction\b|\bcode\b|\bconfirmation\b|\breceipt\b/i.test(text);
}
