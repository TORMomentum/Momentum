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
import { matchPercent } from "@tor-radar/shared";
import type { Storage } from "../../ports/storage.port.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { buildTorsRouter } from "../tors/tors.routes.js";
import { TorsService } from "../tors/tors.service.js";

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

  it("keeps a vendor's own kind of work when a catch-all category buries it under newer noise", async () => {
    // จ้างเหมาบริการ holds twenty-six kinds of work. A software vendor's coarse
    // set is therefore mostly other people's jobs, and when the cap was filled
    // by recency alone, a run of newer cleaning and security tenders pushed the
    // older software ones out before they were ever scored.
    const cap = 5;
    const capped = { ...config, matching: { ...config.matching, candidateCap: cap } };
    const small = express();
    small.use(express.json());
    small.use(sessionContext(sessionsRepository));
    small.use("/api/v1", buildMatchingRouter({ config: capped, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, capped) }));
    small.use(errorMiddleware);

    const dev = await vendor("software@example.test");
    await vendorProfiles(db).insertOne({ accountId: dev.accountId, categories: ["it.software"], areas: ["thailand"], budget: null, taxonomyVersion: "test", updatedAt: new Date() });

    const insert = async (title: string, category: string, ageDays: number) => {
      const at = new Date(Date.now() - ageDays * 86_400_000);
      return (await tors(db).insertOne({ contentHash: `${title}-${ageDays}`, storage: { bucket: "test", key: title, contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: { title: { raw: title, value: title, confidence: 1, verified: true }, category: { raw: category, value: category, confidence: 1, verified: true }, budget: { raw: "100", value: 100, confidence: 1, verified: true }, deadline: { raw: "2027-01-01", value: "2027-01-01", confidence: 1, verified: true } }, announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: at, updatedAt: at })).insertedId.toString();
    };
    const software = await insert("จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", "จ้างเหมาบริการ", 30);
    // The noise has to land in the SAME national category. Security tenders do
    // not — the national normaliser files them under their own category — so an
    // earlier version of this test used them and never exercised the cap at all.
    // Events, catering and transport stay in the catch-all.
    const noise = ["จ้างเหมาจัดงานนิทรรศการ", "จ้างเหมาบริการอาหารกลางวัน", "จ้างเหมาบริการขนส่งพัสดุ"];
    for (let i = 0; i < cap * 3; i += 1) await insert(`${noise[i % noise.length]} ${i}`, "จ้างเหมาบริการ", i);
    // Classify everything, then pin the cache's recency so the software TOR is
    // unambiguously the OLDEST. Left to the clock, every row is classified in the
    // same millisecond and the order is luck — an earlier version of this test
    // passed against the bug for exactly that reason.
    await new MatchingRepository(db, capped).ensureClassified();
    await torClassifications(db).updateMany({}, { $set: { updatedAt: new Date() } });
    await torClassifications(db).updateOne({ torId: software }, { $set: { updatedAt: new Date(Date.now() - 30 * 86_400_000) } });

    const items = (await request(small).get("/api/v1/me/matches").set("x-session-id", dev.sessionId)).body.items;

    expect(items.map((item: { id: string }) => item.id)).toContain(software);
    expect(items[0].id).toBe(software);
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

describe("search filtered by match score", () => {
  // Search and the score badge share one score function; this mounts both so the
  // filter is checked against the very numbers the badge shows.
  function searchApp() {
    const result = express();
    result.use(express.json());
    result.use(sessionContext(sessionsRepository));
    const deps = { config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config) };
    result.use("/api/v1", buildMatchingRouter(deps));
    result.use("/api/v1/tors", buildTorsRouter({ service: new TorsService({ repo: new TorsRepository(db), config }), storage: {} as Storage, search: config.search, ...deps }));
    result.use(errorMiddleware);
    return result;
  }

  async function roadVendorWithTwoMatches() {
    const current = await vendor("filter@example.test");
    await vendorProfiles(db).insertOne({ accountId: current.accountId, categories: ["construction.road"], areas: ["thailand"], budget: { minThb: 100, maxThb: 200 }, taxonomyVersion: "test", updatedAt: new Date() });
    const best = await seed("ปรับปรุงผิวจราจร ก", 150);
    const lower = await seed("ปรับปรุงผิวจราจร ข", 500);
    const unrelated = await seed("จัดซื้อคอมพิวเตอร์", 150);
    return { current, best, lower, unrelated };
  }

  it("keeps only TORs scoring at least the threshold, and the total says so", async () => {
    const app = searchApp();
    const { current, best, lower } = await roadVendorWithTwoMatches();
    const scores = (await request(app).get("/api/v1/me/matches/scores").set("x-session-id", current.sessionId)).body.scores;
    const [high, low] = [matchPercent(scores[best]), matchPercent(scores[lower])];
    expect(high).toBeGreaterThan(low);

    const above = await request(app).get(`/api/v1/tors?minMatch=${low + 1}`).set("x-session-id", current.sessionId);
    expect(above.status).toBe(200);
    expect(above.body.items.map((item: { id: string }) => item.id)).toEqual([best]);
    expect(above.body.total).toBe(1);

    // Inclusive, at the percentage the badge shows.
    const atLow = await request(app).get(`/api/v1/tors?minMatch=${low}`).set("x-session-id", current.sessionId);
    expect(atLow.body.items.map((item: { id: string }) => item.id).sort()).toEqual([best, lower].sort());
  });

  it("refuses the filter without a session instead of quietly returning everything", async () => {
    await roadVendorWithTwoMatches();
    expect((await request(searchApp()).get("/api/v1/tors?minMatch=50")).status).toBe(401);
  });

  it("rejects a threshold outside whole percentages 1-100", async () => {
    const app = searchApp();
    const { current } = await roadVendorWithTwoMatches();
    for (const bad of ["0", "101", "7.5", "abc"]) {
      expect((await request(app).get(`/api/v1/tors?minMatch=${bad}`).set("x-session-id", current.sessionId)).status).toBe(400);
    }
  });

  it("leaves search untouched when no threshold is asked for, signed in or not", async () => {
    const app = searchApp();
    const { current, best, lower, unrelated } = await roadVendorWithTwoMatches();
    const all = [best, lower, unrelated].sort();
    expect((await request(app).get("/api/v1/tors")).body.items.map((item: { id: string }) => item.id).sort()).toEqual(all);
    expect((await request(app).get("/api/v1/tors").set("x-session-id", current.sessionId)).body.items.map((item: { id: string }) => item.id).sort()).toEqual(all);
  });
});
