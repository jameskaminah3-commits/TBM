// A small harness for end-to-end tests that start their own platform server
// with the scripted model and the stand-in services (scripted-model.mjs):
// Gemini, email, WhatsApp's Cloud API and a push service.
//
// The platform database must be local and end in _test (it is wiped).

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
export const PASSWORD = "LocalTest#2026";

export function localTestDatabase(url: string): string {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run against ${parsed.hostname}${parsed.pathname}: test databases must be local and end in _test`);
  }
  return url;
}

export type Platform = {
  base: string;
  work: string;
  db: pg.Pool;
  output: () => string;
  log: (name: "emails" | "model" | "whatsapp" | "push") => any[];
  stop: () => Promise<void>;
  cli: (script: string, args: string[], env?: Record<string, string>) => void;
};

/** Builds the widget and console into a folder, for the server to serve. */
export function buildWebAssets(outdir: string) {
  const built = spawnSync(process.execPath, [path.join(REPO, "zaina-platform/scripts/build.mjs"), "--web", "--outdir", outdir], { cwd: REPO, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr + built.stdout);
  return path.join(outdir, "public");
}

export async function startPlatform(options: { port: number; env?: Record<string, string>; webAssets?: boolean }): Promise<Platform> {
  const databaseUrl = localTestDatabase(process.env.PLATFORM_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zaina_platform_test");
  const work = mkdtempSync(path.join(tmpdir(), "zaina-channels-"));
  const logs = {
    emails: path.join(work, "emails.log"),
    model: path.join(work, "model.log"),
    whatsapp: path.join(work, "whatsapp.log"),
    push: path.join(work, "push.log"),
  };
  for (const file of Object.values(logs)) writeFileSync(file, "");
  const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await db.query("drop schema public cascade; create schema public;");

  const publicDir = options.webAssets ? buildWebAssets(path.join(work, "web")) : path.join(work, "no-web");
  let output = "";
  const server: ChildProcess = spawn(process.execPath, ["--import", path.join(HERE, "scripted-model.mjs"), "--import", "tsx", "zaina-platform/src/server.ts"], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(options.port),
      PLATFORM_DATABASE_URL: databaseUrl,
      TBM_DATABASE_URL: "",
      SESSION_TOKEN_SECRET: "channels-session-secret-long-enough-123456",
      PLATFORM_SECRETS_KEY: randomBytes(32).toString("base64"),
      PLATFORM_PUBLIC_DIR: publicDir,
      GEMINI_API_KEY: "scripted",
      MIGRATE_ON_START: "true",
      TURN_BUDGET_MS: "6000",
      HANDOFF_SWEEP_INTERVAL_MS: "300",
      BUSINESS_CACHE_MS: "100",
      MODEL_PRICE_INPUT_USD_PER_MTOK: "0.1",
      MODEL_PRICE_OUTPUT_USD_PER_MTOK: "0.4",
      FAKE_EMAIL_LOG: logs.emails,
      FAKE_GEMINI_LOG: logs.model,
      FAKE_WHATSAPP_LOG: logs.whatsapp,
      FAKE_PUSH_LOG: logs.push,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { output += chunk; });
  server.stderr?.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${options.port}`;
  let started = false;
  for (let attempt = 0; attempt < 80 && !started; attempt += 1) {
    try {
      started = (await fetch(`${base}/v1/health`)).ok;
    } catch {}
    if (!started) await sleep(250);
  }
  if (!started) throw new Error(`The platform didn't start:\n${output}`);

  const readLog = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return {
    base,
    work,
    db,
    output: () => output,
    log: (name) => readLog(logs[name]),
    cli: (script, args, env = {}) => {
      const run = spawnSync(process.execPath, ["--import", "tsx", `zaina-platform/src/cli/${script}`, ...args], {
        cwd: REPO,
        env: { ...process.env, PLATFORM_DATABASE_URL: databaseUrl, ...env },
        encoding: "utf8",
      });
      assert.equal(run.status, 0, run.stderr + run.stdout);
    },
    stop: async () => {
      if (process.env.E2E_SERVER_LOG) writeFileSync(process.env.E2E_SERVER_LOG, output);
      server.kill("SIGTERM");
      await db.end();
    },
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until check() returns something truthy; fails with the message after timeoutMs. */
export async function eventually<T>(check: () => Promise<T> | T, message: string, timeoutMs = 8000): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const until = Date.now() + timeoutMs;
  do {
    const last = await check();
    if (last) return last as Exclude<T, false | null | undefined | 0 | "">;
    await sleep(100);
  } while (Date.now() < until);
  assert.fail(`${message} (waited ${timeoutMs} ms)`);
}

export type Api = (method: string, route: string, body?: unknown, token?: string) => Promise<{ status: number; body: any; headers: Headers }>;

export function apiFor(base: string): Api {
  return async (method, route, body, token) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}
    return { status: response.status, body: parsed, headers: response.headers };
  };
}
