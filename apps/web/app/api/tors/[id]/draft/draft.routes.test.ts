import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../../../../src/shared/api/api-client", () => ({ apiRequest }));

import { POST } from "./route";

const ORIGIN = "http://app.test";
const ctx = { params: Promise.resolve({ id: "t1" }) };
const post = (headers: Record<string, string> = {}) =>
  POST(new NextRequest(`${ORIGIN}/api/tors/t1/draft`, { method: "POST", headers: { origin: ORIGIN, cookie: "tor-radar-session=sess", ...headers } }), ctx);

beforeEach(() => {
  apiRequest.mockReset();
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  vi.stubEnv("DRAFT_TIMEOUT_MS", "");
});

describe("draft handler", () => {
  it("asks the API for this TOR's draft with the session, and gives the model longer than the default deadline", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ text: "เรียน" }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "เรียน" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [path, init, session, deadline] = apiRequest.mock.calls[0]!;
    expect(path).toBe("/api/v1/me/tors/t1/draft");
    expect(init.method).toBe("POST");
    expect(init.headers.Origin).toBe(ORIGIN);
    expect(session).toBe("sess");
    expect(deadline).toBe(50_000); // the API's 45 s and a few seconds' slack
  });

  it("follows the configured model deadline", async () => {
    vi.stubEnv("DRAFT_TIMEOUT_MS", "10000");
    apiRequest.mockResolvedValue(new Response("{}", { status: 200 }));
    await post();
    expect(apiRequest.mock.calls[0]![3]).toBe(15_000);
  });

  it("passes the API's refusals on with their status and words", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ error: { code: "rate_limited", message: "บ่อยเกินไป" } }), { status: 429, headers: { "content-type": "application/json" } }));
    const response = await post();
    expect(response.status).toBe(429);
    expect((await response.json()).error.message).toBe("บ่อยเกินไป");
  });

  it("refuses another origin and a missing session before calling the API", async () => {
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ cookie: "" })).status).toBe(401);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("answers 502 in Thai when the API cannot be reached", async () => {
    apiRequest.mockRejectedValue(new Error("timeout"));
    const response = await post();
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("ลองใหม่");
  });
});
