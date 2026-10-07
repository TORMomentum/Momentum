import { MongoServerError, type Db } from "mongodb";
import { bookmarks, type BookmarkDocument } from "../../core/db.js";

/** The only bookmark code that addresses the bookmarks collection. */
export class BookmarksRepository {
  constructor(private readonly db: Db) {}

  async add(accountId: string, torId: string): Promise<void> {
    try {
      await bookmarks(this.db).insertOne({ accountId, torId, createdAt: new Date() });
    } catch (error) {
      // The unique index, rather than a read-before-write race, decides whether
      // this vendor has already saved this TOR.
      if (error instanceof MongoServerError && error.code === 11000) return;
      throw error;
    }
  }

  async remove(accountId: string, torId: string): Promise<void> {
    await bookmarks(this.db).deleteOne({ accountId, torId });
  }

  async listFor(accountId: string): Promise<BookmarkDocument[]> {
    return bookmarks(this.db).find({ accountId }).sort({ createdAt: -1 }).toArray();
  }

  async idsFor(accountId: string, torIds: string[]): Promise<string[]> {
    if (torIds.length === 0) return [];
    const rows = await bookmarks(this.db).find({ accountId, torId: { $in: [...new Set(torIds)] } }, { projection: { torId: 1 } }).toArray();
    return rows.map((row) => row.torId);
  }
}
