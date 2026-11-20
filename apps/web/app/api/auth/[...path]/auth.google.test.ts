import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../../../src/shared/api/api-client", () => ({ apiRequest }));
// The handler reads one constant from the staff-session module, which is server-only and reads next/headers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { GET, POST } from "./route";

const ORIGIN = "http://app.test";
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const setCookie = (response: Response) => response.headers.getSetCookie().join("\n");

beforeEach(() => {
  apiRequest.mockReset();
  vi.stubEnv("APP_ORIGIN", ORIGIN);
});

describe("Google sign-in handler", () => {
  it("start redirects to Google and keeps the browser binding in an httpOnly, SameSite=Lax cookie scoped to the flow", async () => {
    apiRequest.mockResolvedValue(json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=s", binding: "bind-1" }));
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/google/start`), ctx("google", "start"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=s");
    const cookie = setCookie(response);
    expect(cookie).toContain("tor-radar-google-binding=bind-1");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/api/auth/google");
  });

  it("start lands on the login page with an error when the API is unreachable or Google sign-in is off", async () => {
    apiRequest.mockResolvedValue(json({}, 404));
    const off = await GET(new NextRequest(`${ORIGIN}/api/auth/google/start`), ctx("google", "start"));
    apiRequest.mockRejectedValue(new Error("down"));
    const down = await GET(new NextRequest(`${ORIGIN}/api/auth/google/start`), ctx("google", "start"));

    expect(off.headers.get("location")).toBe(`${ORIGIN}/login?error=google`);
    expect(down.headers.get("location")).toBe(`${ORIGIN}/login?error=google`);
  });

  it("callback without the binding cookie (or after the person declined) never reaches the API", async () => {
    const noCookie = await GET(new NextRequest(`${ORIGIN}/api/auth/google/callback?code=c&state=s`), ctx("google", "callback"));
    const declined = await GET(new NextRequest(`${ORIGIN}/api/auth/google/callback?error=access_denied&state=s`, { headers: { cookie: "tor-radar-google-binding=b" } }), ctx("google", "callback"));

    expect(noCookie.headers.get("location")).toBe(`${ORIGIN}/login?error=google`);
    expect(declined.headers.get("location")).toBe(`${ORIGIN}/login?error=google`);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("callback with a forged state is refused by the API and ends on the login page without a session", async () => {
    apiRequest.mockResolvedValue(json({ message: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้" }, 401));
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/google/callback?code=c&state=forged`, { headers: { cookie: "tor-radar-google-binding=b" } }), ctx("google", "callback"));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=google`);
    expect(setCookie(response)).not.toContain("tor-radar-session");
    expect(response.headers.get("location")).not.toContain("forged");
  });

  it("callback success sets the normal session cookie and the id appears nowhere else", async () => {
    apiRequest.mockResolvedValue(json({ status: "signed_in", sessionId: "sess-1", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/google/callback?code=c&state=s`, { headers: { cookie: "tor-radar-google-binding=b" } }), ctx("google", "callback"));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
    const cookie = setCookie(response);
    expect(cookie).toMatch(/tor-radar-session=sess-1;.*HttpOnly/is);
    expect(cookie).toContain("tor_staff=;");
    expect(response.headers.get("location")).not.toContain("sess-1");
    const [path, init] = apiRequest.mock.calls[0]!;
    expect(path).toBe("/auth/google/callback");
    expect(JSON.parse(init.body)).toEqual({ code: "c", state: "s", binding: "b" });
  });

  it("a first sign-in is sent to the consent page with a ticket cookie, and no session", async () => {
    apiRequest.mockResolvedValue(json({ status: "consent_required", ticket: "t-1" }));
    const response = await GET(new NextRequest(`${ORIGIN}/api/auth/google/callback?code=c&state=s`, { headers: { cookie: "tor-radar-google-binding=b" } }), ctx("google", "callback"));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/google-consent`);
    expect(setCookie(response)).toContain("tor-radar-google-ticket=t-1");
    expect(setCookie(response)).not.toContain("tor-radar-session=");
  });

  it("complete forwards the ticket from the cookie with consent, and a foreign origin is refused first", async () => {
    apiRequest.mockResolvedValue(json({ status: "signed_in", sessionId: "sess-2", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const body = JSON.stringify({ consent: true });
    const headers = { "content-type": "application/json", cookie: "tor-radar-google-ticket=t-1" };

    const foreign = await POST(new NextRequest(`${ORIGIN}/api/auth/google/complete`, { method: "POST", body, headers: { ...headers, origin: "http://evil.test" } }), ctx("google", "complete"));
    const ok = await POST(new NextRequest(`${ORIGIN}/api/auth/google/complete`, { method: "POST", body, headers: { ...headers, origin: ORIGIN } }), ctx("google", "complete"));

    expect(foreign.status).toBe(403);
    expect(ok.status).toBe(200);
    expect(setCookie(ok)).toContain("tor-radar-session=sess-2");
    expect(JSON.parse(apiRequest.mock.calls[0]![1].body)).toEqual({ ticket: "t-1", consent: true });
    expect(await ok.json()).toEqual({ ok: true });
  });

  it("complete without a ticket cookie is refused", async () => {
    const response = await POST(new NextRequest(`${ORIGIN}/api/auth/google/complete`, { method: "POST", body: "{}", headers: { origin: ORIGIN, "content-type": "application/json" } }), ctx("google", "complete"));
    expect(response.status).toBe(401);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
