import "../../test/env.js";

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";

const config = loadConfig(process.env);

describe("passwords", () => {
  it("hashes a password which verifies", async () => {
    const passwordHash = await hashPassword("correct horse battery staple", config);
    await expect(verifyPassword(passwordHash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("does not verify a wrong password", async () => {
    const passwordHash = await hashPassword("correct horse battery staple", config);
    await expect(verifyPassword(passwordHash, "wrong password")).resolves.toBe(false);
  });

  it("performs real comparable argon2 work for an unknown account", async () => {
    const passwordHash = await hashPassword("correct horse battery staple", config);
    const passwordStartedAt = performance.now();
    await verifyPassword(passwordHash, "wrong password");
    const passwordDuration = performance.now() - passwordStartedAt;

    const dummyStartedAt = performance.now();
    await expect(verifyAgainstDummy("wrong password", config)).resolves.toBe(false);
    const dummyDuration = performance.now() - dummyStartedAt;

    expect(dummyDuration).toBeGreaterThanOrEqual(passwordDuration / 4);
  });

  it("builds its dummy from the CONFIGURED cost, not a literal baked in at some other cost", async () => {
    // A hard-coded dummy hash is verified at whatever cost it was created with,
    // so raising the configured cost would quietly make the unknown-account path
    // cheaper than the real one and hand back the timing signal. Verifying at a
    // far higher cost must take meaningfully longer than at the default.
    const expensive = { ...config, argon2: { ...config.argon2, memoryKiB: config.argon2.memoryKiB * 4 } };

    const cheapStartedAt = performance.now();
    await verifyAgainstDummy("wrong password", config);
    const cheapDuration = performance.now() - cheapStartedAt;

    const dearHash = await hashPassword("whatever", expensive);
    const dearStartedAt = performance.now();
    await verifyPassword(dearHash, "wrong password");
    const dearDuration = performance.now() - dearStartedAt;

    expect(dearDuration).toBeGreaterThan(cheapDuration);
  });
});
