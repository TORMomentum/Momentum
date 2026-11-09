import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type WithId } from "mongodb";
import { accounts, behaviourEvents, bookmarks, vendorProfiles, type AccountDocument, type BehaviourEventDocument, type AccountRole, type BookmarkDocument, type SessionDocument, type VendorProfileDocument } from "../../core/db.js";
import { SessionsRepository } from "./sessions.js";

export interface CreateAccountInput {
  email: string;
  displayName: string;
  passwordHash?: string;
  consent: AccountDocument["consent"];
  /** Agreed at sign-up, separately from the consent above; absent when the box was left unticked. */
  behaviourConsent?: AccountDocument["behaviourConsent"];
}

export type StoredAccount = WithId<AccountDocument> & { id: string };

function withId(account: WithId<AccountDocument>): StoredAccount {
  return { ...account, id: account._id.toString() };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The only account code that touches MongoDB. */
export class AccountsRepository {
  constructor(
    private readonly db: Db,
    private readonly sessionsRepository: SessionsRepository,
  ) {}

  async create(input: CreateAccountInput): Promise<StoredAccount> {
    const now = new Date();
    const document: AccountDocument = {
      email: normalizeEmail(input.email),
      displayName: input.displayName,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      role: "vendor",
      consent: input.consent,
      ...(input.behaviourConsent ? { behaviourConsent: input.behaviourConsent } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const result = await accounts(this.db).insertOne(document);
    return withId({ ...document, _id: result.insertedId });
  }

  async findByEmail(email: string): Promise<StoredAccount | null> {
    const account = await accounts(this.db).findOne({ email: normalizeEmail(email) });
    return account ? withId(account) : null;
  }

  async markVerified(accountId: string): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    await accounts(this.db).updateOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false } },
      { $set: { emailVerifiedAt: new Date(), updatedAt: new Date() } },
    );
  }

  async setPassword(accountId: string, passwordHash: string): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    await accounts(this.db).updateOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false } },
      { $set: { passwordHash, updatedAt: new Date() } },
    );
  }

  async changeRole(accountId: string, role: AccountRole): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    const result = await accounts(this.db).updateOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false } },
      { $set: { role, updatedAt: new Date() } },
    );
    // A role change alters authorization, so no existing credential can retain
    // permissions granted under the previous account row.
    if (result.matchedCount > 0) await this.sessionsRepository.revokeAllForAccount(accountId);
  }

  async withdrawConsent(accountId: string): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    await accounts(this.db).updateOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false } },
      { $set: { "consent.withdrawnAt": new Date(), updatedAt: new Date() } },
    );
  }

  /**
   * Turns behaviour recording on or off (TOR-215). Off also forgets what was recorded: withdrawing means we
   * stop and we do not keep what we already had.
   */
  async setBehaviourConsent(accountId: string, on: boolean): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    const now = new Date();
    // Withdrawing what was never given changes nothing: a withdrawnAt without an agreedAt is not a state.
    await accounts(this.db).updateOne(
      on
        ? { _id: new ObjectId(accountId), deletedAt: { $exists: false } }
        : { _id: new ObjectId(accountId), deletedAt: { $exists: false }, "behaviourConsent.agreedAt": { $exists: true } },
      on
        ? { $set: { behaviourConsent: { agreedAt: now }, updatedAt: now } }
        : { $set: { "behaviourConsent.withdrawnAt": now, updatedAt: now } },
    );
    if (!on) await behaviourEvents(this.db).deleteMany({ accountId });
  }

  async softDelete(accountId: string): Promise<void> {
    if (!ObjectId.isValid(accountId)) return;
    const now = new Date();
    await accounts(this.db).updateOne(
      { _id: new ObjectId(accountId) },
      {
        $set: { email: `deleted:${randomUUID()}`, deletedAt: now, updatedAt: now },
        $unset: { displayName: "", passwordHash: "", google: "" },
      },
    );
    await this.sessionsRepository.revokeAllForAccount(accountId);
  }

  async exportOwnedData(accountId: string): Promise<{ account: Omit<AccountDocument, "passwordHash">; sessions: Array<Omit<SessionDocument, "_id" | "accountId">>; bookmarks: BookmarkDocument[]; profile: VendorProfileDocument | null; behaviourEvents: Array<Omit<BehaviourEventDocument, "_id" | "accountId">> }> {
    if (!ObjectId.isValid(accountId)) throw new Error("Invalid account id");
    const account = await accounts(this.db).findOne({ _id: new ObjectId(accountId) });
    if (!account) throw new Error("Account not found");
    const { passwordHash: _passwordHash, ...safeAccount } = account;
    const accountSessions = await this.sessionsRepository.exportMetadataForAccount(accountId);
    const ownedBookmarks = await bookmarks(this.db).find({ accountId }).toArray();
    const profile = await vendorProfiles(this.db).findOne({ accountId });
    const events = await behaviourEvents(this.db).find({ accountId }, { projection: { _id: 0, accountId: 0 } }).sort({ at: 1 }).toArray();
    return { account: safeAccount, sessions: accountSessions, bookmarks: ownedBookmarks, profile, behaviourEvents: events };
  }

  async removeOwnedData(accountId: string): Promise<void> {
    await bookmarks(this.db).deleteMany({ accountId });
    await vendorProfiles(this.db).deleteMany({ accountId });
    await behaviourEvents(this.db).deleteMany({ accountId });
  }
}
