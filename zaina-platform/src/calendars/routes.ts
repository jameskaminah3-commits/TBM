// zaina-platform/src/calendars/routes.ts
//
// The calendar connector, for a business's team
// (/v1/staff/businesses/:businessId/…), by role:
//
//   GET    calendars                        viewer   Google connection, busy-time sources, feed links
//   POST   calendars/feeds                  manager  { resource_id?, label? }: a new private link (shown once)
//   DELETE calendars/feeds/:feedId          manager  revokes a link
//   POST   calendars/google/start           owner    the address of Google's consent page
//   GET    calendars/google/calendars       manager  the connected account's calendars
//   PATCH  calendars/google                 owner    { write_calendar_id | null }: where bookings are written
//   DELETE calendars/google                 owner    disconnects (and revokes the sign-in at Google)
//   POST   calendars/sources                manager  { kind: google, calendar_id, label, offering_id? | resource_id? }
//                                                   or { kind: ics, url, label, offering_id? | resource_id? }
//   DELETE calendars/sources/:sourceId      manager  the source and the busy times it brought
//   POST   calendars/sync                   manager  syncs now
//
// And, with no one signed in:
//
//   GET /calendar/<token>.ics              a feed link
//   GET /v1/calendar/google/callback       Google sends the owner back here after consent

import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { businessById } from "../businesses/registry.ts";
import { deleteSecret, getSecret, putSecret } from "../businesses/secrets.ts";
import { booksTime, calendarConnections, calendarSources, type Business } from "../db/schema.ts";
import { getStaffUser } from "../db/platform-scope.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { requireBusinessRole, requireStaff, roleIn, ROLE_RANK, staffOf } from "../staff/auth.ts";
import { getOffering } from "../booking/offerings.ts";
import { getResource } from "../booking/resources.ts";
import { createFeed, deleteFeed, feedCalendar, feedForToken, listFeeds, publicFeed } from "./feed.ts";
import { IcsFetchError, icsUrl } from "./fetch-ics.ts";
import { authorizationUrl, exchangeCode, GOOGLE_SECRET, googleConfigured, listCalendars, readState, revoke } from "./google.ts";
import { forgetGoogle, getConnection, googleTokenFor, icsSecretName, listSources, publicSource, syncBusiness, syncSource } from "./sync.ts";

type Handler = (req: Request, res: Response, context: { business: Business; userId: string }) => Promise<unknown>;

function handle(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = staffOf(req);
      await handler(req, res, { business: context.business!, userId: context.user.id });
    } catch (error) {
      next(error);
    }
  };
}

const FEED_PATH = /^\/calendar\/([A-Za-z0-9_-]{24,64})\.ics$/;

