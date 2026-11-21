import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { accounts, connect, disconnect, ensureIndexes, sessions } from "../../core/db.js";
import { loadConfig } from "../../core/config.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { SessionsRepository } from "./sessions.js";

const config = loadConfig(process.env);
let db: Db;
let repository: SessionsRepository;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "accounts-sessions"));
  await ensureIndexes(db);
  repository = new SessionsRepository(db, config.session);
});

beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({})]);
});

afterAll(async () => {
  await disconnect();
});

async function createAccount(role: "vendor" | "admin" = "vendor"): Promise<string> {
  const now = new Date();
  const result = await accounts(db).insertOne({
    email: `${crypto.randomUUID()}@example.test`,
    displayName: "Vendor",
    role,
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: now, action: "checkbox" },
    createdAt: now,
    updatedAt: now,
  });
  return result.insertedId.toString();
}

describe("SessionsRepository", () => {
  it("does not resolve an expired session", async () => {
    const accountId = await createAccount();
    await sessions(db).insertOne({
      _id: "expired-session",
      accountId,
      createdAt: new Date(0),
      lastSeenAt: new Date(0),
      expiresAt: new Date(0),
    });

    await expect(repository.resolve("expired-session")).resolves.toBeNull();
  });

  it("does not resolve a session idle longer than the idle timeout, and touch does not revive it", async () => {
    const accountId = await createAccount();
    const { id } = await repository.create(accountId);
    const idleSince = new Date(Date.now() - config.session.idleTimeoutMs - 1_000);
    await sessions(db).updateOne({ _id: id }, { $set: { lastSeenAt: idleSince } });

    await expect(repository.resolve(id)).resolves.toBeNull();
    await repository.touch(id);
    expect((await sessions(db).findOne({ _id: id }))?.lastSeenAt).toEqual(idleSince);
    await expect(repository.resolve(id)).resolves.toBeNull();
  });

  it("slides the idle window on use, but writes lastSeenAt no more often than the touch interval", async () => {
    const accountId = await createAccount();
    const { id } = await repository.create(accountId);
    const recent = new Date(Date.now() - config.session.touchIntervalMs / 2);
    await sessions(db).updateOne({ _id: id }, { $set: { lastSeenAt: recent } });
    await repository.resolve(id);
    expect((await sessions(db).findOne({ _id: id }))?.lastSeenAt).toEqual(recent);

    const stale = new Date(Date.now() - config.session.touchIntervalMs - 1_000);
    await sessions(db).updateOne({ _id: id }, { $set: { lastSeenAt: stale } });
    await repository.resolve(id);
    expect((await sessions(db).findOne({ _id: id }))!.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("revokes every session belonging to an account", async () => {
    const accountId = await createAccount();
    await repository.create(accountId);
    await repository.create(accountId);

    await repository.revokeAllForAccount(accountId);

    await expect(sessions(db).countDocuments({ accountId })).resolves.toBe(0);
  });

  it("reads the role from the current account row on every resolution", async () => {
    const accountId = await createAccount("vendor");
    const session = await repository.create(accountId);
    expect((await repository.resolve(session.id))?.role).toBe("vendor");

    await accounts(db).updateOne({ _id: (await accounts(db).findOne({ email: { $exists: true } }))!._id }, { $set: { role: "admin" } });

    expect((await repository.resolve(session.id))?.role).toBe("admin");
  });
});
