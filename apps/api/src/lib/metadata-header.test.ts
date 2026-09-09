import { describe, expect, it } from "vitest";
import { encodeMetadataValue } from "./metadata-header.js";

describe("encodeMetadataValue", () => {
  it("round-trips a Thai filename", () => {
    const name = "ประกาศจ้างขุดลอกคลอง.pdf";
    expect(decodeURIComponent(encodeMetadataValue(name))).toBe(name);
  });

  it("flattens CR and LF — a newline in a header value is header injection", () => {
    const attack = "invoice.pdf\r\nx-amz-meta-role: admin";
    const encoded = encodeMetadataValue(attack);

    expect(encoded).not.toContain("%0D");
    expect(encoded).not.toContain("%0A");
    expect(decodeURIComponent(encoded)).toBe("invoice.pdf  x-amz-meta-role: admin");
  });

  it("truncates at a character boundary, so the value still decodes", () => {
    // A Thai character is nine encoded characters, so a long name is cut. The
    // point of the test is that what survives is still valid — slicing the
    // ENCODED string would leave a half-written %E0 that throws on decode.
    const long = "ก".repeat(500) + ".pdf";
    const encoded = encodeMetadataValue(long);

    expect(encoded.length).toBeLessThanOrEqual(1024);
    expect(() => decodeURIComponent(encoded)).not.toThrow();
    expect(decodeURIComponent(encoded).startsWith("ก")).toBe(true);
  });

  it("leaves a plain ASCII name recognisable", () => {
    expect(decodeURIComponent(encodeMetadataValue("tor-2569-0812-041.pdf"))).toBe(
      "tor-2569-0812-041.pdf",
    );
  });

  it("handles an empty string without looping forever", () => {
    expect(encodeMetadataValue("")).toBe("");
  });
});