export function registerCalendarRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: "viewer" | "agent" | "manager" | "owner") => [staff, requireBusinessRole(minimum)];
  const origin = config.publicBaseUrl ?? "";
  const feedUrl = (token: string) => `${origin}/calendar/${token}.ics`;

  async function view(business: Business) {
    const [connection, sources, feeds] = await Promise.all([getConnection(business.id), listSources(business.id), listFeeds(business.id)]);
    return {
      google: {
        available: googleConfigured(),
        connected: connection !== undefined,
        account: connection?.account ?? null,
        status: connection?.status ?? null,
        last_error: connection?.lastError ?? null,
        last_sync_at: connection?.lastSyncAt ?? null,
        write_calendar_id: connection?.writeCalendarId ?? null,
      },
      sources: sources.map(publicSource),
      feeds: feeds.map(publicFeed),
    };
  }

  app.get(`${base}/calendars`, ...role("viewer"), handle(async (_req, res, { business }) => {
    res.json(await view(business));
  }));

  // ── Feed links ───────────────────────────────────────────────────────
  app.post(`${base}/calendars/feeds`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const resourceId = typeof req.body?.resource_id === "string" && req.body.resource_id ? req.body.resource_id : null;
    if (resourceId && !(await getResource(business.id, resourceId))) return res.status(404).json({ error: "not_found" });
    const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 80) : "";
    const { feed, token } = await createFeed(business.id, { resourceId, label, createdBy: userId });
    res.status(201).json({ feed: publicFeed(feed), url: feedUrl(token), note: "Copy this link now: it isn't shown again. Anyone with it can see these bookings." });
  }));

  app.delete(`${base}/calendars/feeds/:feedId`, ...role("manager"), handle(async (req, res, { business }) => {
    const deleted = await deleteFeed(business.id, String(req.params.feedId));
    res.status(deleted ? 200 : 404).json({ deleted });
  }));

  app.get(FEED_PATH, async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const token = FEED_PATH.exec(req.path)![1];
      const found = await feedForToken(token);
      const business = found ? await businessById(found.businessId) : undefined;
      if (!found || !business) return res.status(404).type("text/plain").send("Not found");
      const verdict = await consumeLimits([{ key: `calendar-feed:${found.feedId}`, limit: 120, windowSeconds: 3600 }]);
      if (!verdict.allowed) return res.status(429).type("text/plain").send("Too many requests");
      const text = await runForBusiness(business.id, () => feedCalendar(business, found.feedId, { consoleBase: config.publicBaseUrl }));
      if (text === null) return res.status(404).type("text/plain").send("Not found");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.type("text/calendar; charset=utf-8").send(text);
    } catch (error) {
      next(error);
    }
  });

  // ── Google ───────────────────────────────────────────────────────────
  app.post(`${base}/calendars/google/start`, ...role("owner"), handle(async (_req, res, { business, userId }) => {
    if (!googleConfigured()) return res.status(409).json({ error: "google_not_configured", message: "The platform's Google sign-in isn't set up yet." });
    res.json({ url: authorizationUrl(business.id, userId) });
  }));

  // Google sends the owner back here. The state proves which business and
  // person started it; the person must still be an owner there.
  app.get("/v1/calendar/google/callback", async (req: Request, res: Response, next: NextFunction) => {
    const back = (businessId: string | null, outcome: string) => res.redirect(303, `${origin}/console/${businessId ? `#/b/${encodeURIComponent(businessId)}/settings/calendars?google=${outcome}` : ""}`);
    try {
      const state = readState(req.query.state);
      if (!state) return back(null, "expired");
      if (typeof req.query.error === "string") return back(state.businessId, "declined");
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const [business, user] = await Promise.all([businessById(state.businessId), getStaffUser(state.userId)]);
      if (!business || !user || user.disabledAt || !code) return back(null, "expired");
      const allowed = await roleIn(business.id, user);
      if (!allowed || ROLE_RANK[allowed] < ROLE_RANK.owner) return back(business.id, "forbidden");
      const granted = await exchangeCode(code);
      await runForBusiness(business.id, async () => {
        const old = await getSecret(business.id, GOOGLE_SECRET);
        await putSecret(business.id, GOOGLE_SECRET, granted.refreshToken, user.id);
        await inBusiness((db) => db.insert(calendarConnections).values({ businessId: business.id, account: granted.account, status: "connected", connectedBy: user.id })
          .onConflictDoUpdate({ target: calendarConnections.businessId, set: { account: granted.account, status: "connected", lastError: null, connectedBy: user.id, updatedAt: new Date() } }), business.id);
        if (old && old !== granted.refreshToken) await revoke(old);
      });
      back(business.id, "connected");
    } catch (error) {
      console.error("[calendars] Google sign-in failed:", error);
      try {
        back(readState(req.query.state)?.businessId ?? null, "failed");
      } catch (inner) {
        next(inner);
      }
    }
  });

  app.get(`${base}/calendars/google/calendars`, ...role("manager"), handle(async (_req, res, { business }) => {
    const token = await googleTokenFor(business.id);
    if (!token) return res.status(409).json({ error: "not_connected", message: "Connect a Google account first (or connect it again)." });
    res.json({ calendars: await listCalendars(token) });
  }));

  app.patch(`${base}/calendars/google`, ...role("owner"), handle(async (req, res, { business }) => {
    const connection = await getConnection(business.id);
    if (!connection) return res.status(409).json({ error: "not_connected", message: "Connect a Google account first." });
    const value = req.body?.write_calendar_id;
    if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 300)) return res.status(400).json({ error: "invalid_calendar", message: "write_calendar_id is a calendar's id, or null." });
    if (value !== null) {
      const token = await googleTokenFor(business.id);
      const calendars = token ? await listCalendars(token) : [];
      if (!calendars.some((calendar) => calendar.id === value && calendar.canWrite)) return res.status(400).json({ error: "invalid_calendar", message: "Choose one of the account's calendars you can write to." });
    }
    await inBusiness((db) => db.update(calendarConnections).set({ writeCalendarId: value, updatedAt: new Date() }).where(eq(calendarConnections.businessId, business.id)), business.id);
    res.json(await view(business));
  }));

  app.delete(`${base}/calendars/google`, ...role("owner"), handle(async (_req, res, { business }) => {
    const refresh = await getSecret(business.id, GOOGLE_SECRET);
    await forgetGoogle(business.id);
    await deleteSecret(business.id, GOOGLE_SECRET);
    if (refresh) await revoke(refresh);
    res.json(await view(business));
  }));

  // ── Busy times from other calendars ──────────────────────────────────
  app.post(`${base}/calendars/sources`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const body = req.body ?? {};
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
    if (!label) return res.status(400).json({ error: "label_required", message: "Give the calendar a name, like \"Airbnb: Garden cottage\"." });
    const offeringId = typeof body.offering_id === "string" && body.offering_id ? body.offering_id : null;
    const resourceId = typeof body.resource_id === "string" && body.resource_id ? body.resource_id : null;
    if (offeringId && resourceId) return res.status(400).json({ error: "one_target", message: "A calendar blocks a room type, or a person or table, not both." });
    if (business.businessType === "guesthouse" && !offeringId) return res.status(400).json({ error: "room_type_required", message: "Choose the room type this calendar's bookings are for." });
    if (booksTime(business.businessType) && offeringId) return res.status(400).json({ error: "invalid_target", message: "Choose a person or table, or the whole business." });
    if (offeringId && !(await getOffering(business.id, offeringId))) return res.status(404).json({ error: "not_found" });
    if (resourceId && !(await getResource(business.id, resourceId))) return res.status(404).json({ error: "not_found" });
    let link: string | null = null;
    let calendarId: string | null = null;
    if (body.kind === "ics") {
      try {
        link = icsUrl(String(body.url ?? "")).toString();
      } catch (error) {
        return res.status(400).json({ error: "invalid_url", message: error instanceof IcsFetchError ? error.message : "That isn't a calendar link." });
      }
    } else if (body.kind === "google") {
      calendarId = typeof body.calendar_id === "string" ? body.calendar_id.trim() : "";
      const token = await googleTokenFor(business.id);
      if (!token) return res.status(409).json({ error: "not_connected", message: "Connect a Google account first." });
      if (!(await listCalendars(token)).some((calendar) => calendar.id === calendarId)) return res.status(400).json({ error: "invalid_calendar", message: "Choose one of the connected account's calendars." });
    } else {
      return res.status(400).json({ error: "invalid_kind", message: "kind is google or ics." });
    }
    const [source] = await inBusiness((db) => db.insert(calendarSources).values({ businessId: business.id, kind: body.kind, calendarId, label, offeringId, resourceId, createdBy: userId }).returning(), business.id);
    if (link) await putSecret(business.id, icsSecretName(source.id), link, userId);
    const result = await syncSource(business, source);
    if (!result.ok) {
      // A calendar that can't be read now isn't kept: the team fixes the link and adds it again.
      await inBusiness((db) => db.delete(calendarSources).where(eq(calendarSources.id, source.id)), business.id);
      if (link) await deleteSecret(business.id, icsSecretName(source.id));
      return res.status(400).json({ error: "calendar_unreadable", message: `That calendar couldn't be read: ${result.error}` });
    }
    const [saved] = await inBusiness((db) => db.select().from(calendarSources).where(eq(calendarSources.id, source.id)).limit(1), business.id);
    res.status(201).json({ source: publicSource(saved), synced: result });
  }));

  app.delete(`${base}/calendars/sources/:sourceId`, ...role("manager"), handle(async (req, res, { business }) => {
    const id = String(req.params.sourceId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: "not_found" });
    const rows = await inBusiness((db) => db.delete(calendarSources).where(and(eq(calendarSources.businessId, business.id), eq(calendarSources.id, id))).returning(), business.id);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    if (rows[0].kind === "ics") await deleteSecret(business.id, icsSecretName(id));
    res.json({ deleted: true });
  }));

  app.post(`${base}/calendars/sync`, ...role("manager"), handle(async (_req, res, { business }) => {
    const summary = await syncBusiness(business);
    res.json({ summary, ...(await view(business)) });
  }));
}
