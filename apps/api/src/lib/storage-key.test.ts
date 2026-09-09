import { describe, expect, it } from "vitest";
import { extensionFor, storageKeyFor } from "./storage-key.js";

const HASH = "cfa3181c1ee36e8bce5e39f84959f4558ea7ba32c0e4539a8ab3c8ce8c716ec6";

describe("storageKeyFor", () => {
  it("groups by arrival month and keeps the hash as the identity", () => {
    const at = new Date("2026-09-10T04:00:00Z");
    expect(storageKeyFor(HASH, "application/pdf", at)).toBe(`tors/2026/09/${HASH}.pdf`);
  });

  it("pads the month, so keys sort correctly — S3 sorts keys as bytes", () => {
    const at = new Date("2026-01-05T00:00:00Z");
    expect(storageKeyFor(HASH, "application/pdf", at)).toContain("tors/2026/01/");
  });

  it("uses UTC, so a key does not depend on the server's timezone", () => {
    // 07:00 Bangkok on 1 Oct is 00:00 UTC the same day; an hour earlier is
    // still September in UTC, and both servers must agree.
    const bangkokMidnight = new Date("2026-10-01T00:00:00+07:00");
    expect(storageKeyFor(HASH, "application/pdf", bangkokMidnight)).toContain("tors/2026/09/");
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
