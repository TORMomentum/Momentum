import express from "express";
import { ObjectId, type WithId } from "mongodb";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AccountDocument, AccountRole } from "./db.js";
import { errorMiddleware } from "./errors.js";
import { authRateLimit } from "./auth-rate-limit.js";
import { requireRole } from "./require-role.js";
import { requireSameOrigin } from "./require-same-origin.js";
import { sessionContext } from "./session-context.js";

function account(role: AccountRole): WithId<AccountDocument> {
  const now = new Date();
  return {
    _id: new ObjectId(),
    email: "vendor@example.test",
    displayName: "Vendor",
    role,
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: now, action: "checkbox" },
    createdAt: now,
    updatedAt: now,
  };
}

function protectedApp(resolve: (id: string) => Promise<{ account: WithId<AccountDocument>; role: AccountRole } | null>) {
  const app = express();
  app.use(sessionContext({ resolve }));
  app.get("/vendor", requireRole("vendor"), (_req, res) => res.status(204).end());
  app.use(errorMiddleware);
  return app;
}

describe("session context and roles", () => {
  it("distinguishes no session, the wrong role, and the right role", async () => {
    const vendor = account("vendor");
    const app = protectedApp(async (id) => (id === "vendor-session" ? { account: vendor, role: vendor.role } : null));

    expect((await request(app).get("/vendor")).status).toBe(401);
    expect((await request(app).get("/vendor").set("x-session-id", "missing")).status).toBe(401);
    const admin = account("admin");
    const wrongRoleApp = protectedApp(async () => ({ account: admin, role: admin.role }));
    expect((await request(wrongRoleApp).get("/vendor").set("x-session-id", "admin-session")).status).toBe(403);
    expect((await request(app).get("/vendor").set("x-session-id", "vendor-session")).status).toBe(204);
  });

  it("uses the account role resolved for the next request, not a role retained in a session", async () => {
    let accountRow = account("vendor");
    const resolve = vi.fn(async (id: string) => (id === "active" ? { account: accountRow, role: accountRow.role } : null));
    const app = protectedApp(resolve);

    expect((await request(app).get("/vendor").set("x-session-id", "active")).status).toBe(204);
    accountRow = { ...accountRow, role: "admin" };
    expect((await request(app).get("/vendor").set("x-session-id", "active")).status).toBe(403);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("treats an expired session as absent", async () => {
    const app = protectedApp(async () => null);

    expect((await request(app).get("/vendor").set("x-session-id", "expired")).status).toBe(401);
  });

  it("does not accept a role claimed in a request header", async () => {
    const app = protectedApp(async () => null);

    expect((await request(app).get("/vendor").set("x-role", "admin")).status).toBe(401);
  });
});

describe("same-origin protection", () => {
  function app() {
    const app = express();
    app.post("/write", requireSameOrigin("https://app.example.test"), (_req, res) => res.status(204).end());
    app.use(errorMiddleware);
    return app;
  }

  it("rejects a foreign Origin and accepts the configured origin", async () => {
    expect((await request(app()).post("/write").set("Origin", "https://attacker.example.test")).status).toBe(403);
    expect((await request(app()).post("/write").set("Origin", "https://app.example.test")).status).toBe(204);
  });

  it("rejects missing provenance and uses Referer only when Origin is absent", async () => {
    expect((await request(app()).post("/write")).status).toBe(403);
    expect((await request(app()).post("/write").set("Referer", "https://app.example.test/account")).status).toBe(204);
  });
});

describe("auth rate limiting", () => {
  function app(perIp: number, perEmail: number) {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/auth", authRateLimit({ authRateLimitPerIp: perIp, authRateLimitPerEmail: perEmail }), (_req: express.Request, res: express.Response) => res.status(204).end());
    return app;
  }

  it("limits the n plus one request from an address without affecting another address", async () => {
    const server = app(2, 10);
    const first = () => request(server).post("/auth").set("X-Forwarded-For", "203.0.113.1").send({ email: "one@example.test" });

    expect((await first()).status).toBe(204);
    expect((await first()).status).toBe(204);
    expect((await first()).status).toBe(429);
    expect((await request(server).post("/auth").set("X-Forwarded-For", "203.0.113.2").send({ email: "two@example.test" })).status).toBe(204);
  });

  it("limits a normalised email independently of the address", async () => {
    const server = app(10, 2);
    const send = (address: string, email: string) => request(server).post("/auth").set("X-Forwarded-For", address).send({ email });

    expect((await send("203.0.113.1", "Vendor@Example.Test")).status).toBe(204);
    expect((await send("203.0.113.2", "vendor@example.test")).status).toBe(204);
    expect((await send("203.0.113.3", "vendor@example.test")).status).toBe(429);
    expect((await send("203.0.113.3", "other@example.test")).status).toBe(204);
  });

  it("does not pool requests that carry no address into one shared email bucket", async () => {
    // A logout or a refresh posts no email. If those all keyed on the empty
    // string, a few of them would spend the per-email allowance for everyone.
    const server = app(100, 2);
    const send = (address: string) => request(server).post("/auth").set("X-Forwarded-For", address).send({});

    expect((await send("203.0.113.1")).status).toBe(204);
    expect((await send("203.0.113.2")).status).toBe(204);
    expect((await send("203.0.113.3")).status).toBe(204);
    expect((await send("203.0.113.4")).status).toBe(204);
  });
});
