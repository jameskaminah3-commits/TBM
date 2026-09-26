// zaina-platform/src/calendars/fetch-ics.ts
//
// Fetching an iCal link a business gave us (a channel manager's, Airbnb's,
// Booking.com's). The address comes from outside, so the platform must not
// be used to reach its own network: only https (webcal:// is read as
// https://), no addresses on private, loopback or link-local networks
// (checked for every address the name resolves to, and again after each
// redirect), at most three redirects, 15 seconds and 3 MB.

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class IcsFetchError extends Error {}

/** Whether an IP address is on a network the platform must not reach. */
export function privateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const lower = ip.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff");
}

/** A link a business typed, as an https URL, or why it can't be used. */
export function icsUrl(input: string): URL {
  let text = input.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new IcsFetchError("That isn't a web address.");
  }
  if (url.protocol !== "https:") throw new IcsFetchError("Calendar links must start with https:// (or webcal://).");
  if (url.username || url.password) throw new IcsFetchError("Calendar links can't carry a user name or password.");
  if (url.port && url.port !== "443") throw new IcsFetchError("Calendar links use the standard https port.");
  return url;
}

async function checkHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (privateAddress(host)) throw new IcsFetchError("That address isn't on the public internet.");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new IcsFetchError("That address isn't on the public internet.");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new IcsFetchError("That address couldn't be found.");
  }
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new IcsFetchError("That address isn't on the public internet.");
}

/** The text of an iCal link. */
export async function fetchIcs(input: string): Promise<string> {
  let url = icsUrl(input);
  for (let hop = 0; ; hop += 1) {
    await checkHost(url);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "user-agent": "Zaina-Calendar/1.0" }, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new IcsFetchError(`The calendar couldn't be reached (${(error as Error).name === "TimeoutError" ? "it took too long" : "no answer"}).`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) throw new IcsFetchError("The calendar link redirects too many times.");
      url = icsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new IcsFetchError(`The calendar link answered ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) throw new IcsFetchError("The calendar is too big (over 3 MB).");
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new IcsFetchError("The calendar is too big (over 3 MB).");
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new IcsFetchError("That link isn't an iCal calendar.");
    return text;
  }
}
