import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAllowedUrl,
  assertResolvesPublicly,
  isBlockedAddress,
  safeFetchDocument,
} from "./safe-fetch.js";

/**
 * DNS is the seam every SSRF control turns on, so it is controlled rather than
 * reached over the network: these tests must fail closed on a machine with no
 * resolver and must be able to describe a hostname that returns several records.
 */
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

/** Shapes a `dns.lookup(host, { all: true })` result from plain addresses. */
function resolvesTo(...addresses: string[]): void {
  lookupMock.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
}

const LIMITS = { timeoutMs: 1_000, maxRedirects: 2, maxBytes: 64 };

afterEach(() => {
  vi.unstubAllGlobals();
  lookupMock.mockReset();
});

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("blocks the cloud metadata address", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks private ranges", () => {
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
  });

  it("blocks unique-local IPv6", () => {
    expect(isBlockedAddress("fd00::1")).toBe(true);
  });

  it("allows a public address", () => {
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });

  it("blocks an internal address wearing an IPv4-mapped IPv6 disguise", () => {
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:10.1.2.3")).toBe(true);
  });

  it("blocks anything it cannot parse as an address", () => {
    expect(isBlockedAddress("not-an-address")).toBe(true);
  });
});

describe("assertAllowedUrl", () => {
  it("rejects a non-http scheme", () => {
    expect(() => assertAllowedUrl(new URL("file:///etc/passwd"))).toThrow(/scheme/i);
  });

  it("accepts https", () => {
    expect(() => assertAllowedUrl(new URL("https://example.org/a.pdf"))).not.toThrow();
  });
});

describe("assertResolvesPublicly", () => {
  it("accepts a hostname whose records are all public", async () => {
    resolvesTo("1.1.1.1", "2606:4700:4700::1111");
    await expect(assertResolvesPublicly(new URL("https://example.org/a.pdf"))).resolves.toBeUndefined();
  });

  it("rejects a hostname that returns both a public and a private record", async () => {
    resolvesTo("93.184.216.34", "169.254.169.254");
    await expect(assertResolvesPublicly(new URL("https://rebind.example/a.pdf"))).rejects.toThrow(
      /non-public address/i,
    );
  });

  it("rejects when the private record is not the first one returned", async () => {
    resolvesTo("1.1.1.1", "8.8.8.8", "10.0.0.5");
    await expect(assertResolvesPublicly(new URL("https://rebind.example/a.pdf"))).rejects.toThrow(
      /non-public address/i,
    );
  });

  it("rejects a hostname that does not resolve", async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    await expect(assertResolvesPublicly(new URL("https://nowhere.invalid/a.pdf"))).rejects.toThrow(
      /did not resolve/i,
    );
  });
});

describe("safeFetchDocument", () => {
  it("returns the body of a public document", async () => {
    resolvesTo("1.1.1.1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })),
    );

    const result = await safeFetchDocument("https://example.org/a.pdf", LIMITS);

    expect(result.bytes.toString()).toBe("%PDF-1.7");
    expect(result.declaredType).toBe("application/pdf");
    expect(result.finalUrl).toBe("https://example.org/a.pdf");
  });

  it("re-checks the resolved address after a redirect, rejecting a hop into a private range", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
      ),
    );

    await expect(safeFetchDocument("https://example.org/a.pdf", LIMITS)).rejects.toThrow(
      /non-public address/i,
    );
  });

  it("rejects a redirect that changes scheme to one outside the allowlist", async () => {
    resolvesTo("1.1.1.1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } })),
    );

    await expect(safeFetchDocument("https://example.org/a.pdf", LIMITS)).rejects.toThrow(/scheme/i);
  });

  it("caps the redirect chain", async () => {
    resolvesTo("1.1.1.1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.org/next" } })),
    );

    await expect(safeFetchDocument("https://example.org/a.pdf", LIMITS)).rejects.toThrow(
      /too many redirects/i,
    );
  });

  it("rejects a body larger than the size cap", async () => {
    resolvesTo("1.1.1.1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(LIMITS.maxBytes + 1))),
    );

    await expect(safeFetchDocument("https://example.org/a.pdf", LIMITS)).rejects.toThrow(
      /maximum accepted size/i,
    );
  });

  it("rejects an error status from the source", async () => {
    resolvesTo("1.1.1.1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    await expect(safeFetchDocument("https://example.org/a.pdf", LIMITS)).rejects.toThrow(/status 404/i);
  });
});
