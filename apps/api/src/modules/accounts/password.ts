import { randomBytes } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import type { Config } from "../../core/config.js";

/**
 * The hash an unknown address is verified against, so the failing path pays the
 * same Argon2 cost as the succeeding one (spec §2.4).
 *
 * Built from the SAME configured parameters as a real hash, once, and kept.
 * A hard-coded literal would be verified at whatever cost it was created with,
 * so raising the configured memory or iterations would quietly make the unknown
 * path cheaper than the real one — restoring the timing signal this exists to
 * remove. Its plaintext is random and discarded: nothing can verify against it.
 */
let dummyHash: Promise<string> | null = null;

function dummyPasswordHash(config: Config): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"), config);
  return dummyHash;
}

export async function hashPassword(password: string, config: Config): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: config.argon2.memoryKiB,
    timeCost: config.argon2.iterations,
    parallelism: config.argon2.parallelism,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

export async function verifyAgainstDummy(password: string, config: Config): Promise<boolean> {
  return verify(await dummyPasswordHash(config), password);
}
