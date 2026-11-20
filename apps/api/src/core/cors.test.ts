import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { cors } from "./cors.js";

function appWith() {
  const app = express();
  app.use(cors({ allowedOrigins: ["https://app.example.test"], maxAgeSeconds: 600 }));
  app.get("/thing", (_req, res) => res.json({ ok: true }));
  app.post("/thing", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("cors (TOR-317)", () => {
  it("echoes an allowed origin, never a wildcard", async () => {
    const response = await request(appWith()).get("/thing").set("Origin", "https://app.example.test");
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.test");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers.vary).toContain("Origin");
  });

  it("gives an unlisted origin no CORS header, so the browser blocks the read", async () => {
    const response = await request(appWith()).get("/thing").set("Origin", "https://evil.example");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("does not treat a lookalike origin as allowed", async () => {
    for (const origin of ["https://app.example.test.evil.example", "http://app.example.test", "null"]) {
      const response = await request(appWith()).get("/thing").set("Origin", origin);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("answers an allowed preflight with 204 and the permitted methods", async () => {
    const response = await request(appWith())
      .options("/thing")
      .set("Origin", "https://app.example.test")
      .set("Access-Control-Request-Method", "POST");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-max-age"]).toBe("600");
  });

  it("refuses a preflight from an unlisted origin", async () => {
    const response = await request(appWith())
      .options("/thing")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("leaves requests without an Origin header alone (server-to-server)", async () => {
    const response = await request(appWith()).post("/thing");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
