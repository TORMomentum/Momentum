import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type WithId } from "mongodb";
import { accounts, bookmarks, vendorProfiles, type AccountDocument, type AccountRole, type BookmarkDocument, type SessionDocument, type VendorProfileDocument } from "../../core/db.js";
import { SessionsRepository } from "./sessions.js";

export interface CreateAccountInput {
  email: string;
  displayName: string;
  passwordHash?: string;
  consent: AccountDocument["consent"];
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

  async exportOwnedData(accountId: string): Promise<{ account: Omit<AccountDocument, "passwordHash">; sessions: Array<Omit<SessionDocument, "_id" | "accountId">>; bookmarks: BookmarkDocument[]; profile: VendorProfileDocument | null }> {
    if (!ObjectId.isValid(accountId)) throw new Error("Invalid account id");
    const account = await accounts(this.db).findOne({ _id: new ObjectId(accountId) });
    if (!account) throw new Error("Account not found");
    const { passwordHash: _passwordHash, ...safeAccount } = account;
    const accountSessions = await this.sessionsRepository.exportMetadataForAccount(accountId);
    const ownedBookmarks = await bookmarks(this.db).find({ accountId }).toArray();
    const profile = await vendorProfiles(this.db).findOne({ accountId });
    return { account: safeAccount, sessions: accountSessions, bookmarks: ownedBookmarks, profile };
  }

  async removeOwnedData(accountId: string): Promise<void> {
    await bookmarks(this.db).deleteMany({ accountId });
    await vendorProfiles(this.db).deleteMany({ accountId });
  }
}
