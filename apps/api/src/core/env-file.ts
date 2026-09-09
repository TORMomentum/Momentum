import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the repository-root `.env` when there is one, for processes started on
 * a developer machine. In a container the environment comes from Compose and
 * there is no such file, so this does nothing there.
 *
 * Node's own loader, so no dependency is added, and a variable already present
 * in the environment wins over the file — a real deployment stays authoritative
 * over whatever a laptop happens to have.
 */
export function loadEnvFile(): void {
  const path = fileURLToPath(new URL("../../../../.env", import.meta.url));
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
