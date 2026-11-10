import "../../test/env.js";

import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LogMailer } from "../../adapters/log.mailer.js";
import { loadConfig, type Config } from "../../core/config.js";
import { accounts, accountTokens, behaviourEvents, bookmarks, connect, disconnect, ensureIndexes, sessions, torClassifications, tors } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "../accounts/account-tokens.repository.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { buildAccountsRouter } from "../accounts/accounts.routes.js";
import { hashPassword } from "../accounts/password.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { BookmarksRepository } from "../bookmarks/bookmarks.repository.js";
import { buildBookmarksRouter } from "../bookmarks/bookmarks.routes.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { BehaviourRepository } from "./behaviour.repository.js";
import { buildBehaviourRouter } from "./behaviour.routes.js";

const baseConfig = loadConfig(process.env);
const config: Config = {
  ...baseConfig,
  authRateLimitPerIp: 1_000,
  authRateLimitPerEmail: 1_000,
  matching: { ...baseConfig.matching, behaviour: { ...baseConfig.matching.behaviour, enabled: true } },
};
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository; let behaviour: BehaviourRepository;

function testApp() {
  sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  behaviour = new BehaviourRepository(db, config);
  const accountsRepository = new AccountsRepository(db, sessionsRepository);
  const result = express(); result.use(express.json()); result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildAccountsRouter({ config, accounts: accountsRepository, tokens: new AccountTokensRepository(db), sessions: sessionsRepository, mailer: new LogMailer(), vault: { removeAll: async () => undefined } }));
  result.use("/api/v1", buildBookmarksRouter({ config, bookmarks: new BookmarksRepository(db), tors: new TorsRepository(db), behaviour }));
  result.use("/api/v1", buildBehaviourRouter({ config, behaviour, tors: new TorsRepository(db) }));
  result.use(errorMiddleware); return result;
}
function write(builder: request.Test) { return builder.set("origin", config.appOrigin); }
async function sessionFor(email: string) {
  const repository = new AccountsRepository(db, sessionsRepository);
  const account = await repository.create({ email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config), consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" } });
  return { accountId: account.id, sessionId: (await sessionsRepository.create(account.id)).id };
}
async function seedTor() {
  const result = await tors(db).insertOne({
    contentHash: `behaviour-${Math.random()}`, storage: { bucket: "test", key: "tor", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 }, fields: { title: { raw: "โครงการทดสอบ", value: "โครงการทดสอบ", confidence: 1, verified: true } },
    announcedAt: new Date(), sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return result.insertedId.toString();
}
const grant = (sessionId: string) => write(request(app).post("/api/v1/me/consent/behaviour")).set("x-session-id", sessionId).send({});
const send = (sessionId: string, torId: string, type = "view") => write(request(app).post("/api/v1/me/events")).set("x-session-id", sessionId).send({ torId, type });

beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "behaviour-routes")); await ensureIndexes(db); });
beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), accountTokens(db).deleteMany({}), behaviourEvents(db).deleteMany({}), bookmarks(db).deleteMany({}), sessions(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({})]);
  app = testApp();
});
afterAll(async () => { await disconnect(); });

