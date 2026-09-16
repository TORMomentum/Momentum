import { describe, expect, it } from "vitest";
import { contentDisposition, parseDisposition } from "./content-disposition.js";

describe("parseDisposition", () => {
  it("defaults to attachment when absent", () => {
    expect(parseDisposition(undefined)).toBe("attachment");
  });
  it("accepts the two allowlisted values", () => {
    expect(parseDisposition("inline")).toBe("inline");
    expect(parseDisposition("attachment")).toBe("attachment");
  });
  it("rejects anything else, including arrays from repeated query keys", () => {
    expect(parseDisposition("INLINE")).toBeNull();
    expect(parseDisposition("download")).toBeNull();
    expect(parseDisposition(["inline", "attachment"])).toBeNull();
  });
});

describe("contentDisposition", () => {
  it("is bare inline for the in-app viewer", () => {
    expect(contentDisposition("inline", "anything.pdf")).toBe("inline");
  });

  it("encodes a Thai filename with filename* and an ASCII fallback", () => {
    const header = contentDisposition("attachment", "ประกาศ.pdf");
    expect(header).toBe(
      `attachment; filename="______.pdf"; filename*=UTF-8''%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B2%E0%B8%A8.pdf`,
    );
  });

  it("cannot be broken out of by quotes, CR/LF, or path separators", () => {
    const header = contentDisposition("attachment", 'evil"\r\nX-Injected: 1/../a.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('evil"');
    expect(header).not.toContain("/");
  });

  it("percent-encodes the RFC 5987 characters encodeURIComponent leaves alone", () => {
    expect(contentDisposition("attachment", "a'b(c)*.pdf")).toContain("filename*=UTF-8''a%27b%28c%29%2A.pdf");
  });

  it("falls back to 'document' for an empty name", () => {
    expect(contentDisposition("attachment", "")).toContain('filename="document"');
  });
});
