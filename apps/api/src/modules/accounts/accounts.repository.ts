import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type WithId } from "mongodb";
import { accounts, type AccountDocument, type AccountRole } from "../../core/db.js";
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
}
