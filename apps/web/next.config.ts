import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Configuration lives in ONE file for the whole repository, and Next only reads
 * `.env` from its own app directory. Loading the root file here — with real
 * environment variables still winning — keeps a container's Compose environment
 * authoritative while a developer needs no second copy of the same secrets.
 */
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextConfig: NextConfig = {
  // The repo's agent rules live at the root; do not generate a second set here.
  agentRules: false,
  output: "standalone",
};

export default nextConfig;
