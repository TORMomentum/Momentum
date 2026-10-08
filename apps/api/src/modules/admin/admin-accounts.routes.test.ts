import "../../test/env.js";

import express from "express";
import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { accounts, adminAudit, connect, disconnect, ensureIndexes, sessions, vendorProfiles } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import type { MailMessage, Mailer } from "../../ports/mailer.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "../accounts/account-tokens.repository.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { buildAdminAccountsRouter } from "./admin-accounts.routes.js";
import { AdminAccountsRepository } from "./admin-accounts.repository.js";
import { AdminAccountsService } from "./admin-accounts.service.js";

const config = loadConfig(process.env);
const adminKey = config.adminApiKeys[0]!;
const auth = { "x-api-key": adminKey };

let db: Db;
let sent: MailMessage[] = [];
const mailer: Mailer = { send: async (message) => { sent.push(message); return { messageId: "test" }; } };

function buildTestApp() {
  const sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", buildAdminAccountsRouter({
    service: new AdminAccountsService({
      repo: new AdminAccountsRepository(db),
      accounts: new AccountsRepository(db, sessionsRepository),
      profiles: new ProfileRepository(db),
      sessions: sessionsRepository,
      tokens: new AccountTokensRepository(db),
      mailer,
      appOrigin: "http://app.test",
      verifyTokenTtlMs: 60_000,
      resetTokenTtlMs: 60_000,
    }),
    adminKeys: config.adminApiKeys,
    pageSize: 20,
  }));
  app.use(errorMiddleware);
  return { app, sessionsRepository };
}

async function seedAccount(over: Record<string, unknown> = {}): Promise<string> {
  const now = new Date();
  const result = await accounts(db).insertOne({
    email: `vendor-${Math.random()}@example.test`,
    displayName: "ผู้ขายทดสอบ",
    passwordHash: "$argon2id$not-a-real-hash",
    emailVerifiedAt: now,
    role: "vendor",
    consent: { noticeVersion: "v", noticeHash: "h", agreedAt: now, action: "checkbox" },
    createdAt: now,
    updatedAt: now,
    ...over,
  } as never);
  return result.insertedId.toString();
}

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "admin-accounts-routes"));
  await ensureIndexes(db);
});

beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), adminAudit(db).deleteMany({}), sessions(db).deleteMany({}), vendorProfiles(db).deleteMany({})]);
  sent = [];
});

afterAll(async () => {
  await disconnect();
});

