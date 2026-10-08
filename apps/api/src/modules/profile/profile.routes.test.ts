import "../../test/env.js";
import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LogMailer } from "../../adapters/log.mailer.js";
import { loadConfig } from "../../core/config.js";
import { accounts, accountTokens, bookmarks, connect, disconnect, ensureIndexes, sessions, vendorProfiles } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "../accounts/account-tokens.repository.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { buildAccountsRouter } from "../accounts/accounts.routes.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { hashPassword } from "../accounts/password.js";
import { ProfileRepository } from "./profile.repository.js";
import { buildProfileRouter } from "./profile.routes.js";

const baseConfig = loadConfig(process.env); const config = { ...baseConfig, authRateLimitPerIp: 1_000, authRateLimitPerEmail: 1_000 };
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository;
function write(builder: request.Test) { return builder.set("origin", config.appOrigin); }
function testApp() { sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs); const accountsRepository = new AccountsRepository(db, sessionsRepository); const result = express(); result.use(express.json()); result.use(sessionContext(sessionsRepository)); result.use("/api/v1", buildAccountsRouter({ config, accounts: accountsRepository, tokens: new AccountTokensRepository(db), sessions: sessionsRepository, mailer: new LogMailer() })); result.use("/api/v1", buildProfileRouter({ config, profiles: new ProfileRepository(db) })); result.use(errorMiddleware); return result; }
async function account(email: string) { const repo = new AccountsRepository(db, sessionsRepository); return repo.create({ email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config), consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" } }); }
async function sessionFor(email: string) { const created = await account(email); return (await sessionsRepository.create(created.id)).id; }
const payload = { categories: ["construction.road"], areas: ["chiang-mai"], budget: { minThb: 10, maxThb: 20 } };
beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "profile-routes")); await ensureIndexes(db); });
beforeEach(async () => { await Promise.all([accounts(db).deleteMany({}), accountTokens(db).deleteMany({}), bookmarks(db).deleteMany({}), sessions(db).deleteMany({}), vendorProfiles(db).deleteMany({})]); app = testApp(); }); afterAll(async () => { await disconnect(); });
describe("profile routes", () => {
  it("returns an empty profile when none exists", async () => { const id = await sessionFor("one@example.test"); const response = await request(app).get("/api/v1/me/profile").set("x-session-id", id); expect(response.status).toBe(200); expect(response.body).toMatchObject({ categories: [], areas: ["thailand"], budget: null }); });
  it("stores a replacement and returns it", async () => { const id = await sessionFor("one@example.test"); await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(payload); const response = await request(app).get("/api/v1/me/profile").set("x-session-id", id); expect(response.body).toMatchObject(payload); expect(response.body.categories[0]).toBe("construction.road"); });
  it("rejects invalid categories, areas, and inverted budgets without writing", async () => { const id = await sessionFor("one@example.test"); for (const bad of [{ ...payload, categories: ["งานถนน"] }, { ...payload, areas: ["not-a-province"] }, { ...payload, budget: { minThb: 21, maxThb: 20 } }]) expect((await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(bad)).status).toBe(400); expect(await vendorProfiles(db).countDocuments({})).toBe(0); });
  it("keeps profiles isolated and replaces rather than appends", async () => { const mine = await sessionFor("one@example.test"); const other = await sessionFor("two@example.test"); await write(request(app).put("/api/v1/me/profile")).set("x-session-id", mine).send(payload); await write(request(app).put("/api/v1/me/profile")).set("x-session-id", mine).send({ ...payload, categories: ["it.software"] }); expect((await request(app).get("/api/v1/me/profile").set("x-session-id", other)).body.categories).toEqual([]); expect((await request(app).get("/api/v1/me/profile").set("x-session-id", mine)).body.categories).toEqual(["it.software"]); });
  it("keeps work the taxonomy has no word for, apart from the work it does", async () => {
    // Free text is what the taxonomy replaces, so it must not land in the field
    // matching reads. It is kept because it is the only record of what the
    // vocabulary is missing.
    const id = await sessionFor("one@example.test");
    const response = await write(request(app).put("/api/v1/me/profile"))
      .set("x-session-id", id)
      .send({ ...payload, otherCategories: ["ติดตั้งระบบเสียงในหอประชุม", "ติดตั้งระบบเสียงในหอประชุม"] });

    expect(response.status).toBe(200);
    expect(response.body.otherCategories).toEqual(["ติดตั้งระบบเสียงในหอประชุม"]);
    expect(response.body.categories).not.toContain("ติดตั้งระบบเสียงในหอประชุม");

    const stored = await vendorProfiles(db).findOne({});
    expect(stored?.categories).not.toContain("ติดตั้งระบบเสียงในหอประชุม");
  });

  it("defaults the free-text list to empty rather than demanding it", async () => {
    const id = await sessionFor("one@example.test");
    const response = await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(payload);
    expect(response.status).toBe(200);
    expect(response.body.otherCategories).toEqual([]);
  });

  it("gives a new profile a sensible notification preference instead of nothing", async () => {
    const id = await sessionFor("one@example.test");
    const response = await request(app).get("/api/v1/me/profile").set("x-session-id", id);
    expect(response.body.notify).toMatchObject({ preset: "daily", minMatch: 70 });
  });

  it("stores a stated notification preference and refuses an impossible threshold", async () => {
    const id = await sessionFor("one@example.test");
    const notify = { preset: "high", minMatch: 85, leadDays: 14, deadlineReminder: false, anomalyAlert: true };
    await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send({ ...payload, notify });
    expect((await request(app).get("/api/v1/me/profile").set("x-session-id", id)).body.notify).toMatchObject(notify);

    const bad = await write(request(app).put("/api/v1/me/profile"))
      .set("x-session-id", id)
      .send({ ...payload, notify: { ...notify, minMatch: 500 } });
    expect(bad.status).toBe(400);
    // The refused request changed nothing.
    expect((await request(app).get("/api/v1/me/profile").set("x-session-id", id)).body.notify.minMatch).toBe(85);
  });

  it("gives a read and a write the same shape, and never the database's own id", async () => {
    // These had drifted: a read returned the raw Mongo document and a write a
    // constructed object, so a client saw two different profiles depending on
    // how it had asked, and both leaked the collection's own key.
    const id = await sessionFor("one@example.test");
    const written = await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(payload);
    const read = await request(app).get("/api/v1/me/profile").set("x-session-id", id);

    expect(Object.keys(written.body).sort()).toEqual(Object.keys(read.body).sort());
    expect(written.body).toEqual(read.body);
    for (const body of [written.body, read.body]) {
      expect(JSON.stringify(body)).not.toContain("_id");
      expect(JSON.stringify(body)).not.toContain("accountId");
    }
  });

  it("exports and removes the profile with account deletion", async () => { const id = await sessionFor("one@example.test"); await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(payload); const exported = await request(app).get("/api/v1/me/export").set("x-session-id", id); expect(exported.body.profile).toMatchObject(payload); const accountId = (await accounts(db).findOne({ email: "one@example.test" }))!._id.toString(); const deleted = await write(request(app).delete("/api/v1/me")).set("x-session-id", id).send({ currentPassword: "correct-password" }); expect(deleted.status).toBe(200); expect(await vendorProfiles(db).countDocuments({ accountId })).toBe(0); });

  describe("past work and certifications", () => {
    const extras = {
      pastProjects: [{ title: "ก่อสร้างถนน คสล. หมู่ 5", year: 2567, valueThb: 4_800_000 }],
      certifications: { cgd: [{ branch: "road", grade: 3 }], tags: ["iso-9001"], other: [] },
    };

    it("saves them on their own and gives each project an id", async () => {
      const id = await sessionFor("one@example.test");
      const response = await write(request(app).put("/api/v1/me/profile/extras")).set("x-session-id", id).send(extras);
      expect(response.status).toBe(200);
      expect(response.body.pastProjects[0]).toMatchObject(extras.pastProjects[0]!);
      expect(response.body.pastProjects[0].id).toEqual(expect.any(String));
      expect(response.body.certifications).toEqual(extras.certifications);
    });

    it("is not wiped when the main profile form saves", async () => {
      // The main form and the admin screen send every field they own; past work
      // is not one of them, and a replace there must leave it alone.
      const id = await sessionFor("one@example.test");
      await write(request(app).put("/api/v1/me/profile/extras")).set("x-session-id", id).send(extras);
      const response = await write(request(app).put("/api/v1/me/profile")).set("x-session-id", id).send(payload);
      expect(response.body.pastProjects).toHaveLength(1);
      expect(response.body.certifications.cgd).toEqual([{ branch: "road", grade: 3 }]);
    });

    it("says 'not stated' until the section is saved, rather than 'holds nothing'", async () => {
      const id = await sessionFor("one@example.test");
      expect((await request(app).get("/api/v1/me/profile").set("x-session-id", id)).body.certifications).toBeNull();
    });

    it("rejects unknown branches, grades and certifications without writing", async () => {
      const id = await sessionFor("one@example.test");
      for (const bad of [
        { ...extras, certifications: { ...extras.certifications, cgd: [{ branch: "space", grade: 3 }] } },
        { ...extras, certifications: { ...extras.certifications, cgd: [{ branch: "road", grade: 9 }] } },
        { ...extras, certifications: { ...extras.certifications, tags: ["made-up"] } },
        { ...extras, pastProjects: [{ title: "", year: 2567, valueThb: null }] },
        { ...extras, pastProjects: Array.from({ length: config.matching.pastProjectsMax + 1 }, (_, i) => ({ title: `งาน ${i}`, year: null, valueThb: null })) },
      ]) expect((await write(request(app).put("/api/v1/me/profile/extras")).set("x-session-id", id).send(bad)).status).toBe(400);
      expect(await vendorProfiles(db).countDocuments({})).toBe(0);
    });
  });
});