describe("behaviour consent and events", () => {
  it("records nothing, and says so, until the vendor has consented", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    const refused = await send(vendor.sessionId, torId);
    expect(refused.status).toBe(403);
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);

    expect((await grant(vendor.sessionId)).status).toBe(200);
    expect((await send(vendor.sessionId, torId, "dismiss")).status).toBe(204);
    expect(await behaviourEvents(db).findOne({}, { projection: { _id: 0, at: 0 } })).toEqual({ accountId: vendor.accountId, torId, type: "dismiss" });
  });

  it("is separate from the sign-up consent: ticking neither box, or only the first, records nothing", async () => {
    const vendor = await sessionFor("one@example.test");
    const me = await request(app).get("/api/v1/me").set("x-session-id", vendor.sessionId);
    expect(me.body.behaviourConsent).toBeNull();
    expect(me.body.consent.agreedAt).toEqual(expect.any(String));
  });

  it("can be given at sign-up, and is never required to register", async () => {
    const register = (email: string, extra: object) => write(request(app).post("/api/v1/register")).send({ email, password: "correct-password", consent: true, ...extra });
    expect((await register("with@example.test", { behaviourConsent: true })).status).toBe(202);
    expect((await register("without@example.test", {})).status).toBe(202);
    expect((await accounts(db).findOne({ email: "with@example.test" }))?.behaviourConsent?.agreedAt).toBeInstanceOf(Date);
    expect((await accounts(db).findOne({ email: "without@example.test" }))?.behaviourConsent).toBeUndefined();
  });

  it("rejects an unknown TOR, an unknown event type and extra fields without writing", async () => {
    const vendor = await sessionFor("one@example.test"); await grant(vendor.sessionId);
    expect((await send(vendor.sessionId, "0".repeat(24))).status).toBe(404);
    const torId = await seedTor();
    expect((await send(vendor.sessionId, torId, "like")).status).toBe(400);
    expect((await write(request(app).post("/api/v1/me/events")).set("x-session-id", vendor.sessionId).send({ torId, type: "view", accountId: "x" })).status).toBe(400);
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);
  });

  it("records nothing while scoring by behaviour is off, even with consent, and says so in /me", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await grant(vendor.sessionId);
    const off = new BehaviourRepository(db, baseConfig);
    expect(await off.record(vendor.accountId, torId, "view")).toBe(false);
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);
    expect((await request(app).get("/api/v1/me").set("x-session-id", vendor.sessionId)).body.behaviourEnabled).toBe(true);
  });

  it("keeps nothing when consent is withdrawn between the consent check and the write", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await grant(vendor.sessionId);
    const accountsRepository = new AccountsRepository(db, sessionsRepository);
    // The first read says yes; before the write lands, the whole withdrawal (flag, then delete) completes.
    const spy = vi.spyOn(behaviour, "hasConsent").mockImplementationOnce(async () => {
      await accountsRepository.setBehaviourConsent(vendor.accountId, false);
      return true;
    });
    expect(await behaviour.record(vendor.accountId, torId, "view")).toBe(false);
    spy.mockRestore();
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);
  });

  it("keeps nothing when the check after the write fails, and the sweep removes whatever a failed cleanup left", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await grant(vendor.sessionId);
    const accountsRepository = new AccountsRepository(db, sessionsRepository);
    // Withdrawal completes before the write; then the second consent read fails.
    const spy = vi.spyOn(behaviour, "hasConsent")
      .mockImplementationOnce(async () => { await accountsRepository.setBehaviourConsent(vendor.accountId, false); return true; })
      .mockImplementationOnce(async () => { throw new Error("database unavailable"); });
    await expect(behaviour.record(vendor.accountId, torId, "view")).rejects.toThrow("database unavailable");
    spy.mockRestore();
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);

    // If that cleanup had failed as well, the row would be an orphan: unread, and removed by the sweep.
    const other = await sessionFor("two@example.test"); await grant(other.sessionId);
    await behaviourEvents(db).insertOne({ accountId: vendor.accountId, torId, type: "view", at: new Date() });
    await behaviourEvents(db).insertOne({ accountId: other.accountId, torId, type: "view", at: new Date() });
    expect(await behaviour.affinity(vendor.accountId)).toEqual({});
    expect(await behaviour.purgeUnconsented()).toBe(1);
    expect(await behaviourEvents(db).find({}).toArray()).toMatchObject([{ accountId: other.accountId }]);
  });

  it("starts fresh consent with no history, but giving consent again while it is live keeps what was recorded", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await behaviourEvents(db).insertOne({ accountId: vendor.accountId, torId, type: "view", at: new Date() }); // an orphan
    await grant(vendor.sessionId);
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);

    expect((await send(vendor.sessionId, torId, "save")).status).toBe(204);
    await grant(vendor.sessionId);
    expect(await behaviourEvents(db).countDocuments({})).toBe(1);
  });

  it("answers /me after a withdrawal that came before any consent, and leaves the account as it was", async () => {
    const vendor = await sessionFor("one@example.test");
    const withdrawn = await write(request(app).post("/api/v1/me/consent/behaviour/withdraw")).set("x-session-id", vendor.sessionId).send({});
    expect(withdrawn.status).toBe(200);
    const me = await request(app).get("/api/v1/me").set("x-session-id", vendor.sessionId);
    expect(me.status).toBe(200);
    expect(me.body.behaviourConsent).toBeNull();
    expect((await accounts(db).findOne({}))?.behaviourConsent).toBeUndefined();
    // A row that already has only a withdrawal (written before this fix) reads as never given, not as a crash.
    await accounts(db).updateOne({}, { $set: { "behaviourConsent.withdrawnAt": new Date() } });
    const old = await request(app).get("/api/v1/me").set("x-session-id", vendor.sessionId);
    expect(old.status).toBe(200);
    expect(old.body.behaviourConsent).toBeNull();
  });

  it("needs a signed-in vendor", async () => {
    expect((await write(request(app).post("/api/v1/me/events")).send({ torId: "0".repeat(24), type: "view" })).status).toBe(401);
  });

  it("records a bookmark as a save, only with consent", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", vendor.sessionId).send({});
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);
    await grant(vendor.sessionId);
    const other = await seedTor();
    await write(request(app).put(`/api/v1/me/bookmarks/${other}`)).set("x-session-id", vendor.sessionId).send({});
    expect(await behaviourEvents(db).find({}).toArray()).toMatchObject([{ torId: other, type: "save" }]);
  });

  it("forgets the recorded events when consent is withdrawn", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await grant(vendor.sessionId); await send(vendor.sessionId, torId);
    await write(request(app).post("/api/v1/me/consent/behaviour/withdraw")).set("x-session-id", vendor.sessionId).send({});
    expect(await behaviourEvents(db).countDocuments({})).toBe(0);
    expect((await send(vendor.sessionId, torId)).status).toBe(403);
    const me = await request(app).get("/api/v1/me").set("x-session-id", vendor.sessionId);
    expect(me.body.behaviourConsent.withdrawnAt).toEqual(expect.any(String));
  });

  it("is exported with the account's data and removed with the account", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor();
    await grant(vendor.sessionId); await send(vendor.sessionId, torId, "prepare");
    const exported = await request(app).get("/api/v1/me/export").set("x-session-id", vendor.sessionId);
    expect(exported.body.behaviourEvents).toEqual([{ torId, type: "prepare", at: expect.any(String) }]);
    const deleted = await write(request(app).delete("/api/v1/me")).set("x-session-id", vendor.sessionId).send({ currentPassword: "correct-password" });
    expect(deleted.status).toBe(200);
    expect(await behaviourEvents(db).countDocuments({ accountId: vendor.accountId })).toBe(0);
  });
});

