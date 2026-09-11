import { ObjectId, type Db } from "mongodb";
import { tors } from "../../core/db.js";

export interface PublicTorDocumentRecord {
  storage: { key: string; contentType: string; bytes: number };
  restricted: boolean;
}

/** The only public-TOR code that touches MongoDB. */
export class TorsRepository {
  constructor(private readonly db: Db) {}

  async loadDocument(id: string): Promise<PublicTorDocumentRecord | null> {
    if (!ObjectId.isValid(id)) return null;

    const record = await tors(this.db).findOne(
      { _id: new ObjectId(id) },
      { projection: { storage: 1, "access.restricted": 1 } },
    );
    if (!record) return null;

    return {
      storage: {
        key: record.storage.key,
        contentType: record.storage.contentType,
        bytes: record.storage.bytes,
      },
      restricted: record.access.restricted,
    };
  }
}
