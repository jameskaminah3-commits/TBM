// zaina-platform/src/app.ts
//
// The HTTP app and the service's start-up: database, migrations check,
// routes and the background jobs (unclaimed handoffs, retention, rate-limit
// counters).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import { GoogleGenAI } from "@google/genai";
import type { PlatformConfig } from "./config.ts";
import { anyAllowedOrigins, setExtraAllowedOrigins } from "./businesses/registry.ts";
import { loadSecretKeys, setSecretKeys } from "./businesses/secrets.ts";
import type { WhatsappContext } from "./channels/whatsapp/context.ts";
import { registerWhatsappRoutes, WEBHOOK_PATH } from "./channels/whatsapp/routes.ts";
import { setWhatsappRuntime } from "./channels/whatsapp/runtime.ts";
import { sweepWhatsapp } from "./channels/whatsapp/worker.ts";
import { configureHandoffs, sweepUnclaimedHandoffs } from "./conversations/handoff.ts";
import { deleteExpiredConversations } from "./conversations/retention.ts";
import { registerStaffConversationRoutes } from "./conversations/staff-routes.ts";
import { configureTeamAlerts } from "./conversations/team-alerts.ts";
import { registerConsoleRoutes } from "./console/routes.ts";
import { describeDatabaseUrl } from "./db/connection.ts";
import { assertAppRole, closePlatformDb, explainConnectionError, initPlatformDb, ownerPool } from "./db/platform-db.ts";
import { migrate, pendingMigrations } from "./db/migrate.ts";
import type { EngineOptions } from "./engine/agent.ts";
import { normalizeOrigin } from "./gateway/origin.ts";
import { KNOWLEDGE_PATH, registerKnowledgeRoutes } from "./knowledge/routes.ts";
import { pruneRateLimitCounters } from "./gateway/rate-limit.ts";
import { registerGatewayRoutes } from "./gateway/routes.ts";
import { registerPlatformRoutes } from "./platform/routes.ts";
import { registerStaffAccountRoutes } from "./staff/routes.ts";

/** Browsers may call the API from any website a business allows. */
function cors() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    if (origin) {
      try {
        const allowed = (await anyAllowedOrigins()).map(normalizeOrigin);
        if (allowed.includes(normalizeOrigin(origin))) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-zaina-currency");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
          res.setHeader("Access-Control-Max-Age", "600");
        }
      } catch (error) {
        return next(error);
      }
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** The WhatsApp channel, when the platform's Meta app is configured. */
export function whatsappContextFor(config: PlatformConfig, engine: EngineOptions): WhatsappContext | null {
  return config.whatsapp
    ? { whatsapp: config.whatsapp, engine, sessionSecret: config.sessionTokenSecret, limits: config.rateLimits }
    : null;
}

export function createApp(config: PlatformConfig, engine: EngineOptions, whatsapp: WhatsappContext | null = whatsappContextFor(config, engine)): Express {
  configureTeamAlerts(config);
  configureHandoffs(config);
  setWhatsappRuntime(whatsapp);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  // Knowledge routes parse their own, bigger bodies (documents); the WhatsApp
  // webhook needs the raw body to check Meta's signature.
  const json = express.json({ limit: "32kb" });
  app.use((req: Request, res: Response, next: NextFunction) => (KNOWLEDGE_PATH.test(req.path) || req.path === WEBHOOK_PATH ? next() : json(req, res, next)));
  app.use(cors());

  registerGatewayRoutes(app, config, engine);
  registerStaffAccountRoutes(app, config);
  registerStaffConversationRoutes(app, config);
  registerKnowledgeRoutes(app, config.sessionTokenSecret);
  registerPlatformRoutes(app, config);
  registerWhatsappRoutes(app, config, whatsapp);
  registerConsoleRoutes(app, config);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[platform] request failed:", error);
    if (res.headersSent) return;
    const type = (error as { type?: string })?.type;
    if (type === "entity.too.large") return res.status(413).json({ error: "too_large" });
    const status = type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ error: status === 400 ? "invalid_json" : "server_error" });
  });
  return app;
}

function every(label: string, ms: number, job: () => Promise<unknown>): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (error) {
      console.error(`[platform] ${label} failed:`, error);
    } finally {
      running = false;
    }
  }, ms);
}

export async function startServer(config: PlatformConfig): Promise<{ server: Server; stop: () => Promise<void> }> {
  initPlatformDb(config.platformDatabaseUrl, {
    appConnectionString: config.platformAppDatabaseUrl,
    ca: config.platformDatabaseCa,
    max: config.databasePoolMax,
  });
  if (!config.platformAppDatabaseUrl && !describeDatabaseUrl(config.platformDatabaseUrl).local) {
    console.warn("[platform] PLATFORM_APP_DATABASE_URL isn't set: business queries sign in as the owner and switch to zaina_app. Set it, so they sign in as zaina_app itself.");
  }
  try {
    await ownerPool().query("select 1");
  } catch (error) {
    throw explainConnectionError(error);
  }
  if (config.migrateOnStart) {
    const applied = await migrate(ownerPool(), { log: (message) => console.log(`[migrate] ${message}`) });
    if (applied.length) console.log(`[migrate] applied ${applied.join(", ")}`);
  } else {
    const pending = await pendingMigrations(ownerPool());
    if (pending.length) {
      throw new Error(`Pending migrations: ${pending.map((migration) => migration.version).join(", ")}. Run npm run migrate first.`);
    }
  }
  // Business data must only ever be read as the restricted role.
  try {
    await assertAppRole();
  } catch (error) {
    throw explainConnectionError(error);
  }
  setSecretKeys(loadSecretKeys());
  setExtraAllowedOrigins((process.env.EXTRA_ALLOWED_ORIGINS ?? "").split(","));

  const engine: EngineOptions = {
    ai: new GoogleGenAI({ apiKey: config.geminiApiKey }),
    model: config.model,
    turnBudgetMs: config.turnBudgetMs,
    prices: config.modelPriceUsdPerMillion,
  };
  const whatsapp = whatsappContextFor(config, engine);
  const app = createApp(config, engine, whatsapp);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(config.port, () => resolve(listening));
  });
  console.log(`[platform] listening on ${config.port}`);

  const sweepEveryMs = Number(process.env.HANDOFF_SWEEP_INTERVAL_MS ?? "") || 60_000;
  const jobs = [
    every("unclaimed handoffs", sweepEveryMs, async () => {
      const handedBack = await sweepUnclaimedHandoffs();
      if (handedBack.length) console.log(`[platform] handed back ${handedBack.length} unclaimed chat(s) to Zaina`);
    }),
    every("retention", 60 * 60_000, async () => {
      const deleted = await deleteExpiredConversations();
      if (deleted) console.log(`[platform] deleted ${deleted} expired conversation(s)`);
    }),
    every("rate-limit counters", 60 * 60_000, () => pruneRateLimitCounters()),
    ...(whatsapp ? [every("whatsapp", Number(process.env.WHATSAPP_SWEEP_INTERVAL_MS ?? "") || 5_000, () => sweepWhatsapp(whatsapp))] : []),
  ];

  const stop = async () => {
    jobs.forEach(clearInterval);
    setWhatsappRuntime(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePlatformDb();
  };
  return { server, stop };
}
