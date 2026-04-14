import path from "node:path";
import { spawn } from "node:child_process";

async function runScript(scriptPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(process.cwd(), scriptPath)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptPath} exited due to signal ${signal}`));
        return;
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`${scriptPath} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

async function main() {
  await runScript("./scripts/railway-db-push.mjs");
  await runScript("./scripts/bootstrap-admin-account.mjs");

  if (process.env.PUBLISH_EXISTING_LISTINGS_ON_DEPLOY?.trim().toLowerCase() === "true") {
    await runScript("./scripts/publish-existing-listings.mjs");
  } else {
    console.log("[predeploy] Skipping publish-existing-listings. Set PUBLISH_EXISTING_LISTINGS_ON_DEPLOY=true to run it explicitly.");
  }
}

main().catch((error) => {
  console.error("[predeploy] Failed to prepare deployment:", error);
  process.exit(1);
});
