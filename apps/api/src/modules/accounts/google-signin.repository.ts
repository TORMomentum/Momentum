import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { googleSignups, oauthTransactions, type GoogleSignupDocument, type OauthTransactionDocument } from "../../core/db.js";

/** Both stores key on a digest, so a database read yields neither a usable `state` nor a usable ticket. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The only Google sign-in code that touches MongoDB. */
export class GoogleSigninRepository {
  constructor(private readonly db: Db) {}

  async saveTransaction(transaction: Omit<OauthTransactionDocument, "expiresAt">, lifetimeMs: number): Promise<void> {
    await oauthTransactions(this.db).insertOne({ ...transaction, expiresAt: new Date(Date.now() + lifetimeMs) });
  }

  /** Single use: the row is gone the moment it is read, whether or not the rest of the sign-in succeeds. */
  async consumeTransaction(stateHash: string): Promise<OauthTransactionDocument | null> {
    // Expiry is in the predicate because TTL indexes are swept only periodically.
    return oauthTransactions(this.db).findOneAndDelete({ _id: stateHash, expiresAt: { $gt: new Date() } });
  }

  async saveSignup(signup: Omit<GoogleSignupDocument, "expiresAt">, lifetimeMs: number): Promise<void> {
    await googleSignups(this.db).insertOne({ ...signup, expiresAt: new Date(Date.now() + lifetimeMs) });
  }

  async consumeSignup(ticketHash: string): Promise<GoogleSignupDocument | null> {
    return googleSignups(this.db).findOneAndDelete({ _id: ticketHash, expiresAt: { $gt: new Date() } });
  }
}
