// zaina-platform/src/db/migrate-cli.ts
//
// npm run migrate — applies pending migrations to PLATFORM_DATABASE_URL.
// Run it as a release step before starting a new version.

import "dotenv/config";
import { closePlatformDb, initPlatformDb, ownerPool } from "./platform-db.ts";
import { migrate } from "./migrate.ts";

const url = process.env.PLATFORM_DATABASE_URL?.trim();
if (!url) {
  console.error("PLATFORM_DATABASE_URL is required");
  process.exit(1);
}

initPlatformDb(url, { max: 1 });
try {
  const applied = await migrate(ownerPool(), { log: (message) => console.log(`[migrate] ${message}`) });
  console.log(applied.length ? `[migrate] applied ${applied.length} migration(s)` : "[migrate] already up to date");
} catch (error) {
  console.error(`[migrate] ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePlatformDb();
}
