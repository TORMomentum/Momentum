import "../../test/env.js";
import express from "express";
import { type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { accounts, connect, disconnect, ensureIndexes, sessions, torClassifications, tors, vendorProfiles } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { hashPassword } from "../accounts/password.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { MatchingRepository } from "../matching/matching.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { buildPathRouter } from "./path.routes.js";

const config = loadConfig(process.env);
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository;

function testApp() {
  sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  const result = express();
  result.use(express.json());
  result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildPathRouter({ config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config) }));
  result.use(errorMiddleware);
  return result;
}
async function vendor(email: string) {
  const account = await new AccountsRepository(db, sessionsRepository).create({ email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config), consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" } });
  return { accountId: account.id, sessionId: (await sessionsRepository.create(account.id)).id };
}
const field = (value: unknown, confidence = 1) => ({ raw: String(value), value, confidence, verified: true });

async function seed(title: string, budget: number, extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  const inserted = await tors(db).insertOne({
    contentHash: `${title}-${budget}-${Math.random()}`, storage: { bucket: "test", key: title, contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 },
    fields: { title: field(title), category: field("งานก่อสร้าง-ทาง สะพาน"), budget: field(budget), torStatus: field("announced"), ...extra },
    announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  } as never);
  await new MatchingRepository(db, config).classifyAndStore((await tors(db).findOne({ _id: inserted.insertedId }))!);
}
const iso = (confidence = 1) => ({ requiredDocuments: field([{ name: "ISO 9001", holder: "company", certification: "iso-9001" }], confidence) });
const get = (sessionId: string, target: string) => request(app).get("/api/v1/me/path").query({ target }).set("x-session-id", sessionId);

beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "path-routes")); await ensureIndexes(db); });
beforeEach(async () => { await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({}), vendorProfiles(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({})]); app = testApp(); });
afterAll(async () => { await disconnect(); });

describe("company path", () => {
  it("needs a signed-in vendor and a field that exists", async () => {
    expect((await request(app).get("/api/v1/me/path").query({ target: "construction.road" })).status).toBe(401);
    const current = await vendor("a@example.test");
    expect((await get(current.sessionId, "no-such-field")).status).toBe(400);
    expect((await request(app).get("/api/v1/me/path").set("x-session-id", current.sessionId)).status).toBe(400);
  });

  it("counts what the TORs in the field ask for, most asked first, each TOR once, and the typical budget", async () => {
    await seed("ปรับปรุงผิวจราจร ก", 1_000_000, { ...iso(), qualifications: field(["ผู้เสนอราคาต้องมี ISO 9001"]) });
    await seed("ปรับปรุงผิวจราจร ข", 3_000_000, iso());
    await seed("ปรับปรุงผิวจราจร ค", 5_000_000, { qualifications: field(["ต้องได้ มอก."]) });
    const current = await vendor("a@example.test");

    const body = (await get(current.sessionId, "construction.road")).body;

    expect(body.sample).toBe(3);
    expect(body.requirements.map((item: { id: string; asked: number }) => [item.id, item.asked])).toEqual([["iso-9001", 2], ["road", 1], ["tis", 1]]);
    expect(body.budget).toEqual({ n: 3, medianThb: 3_000_000 });
  });

  it("asks for a registration only of work at or above the threshold", async () => {
    await seed("ก่อสร้างถนนคอนกรีต ใหญ่", config.matching.registrationMinBudgetThb);
    await seed("ก่อสร้างถนนคอนกรีต เล็ก", config.matching.registrationMinBudgetThb - 1);
    const current = await vendor("a@example.test");

    const body = (await get(current.sessionId, "construction")).body;

    expect(body.requirements).toEqual([expect.objectContaining({ kind: "registration", id: "road", asked: 1 })]);
  });

  it("does not count a field read below T_LOW, and does not count TORs outside the field or not public", async () => {
    await seed("ปรับปรุงผิวจราจร ก", 1_000_000, iso(config.tLow - 0.01));
    await seed("ปรับปรุงผิวจราจร ข", 1_000_000, iso(), { access: { restricted: true } });
    await seed("ปรับปรุงผิวจราจร ค", 1_000_000, iso(), { duplicateOf: "x" });
    await seed("จัดซื้อคอมพิวเตอร์", 1_000_000, iso());
    const current = await vendor("a@example.test");

    const body = (await get(current.sessionId, "construction.road")).body;

    expect(body.sample).toBe(1);
    expect(body.requirements).toEqual([]);
  });

  it("says what the vendor holds only once they have stated it, never calling 'not told' missing", async () => {
    await seed("ปรับปรุงผิวจราจร ก", 1_000_000, { requiredDocuments: field([{ name: "ISO 9001", holder: "company", certification: "iso-9001" }, { name: "ใบประกอบวิชาชีพวิศวกรรม", holder: "personnel", certification: "engineer" }]) });
    const silent = await vendor("silent@example.test");
    const stated = await vendor("stated@example.test");
    const base = { categories: [], areas: [], budget: null, taxonomyVersion: "test", updatedAt: new Date() };
    await vendorProfiles(db).insertOne({ accountId: stated.accountId, ...base, certifications: { cgd: [], tags: ["iso-9001"], other: [] }, personnel: [], pastProjects: [{ id: "p", title: "ถนน", year: 2567, valueThb: 7_000_000 }] });

    const none = (await get(silent.sessionId, "construction.road")).body;
    const some = (await get(stated.sessionId, "construction.road")).body;

    expect(none.requirements.map((item: { holds: unknown }) => item.holds)).toEqual([null, null]);
    expect(Object.fromEntries(some.requirements.map((item: { id: string; holds: unknown }) => [item.id, item.holds]))).toEqual({ "iso-9001": true, engineer: false });
    expect(none.yourLargestProjectThb).toBeNull();
    expect(some.yourLargestProjectThb).toBe(7_000_000);
  });
});
