import { defineConfig } from "vitest/config";

/**
 * Only one thing is configured here: the setup file that keeps tests off the
 * development database. Discovery, environments and everything else stay on
 * vitest's defaults, as they were before this file existed.
 */
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
