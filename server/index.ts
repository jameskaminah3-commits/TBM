import dotenv from "dotenv";

dotenv.config();

import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import path from "path";
import {
  buildLegacyUploadRedirectUrl,
  canUseSupabaseMediaStorage,
  ensureMediaStorageReady,
  ensureUploadDir,
  usesLocalUploadStorage,
} from "./media";
import { registerRoutes } from "./routes";
import { applySecurityHeaders } from "./security";
import { log, serveStatic, setupVite } from "./vite";

const app = express();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT ?? "24mb";
const urlencodedBodyLimit = process.env.URLENCODED_BODY_LIMIT ?? "1mb";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function getBoundPort(server: Server, fallbackPort: number) {
  const address = server.address();
  if (address && typeof address === "object") {
    return (address as AddressInfo).port;
  }

  return fallbackPort;
}

function listen(server: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    const handleError = (error: NodeJS.ErrnoException) => {
      server.off("listening", handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.off("error", handleError);
      resolve(getBoundPort(server, port));
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port);
  });
}

async function listenOnAvailablePort(server: Server, requestedPort: number, allowPortFallback: boolean) {
  let port = requestedPort;

  while (true) {
    try {
      return await listen(server, port);
    } catch (error) {
      const listenError = error as NodeJS.ErrnoException;
      if (!allowPortFallback || listenError.code !== "EADDRINUSE") {
        throw error;
      }

      const nextPort = port + 1;
      log(`port ${port} is in use, retrying on ${nextPort}`);
      port = nextPort;
    }
  }
}

app.disable("x-powered-by");
app.use(applySecurityHeaders);

app.use(express.json({
  limit: jsonBodyLimit,
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: false, limit: urlencodedBodyLimit }));

ensureMediaStorageReady();
if (usesLocalUploadStorage()) {
  ensureUploadDir();
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
} else if (canUseSupabaseMediaStorage()) {
  app.get("/uploads/*", (req, res) => {
    try {
      const uploadPath = (req.params as { 0?: string })[0] ?? "";
      const targetUrl = buildLegacyUploadRedirectUrl(uploadPath);
      res.redirect(302, targetUrl);
    } catch (error) {
      console.error("[MEDIA] Failed to resolve legacy upload redirect:", error);
      res.status(404).json({ message: "Media not found" });
    }
  });
}

app.use((req, res, next) => {
  const start = Date.now();
  const requestPath = req.path;

  res.on("finish", () => {
    if (!requestPath.startsWith("/api")) {
      return;
    }

    let logLine = `${req.method} ${requestPath} ${res.statusCode} in ${Date.now() - start}ms`;
    if (logLine.length > 80) {
      logLine = `${logLine.slice(0, 79)}...`;
    }
    log(logLine);
  });

  next();
});

void (async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("[SERVER] Unhandled request error:", err);
    res.status(status).json({ message });
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const requestedPort = Number.parseInt(process.env.PORT || "5000", 10);
  const port = await listenOnAvailablePort(
    server,
    requestedPort,
    app.get("env") === "development" && !process.env.PORT,
  );
  log(`serving on port ${port}`);
})().catch((error) => {
  console.error("[SERVER] Failed to start:", error);
  process.exit(1);
});
