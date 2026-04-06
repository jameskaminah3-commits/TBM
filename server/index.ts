import dotenv from "dotenv";

dotenv.config();

import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import { ensureMediaStorageReady, ensureUploadDir, usesLocalUploadStorage } from "./media";
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

(async () => {
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

  const port = Number.parseInt(process.env.PORT || "5000", 10);
  server.listen(port, () => {
    log(`serving on port ${port}`);
  });
})();
