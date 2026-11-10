import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../../src/shared/api/api-client", () => ({ apiRequest }));

import { POST } from "./route";
import { DELETE, GET } from "./[id]/route";

const ORIGIN = "http://app.test";
const ctx = { params: Promise.resolve({ id: "d1" }) };
const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) =>
  new NextRequest(`${ORIGIN}${url}`, { ...init, headers: { cookie: "tor-radar-session=sess", ...init.headers } });

beforeEach(() => {
  apiRequest.mockReset();
  vi.stubEnv("APP_ORIGIN", ORIGIN);
});

describe("vault handlers", () => {
  it("passes an upload's bytes and multipart type to the API unchanged, with the session", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 201, headers: { "content-type": "application/json" } }));
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80]); // not valid UTF-8
    const response = await POST(req("/api/vault", { method: "POST", headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" }, body: bytes }));

    expect(response.status).toBe(201);
    const [path, init, session] = apiRequest.mock.calls[0]!;
    expect(path).toBe("/api/v1/me/vault");
    expect(Buffer.from(init.body).equals(bytes)).toBe(true);
    expect(init.headers["content-type"]).toBe("multipart/form-data; boundary=x");
    expect(session).toBe("sess");
  });

  it("refuses uploads and deletes that do not come from this site, before calling the API", async () => {
    const upload = await POST(req("/api/vault", { method: "POST", headers: { origin: "http://evil.test" }, body: "x" }));
    const noOrigin = await DELETE(req("/api/vault/d1", { method: "DELETE" }), ctx);

    expect([upload.status, noOrigin.status]).toEqual([403, 403]);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("serves a download as the API sent it, never cacheable and never sniffed", async () => {
    apiRequest.mockResolvedValue(new Response("file-bytes", { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="a.pdf"' } }));
    const response = await GET(req("/api/vault/d1"), ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("file-bytes");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("passes on signed-out and not-theirs, and calls anything else the API failing", async () => {
    const statuses: number[] = [];
    for (const status of [401, 404, 500]) {
      apiRequest.mockResolvedValue(new Response("{}", { status }));
      statuses.push((await GET(req("/api/vault/d1"), ctx)).status);
    }
    expect(statuses).toEqual([401, 404, 502]);
  });

  it("deletes through the API with the session", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await DELETE(req("/api/vault/d1", { method: "DELETE", headers: { origin: ORIGIN } }), ctx);

    expect(response.status).toBe(200);
    expect(apiRequest.mock.calls[0]![0]).toBe("/api/v1/me/vault/d1");
    expect(apiRequest.mock.calls[0]![1].method).toBe("DELETE");
  });
});
