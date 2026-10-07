import "../../test/env.js";

import express from "express";
import type { Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { accounts, bookmarks, connect, disconnect, ensureIndexes, sessions, tors } from "../../core/db.js";
import { errorMiddleware } from "../../core/errors.js";
import { sessionContext } from "../../core/session-context.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountsRepository } from "../accounts/accounts.repository.js";
import { hashPassword } from "../accounts/password.js";
import { SessionsRepository } from "../accounts/sessions.js";
import { TorsRepository } from "../tors/tors.repository.js";
import { BookmarksRepository } from "./bookmarks.repository.js";
import { buildBookmarksRouter } from "./bookmarks.routes.js";

const baseConfig = loadConfig(process.env);
const config = { ...baseConfig, authRateLimitPerIp: 1_000, authRateLimitPerEmail: 1_000 };
let db: Db; let app: express.Express; let sessionsRepository: SessionsRepository;

function testApp() {
  sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  const result = express(); result.use(express.json()); result.use(sessionContext(sessionsRepository));
  result.use("/api/v1", buildBookmarksRouter({ config, bookmarks: new BookmarksRepository(db), tors: new TorsRepository(db) }));
  result.use(errorMiddleware); return result;
}
function write(builder: request.Test) { return builder.set("origin", config.appOrigin); }
async function sessionFor(email: string) {
  const repository = new AccountsRepository(db, sessionsRepository);
  const account = await repository.create({ email, displayName: "ผู้ขาย", passwordHash: await hashPassword("correct-password", config), consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" } });
  return { accountId: account.id, sessionId: (await sessionsRepository.create(account.id)).id };
}
async function seedTor(overrides: { restricted?: boolean; title?: string } = {}) {
  const result = await tors(db).insertOne({
    contentHash: `bookmark-${Math.random()}`, storage: { bucket: "test", key: "tor", contentType: "application/pdf", bytes: 1 }, sourceRefs: [],
    pipeline: { state: "published", attempts: 1 }, fields: {
      title: { raw: overrides.title ?? "โครงการทดสอบ", value: overrides.title ?? "โครงการทดสอบ", confidence: 1, verified: true },
      agency: { raw: "หน่วยงานทดสอบ", value: "หน่วยงานทดสอบ", confidence: 1, verified: true },
      budget: { raw: "1000", value: 1000, confidence: 1, verified: true },
      deadline: { raw: "2027-01-01", value: "2027-01-01", confidence: 1, verified: true },
      torStatus: { raw: "announced", value: "announced", confidence: 1, verified: true },
    }, announcedAt: new Date(), sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: overrides.restricted ?? false }, duplicateOf: null, createdAt: new Date(), updatedAt: new Date(),
  } as never);
  return result.insertedId.toString();
}

beforeAll(async () => { db = await connect(isolatedDbUrl(config.mongoUrl, "bookmark-routes")); await ensureIndexes(db); });
beforeEach(async () => { await Promise.all([accounts(db).deleteMany({}), bookmarks(db).deleteMany({}), sessions(db).deleteMany({}), tors(db).deleteMany({})]); app = testApp(); });
afterAll(async () => { await disconnect(); });

describe("bookmark routes", () => {
  it("saves twice successfully and leaves one bookmark", async () => {
    const viewer = await sessionFor("one@example.test"); const torId = await seedTor();
    const first = await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", viewer.sessionId).send({});
    const second = await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", viewer.sessionId).send({});
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(await bookmarks(db).countDocuments({ accountId: viewer.accountId, torId })).toBe(1);
  });

  it("removing an unsaved TOR succeeds", async () => {
    const viewer = await sessionFor("one@example.test"); const torId = await seedTor();
    expect((await write(request(app).delete(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", viewer.sessionId).send({})).status).toBe(200);
  });

  it("isolates accounts for listing and removal", async () => {
    const mine = await sessionFor("one@example.test"); const other = await sessionFor("two@example.test"); const torId = await seedTor();
    await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", mine.sessionId).send({});
    await write(request(app).delete(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", other.sessionId).send({});
    expect((await request(app).get("/api/v1/me/bookmarks").set("x-session-id", other.sessionId)).body).toEqual([]);
    expect((await request(app).get("/api/v1/me/bookmarks").set("x-session-id", mine.sessionId)).body).toHaveLength(1);
  });

  it("refuses an id that is not a TOR", async () => {
    const viewer = await sessionFor("one@example.test");
    expect((await write(request(app).put("/api/v1/me/bookmarks/0123456789abcdef01234567")).set("x-session-id", viewer.sessionId).send({})).status).toBe(404);
  });

  it("does not return a taken-down TOR", async () => {
    const viewer = await sessionFor("one@example.test"); const torId = await seedTor({ restricted: true });
    await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", viewer.sessionId).send({});
    expect((await request(app).get("/api/v1/me/bookmarks").set("x-session-id", viewer.sessionId)).body).toEqual([]);
  });

  it("returns only the row fields the profile needs", async () => {
    const viewer = await sessionFor("one@example.test"); const torId = await seedTor({ title: "TOR แถวรายการ" });
    await write(request(app).put(`/api/v1/me/bookmarks/${torId}`)).set("x-session-id", viewer.sessionId).send({});
    const response = await request(app).get("/api/v1/me/bookmarks").set("x-session-id", viewer.sessionId);
    expect(response.body[0]).toMatchObject({ id: torId, title: "TOR แถวรายการ", agency: "หน่วยงานทดสอบ", deadline: "2027-01-01", budget: 1000, open: true, savedAt: expect.any(String) });
    expect(Object.keys(response.body[0]).sort()).toEqual(["agency", "budget", "deadline", "id", "open", "savedAt", "title"]);
  });
});
