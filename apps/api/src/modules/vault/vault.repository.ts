import { MongoServerError, ObjectId, type Db } from "mongodb";
import { accounts, vaultDocuments, type ReadyVaultDocument, type VaultDocument, type VaultKind } from "../../core/db.js";

export interface VaultFileMeta {
  kind: VaultKind;
  certificationId?: string;
  filename: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

const DUPLICATE_KEY = 11000;

/**
 * Metadata only; the bytes are in the vault bucket (TOR-218). Every read is scoped to the owner.
 *
 * Rows come in three states: `pending` (an upload holds the slot and has not finished), `ready` (stored and
 * listed) and `discarded` (an upload that must not complete). Only `ready` rows are ever shown or served.
 */
export class VaultRepository {
  constructor(private readonly db: Db) {}

  async list(accountId: string): Promise<ReadyVaultDocument[]> {
    return (await vaultDocuments(this.db).find({ accountId, status: "ready" }).sort({ uploadedAt: -1 }).toArray()) as ReadyVaultDocument[];
  }

  /**
   * Takes one of the account's `max` slots and writes the row that names the file about to be stored, before
   * any byte is. A slot is unique per account, so uploads that start together cannot take more than `max`:
   * the loser of a race for a slot looks again and finds none free. Null when every slot is taken.
   */
  async reserve(accountId: string, key: string, max: number): Promise<VaultDocument | null> {
    for (let attempt = 0; attempt < max; attempt += 1) {
      const taken = new Set((await vaultDocuments(this.db).find({ accountId }, { projection: { slot: 1 } }).toArray()).map((row) => row.slot));
      let slot = 0;
      while (slot < max && taken.has(slot)) slot += 1;
      if (slot >= max) return null;
      const row: VaultDocument = { _id: new ObjectId(), accountId, slot, key, status: "pending", uploadedAt: new Date() };
      try {
        await vaultDocuments(this.db).insertOne(row);
        return row;
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== DUPLICATE_KEY) throw error;
      }
    }
    return null;
  }

  /** The upload's last step. False when the row is no longer pending: the account was deleted, or it timed out. */
  async markReady(id: ObjectId, accountId: string, meta: VaultFileMeta): Promise<ReadyVaultDocument | null> {
    const result = await vaultDocuments(this.db).findOneAndUpdate(
      { _id: id, accountId, status: "pending" },
      { $set: { status: "ready", uploadedAt: new Date(), ...meta } },
      { returnDocument: "after" },
    );
    return result as ReadyVaultDocument | null;
  }

  /** A stored file of this account, by id. Someone else's id, a malformed one and a missing one all answer null. */
  async find(accountId: string, id: string): Promise<ReadyVaultDocument | null> {
    if (!ObjectId.isValid(id)) return null;
    return (await vaultDocuments(this.db).findOne({ _id: new ObjectId(id), accountId, status: "ready" })) as ReadyVaultDocument | null;
  }

  /** A row in any state, for cleaning up after an upload. */
  async findAny(accountId: string, id: ObjectId): Promise<VaultDocument | null> {
    return vaultDocuments(this.db).findOne({ _id: id, accountId });
  }

  async remove(accountId: string, id: ObjectId): Promise<void> {
    await vaultDocuments(this.db).deleteOne({ _id: id, accountId });
  }

  /** The row stays, so the file it names can still be found and removed; the sweep does that. */
  async discard(accountId: string, id: ObjectId): Promise<void> {
    await vaultDocuments(this.db).updateOne({ _id: id, accountId }, { $set: { status: "discarded" } });
  }

  /** Uploads still waiting for their bytes can no longer complete. Each notices when it tries to finish. */
  async discardPending(accountId: string): Promise<void> {
    await vaultDocuments(this.db).updateMany({ accountId, status: "pending" }, { $set: { status: "discarded" } });
  }

  /** Every file the account has, in any state: what an account deletion has to remove. */
  async keysFor(accountId: string): Promise<string[]> {
    const rows = await vaultDocuments(this.db).find({ accountId }, { projection: { key: 1 } }).toArray();
    return rows.map((row) => row.key);
  }

  /** Stored files only. A discarded row stays until its own upload (or the sweep) has removed its file. */
  async removeReady(accountId: string): Promise<void> {
    await vaultDocuments(this.db).deleteMany({ accountId, status: "ready" });
  }

  /** Rows of uploads that never finished or were discarded, old enough not to be a running upload. */
  async stale(before: Date): Promise<VaultDocument[]> {
    return vaultDocuments(this.db).find({ status: { $in: ["pending", "discarded"] }, uploadedAt: { $lt: before } }).toArray();
  }

  /** Whether the account may still keep files: it exists, is not deleted and is not being deleted. */
  async accountLive(accountId: string): Promise<boolean> {
    if (!ObjectId.isValid(accountId)) return false;
    const found = await accounts(this.db).findOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false }, deletingAt: { $exists: false } },
      { projection: { _id: 1 } },
    );
    return found !== null;
  }
}
