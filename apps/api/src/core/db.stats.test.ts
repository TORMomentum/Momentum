import "../test/env.js";

import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { connect, disconnect, ensureIndexes, tors } from "./db.js";
import { eligibleFilter } from "../modules/stats/eligibility.js";
import { isolatedDbUrl } from "../test/mongo.js";

const config = loadConfig(process.env);

let db: Db;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "db-stats"));
});

afterAll(async () => {
  await disconnect();
});

describe("statistics indexes", () => {
  it("is idempotent and gives the peer scan the complete eligibility predicate", async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);

    const indexes = await tors(db).listIndexes().toArray();
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: { "cohort.category": 1, "cohort.month": 1, "fields.budget.value": 1 },
        partialFilterExpression: eligibleFilter(),
      }),
    ]));
  });
});
