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

/**
 * Tests never reach a hosted cluster.
 *
 * The development .env now points MONGO_URL at the team's shared Atlas cluster,
 * and suites here call deleteMany. A `_test` suffix on the database name kept
 * them out of the real database but still ran them against the shared
 * cluster, creating and emptying databases there on every run. So tests take
 * TEST_MONGO_URL when it is set, and refuse outright to run against Atlas
 * rather than trusting a name suffix to make that safe.
 */
if (process.env.TEST_MONGO_URL) {
  process.env.MONGO_URL = process.env.TEST_MONGO_URL;
}
// The same for object storage: tests write and read, so they use the emulator
// even when the development .env points the app at a real bucket.
if (process.env.TEST_GCS_API_ENDPOINT) {
  process.env.GCS_API_ENDPOINT = process.env.TEST_GCS_API_ENDPOINT;
}
if (process.env.MONGO_URL && /mongodb\+srv:|\.mongodb\.net\b/.test(process.env.MONGO_URL)) {
  throw new Error(
    "Refusing to run tests against a hosted MongoDB cluster. Set TEST_MONGO_URL to a local database " +
      "(the Compose mongo service) — see .env.example.",
  );
}

if (process.env.MONGO_URL) {
  // Parsed by hand rather than with `new URL()`: a replica-set address names
  // several hosts separated by commas, which the WHATWG parser rejects — and
  // rejecting it here stopped every suite from loading at all.
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]*)\/?([^?]*)(\?.*)?$/.exec(process.env.MONGO_URL);
  if (match) {
    const [, origin, path, query = ""] = match;
    const database = path.split("/")[0] || "tor_radar";
    const name = database.endsWith(TEST_SUFFIX) ? database : `${database}${TEST_SUFFIX}`;
    process.env.MONGO_URL = `${origin}/${name}${query}`;
  }
}
