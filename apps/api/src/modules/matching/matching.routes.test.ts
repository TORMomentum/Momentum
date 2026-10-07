import "../../test/env.js";
import express from "express";
import type { Db } from "mongodb";
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
import { ProfileRepository } from "../profile/profile.repository.js";
import { MatchingRepository } from "./matching.repository.js";
import { buildMatchingRouter } from "./matching.routes.js";

const config = loadConfig(process.env);
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository;
function testApp() { sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs); const result = express(); result.use(express.json()); result.use(sessionContext(sessionsRepository)); result.use("/api/v1", buildMatchingRouter({ config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config) })); result.use(errorMiddleware); return result; }
async function vendor(email: string) { const account = await new AccountsRepository(db, sessionsRepository).create({ email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config), consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" } }); return { accountId: account.id, sessionId: (await sessionsRepository.create(account.id)).id }; }
async function seed(title: string, budget: number) {
  const category = title.includes("คอมพิวเตอร์") ? "ซื้อคอมพิวเตอร์และอุปกรณ์ไอที" : "งานก่อสร้าง-ทาง สะพาน";
  const inserted = await tors(db).insertOne({ contentHash: `${title}-${budget}`, storage: { bucket: "test", key: title, contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: { title: { raw: title, value: title, confidence: 1, verified: true }, category: { raw: category, value: category, confidence: 1, verified: true }, budget: { raw: String(budget), value: budget, confidence: 1, verified: true }, deadline: { raw: "2027-01-01", value: "2027-01-01", confidence: 1, verified: true } }, announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date() });
  await new MatchingRepository(db, config).classifyAndStore((await tors(db).findOne({ _id: inserted.insertedId }))!);
  return inserted.insertedId.toString();
}
beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "matching-routes")); await ensureIndexes(db); });
beforeEach(async () => { await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({}), vendorProfiles(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({})]); app = testApp(); });
afterAll(async () => { await disconnect(); });

describe("matching routes", () => {
  it("returns an empty list with a stated reason when no categories are chosen", async () => {
    const current = await vendor("empty@example.test");
    expect((await request(app).get("/api/v1/me/matches").set("x-session-id", current.sessionId)).body).toEqual({ items: [], reason: "กรุณาเลือกหมวดหมู่งานเพื่อดูรายการที่เกี่ยวข้อง" });
  });
  it("matches records nobody has classified, still holding the category wording from before the national list", async () => {
    // Every other test seeds through classifyAndStore, which pre-fills the cache
    // — so none of them could see that a corpus nobody had classified matched
    // nothing at all. This one inserts straight into the collection, exactly as
    // intake and the importers do, and with the older "งานก่อสร้าง-ทาง" wording
    // that records extracted before the national list still carry.
    const road = await vendor("cold@example.test");
    await vendorProfiles(db).insertOne({ accountId: road.accountId, categories: ["construction.road"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() });
    const inserted = await tors(db).insertOne({ contentHash: "cold-cache", storage: { bucket: "test", key: "cold", contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: { title: { raw: "ก่อสร้างถนนคอนกรีตเสริมเหล็ก", value: "ก่อสร้างถนนคอนกรีตเสริมเหล็ก", confidence: 1, verified: true }, category: { raw: "งานก่อสร้าง-ทาง", value: "งานก่อสร้าง-ทาง", confidence: 1, verified: true }, budget: { raw: "100", value: 100, confidence: 1, verified: true }, deadline: { raw: "2027-01-01", value: "2027-01-01", confidence: 1, verified: true } }, announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date() });
    expect(await torClassifications(db).countDocuments({})).toBe(0);

    const items = (await request(app).get("/api/v1/me/matches").set("x-session-id", road.sessionId)).body.items;

    expect(items.map((item: { id: string }) => item.id)).toEqual([inserted.insertedId.toString()]);
    expect(await torClassifications(db).countDocuments({})).toBe(1);
  });

  it("never returns another vendor's category candidates", async () => {
    const road = await vendor("road@example.test"); const computer = await vendor("computer@example.test");
    await vendorProfiles(db).insertMany([
      { accountId: road.accountId, categories: ["construction.road"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() },
      { accountId: computer.accountId, categories: ["goods.computer"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() },
    ]);
    const roadId = await seed("ปรับปรุงผิวจราจร", 100); const computerId = await seed("จัดซื้อคอมพิวเตอร์", 100);
    const roadItems = (await request(app).get("/api/v1/me/matches").set("x-session-id", road.sessionId)).body.items;
    const computerItems = (await request(app).get("/api/v1/me/matches").set("x-session-id", computer.sessionId)).body.items;
    expect(roadItems.map((item: { id: string }) => item.id)).toEqual([roadId]); expect(computerItems.map((item: { id: string }) => item.id)).toEqual([computerId]);
  });
  it("orders results best first", async () => {
    const current = await vendor("sort@example.test"); await vendorProfiles(db).insertOne({ accountId: current.accountId, categories: ["construction.road"], areas: ["thailand"], budget: { minThb: 100, maxThb: 200 }, taxonomyVersion: "test", updatedAt: new Date() });
    const best = await seed("ปรับปรุงผิวจราจร ก", 150); const lower = await seed("ปรับปรุงผิวจราจร ข", 500);
    expect((await request(app).get("/api/v1/me/matches").set("x-session-id", current.sessionId)).body.items.map((item: { id: string }) => item.id)).toEqual([best, lower]);
  });
  it("reclassifies a stale cached mapper version when it reads a candidate", async () => {
    const current = await vendor("stale@example.test");
    await vendorProfiles(db).insertOne({ accountId: current.accountId, categories: ["construction.road"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() });
    const id = await seed("ปรับปรุงผิวจราจร", 100);
    await torClassifications(db).updateOne({ torId: id }, { $set: { mapperVersion: "obsolete" } });
    await request(app).get("/api/v1/me/matches").set("x-session-id", current.sessionId);
    expect((await torClassifications(db).findOne({ torId: id }))?.mapperVersion).not.toBe("obsolete");
  });
  it("allows a free-text title candidate outside the selected coarse category", async () => {
    const current = await vendor("free-text@example.test");
    await vendorProfiles(db).insertOne({ accountId: current.accountId, categories: ["construction.road"], otherCategories: ["คอมพิวเตอร์"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() });
    const id = await seed("จัดซื้อคอมพิวเตอร์", 100);
    expect((await request(app).get("/api/v1/me/matches").set("x-session-id", current.sessionId)).body.items.map((item: { id: string }) => item.id)).toContain(id);
  });
});
