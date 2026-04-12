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
  await runScript("./scripts/publish-existing-listings.mjs");
}

main().catch((error) => {
  console.error("[predeploy] Failed to prepare deployment:", error);
  process.exit(1);
});
