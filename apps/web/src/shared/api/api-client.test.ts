// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { apiRequest } from "./api-client.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.API_BASE_URL = "https://api.example.run.app";
  delete process.env.K_SERVICE;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("sends no Authorization header outside Cloud Run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/v1/tors");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("fetches and attaches an identity token scoped to api's own URL when running on Cloud Run", async () => {
    process.env.K_SERVICE = "tor-radar-web";
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("http://metadata.google.internal")) {
        expect(url).toContain(encodeURIComponent("https://api.example.run.app"));
        return Promise.resolve(new Response("the-id-token", { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/v1/tors");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer the-id-token");
  });
});
