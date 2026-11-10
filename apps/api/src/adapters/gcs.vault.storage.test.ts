import { randomUUID } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { GcsVaultStorage } from "./gcs.vault.storage.js";

const config = loadConfig(process.env);
const bucket = `${config.gcs.vaultBucket}-adapter-test`;
const storage = new GcsVaultStorage({
  bucket,
  apiEndpoint: config.gcs.apiEndpoint,
  projectId: "emulator",
  timeoutMs: config.gcs.timeoutApiMs,
});

beforeAll(async () => {
  const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
  const [exists] = await client.bucket(bucket).exists();
  if (!exists) await client.createBucket(bucket);
});

describe("GcsVaultStorage (emulator)", () => {
  it("stores a file, removes it, and treats removing it again as done", async () => {
    const key = `vault/test/${randomUUID()}`;
    await storage.putIfAbsent(key, Buffer.from("%PDF-1.7 mine"), "application/pdf");
    expect(await storage.exists(key)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });
});
