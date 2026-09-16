import { ObjectId, type Db, type Filter, type WithId } from "mongodb";
import { torPeerStats, tors, type TorDocument } from "../../core/db.js";
import type { CohortKey } from "../stats/cohort.js";

export interface PublicTorDocumentRecord {
  storage: { key: string; contentType: string; bytes: number };
  restricted: boolean;
  filename?: string;
}

/** The only public-TOR code that touches MongoDB. */
export class TorsRepository {
  constructor(private readonly db: Db) {}

  async loadDocument(id: string): Promise<PublicTorDocumentRecord | null> {
    if (!ObjectId.isValid(id)) return null;

    const record = await tors(this.db).findOne(
      { _id: new ObjectId(id) },
      { projection: { storage: 1, "access.restricted": 1, "sourceRefs.originalFilename": 1 } },
    );
    if (!record) return null;

    return {
      storage: {
        key: record.storage.key,
        contentType: record.storage.contentType,
        bytes: record.storage.bytes,
      },
      restricted: record.access.restricted,
      filename: record.sourceRefs?.find((s) => s.originalFilename)?.originalFilename,
    };
  }

  async list(filter: Filter<TorDocument>, page: number, pageSize: number): Promise<{ records: WithId<TorDocument>[]; total: number }> {
    const [records, total] = await Promise.all([
      tors(this.db).find(filter, { sort: { createdAt: -1 }, skip: (page - 1) * pageSize, limit: pageSize }).toArray(),
      tors(this.db).countDocuments(filter),
    ]);
    return { records, total };
  }

  async boundsFor(keys: CohortKey[]) {
    const unique = [...new Map(keys.map((key) => [`${key.category}\u0000${key.month}`, key])).values()];
    if (unique.length === 0) return [];
    return torPeerStats(this.db).find({
      category: { $in: [...new Set(unique.map((key) => key.category))] },
      month: { $in: [...new Set(unique.map((key) => key.month))] },
    }).toArray();
  }
}
