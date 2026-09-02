import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Integration tests call `loadConfig(process.env)` and so need the host-side
 * values in the repository-root `.env`. Neither runner reads that file on its
 * own: the root `vitest run` (the gate CI runs) has no config, and a
 * `vitest.config.ts` in this workspace would only apply to
 * `npm test -w @tor-radar/api`. Importing this module is therefore the one
 * mechanism that covers both — an integration test imports it first.
 *
 * Node's own loader is used, so no dependency is added, and a variable already
 * present in the environment wins over the file, which keeps a real CI or
 * container environment authoritative over a developer's local file.
 */
const REPO_ROOT_ENV = fileURLToPath(new URL("../../../../.env", import.meta.url));

if (existsSync(REPO_ROOT_ENV)) {
  process.loadEnvFile(REPO_ROOT_ENV);
}
