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
import { sweepUnclaimedHandoffs } from "./conversations/handoff.ts";
import { deleteExpiredConversations } from "./conversations/retention.ts";
import { registerStaffConversationRoutes } from "./conversations/staff-routes.ts";
import { assertAppRole, closePlatformDb, initPlatformDb, ownerPool } from "./db/platform-db.ts";
import { migrate, pendingMigrations } from "./db/migrate.ts";
import type { EngineOptions } from "./engine/agent.ts";
import { normalizeOrigin } from "./gateway/origin.ts";
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

export function createApp(config: PlatformConfig, engine: EngineOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(express.json({ limit: "32kb" }));
  app.use(cors());

  registerGatewayRoutes(app, config, engine);
  registerStaffAccountRoutes(app, config);
  registerStaffConversationRoutes(app, config.sessionTokenSecret);
  registerPlatformRoutes(app, config);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[platform] request failed:", error);
    if (res.headersSent) return;
    const status = (error as { type?: string })?.type === "entity.parse.failed" ? 400 : 500;
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
  initPlatformDb(config.platformDatabaseUrl, { appConnectionString: config.platformAppDatabaseUrl });
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
  await assertAppRole();
  setSecretKeys(loadSecretKeys());
  setExtraAllowedOrigins((process.env.EXTRA_ALLOWED_ORIGINS ?? "").split(","));

  const engine: EngineOptions = {
    ai: new GoogleGenAI({ apiKey: config.geminiApiKey }),
    model: config.model,
    turnBudgetMs: config.turnBudgetMs,
    prices: config.modelPriceUsdPerMillion,
  };
  const app = createApp(config, engine);
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
  ];

  const stop = async () => {
    jobs.forEach(clearInterval);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePlatformDb();
  };
  return { server, stop };
}
