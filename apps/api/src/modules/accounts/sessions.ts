import { randomBytes } from "node:crypto";
import { ObjectId, type Db, type WithId } from "mongodb";
import { accounts, sessions, type AccountDocument, type AccountRole, type SessionDocument } from "../../core/db.js";

export interface ResolvedSession {
  account: WithId<AccountDocument>;
  role: AccountRole;
}

export class SessionsRepository {
  constructor(
    private readonly db: Db,
    private readonly timeouts: { lifetimeMs: number; idleTimeoutMs: number; touchIntervalMs: number },
  ) {}

  async create(accountId: string): Promise<{ id: string; expiresAt: Date }> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.timeouts.lifetimeMs);
    const id = randomBytes(32).toString("hex");
    await sessions(this.db).insertOne({ _id: id, accountId, createdAt, expiresAt, lastSeenAt: createdAt });
    return { id, expiresAt };
  }

  async resolve(id: string): Promise<ResolvedSession | null> {
    const now = new Date();
    const session = await sessions(this.db).findOne({ _id: id, ...this.live(now) });
    if (!session || !ObjectId.isValid(session.accountId)) return null;

    const account = await accounts(this.db).findOne({ _id: new ObjectId(session.accountId) });
    // A disabled account is signed out everywhere at once, whatever sessions survived.
    if (!account || account.deletedAt || account.disabledAt) return null;
    if (now.getTime() - session.lastSeenAt.getTime() >= this.timeouts.touchIntervalMs) await this.touch(id);
    return { account, role: account.role };
  }

  /** Slides the idle window. A session already idle-expired or past its absolute end is not revived. */
  async touch(id: string): Promise<void> {
    const now = new Date();
    await sessions(this.db).updateOne({ _id: id, ...this.live(now) }, { $set: { lastSeenAt: now } });
  }

  /** Not past its absolute end, and used within the idle window. */
  private live(now: Date) {
    return { expiresAt: { $gt: now }, lastSeenAt: { $gt: new Date(now.getTime() - this.timeouts.idleTimeoutMs) } };
  }

  async revoke(id: string): Promise<void> {
    await sessions(this.db).deleteOne({ _id: id });
  }

  async revokeAllForAccount(accountId: string): Promise<void> {
    await sessions(this.db).deleteMany({ accountId });
  }

  async revokeAllForAccountExcept(accountId: string, sessionId: string): Promise<void> {
    await sessions(this.db).deleteMany({ accountId, _id: { $ne: sessionId } });
  }

  async exportMetadataForAccount(accountId: string): Promise<Array<Omit<SessionDocument, "_id" | "accountId">>> {
    return (await sessions(this.db).find({ accountId }, { projection: { _id: 0, accountId: 0 } }).toArray())
      .map(({ createdAt, expiresAt, lastSeenAt }) => ({ createdAt, expiresAt, lastSeenAt }));
  }
}
