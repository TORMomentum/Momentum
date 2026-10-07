import { ObjectId, type Db, type Filter } from "mongodb";
import { accounts, adminAudit, type AccountDocument, type AccountRole, type AdminAuditDocument } from "../../core/db.js";
import { NotFoundError } from "../../core/errors.js";

/** One row of the vendors list: enough to choose whom to open. No password hash, ever. */
export interface AdminAccountRow {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  verified: boolean;
  disabled: boolean;
  createdAt: Date;
}

export interface AdminAccountPage {
  rows: AdminAccountRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAccountDetail extends AdminAccountRow {
  hasPassword: boolean;
  consentAgreedAt: Date | null;
  consentWithdrawnAt: Date | null;
}

function row(account: AccountDocument & { _id: ObjectId }): AdminAccountRow {
  return {
    id: account._id.toString(),
    email: account.email,
    displayName: account.displayName ?? "",
    role: account.role,
    verified: Boolean(account.emailVerifiedAt),
    disabled: Boolean(account.disabledAt),
    createdAt: account.createdAt,
  };
}

/** A search term as literal text: nothing typed is read as a pattern. */
function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/**
 * The admin's view of vendor accounts — the only admin code that reads them from MongoDB. Deleted
 * accounts are left out: what remains of one is a tombstone, not a person to look after.
 */
export class AdminAccountsRepository {
  constructor(private readonly db: Db) {}

  async list(q: string | undefined, page: number, pageSize: number): Promise<AdminAccountPage> {
    const filter: Filter<AccountDocument> = { deletedAt: { $exists: false } };
    const term = q?.trim();
    if (term) filter.$or = [{ email: literal(term) }, { displayName: literal(term) }];
    const [docs, total] = await Promise.all([
      accounts(this.db)
        .find(filter, { sort: { createdAt: -1, _id: -1 }, skip: (page - 1) * pageSize, limit: pageSize, projection: { passwordHash: 0 } })
        .toArray(),
      accounts(this.db).countDocuments(filter),
    ]);
    return { rows: docs.map(row), total, page, pageSize };
  }

  async load(accountId: string): Promise<AdminAccountDetail> {
    if (!ObjectId.isValid(accountId)) throw new NotFoundError(`account ${accountId} not found`);
    const account = await accounts(this.db).findOne({ _id: new ObjectId(accountId), deletedAt: { $exists: false } });
    if (!account) throw new NotFoundError(`account ${accountId} not found`);
    return {
      ...row(account),
      hasPassword: Boolean(account.passwordHash),
      consentAgreedAt: account.consent?.agreedAt ?? null,
      consentWithdrawnAt: account.consent?.withdrawnAt ?? null,
    };
  }

  /** Disabling stops sign-in; the caller revokes the sessions. Enabling clears it. */
  async setDisabled(accountId: string, disabled: boolean): Promise<void> {
    const update = disabled
      ? { $set: { disabledAt: new Date(), updatedAt: new Date() } }
      : { $unset: { disabledAt: "" as const }, $set: { updatedAt: new Date() } };
    const result = await accounts(this.db).updateOne({ _id: new ObjectId(accountId), deletedAt: { $exists: false } }, update);
    if (result.matchedCount === 0) throw new NotFoundError(`account ${accountId} not found`);
  }

  async audit(entry: Omit<AdminAuditDocument, "at">): Promise<void> {
    await adminAudit(this.db).insertOne({ ...entry, at: new Date() });
  }

  async auditFor(accountId: string, limit: number): Promise<AdminAuditDocument[]> {
    return adminAudit(this.db).find({ accountId }, { sort: { at: -1 }, limit, projection: { _id: 0 } }).toArray();
  }
}
