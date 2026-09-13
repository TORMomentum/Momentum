import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tests never run against the development database.
 *
 * Tests and the running app used to share one MONGO_URL. Two suites write to
 * that base database directly rather than an isolated one, so every `npm test`
 * deleted the seeded review queue a developer was working against — five times
 * in one week, each recovery a single command, which is exactly why it kept
 * happening.
 *
 * Fixed here rather than in the offending suites, so a suite added next month
 * cannot reintroduce it: before any test file loads, the database name is forced
 * to end in `_test`. The repository's `.env` loader never overrides a variable
 * that is already set, so everything loaded afterwards — config, adapters,
 * `isolatedDbUrl` — derives from the test database.
 *
 * Development points MONGO_URL at `tor_radar_dev`; tests land on
 * `tor_radar_dev_test`. CI's `tor_radar` becomes `tor_radar_test`.
 */

const TEST_SUFFIX = "_test";

// Resolved from the working directory, not import.meta.url: under a jsdom test
// environment import.meta.url is not a file: URL, and fileURLToPath throws —
// which failed the one browser-environment suite outright. Vitest runs from the
// repository root, so the working directory is where .env lives.
const rootEnv = resolve(process.cwd(), ".env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

if (process.env.MONGO_URL) {
  const url = new URL(process.env.MONGO_URL);
  const database = url.pathname.replace(/^\//, "").split("/")[0] || "tor_radar";
  if (!database.endsWith(TEST_SUFFIX)) {
    url.pathname = `/${database}${TEST_SUFFIX}`;
  }
  process.env.MONGO_URL = url.toString();
}
