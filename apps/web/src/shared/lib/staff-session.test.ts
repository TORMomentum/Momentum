import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../api/api-client", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "../api/api-client";
import { isStaff, requireStaff, StaffAuthRequired } from "./staff-session";

const jar = new Map<string, string>();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  jar.clear();
  vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) } as never);
  vi.mocked(apiRequest).mockReset();
});

describe("requireStaff (TOR-199): the staff area opens to an admin account, and to nothing else", () => {
  it("refuses a browser with no account session, without asking the API", async () => {
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("refuses a vendor account", async () => {
    jar.set("tor-radar-session", "vendor-session");
    vi.mocked(apiRequest).mockImplementation(async () => json({ role: "vendor", email: "v@example.test" }));
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
    expect(await isStaff()).toBe(false);
  });

  it("accepts an admin account and hands back its session id for the admin API", async () => {
    jar.set("tor-radar-session", "admin-session");
    vi.mocked(apiRequest).mockImplementation(async () => json({ role: "admin", email: "a@example.test" }));
    expect(await requireStaff()).toBe("admin-session");
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/me", {}, "admin-session");
    expect(await isStaff()).toBe(true);
  });

  it("fails closed: an expired session, an API error or an unreachable API is no", async () => {
    jar.set("tor-radar-session", "some-session");
    vi.mocked(apiRequest).mockResolvedValueOnce(json({ error: "expired" }, 401));
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
    vi.mocked(apiRequest).mockResolvedValueOnce(json({ error: "down" }, 503));
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });

  it("ignores a staff cookie left from before TOR-199: the old shared pass opens nothing", async () => {
    jar.set("tor_staff", "1.9999999999999.signature");
    await expect(requireStaff()).rejects.toBeInstanceOf(StaffAuthRequired);
  });
});
