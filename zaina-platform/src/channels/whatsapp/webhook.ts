// zaina-platform/src/channels/whatsapp/webhook.ts
//
// What Meta sends to the webhook, checked and read.
//
//   - Every delivery is signed with the platform app's secret
//     (X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body>). A delivery
//     without a valid signature is refused before anything is read.
//   - A delivery carries, per business number (metadata.phone_number_id),
//     messages from customers and status updates for messages sent.
//
// Only what the platform uses is kept: who wrote, what they wrote (a photo's
// caption, a button's title, a location or contact card as text) and which
// media they sent, by WhatsApp's media id.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChatMedia } from "../../db/schema.ts";

export function validSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The handshake Meta does when the webhook is set up: echo the challenge if the token matches. */
export function verificationChallenge(query: Record<string, unknown>, verifyToken: string): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
  const expected = Buffer.from(verifyToken);
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}

export type InboundKind = "text" | "photo" | "voice" | "video" | "document" | "location" | "contacts" | "sticker" | "reaction" | "other";

export type InboundMessage = {
  messageId: string;
  /** The customer's WhatsApp number (wa_id): digits, country code first. */
  from: string;
  profileName: string | null;
  sentAt: Date | null;
  kind: InboundKind;
  /** What the customer wrote: the text, a caption, a button's title, a location or contact card as text. */
  text: string | null;
  media: ChatMedia | null;
};

export type StatusUpdate = {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode: number | null;
  errorTitle: string | null;
};

export type NumberDelivery = { phoneNumberId: string; messages: InboundMessage[]; statuses: StatusUpdate[] };

const MAX_TEXT = 4000;

const str = (value: unknown, max = MAX_TEXT): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

function mediaOf(kind: ChatMedia["kind"], part: any): ChatMedia | null {
  const id = str(part?.id, 100);
  if (!id || !/^[\w.-]+$/.test(id)) return null;
  return {
    kind,
    id,
    mimeType: str(part?.mime_type, 100),
    caption: str(part?.caption),
    fileName: str(part?.filename, 200),
  };
}

function readMessage(message: any, names: Map<string, string>): InboundMessage | null {
  const messageId = str(message?.id, 200);
  const from = typeof message?.from === "string" ? message.from.replace(/\D/g, "") : "";
  if (!messageId || !/^\d{6,20}$/.test(from)) return null;
  const seconds = Number(message?.timestamp);
  const base = {
    messageId,
    from,
    profileName: names.get(from) ?? null,
    sentAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
  };

  switch (message?.type) {
    case "text":
      return { ...base, kind: "text", text: str(message.text?.body), media: null };
    case "image": {
      const media = mediaOf("photo", message.image);
      return { ...base, kind: "photo", text: media?.caption ?? null, media };
    }
    case "audio":
      return { ...base, kind: "voice", text: null, media: mediaOf("voice", message.audio) };
    case "video": {
      const media = mediaOf("video", message.video);
      return { ...base, kind: "video", text: media?.caption ?? null, media };
    }
    case "document": {
      const media = mediaOf("document", message.document);
      return { ...base, kind: "document", text: media?.caption ?? null, media };
    }
    case "sticker":
      return { ...base, kind: "sticker", text: null, media: null };
    case "reaction":
      return { ...base, kind: "reaction", text: null, media: null };
    case "location": {
      const location = message.location ?? {};
      const place = [str(location.name, 200), str(location.address, 300)].filter(Boolean).join(", ");
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : "";
      const text = [place, coordinates && `(${coordinates})`].filter(Boolean).join(" ");
      return { ...base, kind: "location", text: text ? `My location: ${text}` : null, media: null };
    }
    case "contacts": {
      const cards = (Array.isArray(message.contacts) ? message.contacts : []).slice(0, 5).map((card: any) => {
        const name = str(card?.name?.formatted_name, 200) ?? "";
        const phones = (Array.isArray(card?.phones) ? card.phones : []).map((phone: any) => str(phone?.phone, 40)).filter(Boolean);
        return [name, ...phones].filter(Boolean).join(" ");
      }).filter(Boolean);
      return { ...base, kind: "contacts", text: cards.length ? `Contact card: ${cards.join("; ")}` : null, media: null };
    }
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return { ...base, kind: "text", text: str(reply?.title, 200), media: null };
    }
    case "button":
      return { ...base, kind: "text", text: str(message.button?.text, 200), media: null };
    default:
      return { ...base, kind: "other", text: null, media: null };
  }
}

function readStatus(status: any): StatusUpdate | null {
  const messageId = str(status?.id, 200);
  const value = status?.status;
  if (!messageId || !["sent", "delivered", "read", "failed"].includes(value)) return null;
  const error = Array.isArray(status.errors) ? status.errors[0] : null;
  return {
    messageId,
    status: value,
    errorCode: Number.isInteger(error?.code) ? error.code : null,
    errorTitle: error ? str(error.title ?? error.message, 300) : null,
  };
}

/** The messages and status updates in one webhook delivery, per business number. */
export function readDelivery(payload: any): NumberDelivery[] {
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const deliveries: NumberDelivery[] = [];
  for (const entry of payload.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = typeof value.metadata?.phone_number_id === "string" ? value.metadata.phone_number_id : "";
      if (!/^\d{5,30}$/.test(phoneNumberId)) continue;
      const names = new Map<string, string>();
      for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
        const waId = typeof contact?.wa_id === "string" ? contact.wa_id.replace(/\D/g, "") : "";
        const name = str(contact?.profile?.name, 100);
        if (waId && name) names.set(waId, name);
      }
      deliveries.push({
        phoneNumberId,
        messages: (Array.isArray(value.messages) ? value.messages : []).map((message: any) => readMessage(message, names)).filter(Boolean) as InboundMessage[],
        statuses: (Array.isArray(value.statuses) ? value.statuses : []).map(readStatus).filter(Boolean) as StatusUpdate[],
      });
    }
  }
  return deliveries;
}
