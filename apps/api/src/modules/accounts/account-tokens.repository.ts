import { createHash, randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import { accountTokens, type AccountTokenPurpose as TokenPurpose } from "../../core/db.js";

export type AccountTokenPurpose = TokenPurpose;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Stores only a digest: a database read cannot become an email credential. */
export class AccountTokensRepository {
  constructor(private readonly db: Db) {}

  async create(accountId: string, purpose: AccountTokenPurpose, lifetimeMs: number): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await accountTokens(this.db).insertOne({
      tokenHash: hashToken(token), accountId, purpose,
      expiresAt: new Date(Date.now() + lifetimeMs),
    });
    return token;
  }

  async consume(token: string, purpose: AccountTokenPurpose): Promise<{ accountId: string } | null> {
    // Expiry belongs in the predicate because TTL indexes are swept periodically.
    const result = await accountTokens(this.db).findOneAndDelete({
      tokenHash: hashToken(token), purpose, expiresAt: { $gt: new Date() },
    });
    return result ? { accountId: result.accountId } : null;
  }
}
