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

// Same defaults as apps/api/src/core/config.ts's MAX_UPLOAD_BYTES /
// ALLOWED_MIME_TYPES — one value, not two copies that can drift apart.
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES) || 26_214_400;
const allowedMimeTypes = process.env.ALLOWED_MIME_TYPES ?? "application/pdf,image/jpeg,image/png";

const nextConfig: NextConfig = {
  // The repo's agent rules live at the root; do not generate a second set here.
  agentRules: false,
  // Development only, and it defaults to bottom-left — directly on top of the
  // save control on any screen whose actions sit there. Kept, because it
  // reports what a route rendered as, but moved out of the way.
  devIndicators: { position: "bottom-right" },
  output: "standalone",
  // Exposes the same limits to the client bundle as NEXT_PUBLIC_* — see
  // UploadForm.tsx, which reads these instead of restating the numbers.
  env: {
    NEXT_PUBLIC_MAX_UPLOAD_BYTES: String(maxUploadBytes),
    NEXT_PUBLIC_ALLOWED_MIME_TYPES: allowedMimeTypes,
  },
  experimental: {
    serverActions: {
      // Next's own default is 1MB, well under MAX_UPLOAD_BYTES — every real
      // scanned TOR over ~1MB would 500 before reaching the API's own check.
      bodySizeLimit: maxUploadBytes,
    },
  },
};

export default nextConfig;
