import "../test/env.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { behaviourEvents, connect, disconnect, ensureIndexes } from "./db.js";
import { loadConfig } from "./config.js";
import { isolatedDbUrl } from "../test/mongo.js";

const config = loadConfig(process.env);
let db: Db;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "db-behaviour"));
});
afterAll(async () => {
  await disconnect();
});

describe("behaviour_events key", () => {
  it("starts on a collection that holds repeats from before one-row-per-kind, keeping the latest of each", async () => {
    const collection = behaviourEvents(db);
    await collection.deleteMany({});
    await collection.dropIndexes().catch(() => undefined);
    const day = (n: number) => new Date(Date.UTC(2026, 10, n));
    await collection.insertMany([
      { accountId: "a", torId: "t", type: "view", at: day(1) },
      { accountId: "a", torId: "t", type: "view", at: day(3) },
      { accountId: "a", torId: "t", type: "view", at: day(2) },
      { accountId: "a", torId: "t", type: "save", at: day(1) },
      { accountId: "b", torId: "t", type: "view", at: day(1) },
    ]);

    await ensureIndexes(db);

    const rows = await collection.find({}).sort({ accountId: 1, type: 1 }).toArray();
    expect(rows.map((row) => `${row.accountId}:${row.type}:${row.at.getUTCDate()}`)).toEqual(["a:save:1", "a:view:3", "b:view:1"]);
    await expect(collection.insertOne({ accountId: "a", torId: "t", type: "view", at: day(4) })).rejects.toMatchObject({ code: 11000 });
    await ensureIndexes(db); // and a clean collection is left alone
    expect(await collection.countDocuments({})).toBe(3);
  });
});
