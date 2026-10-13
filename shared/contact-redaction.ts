// Phone numbers and email addresses taken out of free text: what a guest typed
// for a provider, and anything TBM shows in public (review comments, provider
// bios and replies). Guests and providers reach each other through TBM.

export const CONTACT_REMOVED = "[contact details removed – message TBM]";
export const PUBLIC_CONTACT_REMOVED = "[contact details removed]";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Nine or more digits, allowing a leading +, spaces, dots, dashes and brackets
// between them: 0712 345 678, +254 (0) 712-345-678, wa.me/254712345678.
const phonePattern = /\+?\d(?:[\s().-]*\d){8,}/g;

export function removeContactDetails(text: string, replacement?: string): string;
export function removeContactDetails(text: string | null | undefined, replacement?: string): string | null | undefined;
export function removeContactDetails(text: string | null | undefined, replacement = CONTACT_REMOVED) {
  if (!text) {
    return text;
  }
  return text.replace(emailPattern, replacement).replace(phonePattern, replacement);
}

// Links and social handles, for text TBM shows in public on a provider's
// behalf (bios, replies to reviews): guests reach providers through TBM.
const linkPattern = /\b(?:https?:\/\/|www\.)\S+|\b(?:wa\.me|t\.me|bit\.ly|instagram\.com|facebook\.com|fb\.me|tiktok\.com)\/\S*/gi;
const handlePattern = /(^|\s)@[A-Za-z0-9_.]{2,}/g;

export function removeContactRoutes(text: string, replacement = PUBLIC_CONTACT_REMOVED) {
  // Links first, so a link with a number in it goes as one piece.
  return removeContactDetails(text.replace(linkPattern, replacement), replacement).replace(handlePattern, `$1${replacement}`);
}
