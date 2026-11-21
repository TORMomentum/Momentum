import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../../src/shared/api/api-client", () => ({ apiRequest }));
vi.mock("server-only", () => ({}));

import { POST } from "./[...path]/route";
import { GET as expired } from "./expired/route";

const ORIGIN = "http://app.test";

beforeEach(() => {
  apiRequest.mockReset();
  vi.stubEnv("APP_ORIGIN", ORIGIN);
});

describe("auth handlers", () => {
  it("clears the browser's cache, cookies and storage on the logout reply, and drops the session cookie", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await POST(
      new NextRequest(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { origin: ORIGIN, cookie: "tor-radar-session=sess" }, body: "{}" }),
      { params: Promise.resolve({ path: ["logout"] }) },
    );

    expect(response.headers.get("clear-site-data")).toBe('"cache", "cookies", "storage"');
    expect(response.headers.get("set-cookie")).toMatch(/tor-radar-session=;/);
    expect(apiRequest.mock.calls[0]![2]).toBe("sess");
  });

  it("sends a reader whose session was rejected to sign in again, with the reason, and drops the cookie", () => {
    const response = expired();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?reason=expired`);
    expect(response.headers.get("set-cookie")).toMatch(/tor-radar-session=;/);
  });
});
