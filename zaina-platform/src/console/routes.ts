// zaina-platform/src/console/routes.ts
//
// The business console (a single-page app at /console/) and the website
// widget script (/widget.js), and the routes only the console uses:
//
//   POST   /v1/console/session              sign in: { email, password } → sets the console's cookie
//   DELETE /v1/console/session              sign out
//   GET    /v1/console/me                   who is signed in, their businesses, alert settings
//   POST   /v1/console/push-subscriptions   alerts on this phone or browser: { endpoint, keys: { p256dh, auth } }
//   DELETE /v1/console/push-subscriptions   { endpoint }: stop them
//
// Everything else the console does goes through the staff API, with the
// cookie and the X-Zaina-Console header (see staff/auth.ts).

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { pushPublicKey } from "../conversations/team-alerts.ts";
import { deletePushSubscription, membershipsOf, pushSubscriptionCount, savePushSubscription } from "../db/platform-scope.ts";
import { clearConsoleCookie, requireStaff, setConsoleCookie, staffOf } from "../staff/auth.ts";
import { signIn } from "../staff/routes.ts";
import { issueStaffToken } from "../staff/tokens.ts";

/** The built widget and console: PLATFORM_PUBLIC_DIR, or dist/public (next to dist/server.js, or two up from src/console/). */
export function publicDirectory(config: PlatformConfig): string | null {
  const candidates = config.publicDir
    ? [path.resolve(config.publicDir)]
    : ["./public/", "../../dist/public/"].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
  return candidates.find((directory) => existsSync(path.join(directory, "widget.js"))) ?? null;
}

const CONSOLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const publicUser = (user: { id: string; email: string; name: string; isPlatformAdmin: boolean }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  is_platform_admin: user.isPlatformAdmin,
});

export function registerConsoleRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const staff = requireStaff(secret);
  const directory = publicDirectory(config);
  if (!directory) console.warn("[platform] the widget and console aren't built (npm run build:web); /widget.js and /console/ are off");

  // ── The widget script: any website may load it; it only works where the business allows. ──
  app.get("/widget.js", (_req: Request, res: Response) => {
    if (!directory) return res.status(404).type("text/plain").send("// The widget isn't built on this server.");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(directory, "widget.js"), { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  });

  // ── The console ────────────────────────────────────────────────────────
  // Express matches "/console" and "/console/" alike: only the first is sent on.
  app.get("/console", (req: Request, res: Response, next: NextFunction) => (req.path.endsWith("/") ? next() : res.redirect(301, "/console/")));
  if (directory) {
    app.use("/console", express.static(path.join(directory, "console"), {
      index: "index.html",
      redirect: false,
      setHeaders: (res, file) => {
        res.setHeader("Content-Security-Policy", CONSOLE_CSP);
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-cache");
        if (file.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed", "/console/");
      },
    }));
  }

  app.post("/v1/console/session", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outcome = await signIn(secret, req);
      if (!outcome.ok) {
        if (outcome.retryAfterSeconds) res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
        return res.status(outcome.status).json(outcome.body);
      }
      setConsoleCookie(res, issueStaffToken(secret, outcome.user));
      res.json({ user: publicUser(outcome.user), businesses: await membershipsOf(outcome.user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/console/session", (_req: Request, res: Response) => {
    clearConsoleCookie(res);
    res.json({ ok: true });
  });

  app.get("/v1/console/me", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user } = staffOf(req);
      res.json({
        user: publicUser(user),
        businesses: await membershipsOf(user.id),
        push: { public_key: pushPublicKey(), devices: await pushSubscriptionCount(user.id) },
        public_base_url: config.publicBaseUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/console/push-subscriptions", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!pushPublicKey()) return res.status(404).json({ error: "push_off", message: "Alerts on phones aren't set up on this platform." });
      const endpoint = req.body?.endpoint;
      const p256dh = req.body?.keys?.p256dh;
      const auth = req.body?.keys?.auth;
      const valid = typeof endpoint === "string" && /^https:\/\/[^\s]{8,1990}$/.test(endpoint)
        && typeof p256dh === "string" && /^[\w-]{40,200}$/.test(p256dh)
        && typeof auth === "string" && /^[\w-]{10,100}$/.test(auth);
      if (!valid) return res.status(400).json({ error: "invalid_subscription" });
      const userAgent = String(req.header("user-agent") ?? "").slice(0, 300) || null;
      await savePushSubscription(staffOf(req).user.id, { endpoint, p256dh, auth }, userAgent);
      res.status(201).json({ ok: true, devices: await pushSubscriptionCount(staffOf(req).user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/console/push-subscriptions", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const endpoint = req.body?.endpoint;
      if (typeof endpoint !== "string") return res.status(400).json({ error: "endpoint_required" });
      const removed = await deletePushSubscription(endpoint, staffOf(req).user.id);
      res.status(removed ? 200 : 404).json({ removed, devices: await pushSubscriptionCount(staffOf(req).user.id) });
    } catch (error) {
      next(error);
    }
  });
}
