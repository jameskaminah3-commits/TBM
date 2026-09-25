// zaina-platform/src/channels/whatsapp/format.ts
//
// Zaina's replies are plain text already (the reply policy strips markdown);
// WhatsApp needs a little more: a markdown link becomes "label: address"
// (WhatsApp links bare addresses itself), headings and **bold** become
// WhatsApp's *bold*, and a message longer than WhatsApp allows is split at
// paragraph, line or word breaks.

/** WhatsApp's limit for one text message. */
export const WHATSAPP_TEXT_LIMIT = 4096;

export function toWhatsappText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => {
      const name = label.trim();
      return name === url || name.replace(/^https?:\/\//, "") === url.replace(/^https?:\/\//, "") ? url : `${name}: ${url}`;
    })
    .replace(/^#{1,6}\s+(.+?)\s*#*$/gm, "*$1*")
    .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
    .replace(/__([^_\n]+?)__/g, "_$1_")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits a message into parts WhatsApp accepts, at the most natural break before the limit. */
export function splitMessage(text: string, limit = WHATSAPP_TEXT_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit * 0.5) cut = window.lastIndexOf("\n");
    if (cut < limit * 0.5) cut = window.lastIndexOf(" ");
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** A team reply names who wrote it: "*Amina*: …". */
export function teamReply(authorFirstName: string | null, text: string): string {
  return authorFirstName ? `*${authorFirstName.replace(/[*_~`]/g, "")}*: ${text}` : text;
}
