import "../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { accounts, connect, disconnect, ensureIndexes } from "./db.js";
import { loadConfig } from "./config.js";
import { isolatedDbUrl } from "../test/mongo.js";

const config = loadConfig(process.env);
let db: Db;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "db-accounts"));
});

beforeEach(async () => {
  await accounts(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("account indexes", () => {
  it("is idempotent and makes email unique even after more than one deletion", async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const now = new Date();
    const active = () => ({
      email: "vendor@example.test",
      displayName: "Vendor",
      passwordHash: "hash",
      role: "vendor" as const,
      consent: { noticeVersion: "test", noticeHash: "test", agreedAt: now, action: "checkbox" as const },
      createdAt: now,
      updatedAt: now,
    });
    await accounts(db).insertOne(active());
    await expect(accounts(db).insertOne(active()))
      .rejects.toMatchObject({ code: 11000 });

    await accounts(db).updateOne(
      { email: "vendor@example.test" },
      { $set: { email: "deleted:first", deletedAt: new Date() } },
    );
    await accounts(db).insertOne(active());
    await accounts(db).updateOne(
      { email: "vendor@example.test" },
      { $set: { email: "deleted:second", deletedAt: new Date() } },
    );

    expect(await accounts(db).countDocuments({ email: { $regex: "^deleted:" } })).toBe(2);
  });
});
