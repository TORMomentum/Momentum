import type { Db } from "mongodb";
import { matchLabels, type MatchLabelDocument } from "../../core/db.js";

/** The labelled benchmark's only Mongo boundary. */
export class MatchLabelsRepository {
  constructor(private readonly db: Db) {}

  async save(label: Omit<MatchLabelDocument, "labelledAt">): Promise<void> {
    await matchLabels(this.db).updateOne(
      { accountId: label.accountId, torId: label.torId },
      { $set: { ...label, labelledAt: new Date() } },
      { upsert: true },
    );
  }

  async forAccount(accountId: string): Promise<Map<string, MatchLabelDocument["label"]>> {
    const rows = await matchLabels(this.db).find({ accountId }, { projection: { torId: 1, label: 1 } }).toArray();
    return new Map(rows.map((row) => [row.torId, row.label]));
  }

  /** Counts by (matched, label) — everything the benchmark's figures need. */
  async tally(): Promise<Array<{ matched: boolean; label: MatchLabelDocument["label"]; n: number }>> {
    return matchLabels(this.db)
      .aggregate<{ matched: boolean; label: MatchLabelDocument["label"]; n: number }>([
        { $group: { _id: { matched: "$matched", label: "$label" }, n: { $sum: 1 } } },
        { $project: { _id: 0, matched: "$_id.matched", label: "$_id.label", n: 1 } },
      ])
      .toArray();
  }

  async vendorsLabelled(): Promise<number> {
    return (await matchLabels(this.db).distinct("accountId")).length;
  }
}
