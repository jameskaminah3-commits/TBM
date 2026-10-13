// The provider's smart business card (plan section 5): what it says, its
// sizes, and the contact file. It carries no rating and no personal phone
// number; the QR code opens the provider's live page, and TBM's official
// number is the only number on any of it.
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from "./support-contact.ts";
import { providerPaySafely, providerPaySafelyHeading } from "./provider-public.ts";

export const CARD_CALL_TO_ACTION = "Scan to explore and book";
export const CARD_COORDINATED_BY = "Bookings and guest support coordinated by Tembea Bila Matata";
export const CARD_PAY_HEADING = providerPaySafelyHeading;
export const CARD_PAY_SAFELY = providerPaySafely;
export const CARD_HOW_TO_BOOK = "Book and pay through TBM, by M-Pesa or card.";

// Print: 85 × 55 mm trimmed, with 3 mm bleed on every side, at 300 dpi.
export const PRINT_TRIM_MM = { width: 85, height: 55 } as const;
export const PRINT_BLEED_MM = 3;
export const PRINT_DPI = 300;
const mmToPx = (mm: number) => Math.round((mm / 25.4) * PRINT_DPI);
const mmToPt = (mm: number) => (mm / 25.4) * 72;
export const PRINT_PIXELS = {
  width: mmToPx(PRINT_TRIM_MM.width + 2 * PRINT_BLEED_MM),
  height: mmToPx(PRINT_TRIM_MM.height + 2 * PRINT_BLEED_MM),
  bleed: mmToPx(PRINT_BLEED_MM),
  // Text and the QR code stay this far inside the trim line.
  safe: mmToPx(PRINT_BLEED_MM + 3),
};
export const PRINT_POINTS = {
  width: mmToPt(PRINT_TRIM_MM.width + 2 * PRINT_BLEED_MM),
  height: mmToPt(PRINT_TRIM_MM.height + 2 * PRINT_BLEED_MM),
  bleed: mmToPt(PRINT_BLEED_MM),
  trimWidth: mmToPt(PRINT_TRIM_MM.width),
  trimHeight: mmToPt(PRINT_TRIM_MM.height),
};
// WhatsApp Status: a full phone screen.
export const STATUS_PIXELS = { width: 1080, height: 1920 } as const;

export type BusinessCardSource = {
  displayName: string;
  serviceTypes: string[];
  serviceAreas: string[];
  verified: boolean;
  photoUrl: string | null;
  photoKind: string | null;
};

export type BusinessCardContent = {
  name: string;
  line: string;
  verified: boolean;
  photoUrl: string | null;
  photoIsLogo: boolean;
  callToAction: string;
  coordinatedBy: string;
};

// The card's words, from the public page's allowlisted fields only.
export function businessCardContent(source: BusinessCardSource): BusinessCardContent {
  const services = source.serviceTypes.slice(0, 3).join(" · ");
  const areas = source.serviceAreas.slice(0, 2).join(" & ");
  return {
    name: source.displayName,
    line: [services, areas ? `in ${areas}` : ""].filter(Boolean).join(" ") || "On Tembea Bila Matata",
    verified: Boolean(source.verified),
    photoUrl: source.photoUrl,
    photoIsLogo: source.photoKind === "logo",
    callToAction: CARD_CALL_TO_ACTION,
    coordinatedBy: CARD_COORDINATED_BY,
  };
}

// vCard text values: backslash, comma, semicolon and newlines escaped.
const vcardText = (value: string) => value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");

// A contact file that saves the provider "via TBM": TBM's official number and
// the provider's page, nothing personal.
export function buildProviderVCard(args: { name: string; pageUrl: string }) {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcardText(`${args.name} (book via TBM)`)}`,
    `N:;${vcardText(`${args.name} (book via TBM)`)};;;`,
    "ORG:Tembea Bila Matata",
    `TEL;TYPE=WORK,VOICE:${SUPPORT_PHONE}`,
    `URL:${args.pageUrl}`,
    `NOTE:${vcardText(`Book ${args.name} through Tembea Bila Matata. TBM's official number is ${SUPPORT_PHONE_DISPLAY}. ${CARD_PAY_SAFELY}`)}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}

export function cardFileName(name: string, suffix: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "provider";
  return `${slug}-tbm-${suffix}`;
}
