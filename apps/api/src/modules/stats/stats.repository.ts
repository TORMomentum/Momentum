import { ObjectId, type Db, type Filter, type WithId } from "mongodb";
import { torMeta, torPeerStats, torRollups, tors, type TorDocument, type TorPeerStatsDocument, type TorRollupDocument } from "../../core/db.js";
import type { Config } from "../../core/config.js";
import type { CohortKey } from "./cohort.js";
import { NOT_SUPPORTING_DOCUMENT, eligibleFilter, eligibilityOf } from "./eligibility.js";
import { quantile, verdictFor, type PeerBounds } from "./anomaly.rule.js";

function monthAfter(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) throw new Error(`invalid cohort month: ${month}`);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * A changed record contributes to its own window and every later window that
 * still contains it. Keeping this calculation here gives every state-change
 * caller the same bounded fan-out.
 */
export function windowKeysFor(cohort: CohortKey, windowMonths: number): CohortKey[] {
  return Array.from({ length: windowMonths }, (_, offset) => ({
    category: cohort.category,
    month: monthAfter(cohort.month, offset),
  }));
}

export class StatsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Separate exact upserts are required because MongoDB can only construct one
   * upsert document from an updateMany filter, while these keys are distinct.
   */
  async markCohortsDirty(keys: CohortKey[]): Promise<void> {
    const unique = [...new Map(keys.map((key) => [`${key.category}\u0000${key.month}`, key])).values()];
    if (unique.length === 0) return;

    const dirtyAt = new Date();
    await torPeerStats(this.db).bulkWrite(unique.map((key) => ({
      updateOne: {
        filter: key,
        update: { $set: { dirty: true, dirtyAt }, $inc: { generation: 1 } },
        upsert: true,
      },
    })));
  }

  async markTorCohortDirty(torId: string, windowMonths: number): Promise<void> {
    const document = await tors(this.db).findOne(
      { _id: new ObjectId(torId) },
      { projection: { cohort: 1 } },
    );
    if (document?.cohort) await this.markCohortsDirty(windowKeysFor(document.cohort, windowMonths));
  }

  async claimDirtyCohort(leaseMs: number): Promise<TorPeerStatsDocument | null> {
    const now = new Date();
    return torPeerStats(this.db).findOneAndUpdate(
      { dirty: true, $or: [{ leaseUntil: { $lt: now } }, { leaseUntil: { $exists: false } }] },
      { $set: { leaseOwner: new ObjectId().toHexString(), leaseUntil: new Date(now.getTime() + leaseMs) } },
      { sort: { dirtyAt: 1 }, returnDocument: "after" },
    );
  }

  async computeBounds(key: CohortKey, settings: Config["stats"]): Promise<PeerBounds> {
    const months = windowKeysFor({ category: key.category, month: monthAfter(key.month, -(settings.peerWindowMonths - 1)) }, settings.peerWindowMonths)
      .map((window) => window.month);
    const records = await tors(this.db).find({
      ...eligibleFilter(),
      ...NOT_SUPPORTING_DOCUMENT,
      "cohort.category": key.category,
      "cohort.month": { $in: months },
    }, { projection: { "fields.budget.value": 1 } }).toArray();
    const values = records.map((record) => record.fields.budget?.value).filter((value): value is number => typeof value === "number");
    const n = values.length;
    if (n === 0) return { n };
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    const stdDev = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n);
    return {
      n, q1, q3, iqr,
      lowBound: q1 - settings.iqrMultiplier * iqr,
      highBound: q3 + settings.iqrMultiplier * iqr,
      mean, stdDev,
    };
  }

  async writeBounds(key: CohortKey, generation: number, bounds: PeerBounds, settings: Config["stats"]): Promise<void> {
    const values = {
      ...bounds,
      method: settings.method,
      minN: settings.peerMinN,
      windowMonths: settings.peerWindowMonths,
      computedAt: new Date(),
    };
    const cleared = await torPeerStats(this.db).updateOne(
      { ...key, generation },
      // Deliberately NOT an upsert: the filter pins a generation, so an upsert
      // would try to insert a second document for a key the unique index
      // already holds. The fallback below owns document creation.
      { $set: { ...values, dirty: false }, $unset: { leaseOwner: "", leaseUntil: "" } },
    );
    // A mark that won the race must remain queued. Publishing these bounds is
    // still useful until the next pass replaces them with the newer snapshot.
    // The lease is released either way, or the cohort that most needs
    // recomputing would be the one nobody may claim until the lease expires.
    if (cleared.matchedCount === 0) {
      await torPeerStats(this.db).updateOne(
        key,
        { $set: values, $unset: { leaseOwner: "", leaseUntil: "" } },
        { upsert: true },
      );
    }
  }

  async recomputeRollups(months: string[], config: Pick<Config, "stats" | "budgetMinThb" | "budgetMaxThb">): Promise<void> {
    const records = await tors(this.db).find({
      "pipeline.state": "published", "access.restricted": false,
      "fields.budget.value": { $type: "number", $gt: 0 }, "cohort.month": { $in: months },
      ...NOT_SUPPORTING_DOCUMENT,
    }).toArray();
    const bounds = await torPeerStats(this.db).find({ month: { $in: months } }).toArray();
    const byKey = new Map(bounds.map((bound) => [`${bound.category}\u0000${bound.month}`, bound]));
    const cells = new Map<string, { agency: string; category: string; month: string; torCount: number; budgetSum: number; unverifiedBudgetCount: number; flaggedCount: number }>();
    for (const record of records) {
      const agency = typeof record.fields.agency?.value === "string" ? record.fields.agency.value.trim() : "";
      const category = record.cohort?.category;
      const month = record.cohort?.month;
      const budget = record.fields.budget?.value;
      if (!category || !month || typeof budget !== "number") continue;
      const cellKey = `${agency}\u0000${category}\u0000${month}`;
      const cell = cells.get(cellKey) ?? { agency, category, month, torCount: 0, budgetSum: 0, unverifiedBudgetCount: 0, flaggedCount: 0 };
      cell.torCount += 1;
      cell.budgetSum += budget;
      if (!record.fields.budget?.verified) cell.unverifiedBudgetCount += 1;
      const reason = eligibilityOf(record as never, config);
      const storedBounds = byKey.get(`${category}\u0000${month}`);
      const peerBounds: PeerBounds | null = storedBounds?.n === undefined ? null : storedBounds as PeerBounds;
      const verdict = verdictFor(reason ? { budget, eligible: false, reason } : { budget, eligible: true }, peerBounds, {
        method: config.stats.method, minN: config.stats.peerMinN, iqrMultiplier: config.stats.iqrMultiplier, zScoreLimit: config.stats.zScoreLimit,
      });
      if (verdict.kind === "anomaly") cell.flaggedCount += 1;
      cells.set(cellKey, cell);
    }
    const computedAt = new Date();
    if (cells.size) await torRollups(this.db).bulkWrite([...cells.values()].map((cell) => ({ updateOne: {
      filter: { agency: cell.agency, category: cell.category, month: cell.month },
      update: { $set: { ...cell, computedAt } }, upsert: true,
    } })));

    // Cells that no longer have any record must go, not merely stop being
    // updated. A takedown removes the last record from a cell, and an upsert-only
    // pass would leave its spending total standing for ever — the dashboard would
    // keep reporting money against a record it is no longer allowed to show.
    const survivors = [...cells.values()].map(({ agency, category, month }) => ({ agency, category, month }));
    await torRollups(this.db).deleteMany(
      // $nor rejects an empty array, and "no records left in these months" is
      // precisely the case that must clear every cell — a whole month of
      // records taken down would otherwise keep reporting its old totals.
      survivors.length === 0
        ? { month: { $in: months } }
        : { month: { $in: months }, $nor: survivors },
    );
  }

  /**
   * Every cohort the records themselves imply, which is what makes the sweep a
   * real safety net: a cohort whose mark was lost before its bounds document
   * existed is invisible to anything that only reads tor_peer_stats.
   */
  async distinctCohorts(): Promise<CohortKey[]> {
    const keys = await tors(this.db).distinct("cohort", { ...eligibleFilter(), ...NOT_SUPPORTING_DOCUMENT });
    return keys.filter((key): key is CohortKey =>
      Boolean(key) && typeof (key as CohortKey).category === "string" && typeof (key as CohortKey).month === "string");
  }

  async dashboardRecords(filter: Filter<TorDocument>): Promise<WithId<TorDocument>[]> {
    return tors(this.db).find(filter, { sort: { "cohort.month": 1, _id: 1 } }).toArray();
  }

  async dashboardRollups(filter: Filter<TorRollupDocument>): Promise<TorRollupDocument[]> {
    return torRollups(this.db).find(filter).toArray();
  }

  async boundsFor(keys: CohortKey[]): Promise<TorPeerStatsDocument[]> {
    const unique = [...new Map(keys.map((key) => [`${key.category}\u0000${key.month}`, key])).values()];
    if (unique.length === 0) return [];
    return torPeerStats(this.db).find({
      category: { $in: [...new Set(unique.map((key) => key.category))] },
      month: { $in: [...new Set(unique.map((key) => key.month))] },
    }).toArray();
  }

  async dashboardMeta() { return torMeta(this.db).findOne({ _id: "dashboard" }); }

  async corpusSize(): Promise<number> { return tors(this.db).countDocuments(); }
}