describe("behaviour affinity", () => {
  async function classify(torId: string, leaf: string) {
    await torClassifications(db).insertOne({ torId, classification: { coarse: null, leaves: [{ id: leaf, score: 1 }], nodes: [], evidence: [], outcome: "classified", mapperVersion: "test" }, mapperVersion: "test", updatedAt: new Date() } as never);
  }

  it("sums each kind of event once per TOR into points for that kind of work", async () => {
    const vendor = await sessionFor("one@example.test"); await grant(vendor.sessionId);
    const torId = await seedTor(); await classify(torId, "construction.road");
    await send(vendor.sessionId, torId, "view"); await send(vendor.sessionId, torId, "view"); await send(vendor.sessionId, torId, "save");
    const w = config.matching.behaviour.weights;
    expect(await behaviour.affinity(vendor.accountId)).toEqual({ "construction.road": w.view + w.save });
  });

  it("keeps one row per TOR and kind, so repeats cannot push a save out of what is read", async () => {
    const vendor = await sessionFor("one@example.test"); await grant(vendor.sessionId);
    const torId = await seedTor(); await classify(torId, "construction.road");
    await behaviour.record(vendor.accountId, torId, "save");
    for (let i = 0; i < 2100; i++) await behaviour.record(vendor.accountId, torId, "view");
    expect(await behaviourEvents(db).countDocuments({ accountId: vendor.accountId })).toBe(2);
    const w = config.matching.behaviour.weights;
    expect(await behaviour.affinity(vendor.accountId)).toEqual({ "construction.road": w.save + w.view });
  }, 60_000);

  it("is empty without consent, when switched off, and outside the window", async () => {
    const vendor = await sessionFor("one@example.test"); const torId = await seedTor(); await classify(torId, "construction.road");
    await behaviourEvents(db).insertOne({ accountId: vendor.accountId, torId, type: "save", at: new Date() });
    expect(await behaviour.affinity(vendor.accountId)).toEqual({});

    await grant(vendor.sessionId); // fresh consent clears what was there before it
    await behaviourEvents(db).insertOne({ accountId: vendor.accountId, torId, type: "save", at: new Date() });
    expect(Object.keys(await behaviour.affinity(vendor.accountId))).toEqual(["construction.road"]);
    expect(await new BehaviourRepository(db, baseConfig).affinity(vendor.accountId)).toEqual({});

    await behaviourEvents(db).deleteMany({});
    await behaviourEvents(db).insertOne({ accountId: vendor.accountId, torId, type: "save", at: new Date(Date.now() - (config.matching.behaviour.windowDays + 1) * 86_400_000) });
    expect(await behaviour.affinity(vendor.accountId)).toEqual({});
  });
});
