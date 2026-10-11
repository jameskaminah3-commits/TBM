// Move protected files already in the public media bucket into private storage.
// See docs/storage-private-files-plan.md. Run by someone authorised to hold
// production credentials, after the release that adds private storage:
//
//   npx tsx scripts/migrate-private-files.ts                 dry run: what would move (default)
//   npx tsx scripts/migrate-private-files.ts --apply         copy privately, repoint records, log each move
//   npx tsx scripts/migrate-private-files.ts --remove-public delete public copies of checked moves
//   npx tsx scripts/migrate-private-files.ts --restore-references   undo --apply (before --remove-public)
//
// Output lists file paths and record IDs only, no names or contact details.
import { pool } from "../server/db";
import {
  applyPrivateFileMigration,
  planPrivateFileMigration,
  removeMigratedPublicCopies,
  restoreMigratedReferences,
} from "../server/private-files-migration";
import { publicObjectUrl } from "../server/private-files";
import { getInventoryConfig } from "../server/storage-inventory-source";

const args = new Set(process.argv.slice(2));

async function main() {
  if (args.has("--restore-references")) {
    const restored = await restoreMigratedReferences();
    console.log(JSON.stringify({ step: "restore-references", restored: restored.length, paths: restored }, null, 2));
    return;
  }

  if (args.has("--remove-public")) {
    const removed = await removeMigratedPublicCopies();
    const checks: Array<{ path: string; status: number | string }> = [];
    if (!getInventoryConfig().localUploads) {
      for (const path of removed.slice(0, 5)) {
        const response = await fetch(publicObjectUrl(path), { method: "HEAD" }).catch((error) => ({ status: String(error) }));
        checks.push({ path, status: response.status });
      }
    }
    console.log(JSON.stringify({ step: "remove-public", removed: removed.length, oldLinkChecks: checks, note: "Old links may be served from cache for up to an hour; check again after that." }, null, 2));
    return;
  }

  const plan = await planPrivateFileMigration();
  const byCategory: Record<string, number> = {};
  for (const move of plan.moves) {
    byCategory[move.category] = (byCategory[move.category] ?? 0) + 1;
  }
  if (!args.has("--apply")) {
    console.log(JSON.stringify({
      step: "dry-run",
      listedVia: plan.listedVia,
      objectsInPublicBucket: plan.totalObjects,
      alreadyMoved: plan.alreadyMoved,
      toMove: plan.moves.length,
      byCategory,
      moves: plan.moves.map((move) => ({ path: move.path, category: move.category, newKey: move.newKey, records: move.references.map((reference) => `${reference.table}:${reference.recordId}`) })),
    }, null, 2));
    return;
  }

  const results = await applyPrivateFileMigration(plan.moves);
  console.log(JSON.stringify({
    step: "apply",
    moved: results.filter((result) => !result.error).length,
    verified: results.filter((result) => result.verified).length,
    failed: results.filter((result) => result.error).length,
    byCategory,
    results,
    next: "Check the site and these results, then run --remove-public.",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[migrate-private-files] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => undefined));
