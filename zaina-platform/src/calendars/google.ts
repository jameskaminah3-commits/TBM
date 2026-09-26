// zaina-platform/src/calendars/google.ts
//
// Google Calendar, through the platform's own Google OAuth app
// (PLATFORM_GOOGLE_CLIENT_ID and PLATFORM_GOOGLE_CLIENT_SECRET). A business
// signs in with Google once; the refresh token Google returns is kept as a
// business secret ("google_refresh_token"), and short-lived access tokens
// are fetched from it as needed.
//
// Scopes: the account's email (to show which account is connected), read
// its calendars (busy times), and write events (bookings).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_SECRET = "google_refresh_token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"];

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string };

let config: GoogleConfig | null = null;

export function configureGoogle(next: GoogleConfig | null) {
  config = next;
  tokens.clear();
}

export const googleConfigured = () => config !== null;

/** Google turned the connection down: the business must connect again. */
export class GoogleAuthError extends Error {}

// ── Signing in ────────────────────────────────────────────────────────

const STATE_TTL_SECONDS = 15 * 60;

function stateSignature(payload: string): string {
  const key = createHmac("sha256", config!.stateSecret).update("zaina-google-state").digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Where to send the owner to connect: Google's consent page, with a signed state naming the business and person. */
export function authorizationUrl(businessId: string, userId: string, now = new Date()): string {
  if (!config) throw new Error("Google isn't configured on this platform");
  const payload = Buffer.from(JSON.stringify({ b: businessId, u: userId, n: randomBytes(8).toString("hex"), exp: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS })).toString("base64url");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state: `${payload}.${stateSignature(payload)}`,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** The business and person a state names, if it's ours and fresh. */
export function readState(state: unknown, now = new Date()): { businessId: string; userId: string } | null {
  if (!config || typeof state !== "string" || state.length > 600) return null;
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(stateSignature(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims?.b !== "string" || typeof claims?.u !== "string" || !Number.isInteger(claims?.exp)) return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { businessId: claims.b, userId: claims.u };
  } catch {
    return null;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config!.clientId, client_secret: config!.clientSecret, ...body }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    if (data?.error === "invalid_grant") throw new GoogleAuthError("Google no longer accepts this connection: connect again.");
    throw new Error(`Google refused the sign-in (${response.status}${data?.error ? `: ${data.error}` : ""})`);
  }
  return data;
}

/** The email in an id_token Google just sent us directly (over HTTPS, so it needn't be checked again). */
function emailOf(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof claims?.email === "string" ? claims.email.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Swaps the code Google sent back for a refresh token, and the account's email. */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; account: string | null }> {
  if (!config) throw new Error("Google isn't configured on this platform");
  const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
  if (typeof data.refresh_token !== "string") throw new Error("Google didn't return a refresh token");
  return { refreshToken: data.refresh_token, account: emailOf(data.id_token) };
}

/** Access tokens, by refresh token, until shortly before they expire. */
const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function accessToken(refreshToken: string): Promise<string> {
  if (!config) throw new Error("Google isn't configured on this platform");
  const cached = tokens.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  const token = String(data.access_token ?? "");
  if (!token) throw new Error("Google didn't return an access token");
  tokens.set(refreshToken, { token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000 });
  return token;
}

/** Revokes a refresh token at Google (disconnecting). Never throws. */
export async function revoke(refreshToken: string): Promise<void> {
  tokens.delete(refreshToken);
  try {
    await fetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }).toString(), signal: AbortSignal.timeout(10_000) });
  } catch {
    // The business has already removed it here; Google forgets unused tokens anyway.
  }
}

// ── The Calendar API ──────────────────────────────────────────────────

async function call(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({})) as any;
  if (response.status === 401) throw new GoogleAuthError("Google no longer accepts this connection: connect again.");
  if (!response.ok) {
    const error = new Error(`Google Calendar: ${data?.error?.message ?? response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

export type GoogleCalendar = { id: string; name: string; primary: boolean; canWrite: boolean };

export async function listCalendars(token: string): Promise<GoogleCalendar[]> {
  const data = await call(token, "GET", "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  return (data?.items ?? []).map((item: any) => ({
    id: String(item.id),
    name: String(item.summaryOverride ?? item.summary ?? item.id).slice(0, 120),
    primary: item.primary === true,
    canWrite: item.accessRole === "owner" || item.accessRole === "writer",
  }));
}

export type GoogleBusy = { id: string; days: { from: string; to: string } | null; start: Date; end: Date };

/**
 * A calendar's busy events in [from, to): repeating events expanded, and
 * without cancelled events, ones marked free, or the platform's own booking
 * events (they are bookings already).
 */
export async function busyEvents(token: string, calendarId: string, from: Date, to: Date, timeZone: string): Promise<GoogleBusy[]> {
  const busy: GoogleBusy[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", maxResults: "2500", showDeleted: "false", timeZone });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await call(token, "GET", `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`);
    for (const item of data?.items ?? []) {
      if (item.status === "cancelled" || item.transparency === "transparent") continue;
      if (item.extendedProperties?.private?.zaina_booking) continue;
      const allDay = typeof item.start?.date === "string";
      const start = allDay ? null : new Date(item.start?.dateTime);
      const end = allDay ? null : new Date(item.end?.dateTime);
      if (allDay) {
        busy.push({ id: String(item.id), days: { from: item.start.date, to: item.end?.date ?? item.start.date }, start: new Date(`${item.start.date}T00:00:00Z`), end: new Date(`${item.end?.date ?? item.start.date}T00:00:00Z`) });
      } else if (start && end && !Number.isNaN(start.getTime()) && end > start) {
        busy.push({ id: String(item.id), days: null, start, end });
      }
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return busy;
}

export type GoogleEventInput = {
  summary: string;
  description: string;
  days?: { from: string; to: string };
  start?: Date;
  end?: Date;
  timeZone: string;
  bookingId: string;
  tentative: boolean;
};

function eventBody(input: GoogleEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: input.days ? { date: input.days.from } : { dateTime: input.start!.toISOString(), timeZone: input.timeZone },
    end: input.days ? { date: input.days.to } : { dateTime: input.end!.toISOString(), timeZone: input.timeZone },
    status: input.tentative ? "tentative" : "confirmed",
    // Marks it as a booking, so reading busy times skips it.
    extendedProperties: { private: { zaina_booking: input.bookingId } },
  };
}

export async function insertEvent(token: string, calendarId: string, input: GoogleEventInput): Promise<string> {
  const data = await call(token, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, eventBody(input));
  return String(data.id);
}

export async function updateEvent(token: string, calendarId: string, eventId: string, input: GoogleEventInput): Promise<void> {
  await call(token, "PUT", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, eventBody(input));
}

/** Deletes an event; one already gone counts as deleted. */
export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await call(token, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 404 && status !== 410) throw error;
  }
}
