import { createHash, randomUUID } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { GcsStorage } from "./gcs.storage.js";

const config = loadConfig(process.env);
const bucket = `${config.gcs.bucket}-adapter-test`;
const settings = {
  bucket,
  apiEndpoint: config.gcs.apiEndpoint,
  projectId: "emulator",
  timeoutMs: config.gcs.timeoutApiMs,
};
const storage = new GcsStorage(settings);

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
  const [exists] = await client.bucket(bucket).exists();
  if (!exists) await client.createBucket(bucket);
});

describe("GcsStorage (emulator)", () => {
  it("stores bytes, reports existence, and streams them back", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 hello");

    const stored = await storage.putIfAbsent(key, bytes, "application/pdf", { route: "upload" });

    expect(stored).toEqual({ bucket, key, contentType: "application/pdf", bytes: bytes.byteLength });
    expect(await storage.exists(key)).toBe(true);
    expect(await readAll(await storage.getStream(key))).toEqual(bytes);
  });

  it("returns the existing object when the same bytes are written twice", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 duplicate");

    await storage.putIfAbsent(key, bytes, "application/pdf");
    const second = await storage.putIfAbsent(key, bytes, "application/pdf");

    expect(second.bytes).toBe(bytes.byteLength);
    expect(await readAll(await storage.getStream(key))).toEqual(bytes);
  });

  it("refuses to treat different bytes at the same key as already stored", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("%PDF-1.7 original"), "application/pdf");

    await expect(
      storage.putIfAbsent(key, Buffer.from("%PDF-1.7 different"), "application/pdf"),
    ).rejects.toThrow(/sha256/);
  });

  it("streams an inclusive byte range", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("0123456789"), "application/pdf");

    expect((await readAll(await storage.getStream(key, { start: 2, end: 5 }))).toString()).toBe("2345");
  });

  it("answers false for a missing object and throws not-found when streaming it", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.getStream(key)).rejects.toMatchObject({ status: 404 });
  });

  it("stores the sha256 and an ASCII-safe filename as custom metadata", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 thai name");
    await storage.putIfAbsent(key, bytes, "application/pdf", { originalFilename: "ประกาศ.pdf" });

    const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
    const [meta] = await client.bucket(bucket).file(key).getMetadata();
    expect(meta.metadata?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(String(meta.metadata?.originalFilename)).toMatch(/^[\x20-\x7e]*$/);
  });
});
