import "../test/env.js";
import { beforeAll, describe, expect, it } from "vitest";
import { MinioStorage } from "./minio.storage.js";
import { loadConfig } from "../core/config.js";

const config = loadConfig(process.env);
const storage = new MinioStorage(config.minio);

describe("MinioStorage", () => {
  beforeAll(async () => {
    await storage.ensureBucket();
  });

  it("stores an object and reports it exists", async () => {
    const key = `test-${Date.now()}`;
    await storage.putIfAbsent(key, Buffer.from("hello"), "application/pdf");
    expect(await storage.exists(key)).toBe(true);
  });

  it("does not overwrite an existing object", async () => {
    const key = `test-${Date.now()}-noclobber`;
    const first = await storage.putIfAbsent(key, Buffer.from("original"), "application/pdf");
    const second = await storage.putIfAbsent(key, Buffer.from("replacement"), "application/pdf");
    expect(second.bytes).toBe(first.bytes);

    const chunks: Buffer[] = [];
    const stream = await storage.getStream(key);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe("original");
  });

  it("signs a URL against the public origin, not the internal endpoint", async () => {
    const key = `test-${Date.now()}-url`;
    await storage.putIfAbsent(key, Buffer.from("x"), "application/pdf");
    const url = await storage.signedUrl(key, 60);
    expect(url.startsWith(config.minio.publicUrl)).toBe(true);
  });
});

/**
 * The integration test above cannot catch a regression to the internal client:
 * on a developer host MINIO_ENDPOINT and MINIO_PUBLIC_URL are the same origin,
 * so both would produce an identical URL. This constructs the adapter the way
 * Compose does, with the two diverging, where signing on the wrong client
 * yields a URL no browser can resolve.
 */
describe("MinioStorage.signedUrl with a Compose-shaped configuration", () => {
  it("signs against the public origin, not the internal endpoint", async () => {
    const composeLike = new MinioStorage({
      ...config.minio,
      endPoint: "tor-radar-minio",
      port: 9000,
      publicUrl: config.minio.publicUrl,
    });

    const key = `test-${Date.now()}-divergent`;
    await storage.putIfAbsent(key, Buffer.from("x"), "application/pdf");
    const url = await composeLike.signedUrl(key, 60);

    expect(url.startsWith(config.minio.publicUrl)).toBe(true);
    expect(url).not.toContain("tor-radar-minio");
  });
});
