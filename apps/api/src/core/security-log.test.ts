import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authRateLimit } from "./auth-rate-limit.js";
import { errorMiddleware, ForbiddenError } from "./errors.js";
import { setLogSink } from "./logger.js";
import { auditAdmin, securityLog } from "./security-log.js";
import { requireKey } from "../modules/intake/intake.auth.js";
import { adminActor, requireRole } from "./require-role.js";
import { AS_ADMIN, TEST_ADMIN_ID, testSession } from "../test/admin-session.js";

const API_KEY = "test-admin-key-3f9a";
const SESSION = "session-id-7c1d";
let lines: Record<string, unknown>[];
let raw: string;
let app: Express;

beforeEach(() => {
  lines = [];
  raw = "";
  setLogSink((line) => { raw += line; lines.push(JSON.parse(line) as Record<string, unknown>); });
  app = express();
  app.use(securityLog());
  app.use(express.json());
  app.post("/unexpected", (req) => { throw new TypeError(req.body.input); });
  app.post("/forbidden", () => { throw new ForbiddenError(); });
  app.post("/login", ...authRateLimit({ authRateLimitPerIp: 100, authRateLimitPerEmail: 1 }), (_req, res) => { res.json({ ok: true }); });
  // A key-gated router (as POST /intake is) for the refusal log, and the admin router as it is now (TOR-199).
  const keyed = express.Router();
  keyed.use(requireKey([API_KEY], "api"));
  keyed.post("/tors/:id/approve", (_req, res) => { res.json({ ok: true }); });
  app.use("/keyed", keyed);
  const admin = express.Router();
  admin.use(testSession());
  admin.use(requireRole("admin"));
  admin.use(auditAdmin(adminActor));
  admin.post("/tors/:id/approve", (_req, res) => { res.json({ ok: true }); });
  admin.get("/tors", (_req, res) => { res.json([]); });
  app.use("/admin", admin);
  app.use(errorMiddleware);
});
afterEach(() => setLogSink());

describe("security logging", () => {
  it("keeps request data out of the serialized unexpected-error log", async () => {
    const res = await request(app).post("/unexpected").send({ input: "private-parser-input" }).expect(500);
    expect(lines).toContainEqual(expect.objectContaining({ message: "unhandled_error", name: "TypeError", code: "internal", requestId: res.headers["x-request-id"] }));
    expect(raw).not.toContain("private-parser-input");
  });

  it("logs a 403 as auth.denied with route, method and request id, and none of the secrets sent", async () => {
    const response = await request(app).post("/forbidden?token=abc123").set("x-session-id", SESSION).set("cookie", "sid=cookie-value").set("user-agent", `ua/${"x".repeat(500)}`).send({ password: "hunter2-secret" });

    expect(response.status).toBe(403);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ message: "auth.denied", category: "security", status: 403, method: "POST", path: "/forbidden", requestId: response.headers["x-request-id"] });
    expect((lines[0]!.userAgent as string).length).toBeLessThanOrEqual(120);
    expect(raw).not.toMatch(/hunter2|abc123|cookie-value|session-id-7c1d/);
  });

  it("logs a wrong API key as auth.denied without the key", async () => {
    await request(app).post("/keyed/tors/1/approve").set("x-api-key", "wrong-key-value").expect(401);
    expect(lines).toEqual([expect.objectContaining({ message: "auth.denied", status: 401, path: "/keyed/tors/1/approve" })]);
    expect(raw).not.toContain("wrong-key-value");
  });

  it("logs a rate-limit hit with the key type, never the email", async () => {
    const send = () => request(app).post("/login").send({ email: "victim@example.test", password: "pw-secret" });
    await send().expect(200);
    await send().expect(429);
    expect(lines).toEqual([expect.objectContaining({ message: "ratelimit.hit", keyType: "email", path: "/login" })]);
    expect(raw).not.toMatch(/victim@example|pw-secret/);
  });

  it("logs a state-changing admin action with the actor and target, and reads are not logged", async () => {
    await request(app).get("/admin/tors").set(AS_ADMIN).expect(200);
    await request(app).post("/admin/tors/64b000000000000000000001/approve").set(AS_ADMIN).send({ edits: [] }).expect(200);

    expect(lines).toEqual([expect.objectContaining({
      message: "admin.action", actor: TEST_ADMIN_ID, authMethod: "session",
      action: "POST /admin/tors/:id/approve", target: "64b000000000000000000001", status: 200,
    })]);
  });

  it("refuses the admin router to a vendor and to no account, and logs both", async () => {
    await request(app).post("/admin/tors/1/approve").set({ "x-test-role": "vendor" }).expect(403);
    await request(app).post("/admin/tors/1/approve").expect(401);
    expect(lines.map((line) => [line.message, line.status])).toEqual([["auth.denied", 403], ["auth.denied", 401]]);
  });
});
