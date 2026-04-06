import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const searchRoots = ["server", "shared"];

function collectTests(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const tests = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      tests.push(...collectTests(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(fullPath);
    }
  }

  return tests;
}

const testFiles = searchRoots
  .map((root) => join(projectRoot, root))
  .filter((root) => statSync(root, { throwIfNoEntry: false })?.isDirectory())
  .flatMap((root) => collectTests(root))
  .map((file) => relative(projectRoot, file));

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-isolation=none", ...testFiles],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
