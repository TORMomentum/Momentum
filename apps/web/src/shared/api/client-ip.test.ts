// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIpFrom, forwardedClientHeaders } from "./client-ip.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("clientIpFrom", () => {
  it("takes the entry just left of the trusted hops, ignoring whatever the client prepended", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIpFrom("198.51.100.9, 203.0.113.7")).toBe("203.0.113.7");
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(clientIpFrom("198.51.100.9, 203.0.113.7, 10.1.1.1")).toBe("203.0.113.7");
  });

  it("names no client when forwarding is off, the header is absent, or the entry is not an address", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(clientIpFrom("203.0.113.7")).toBeNull();
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIpFrom(null)).toBeNull();
    expect(clientIpFrom("not-an-ip")).toBeNull();
    process.env.TRUSTED_PROXY_HOPS = "3";
    expect(clientIpFrom("203.0.113.7")).toBeNull();
  });
});

describe("forwardedClientHeaders", () => {
  it("replaces the incoming chain with the single derived address", async () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    const incoming = new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" });
    expect(await forwardedClientHeaders(incoming)).toEqual({ "x-forwarded-for": "203.0.113.7" });
  });

  it("sends nothing outside a request", async () => {
    expect(await forwardedClientHeaders()).toEqual({});
  });
});
