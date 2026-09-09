import { describe, expect, it } from "vitest";
import { detectMimeType } from "./file-type.js";

describe("detectMimeType", () => {
  it("detects a PDF from its signature", () => {
    expect(detectMimeType(Buffer.from("%PDF-1.7\n..."))).toBe("application/pdf");
  });

  it("detects a JPEG from its signature", () => {
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  it("detects a PNG from its signature", () => {
    expect(
      detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
  });

  it("returns null for HTML masquerading as a PDF", () => {
    expect(detectMimeType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("returns null for a buffer too short to identify", () => {
    expect(detectMimeType(Buffer.from([0x25]))).toBeNull();
  });
});
