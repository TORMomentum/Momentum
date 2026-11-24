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
import { StatsRepository } from "../stats/stats.repository.js";
import { buildPathRouter } from "./path.routes.js";

const config = loadConfig(process.env);
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository;

function testApp() {
  sessionsRepository = new SessionsRepository(db, config.session);
  const result = express();
  result.use(express.json());
  result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildPathRouter({ config, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, config), stats: new StatsRepository(db) }));
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

  describe("winner spread by category (TOR-284)", () => {
    const ROAD = "งานก่อสร้าง-ทาง สะพาน";
    const BUILDING = "งานก่อสร้าง-อาคาร";
    const award = (id: string, winner: string, over: Record<string, unknown> = {}) => ({
      recordId: id, winner: { raw: winner, value: winner, confidence: 0.97 }, winnerKind: "juristic",
      price: { raw: "1", value: 1, confidence: 0.97 }, announcedOn: "2026-01-20", unverified: false,
      provenance: { extractModel: "m", modelVersion: "m-1", extractedAt: new Date("2026-02-01T00:00:00Z") }, ...over,
    });
    // `winners` lists who won each awarded project, one TOR record per entry.
    async function awardedIn(category: string, winners: string[]) {
      for (const [index, winner] of winners.entries()) {
        await tors(db).insertOne({
          contentHash: `spread-${category}-${index}`, storage: { bucket: "test", key: `s${index}`, contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 },
          fields: { title: field(`${category} ${index}`), category: field(category), budget: field(1_000_000), torStatus: field("awarded") },
          cohort: { category, month: "2026-01" }, award: award(`${category}-${index}`, winner),
          announcedAt: null, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
        } as never);
      }
    }

    it("lists the field's comparable categories, widest spread first, and counts the rest as not comparable", async () => {
      // Road: eight different winners, so the top three hold 3 of 8. Building: eight projects, one winner has all of them.
      await awardedIn(ROAD, ["A", "B", "C", "D", "E", "F", "G", "H"].map((name) => `บริษัท ${name} จำกัด`));
      await awardedIn(BUILDING, Array.from({ length: 8 }, () => "บริษัท ใหญ่ จำกัด"));
      await awardedIn("งานก่อสร้าง-อื่น ๆ", ["บริษัท เอ จำกัด", "บริษัท บี จำกัด"]);
      // Another field's category must not appear.
      await awardedIn("ซื้อยานพาหนะ", Array.from({ length: 9 }, (_, index) => `บริษัท ${index} จำกัด`));
      const current = await vendor("a@example.test");

      const body = (await get(current.sessionId, "construction")).body;

      expect(body.winnerSpread).toEqual({
        topWinners: 3, minAwarded: 8,
        comparable: [
          { category: ROAD, awarded: 8, winners: 8, topShare: 0.375 },
          { category: BUILDING, awarded: 8, winners: 1, topShare: 1 },
        ],
        // อื่น ๆ has only two awarded projects and ชลประทานและระบบน้ำ has none: neither is given a share.
        notComparable: 2,
        lastAwardAt: "2026-02-01T00:00:00.000Z",
      });
      expect(JSON.stringify(body.winnerSpread)).not.toContain("บริษัท");
    });

    it("is empty, not invented, for a field with no awarded projects, and for one category when the target is a single kind of work", async () => {
      const current = await vendor("a@example.test");
      expect((await get(current.sessionId, "construction.road")).body.winnerSpread).toEqual({ topWinners: 3, minAwarded: 8, comparable: [], notComparable: 1, lastAwardAt: null });
      await awardedIn(ROAD, Array.from({ length: 8 }, (_, index) => `บริษัท ${index} จำกัด`));
      expect((await get(current.sessionId, "construction.road")).body.winnerSpread.comparable.map((row: { category: string }) => row.category)).toEqual([ROAD]);
    });
  });

  it("takes the newest usable TORs up to the cap, however the cache was refreshed and whatever else sits in it", async () => {
    const capped = { ...config, matching: { ...config.matching, pathSampleCap: 2 } };
    const cappedApp = express();
    cappedApp.use(express.json());
    cappedApp.use(sessionContext(sessionsRepository));
    cappedApp.use("/api/v1", buildPathRouter({ config: capped, profiles: new ProfileRepository(db), matching: new MatchingRepository(db, capped), stats: new StatsRepository(db) }));
    cappedApp.use(errorMiddleware);
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    await seed("ปรับปรุงผิวจราจร เก่า", 1_000_000, iso(), { announcedAt: day(1) });
    await seed("ปรับปรุงผิวจราจร กลาง", 1_000_000, iso(), { announcedAt: day(2) });
    await seed("ปรับปรุงผิวจราจร ใหม่", 1_000_000, iso(), { announcedAt: day(3) });
    // Newer than all of them in the cache, but not public: it must not use up a place.
    await seed("ปรับปรุงผิวจราจร ปิด", 1_000_000, iso(), { announcedAt: day(4), access: { restricted: true } });
    // Cache refresh order, newest first: the not-public one, then the OLDEST TOR (re-classified last), then the rest.
    // Neither the refresh time nor the not-public row may decide what the sample is.
    for (const [rank, title] of ["ปรับปรุงผิวจราจร ปิด", "ปรับปรุงผิวจราจร เก่า", "ปรับปรุงผิวจราจร ใหม่", "ปรับปรุงผิวจราจร กลาง"].entries()) {
      const record = (await tors(db).findOne({ "fields.title.value": title }))!;
      await torClassifications(db).updateOne({ torId: record._id.toString() }, { $set: { updatedAt: new Date(Date.UTC(2026, 5, 10 - rank)) } });
    }
    const current = await vendor("a@example.test");

    const body = (await request(cappedApp).get("/api/v1/me/path").query({ target: "construction.road" }).set("x-session-id", current.sessionId)).body;

    expect(body.sample).toBe(2);
    expect(body.requirements[0]).toMatchObject({ id: "iso-9001", asked: 2 });
    expect(body.budget).toEqual({ n: 2, medianThb: 1_000_000 });
  });

  it("leaves a budget out of the typical one unless it was verified and is plausible", async () => {
    await seed("ปรับปรุงผิวจราจร ก", 2_000_000);
    await seed("ปรับปรุงผิวจราจร ข", 1, { budget: { raw: "1", value: 1, confidence: 1, verified: false } });
    await seed("ปรับปรุงผิวจราจร ค", config.budgetMaxThb + 1, { budget: { raw: "x", value: config.budgetMaxThb + 1, confidence: 1, verified: true } });
    const current = await vendor("a@example.test");

    const body = (await get(current.sessionId, "construction.road")).body;

    expect(body.sample).toBe(3);
    expect(body.budget).toEqual({ n: 1, medianThb: 2_000_000 });
  });

  it("counts a licence the vendor listed with their certifications, not only one on a person", async () => {
    await seed("ปรับปรุงผิวจราจร ก", 1_000_000, { requiredDocuments: field([{ name: "ใบประกอบวิชาชีพวิศวกรรม", holder: "personnel", certification: "engineer" }]) });
    const listed = await vendor("listed@example.test");
    const base = { categories: [], areas: [], budget: null, taxonomyVersion: "test", updatedAt: new Date() };
    await vendorProfiles(db).insertOne({ accountId: listed.accountId, ...base, certifications: { cgd: [], tags: ["engineer"], other: [] }, personnel: [], pastProjects: [] });

    const body = (await get(listed.sessionId, "construction.road")).body;

    expect(body.requirements).toEqual([expect.objectContaining({ id: "engineer", holds: true })]);
  });
});
