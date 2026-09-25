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
  console.warn("[platform] TBM_DATABASE_URL is not set: the TBM connector is off, and TBM's chats are refused.");
  // TBM's modules load either way (they are bundled in) and refuse to load
  // without an address. Nothing connects to this one: the TBM connector
  // isn't registered, so no TBM code runs.
  process.env.DATABASE_URL = "postgres://tbm-connector-off@127.0.0.1:1/none";
}
