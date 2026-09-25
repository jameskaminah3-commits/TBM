// zaina-platform/scripts/build.mjs
//
// Builds the service:
//   dist/server.js, dist/release.js   the service and its release step (Node;
//                                     packages stay in node_modules)
//   dist/public/widget.js             the website widget (one script tag per business)
//   dist/public/console/              the business console (a single-page app)
//
//   node zaina-platform/scripts/build.mjs [--web] [--outdir <dir>]
//   --web builds the web assets only (tests and local development).

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PLATFORM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { web: { type: "boolean", default: false }, outdir: { type: "string" } } });
const outdir = path.resolve(values.outdir ?? path.join(PLATFORM, "dist"));

async function buildNode() {
  await build({
    entryPoints: { server: path.join(PLATFORM, "src/server.ts"), release: path.join(PLATFORM, "src/cli/release.ts") },
    outdir,
    platform: "node",
    format: "esm",
    target: "node20",
    bundle: true,
    packages: "external",
    logLevel: "warning",
  });
}

async function buildWeb() {
  const publicDir = path.join(outdir, "public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(path.join(publicDir, "console"), { recursive: true });
  const common = { bundle: true, minify: true, legalComments: "none", logLevel: "warning", define: { "process.env.NODE_ENV": '"production"' } };
  await build({
    ...common,
    entryPoints: [path.join(PLATFORM, "web/widget/widget.ts")],
    outfile: path.join(publicDir, "widget.js"),
    format: "iife",
    target: ["es2019", "safari13"],
  });
  await build({
    ...common,
    entryPoints: [path.join(PLATFORM, "web/console/main.tsx")],
    outfile: path.join(publicDir, "console/app.js"),
    format: "esm",
    target: ["es2020", "safari14"],
    jsx: "automatic",
  });
  // The service worker (alerts on staff phones) is a classic script.
  await build({
    ...common,
    entryPoints: [path.join(PLATFORM, "web/console/sw.ts")],
    outfile: path.join(publicDir, "console/sw.js"),
    format: "iife",
    target: ["es2020", "safari14"],
  });
  cpSync(path.join(PLATFORM, "web/console/static"), path.join(publicDir, "console"), { recursive: true });
}

if (!values.web) await buildNode();
await buildWeb();
console.log(`[build] ${values.web ? "web assets" : "service and web assets"} → ${path.relative(process.cwd(), outdir) || "."}`);
