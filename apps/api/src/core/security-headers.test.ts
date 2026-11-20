import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { corsAllowlist, securityHeaders } from "./security-headers.js";

const APP_ORIGIN = "https://app.example.test";
const FOREIGN = "https://evil.example";

function testApp() {
  const app = express();
  app.use(securityHeaders());
  app.use(corsAllowlist(APP_ORIGIN));
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("security headers (TOR-338)", () => {
  it("sets helmet headers, a deny-all CSP, and no x-powered-by", async () => {
    const res = await request(testApp()).get("/ping");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("CORS allowlist (TOR-339, TOR-340)", () => {
  it("echoes the allowed origin with credentials, never *", async () => {
    const res = await request(testApp()).get("/ping").set("Origin", APP_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers.vary).toContain("Origin");
  });

  it("answers an allowed preflight with the method list", async () => {
    const res = await request(testApp())
      .options("/ping")
      .set("Origin", APP_ORIGIN)
      .set("Access-Control-Request-Method", "DELETE");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("gives a foreign origin no Access-Control headers", async () => {
    const res = await request(testApp()).get("/ping").set("Origin", FOREIGN);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("rejects a foreign preflight without Access-Control headers", async () => {
    const res = await request(testApp())
      .options("/ping")
      .set("Origin", FOREIGN)
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
  });

  it("does not treat a look-alike origin as allowed", async () => {
    const res = await request(testApp()).get("/ping").set("Origin", `${APP_ORIGIN}.evil.example`);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
