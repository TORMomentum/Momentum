import { ObjectId, type Db } from "mongodb";
import { vaultDocuments, type VaultDocument } from "../../core/db.js";

/** Metadata only; the bytes are in the vault bucket (TOR-218). Every read is scoped to the owner. */
export class VaultRepository {
  constructor(private readonly db: Db) {}

  async list(accountId: string): Promise<VaultDocument[]> {
    return vaultDocuments(this.db).find({ accountId }).sort({ uploadedAt: -1 }).toArray();
  }

  async count(accountId: string): Promise<number> {
    return vaultDocuments(this.db).countDocuments({ accountId });
  }

  async insert(doc: Omit<VaultDocument, "_id">): Promise<VaultDocument> {
    const _id = new ObjectId();
    await vaultDocuments(this.db).insertOne({ _id, ...doc });
    return { _id, ...doc };
  }

  /** Someone else's id, a malformed one and a missing one all answer the same: nothing. */
  async find(accountId: string, id: string): Promise<VaultDocument | null> {
    if (!ObjectId.isValid(id)) return null;
    return vaultDocuments(this.db).findOne({ _id: new ObjectId(id), accountId });
  }

  async remove(accountId: string, id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await vaultDocuments(this.db).deleteOne({ _id: new ObjectId(id), accountId });
  }

  async keysFor(accountId: string): Promise<string[]> {
    const rows = await vaultDocuments(this.db).find({ accountId }, { projection: { key: 1 } }).toArray();
    return rows.map((row) => row.key);
  }

  async removeAll(accountId: string): Promise<void> {
    await vaultDocuments(this.db).deleteMany({ accountId });
  }
}
