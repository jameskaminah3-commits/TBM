// zaina-platform/src/bootstrap-env.ts
//
// Loaded first by the server: reads and checks the configuration, and points
// DATABASE_URL at TBM's database, because TBM's own modules (used by the TBM
// connector) read it when they load.

import "dotenv/config";
import { loadConfig } from "./config.ts";

export const platformConfig = loadConfig();

if (platformConfig.tbmDatabaseUrl) {
  process.env.DATABASE_URL = platformConfig.tbmDatabaseUrl;
} else {
  console.warn("[platform] TBM_DATABASE_URL is not set: the TBM connector is unavailable.");
  delete process.env.DATABASE_URL;
}
