import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../api/api-client", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "../api/api-client";

import {
  requireStaff,
  signIn,
  StaffAuthRequired,
} from "./staff-session";

interface StoredCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

const cookieJar = new Map<string, StoredCookie>();
const cookieStore = {
  get: vi.fn((name: string) => cookieJar.get(name)),
  set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
    cookieJar.set(name, { name, value, options });
  }),
  delete: vi.fn((name: string) => cookieJar.delete(name)),
};

beforeEach(() => {
  vi.mocked(cookies).mockResolvedValue(
    cookieStore as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  vi.stubEnv("STAFF_ACCESS_SECRET", "correct horse battery staple");
  cookieJar.clear();
  cookieStore.get.mockClear();
  cookieStore.set.mockClear();
  cookieStore.delete.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("signIn", () => {
  it("refuses a wrong secret without issuing a cookie", async () => {
    await expect(signIn("wrong secret")).resolves.toBe(false);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("issues a hardened cookie for the configured secret", async () => {
    await expect(signIn("correct horse battery staple")).resolves.toBe(true);

    const cookie = cookieJar.get("tor_staff");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.value).not.toContain("correct horse battery staple");
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      expires: expect.any(Date),
    });
  });
});

describe("requireStaff", () => {
  it("refuses when there is no cookie", async () => {
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("refuses a malformed cookie", async () => {
    cookieJar.set("tor_staff", { name: "tor_staff", value: "not-a-token" });

    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("refuses a token with a tampered signature", async () => {
    await signIn("correct horse battery staple");
    const cookie = cookieJar.get("tor_staff");
    if (!cookie) throw new Error("Expected signIn to issue a cookie");
    const signatureStart = cookie.value.lastIndexOf(".") + 1;
    const replacement = cookie.value[signatureStart] === "A" ? "B" : "A";
    cookie.value = `${cookie.value.slice(0, signatureStart)}${replacement}${cookie.value.slice(signatureStart + 1)}`;

    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("refuses an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    await signIn("correct horse battery staple");
    const cookie = cookieJar.get("tor_staff");
    if (!cookie) throw new Error("Expected signIn to issue a cookie");
    const expiresAt = Number(cookie.value.split(".")[1]);
    vi.setSystemTime(expiresAt + 1);

    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("refuses when STAFF_ACCESS_SECRET is unset", async () => {
    await signIn("correct horse battery staple");
    vi.stubEnv("STAFF_ACCESS_SECRET", "");

    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("accepts a freshly issued valid cookie", async () => {
    await signIn("correct horse battery staple");

    await expect(requireStaff()).resolves.toBeUndefined();
  });

  it("refuses a valid pass while a vendor account is signed in", async () => {
    await signIn("correct horse battery staple");
    cookieJar.set("tor-radar-session", { name: "tor-radar-session", value: "vendor-session" });
    vi.mocked(apiRequest).mockResolvedValue(Response.json({ role: "vendor" }));

    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/me", {}, "vendor-session");
  });

  it("accepts a valid pass while an admin account is signed in", async () => {
    await signIn("correct horse battery staple");
    cookieJar.set("tor-radar-session", { name: "tor-radar-session", value: "admin-session" });
    vi.mocked(apiRequest).mockResolvedValue(Response.json({ role: "admin" }));

    await expect(requireStaff()).resolves.toBeUndefined();
  });

  it("treats an expired account session as no account, and fails closed when the role cannot be read", async () => {
    await signIn("correct horse battery staple");
    cookieJar.set("tor-radar-session", { name: "tor-radar-session", value: "old-session" });
    vi.mocked(apiRequest).mockResolvedValue(new Response(null, { status: 401 }));
    await expect(requireStaff()).resolves.toBeUndefined();

    vi.mocked(apiRequest).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });
});
