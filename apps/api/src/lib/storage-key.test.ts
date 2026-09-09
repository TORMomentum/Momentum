import { describe, expect, it } from "vitest";
import { extensionFor, storageKeyFor } from "./storage-key.js";

const HASH = "cfa3181c1ee36e8bce5e39f84959f4558ea7ba32c0e4539a8ab3c8ce8c716ec6";

describe("storageKeyFor", () => {
  it("shards by the first four hash characters and keeps the hash as the identity", () => {
    expect(storageKeyFor(HASH, "application/pdf")).toBe(`tors/cf/a3/${HASH}.pdf`);
  });

  it("is a pure function of the bytes — the same document always lands on the same key", () => {
    // This is what makes an overwrite impossible and dedupe exact. A key built
    // from a filename or a timestamp would give one document two homes.
    expect(storageKeyFor(HASH, "application/pdf")).toBe(storageKeyFor(HASH, "application/pdf"));
  });

  it("names the kind of file, so an operator and a browser both know what it is", () => {
    expect(storageKeyFor(HASH, "image/jpeg").endsWith(".jpg")).toBe(true);
    expect(storageKeyFor(HASH, "image/png").endsWith(".png")).toBe(true);
    expect(storageKeyFor(HASH, "text/html").endsWith(".html")).toBe(true);
  });

  it("falls back rather than throwing on a type it has no extension for", () => {
    expect(extensionFor("application/octet-stream")).toBe("bin");
    expect(storageKeyFor(HASH, "application/octet-stream").endsWith(".bin")).toBe(true);
  });
});
