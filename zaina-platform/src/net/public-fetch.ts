// zaina-platform/src/net/public-fetch.ts
//
// Reading a page on the public internet for a business (its website, for
// knowledge). The address comes from outside, so the platform must not be
// used to reach its own network:
//
//   - https on the standard port only, with no user name or password;
//   - every address the name resolves to must be public (not private,
//     loopback, link-local or multicast). The check runs when the
//     connection is made (a lookup of our own), so a name can't answer one
//     address to a check and another to the request;
//   - at most three redirects, each checked the same way;
//   - a time limit for the whole read, and a size limit counted after
//     decompression (a small compressed page can't grow without bound).

import dns from "node:dns";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

export class PublicFetchError extends Error {}

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
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff")
    || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:");
}

const INTERNAL_NAME = /(^|\.)(localhost|internal|local|localdomain|home\.arpa)$/i;

/** An address someone typed ("coralcove.co.ke", "https://…"), as an https URL, or why it can't be used. */
export function publicUrl(input: string | URL): URL {
  let url: URL;
  try {
    const text = String(input).trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new PublicFetchError("That isn't a web address.");
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new PublicFetchError("Use a web address that starts with https://.");
  if (url.username || url.password) throw new PublicFetchError("The address can't carry a user name or password.");
  if (url.port && url.port !== "443") throw new PublicFetchError("The address must use the standard https port.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? privateAddress(host) : INTERNAL_NAME.test(host) || !host.includes(".")) {
    throw new PublicFetchError("That address isn't on the public internet.");
  }
  url.hash = "";
  return url;
}

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** A DNS lookup for connections that refuses names resolving to any address the platform must not reach. */
export function publicLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const done = callback as (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
    if (INTERNAL_NAME.test(hostname)) return done(new PublicFetchError("That address isn't on the public internet."), "", 4);
    resolve(hostname).then((addresses) => {
      if (!addresses.length) return done(new PublicFetchError("That address couldn't be found."), "", 4);
      if (addresses.some((entry) => privateAddress(entry.address))) return done(new PublicFetchError("That address isn't on the public internet."), "", 4);
      const wanted = options.family === 4 || options.family === 6 ? addresses.filter((entry) => entry.family === options.family) : addresses;
      if (!wanted.length) return done(new PublicFetchError("That address couldn't be found."), "", 4);
      if (options.all) done(null, wanted);
      else done(null, wanted[0].address, wanted[0].family);
    }, () => done(new PublicFetchError("That address couldn't be found."), "", 4));
  };
}

export type PublicFetchOptions = {
  /** What the request accepts, e.g. "text/html". */
  accept: string;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
};

export type PublicResponse = { url: URL; status: number; contentType: string; body: Buffer };

const lookup = publicLookup();

function request(url: URL, options: PublicFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const sent = https.request(url, {
      method: "GET",
      headers: { accept: options.accept, "accept-encoding": "gzip, deflate, br", "user-agent": "ZainaBot/1.0 (reads a business's own pages for its assistant)" },
      lookup,
      // A connection of its own: never one reused from another address.
      agent: false,
      signal,
    }, resolve);
    sent.on("error", (error) => reject(error));
    sent.end();
  });
}

/** Reads a response's body, decompressed, up to maxBytes. */
function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase().trim();
  const decoder = encoding === "gzip" || encoding === "x-gzip" ? zlib.createGunzip()
    : encoding === "deflate" ? zlib.createInflate()
      : encoding === "br" ? zlib.createBrotliDecompress()
        : null;
  const stream = decoder ? response.pipe(decoder) : response;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        response.destroy();
        decoder?.destroy();
        reject(new PublicFetchError(`The page is too big (over ${Math.round(maxBytes / 1024 / 1024)} MB).`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => reject(new PublicFetchError("The page couldn't be read.")));
  });
}

/** Reads one public https address, following redirects, within the limits. */
export async function fetchPublic(input: string | URL, options: PublicFetchOptions): Promise<PublicResponse> {
  let url = publicUrl(input);
  const signal = AbortSignal.timeout(options.timeoutMs);
  for (let hop = 0; ; hop += 1) {
    let response: IncomingMessage;
    try {
      response = await request(url, options, signal);
    } catch (error) {
      if (error instanceof PublicFetchError) throw error;
      const name = (error as Error).name;
      throw new PublicFetchError(name === "AbortError" || name === "TimeoutError" ? "The website took too long to answer." : "The website couldn't be reached.");
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= (options.maxRedirects ?? 3)) throw new PublicFetchError("The address redirects too many times.");
      url = publicUrl(new URL(response.headers.location, url));
      continue;
    }
    const declared = Number(response.headers["content-length"] ?? "0");
    if (declared > options.maxBytes) {
      response.destroy();
      throw new PublicFetchError(`The page is too big (over ${Math.round(options.maxBytes / 1024 / 1024)} MB).`);
    }
    let body: Buffer;
    try {
      body = await readBody(response, options.maxBytes);
    } catch (error) {
      if (error instanceof PublicFetchError) throw error;
      throw new PublicFetchError("The page couldn't be read.");
    }
    return { url, status, contentType: String(response.headers["content-type"] ?? "").toLowerCase(), body };
  }
}
