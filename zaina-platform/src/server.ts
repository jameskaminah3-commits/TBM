// zaina-platform/src/server.ts
//
// Entry point. bootstrap-env.ts must stay the first import: it checks the
// configuration and points TBM's modules at TBM's database before they load.

import { platformConfig } from "./bootstrap-env.ts";
import { startServer } from "./app.ts";
import { registerConnector } from "./connectors/registry.ts";
import { tbmConnector } from "./connectors/tbm/index.ts";

if (platformConfig.tbmDatabaseUrl) registerConnector("tbm", tbmConnector);

const { stop } = await startServer(platformConfig);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`[platform] ${signal}: shutting down`);
    stop().then(() => process.exit(0), () => process.exit(1));
  });
}
