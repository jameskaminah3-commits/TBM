import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

function parseOrigin(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseExtraSources(value?: string | null) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function addOrigin(target: Set<string>, value?: string | null) {
  const origin = parseOrigin(value);
  if (origin) {
    target.add(origin);
  }
}

function addWebSocketOrigin(target: Set<string>, value?: string | null) {
  const origin = parseOrigin(value);
  if (!origin) {
    return;
  }

  if (origin.startsWith("https://")) {
    target.add(`wss://${origin.slice("https://".length)}`);
    return;
  }

  if (origin.startsWith("http://")) {
    target.add(`ws://${origin.slice("http://".length)}`);
  }
}

function formatDirective(name: string, values: Iterable<string>) {
  return `${name} ${Array.from(new Set(values)).join(" ")}`;
}

function buildContentSecurityPolicy(nonce: string) {
  const connectSrc = new Set<string>(["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  const imageAndMediaSrc = new Set<string>(["'self'", "data:", "blob:", "https:"]);

  addOrigin(connectSrc, process.env.SUPABASE_URL);
  addOrigin(connectSrc, process.env.VITE_SUPABASE_URL);
  addWebSocketOrigin(connectSrc, process.env.SUPABASE_URL);
  addWebSocketOrigin(connectSrc, process.env.VITE_SUPABASE_URL);

  addOrigin(imageAndMediaSrc, process.env.SUPABASE_URL);
  addOrigin(imageAndMediaSrc, process.env.VITE_SUPABASE_URL);
  addOrigin(imageAndMediaSrc, process.env.SUPABASE_MEDIA_PUBLIC_BASE_URL);

  for (const source of parseExtraSources(process.env.CSP_EXTRA_CONNECT_SRC)) {
    connectSrc.add(source);
  }

  for (const source of parseExtraSources(process.env.CSP_EXTRA_IMG_SRC)) {
    imageAndMediaSrc.add(source);
  }

  for (const source of parseExtraSources(process.env.CSP_EXTRA_MEDIA_SRC)) {
    imageAndMediaSrc.add(source);
  }

  return [
    formatDirective("default-src", ["'self'"]),
    formatDirective("base-uri", ["'self'"]),
    formatDirective("object-src", ["'none'"]),
    formatDirective("frame-ancestors", ["'none'"]),
    formatDirective("form-action", ["'self'"]),
    formatDirective("frame-src", ["'none'"]),
    formatDirective("manifest-src", ["'self'"]),
    formatDirective("worker-src", ["'self'", "blob:"]),
    formatDirective("script-src", ["'self'", `'nonce-${nonce}'`]),
    formatDirective("style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]),
    formatDirective("font-src", ["'self'", "data:", "https://fonts.gstatic.com"]),
    formatDirective("img-src", imageAndMediaSrc),
    formatDirective("media-src", imageAndMediaSrc),
    formatDirective("connect-src", connectSrc),
  ].join("; ");
}

export function injectHtmlSecurityContext(html: string, nonce: string) {
  return html.replace(/__CSP_NONCE__/g, nonce);
}

export function applySecurityHeaders(req: Request, res: Response, next: NextFunction) {
  const cspNonce = crypto.randomBytes(16).toString("base64");
  res.locals.cspNonce = cspNonce;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Origin-Agent-Cluster", "?1");

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Content-Security-Policy", buildContentSecurityPolicy(cspNonce));
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}
