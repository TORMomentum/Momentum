import "../../test/env.js";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { accountTokens, connect, disconnect, ensureIndexes } from "../../core/db.js";
import { loadConfig } from "../../core/config.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { AccountTokensRepository } from "./account-tokens.repository.js";

const config = loadConfig(process.env);
let db: Db;
let repository: AccountTokensRepository;

beforeAll(async () => {
  db = await connect(isolatedDbUrl(config.mongoUrl, "account-tokens-repository"));
  await ensureIndexes(db);
  repository = new AccountTokensRepository(db);
});

beforeEach(async () => {
  await accountTokens(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("AccountTokensRepository", () => {
  it("stores only a hash of an issued token", async () => {
    const token = await repository.create("account-id", "verify", config.verifyTokenTtlMs);
    const stored = await accountTokens(db).findOne({ accountId: "account-id" });

    expect(stored).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("consumes a token only once when requests race", async () => {
    const token = await repository.create("account-id", "verify", config.verifyTokenTtlMs);
    const results = await Promise.all([
      repository.consume(token, "verify"),
      repository.consume(token, "verify"),
    ]);

    expect(results.filter(Boolean)).toEqual([{ accountId: "account-id" }]);
  });

  it("does not return a token issued for another purpose", async () => {
    const token = await repository.create("account-id", "verify", config.verifyTokenTtlMs);

    await expect(repository.consume(token, "reset")).resolves.toBeNull();
  });

  it("does not return an expired token before the TTL sweep", async () => {
    const token = await repository.create("account-id", "verify", -1);

    await expect(repository.consume(token, "verify")).resolves.toBeNull();
  });
});