describe("admin vendor accounts", () => {
  it("lists live accounts without password hashes, searchable, and leaves deleted ones out", async () => {
    await seedAccount({ email: "somchai@example.test" });
    await seedAccount({ email: "deleted:abc", deletedAt: new Date() });
    const { app } = buildTestApp();

    const all = await request(app).get("/api/v1/admin/accounts").set(auth);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(1);
    expect(JSON.stringify(all.body)).not.toContain("argon2");
    expect((await request(app).get("/api/v1/admin/accounts?q=somchai").set(auth)).body.total).toBe(1);
    expect((await request(app).get("/api/v1/admin/accounts?q=.*").set(auth)).body.total).toBe(0);
  });

  it("records every view of an account, and returns its profile", async () => {
    const id = await seedAccount();
    const { app } = buildTestApp();

    const opened = await request(app).get(`/api/v1/admin/accounts/${id}`).set(auth);
    expect(opened.status).toBe(200);
    expect(opened.body.account).toMatchObject({ id, verified: true, disabled: false, hasPassword: true });
    expect(opened.body.profile.areas).toEqual(["thailand"]);
    expect(JSON.stringify(opened.body)).not.toContain("argon2");
    expect(await adminAudit(db).countDocuments({ accountId: id, action: "viewed" })).toBe(1);
  });

  it("edits a profile as the admin, validated like the vendor's own, and says who made it", async () => {
    const id = await seedAccount();
    const { app } = buildTestApp();

    const refused = await request(app).put(`/api/v1/admin/accounts/${id}/profile`).set(auth)
      .send({ categories: ["no-such-category"], areas: ["thailand"], budget: null });
    expect(refused.status).toBe(400);

    const saved = await request(app).put(`/api/v1/admin/accounts/${id}/profile`).set(auth)
      .send({ categories: ["construction.road"], areas: ["bangkok"], budget: { minThb: 0, maxThb: 5_000_000 } });
    expect(saved.status).toBe(200);
    expect(await vendorProfiles(db).findOne({ accountId: id })).toMatchObject({ categories: ["construction.road"], updatedBy: "admin" });
    expect(await adminAudit(db).countDocuments({ accountId: id, action: "profile-edited" })).toBe(1);
  });

  it("leaves the vendor's own email preferences alone when an admin edits their profile", async () => {
    // Admin profile editing and notification preferences arrived in separate
    // branches, neither knowing about the other. The admin edit builds its own
    // input and the repository sets only the fields it is given, so the
    // vendor's preferences survive — but only by that arrangement, which this
    // pins. How often a vendor is emailed is theirs to decide, not an admin's.
    const id = await seedAccount();
    const { app } = buildTestApp();
    const notify = { preset: "high", minMatch: 85, leadDays: 14, deadlineReminder: false, anomalyAlert: true };
    await vendorProfiles(db).insertOne({
      accountId: id, categories: ["it"], areas: ["thailand"], otherCategories: [], budget: null,
      notify, taxonomyVersion: "test", updatedAt: new Date(),
    } as never);

    const saved = await request(app).put(`/api/v1/admin/accounts/${id}/profile`).set(auth)
      .send({ categories: ["construction.road"], areas: ["bangkok"], budget: null });

    expect(saved.status).toBe(200);
    const stored = await vendorProfiles(db).findOne({ accountId: id });
    expect(stored?.categories).toEqual(["construction.road"]);
    expect(stored?.notify).toEqual(notify);
  });

  it("disables an account — signing it out everywhere — and enables it again", async () => {
    const id = await seedAccount();
    const { app, sessionsRepository } = buildTestApp();
    const session = await sessionsRepository.create(id);

    expect((await request(app).post(`/api/v1/admin/accounts/${id}/disable`).set(auth).send({ reason: "ab" })).status).toBe(400);
    expect((await request(app).post(`/api/v1/admin/accounts/${id}/disable`).set(auth).send({ reason: "บัญชีปลอม" })).status).toBe(200);
    expect(await sessionsRepository.resolve(session.id)).toBeNull();
    expect((await accounts(db).findOne({ _id: new ObjectId(id) }))?.disabledAt).toBeInstanceOf(Date);

    expect((await request(app).post(`/api/v1/admin/accounts/${id}/enable`).set(auth)).status).toBe(200);
    expect((await accounts(db).findOne({ _id: new ObjectId(id) }))?.disabledAt).toBeUndefined();
    expect((await adminAudit(db).find({ accountId: id }).sort({ at: 1 }).toArray()).map((entry) => entry.action)).toEqual(["disabled", "enabled"]);
  });

  it("changes a role, which signs the account out, and records from and to", async () => {
    const id = await seedAccount();
    const { app, sessionsRepository } = buildTestApp();
    const session = await sessionsRepository.create(id);

    expect((await request(app).post(`/api/v1/admin/accounts/${id}/role`).set(auth).send({ role: "admin" })).status).toBe(200);
    expect(await sessionsRepository.resolve(session.id)).toBeNull();
    expect(await adminAudit(db).findOne({ accountId: id, action: "role-changed" })).toMatchObject({ detail: "vendor → admin" });
  });

  it("sends a verification email only to an unverified account, and a reset link only to a verified one", async () => {
    const unverified = await seedAccount({ emailVerifiedAt: undefined, email: "new@example.test" });
    const verified = await seedAccount({ email: "known@example.test" });
    const { app } = buildTestApp();

    expect((await request(app).post(`/api/v1/admin/accounts/${verified}/verification-email`).set(auth)).status).toBe(400);
    expect((await request(app).post(`/api/v1/admin/accounts/${unverified}/password-reset`).set(auth)).status).toBe(400);
    expect(sent).toHaveLength(0);

    expect((await request(app).post(`/api/v1/admin/accounts/${unverified}/verification-email`).set(auth)).status).toBe(202);
    expect((await request(app).post(`/api/v1/admin/accounts/${verified}/password-reset`).set(auth)).status).toBe(202);
    expect(sent.map((message) => message.to)).toEqual(["new@example.test", "known@example.test"]);
    expect(sent[0]?.text).toContain("http://app.test/verify?token=");
    expect(sent[1]?.text).toContain("http://app.test/reset-password?token=");
    expect(await adminAudit(db).countDocuments({ action: { $in: ["verification-email-sent", "password-reset-sent"] } })).toBe(2);
  });

  it("requires the admin key, and answers 404 for an unknown account", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/v1/admin/accounts")).status).toBe(401);
    expect((await request(app).get(`/api/v1/admin/accounts/${new ObjectId().toString()}`).set(auth)).status).toBe(404);
  });
});
