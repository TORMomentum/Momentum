import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { API_SECURITY_HEADERS, securityHeaders } from "./security-headers.js";

function appWith(hstsMaxAgeSeconds = 31_536_000) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders({ hstsMaxAgeSeconds }));
  app.get("/thing", (_req, res) => res.json({ ok: true }));
  app.post("/thing", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("securityHeaders (TOR-317)", () => {
  it("sets every header on a normal response", async () => {
    const response = await request(appWith()).get("/thing");
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(response.headers[name.toLowerCase()]).toBe(value);
    }
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("sets them on a 404 too, since it runs before any route", async () => {
    const response = await request(appWith()).get("/missing");
    expect(response.status).toBe(404);
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("sends HSTS only when the client connected over HTTPS", async () => {
    const plain = await request(appWith()).get("/thing");
    expect(plain.headers["strict-transport-security"]).toBeUndefined();

    const behindTls = await request(appWith()).get("/thing").set("X-Forwarded-Proto", "https");
    expect(behindTls.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("sends no HSTS when its lifetime is configured as 0", async () => {
    const response = await request(appWith(0)).get("/thing").set("X-Forwarded-Proto", "https");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });
});
