import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { accounts, connect, disconnect, ensureIndexes, sessions } from "../../core/db.js";
import { loadConfig } from "../../core/config.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountsRepository } from "./accounts.repository.js";
import { SessionsRepository } from "./sessions.js";

const config = loadConfig(process.env);
let db: Db;
let accountsRepository: AccountsRepository;
let sessionsRepository: SessionsRepository;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "accounts-repository"));
  await ensureIndexes(db);
  sessionsRepository = new SessionsRepository(db, config.session.lifetimeMs);
  accountsRepository = new AccountsRepository(db, sessionsRepository);
});

beforeEach(async () => {
  await Promise.all([accounts(db).deleteMany({}), sessions(db).deleteMany({})]);
});

afterAll(async () => {
  await disconnect();
});

async function createAccount(email = "Vendor@Example.test") {
  return accountsRepository.create({
    email,
    displayName: "Vendor",
    passwordHash: "password-hash",
    consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox" },
  });
}

describe("AccountsRepository", () => {
  it("creates an unverified account and finds it by normalized email", async () => {
    const created = await createAccount();

    expect(created.emailVerifiedAt).toBeUndefined();
    await expect(accountsRepository.findByEmail("  vendor@example.TEST ")).resolves.toMatchObject({ id: created.id });
  });

  it("marks an account email address as verified", async () => {
    const created = await createAccount();
    await accountsRepository.markVerified(created.id);

    expect((await accounts(db).findOne({ _id: created._id }))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("revokes every session when changing the role", async () => {
    const created = await createAccount();
    await sessionsRepository.create(created.id);
    await sessionsRepository.create(created.id);

    await accountsRepository.changeRole(created.id, "admin");

    expect(await sessions(db).countDocuments({ accountId: created.id })).toBe(0);
    expect((await accounts(db).findOne({ _id: created._id }))?.role).toBe("admin");
  });

  it("soft-deletes identifying fields and replaces the address with a non-recoverable tombstone", async () => {
    const created = await createAccount();
    await accounts(db).updateOne({ _id: created._id }, { $set: { google: { sub: "google-sub" } } });

    await accountsRepository.softDelete(created.id);

    const deleted = await accounts(db).findOne({ _id: created._id });
    expect(deleted).toMatchObject({ deletedAt: expect.any(Date) });
    expect(deleted?.email).toMatch(/^deleted:[0-9a-f-]{36}$/);
    expect(deleted).not.toHaveProperty("displayName");
    expect(deleted).not.toHaveProperty("passwordHash");
    expect(deleted).not.toHaveProperty("google");
    expect(await accountsRepository.findByEmail("vendor@example.test")).toBeNull();
  });
});
