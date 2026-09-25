// zaina-platform/src/cli/release.ts
//
// The release step, run once before each new version starts (Railway's
// pre-deploy command, `npm run release`):
//
//   1. apply pending migrations;
//   2. when the service signs in as the restricted role
//      (PLATFORM_APP_DATABASE_URL), make sure it can: if the password in the
//      URL doesn't work yet, give the role that password, then wait until
//      the database (or Supabase's pooler) lets it in;
//   3. create the first platform admin when PLATFORM_ADMIN_EMAIL and
//      PLATFORM_ADMIN_PASSWORD are set and the account doesn't exist yet
//      (remove the password variable afterwards);
//   4. import TBM's knowledge documents (unchanged ones are left alone;
//      documents staff added in the console are kept).
//
// Any failure stops the release, and the running version keeps serving.

import "dotenv/config";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { appAddressProblem, databaseConnection, describeDatabaseUrl, parseDatabaseCa } from "../db/connection.ts";
import { closePlatformDb, explainConnectionError, initPlatformDb, ownerPool, APP_ROLE } from "../db/platform-db.ts";
import { createStaffUser, findStaffByEmail } from "../db/platform-scope.ts";
import { migrate } from "../db/migrate.ts";
import { describeOutcome, saveImportedSources, sourcesInDirectory } from "../knowledge/import-files.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

const log = (message: string) => console.log(`[release] ${message}`);

/** The app role's password from its connection URL, checked (zaina_app, or zaina_app.<project-ref> on Supabase's pooler). */
export function appRolePassword(appUrl: string): string {
  const address = describeDatabaseUrl(appUrl, "PLATFORM_APP_DATABASE_URL");
  if (address.role !== APP_ROLE) {
    const expected = address.supabasePooler ? `${APP_ROLE}.<project-ref>` : APP_ROLE;
    throw new Error(`PLATFORM_APP_DATABASE_URL must sign in as ${APP_ROLE} (user ${expected}), not "${address.role}"`);
  }
  const password = decodeURIComponent(new URL(appUrl.trim()).password);
  if (password.length < 16) throw new Error("PLATFORM_APP_DATABASE_URL needs a password of at least 16 characters");
  return password;
}

/** Signs in with the app address once: null when it works, else why not. */
async function appSignInProblem(appUrl: string, ca: string | null): Promise<string | null> {
  const { config } = databaseConnection(appUrl, { label: "PLATFORM_APP_DATABASE_URL", ca, max: 1, applicationName: "zaina-platform-release" });
  const client = new pg.Client(config);
  try {
    await client.connect();
    const { rows } = await client.query<{ role: string }>("select current_user as role");
    return rows[0]?.role === APP_ROLE ? null : `signed in as ${rows[0]?.role}, not ${APP_ROLE}`;
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Gives the restricted role the address's password, unless it already signs in with it. */
async function ensureAppRoleSignsIn(ownerUrl: string, appUrl: string, ca: string | null): Promise<void> {
  const problem = appAddressProblem(describeDatabaseUrl(ownerUrl), describeDatabaseUrl(appUrl, "PLATFORM_APP_DATABASE_URL"));
  if (problem) throw new Error(problem);
  const password = appRolePassword(appUrl);
  if (!(await appSignInProblem(appUrl, ca))) {
    log(`${APP_ROLE} signs in`);
    return;
  }
  const { rows: [statement] } = await ownerPool().query<{ sql: string }>(
    "select format('alter role %I with login password %L', $1::text, $2::text) as sql",
    [APP_ROLE, password],
  );
  await ownerPool().query(statement.sql);
  // A pooler may take a moment to see the new password.
  let last: string | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = await appSignInProblem(appUrl, ca);
    if (!last) {
      log(`${APP_ROLE} can sign in (password from PLATFORM_APP_DATABASE_URL)`);
      return;
    }
    await sleep(2_500);
  }
  throw new Error(`${APP_ROLE} was given its password but still can't sign in: ${last}`);
}

/** TBM's documents: next to dist/ when bundled, or two levels up from src/cli/. */
function tbmKnowledgeDirectory(): string | null {
  for (const relative of ["../knowledge/tbm/", "../../knowledge/tbm/"]) {
    const directory = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(`${directory}/about-tbm.md`)) return directory;
  }
  return null;
}

async function main() {
  const url = process.env.PLATFORM_DATABASE_URL?.trim();
  if (!url) throw new Error("PLATFORM_DATABASE_URL is required");
  const ca = parseDatabaseCa(process.env.PLATFORM_DATABASE_CA);
  initPlatformDb(url, { max: 2, ca });
  try {
    await ownerPool().query("select 1");
  } catch (error) {
    throw explainConnectionError(error);
  }

  const applied = await migrate(ownerPool(), { log });
  log(applied.length ? `applied ${applied.length} migration(s)` : "migrations already up to date");

  const appUrl = process.env.PLATFORM_APP_DATABASE_URL?.trim();
  if (appUrl) await ensureAppRoleSignsIn(url, appUrl, ca);

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    if (await findStaffByEmail(adminEmail)) {
      log(`platform admin ${adminEmail} exists`);
    } else {
      const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
      const problem = passwordProblem(password);
      if (problem) throw new Error(`PLATFORM_ADMIN_PASSWORD: ${problem}`);
      const name = process.env.PLATFORM_ADMIN_NAME?.trim() || adminEmail.split("@")[0];
      await createStaffUser({ email: adminEmail, name, passwordHash: await hashPassword(password), isPlatformAdmin: true });
      log(`created platform admin ${adminEmail}; you can now remove PLATFORM_ADMIN_PASSWORD`);
    }
  }

  const directory = tbmKnowledgeDirectory();
  if (directory) {
    const outcomes = await saveImportedSources("tbm", sourcesInDirectory(directory));
    const changed = outcomes.filter((outcome) => !outcome.unchanged);
    for (const outcome of changed) log(`knowledge ${describeOutcome(outcome)}`);
    log(`TBM knowledge: ${outcomes.length} document(s), ${changed.length} changed`);
  } else {
    log("TBM knowledge folder not found; skipped");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((error) => {
      console.error(`[release] failed: ${(error as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => closePlatformDb());
}
