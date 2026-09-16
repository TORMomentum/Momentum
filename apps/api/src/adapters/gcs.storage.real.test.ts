import { randomUUID } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";
import { GcsStorage } from "./gcs.storage.js";

const bucket = process.env.GCS_REAL_TEST_BUCKET;
const keyFilename = process.env.GCS_CREDENTIALS;
const run = Boolean(bucket && keyFilename);

/**
 * Proves, against the REAL service, what fake-gcs-server cannot (spec §7).
 * Not a pull-request gate: it needs credentials, and is run deliberately.
 * Uses a disposable test bucket — never the originals bucket — whose lifecycle
 * rule deletes objects after a day.
 */
describe.runIf(run)("GcsStorage against a real bucket", () => {
  const storage = new GcsStorage({ bucket: bucket as string, keyFilename, timeoutMs: 30_000 });
  const raw = new GcsClient({ keyFilename });

  it("refuses a duplicate write with a precondition failure, returning the original", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 real");
    await storage.putIfAbsent(key, bytes, "application/pdf");
    const again = await storage.putIfAbsent(key, bytes, "application/pdf");
    expect(again.bytes).toBe(bytes.byteLength);
  });

  it("rejects an upload whose MD5 does not match, and stores nothing", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await expect(
      raw.bucket(bucket as string).file(key).save(Buffer.from("real bytes"), {
        resumable: false,
        validation: false,
        metadata: { md5Hash: Buffer.alloc(16).toString("base64") },
      }),
    ).rejects.toMatchObject({ code: 400 });
    expect(await storage.exists(key)).toBe(false);
  });

  it("cannot delete an object with the application's identity", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("%PDF-1.7 keep"), "application/pdf");
    await expect(raw.bucket(bucket as string).file(key).delete()).rejects.toMatchObject({ code: 403 });
  });

  it("streams the stored bytes and a range of them", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("0123456789"), "application/pdf");
    const chunks: Buffer[] = [];
    for await (const c of await storage.getStream(key, { start: 3, end: 6 })) chunks.push(Buffer.from(c as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe("3456");
  });
});
