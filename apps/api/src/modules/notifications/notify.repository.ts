import { ObjectId, MongoServerError, type Db, type WithId } from "mongodb";
import { accounts, bookmarks, notificationLeases, notifications, torEvents, tors, vendorProfiles, type AccountDocument, type NotificationDocument, type TorDocument, type TorEventDocument, type VendorProfileDocument } from "../../core/db.js";

export type EligibleVendor = { account: WithId<AccountDocument>; profile: VendorProfileDocument };

/** Mongo boundary for notification dispatch and its at-most-once claims. */
export class NotifyRepository {
  constructor(private readonly db: Db) {}

  async claimLease(owner: string, leaseMs: number): Promise<boolean> {
    const now = new Date();
    try {
      const row = await notificationLeases(this.db).findOneAndUpdate(
        { _id: "notify-dispatch", $or: [{ leaseUntil: { $lt: now } }, { owner }] },
        { $set: { owner, leaseUntil: new Date(now.getTime() + leaseMs) } },
        { upsert: true, returnDocument: "after" },
      );
      return row?.owner === owner;
    } catch (error) {
      // Two first-starting workers can both observe no singleton. The `_id`
      // uniqueness constraint chooses the winner; the loser simply skips.
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw error;
    }
  }

  async releaseLease(owner: string): Promise<void> {
    await notificationLeases(this.db).deleteOne({ _id: "notify-dispatch", owner });
  }

  /**
   * One account, under the same rules the dispatcher applies to everyone:
   * verified, not disabled, not deleted, consent not withdrawn. Null otherwise,
   * so a manual send can never reach someone the automatic one would skip.
   */
  async eligibleVendor(accountId: string): Promise<EligibleVendor | null> {
    if (!ObjectId.isValid(accountId)) return null;
    const account = await accounts(this.db).findOne({
      _id: new ObjectId(accountId),
      emailVerifiedAt: { $exists: true },
      disabledAt: { $exists: false },
      deletedAt: { $exists: false },
      "consent.withdrawnAt": { $exists: false },
    });
    if (!account) return null;
    const profile = await vendorProfiles(this.db).findOne({ accountId });
    return profile ? { account, profile } : null;
  }

  async eligibleVendors(limit: number): Promise<EligibleVendor[]> {
    const accountRows = await accounts(this.db).find({
      role: "vendor",
      emailVerifiedAt: { $exists: true },
      disabledAt: { $exists: false },
      deletedAt: { $exists: false },
      "consent.withdrawnAt": { $exists: false },
    }, { limit }).toArray();
    if (!accountRows.length) return [];
    const ids = accountRows.map((account) => account._id.toString());
    const profileRows = await vendorProfiles(this.db).find({ accountId: { $in: ids } }).toArray();
    const profiles = new Map(profileRows.map((profile) => [profile.accountId, profile]));
    return accountRows.flatMap((account) => {
      const profile = profiles.get(account._id.toString());
      const hasEntry = Boolean(profile?.categories.length || profile?.otherCategories?.some((entry) => entry.trim().length));
      return profile && hasEntry ? [{ account, profile }] : [];
    });
  }

  async bookmarkedTors(accountId: string): Promise<WithId<TorDocument>[]> {
    const rows = await bookmarks(this.db).find({ accountId }, { projection: { torId: 1 } }).toArray();
    const ids = rows.map((row) => row.torId).filter(ObjectId.isValid).map((id) => new ObjectId(id));
    return ids.length ? tors(this.db).find({ _id: { $in: ids } }).toArray() : [];
  }

  /**
   * The TORs a vendor follows, and since when (TOR-239): those they were emailed as a match — in the same
   * mode, so a dry run follows what a dry run claimed — and those they saved. The earlier date wins.
   */
  async followedTors(accountId: string, dryRun: boolean): Promise<Map<string, { since: Date; following: "matched" | "bookmarked" }>> {
    const [matched, saved] = await Promise.all([
      notifications(this.db)
        .find({ accountId, reason: "match", dryRun, ...(dryRun ? {} : { sentAt: { $exists: true } }) }, { projection: { torId: 1, createdAt: 1 } })
        .toArray(),
      bookmarks(this.db).find({ accountId }, { projection: { torId: 1, createdAt: 1 } }).toArray(),
    ]);
    const followed = new Map<string, { since: Date; following: "matched" | "bookmarked" }>();
    for (const row of matched) followed.set(row.torId, { since: row.createdAt, following: "matched" });
    for (const row of saved) {
      const known = followed.get(row.torId);
      if (!known || row.createdAt < known.since) followed.set(row.torId, { since: row.createdAt, following: known?.following ?? "bookmarked" });
    }
    return followed;
  }

  /** Stage moves of these TORs since `since`, oldest first. A first read (`from: null`) is not a move. */
  async stageMoves(torIds: string[], since: Date): Promise<WithId<TorEventDocument>[]> {
    if (torIds.length === 0) return [];
    return torEvents(this.db)
      .find({ torId: { $in: torIds }, kind: "stage", from: { $ne: null }, at: { $gte: since } }, { sort: { at: 1, _id: 1 } })
      .toArray();
  }

  async torsById(ids: string[]): Promise<WithId<TorDocument>[]> {
    const valid = ids.filter(ObjectId.isValid).map((id) => new ObjectId(id));
    return valid.length ? tors(this.db).find({ _id: { $in: valid } }).toArray() : [];
  }

  /** The unique database key is the final authority when worker processes race. */
  async claim(notification: NotificationDocument): Promise<boolean> {
    try {
      await notifications(this.db).insertOne(notification);
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw error;
    }
  }

  async sent(accountId: string, torId: string, reason: NotificationDocument["reason"], dryRun: boolean, messageId?: string): Promise<void> {
    await notifications(this.db).updateOne(
      { accountId, torId, reason, dryRun },
      { $set: { sentAt: new Date(), ...(messageId ? { messageId } : {}) } },
    );
  }
}
