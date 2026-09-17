import type { Db } from "mongodb";
import type { Config } from "../../core/config.js";
import { torMeta, torPeerStats } from "../../core/db.js";
import { StatsRepository } from "./stats.repository.js";

/** Coordinates one claim so the repository keeps all Mongo-specific operations. */
export class StatsService {
  private readonly repository: StatsRepository;

  constructor(private readonly db: Db, private readonly config: Config) {
    this.repository = new StatsRepository(db);
  }

  async recomputeOne(): Promise<boolean> {
    const claim = await this.repository.claimDirtyCohort(this.config.stats.leaseMs);
    if (!claim) return false;
    const key = { category: claim.category, month: claim.month };
    const bounds = await this.repository.computeBounds(key, this.config.stats);
    await this.repository.writeBounds(key, claim.generation, bounds, this.config.stats);
    await this.repository.recomputeRollups([claim.month], this.config);
    await torMeta(this.db).updateOne({ _id: "dashboard" }, { $set: { statsComputedAt: new Date() } }, { upsert: true });
    return true;
  }

  /**
   * Periodic full sweep makes a missed event self-healing. It deliberately
   * ignores `dirty`: the event path is fast freshness, this is the safety net.
   */
  async sweepEveryCohort(): Promise<number> {
    const known = await torPeerStats(this.db).find({}, { projection: { category: 1, month: 1 } }).toArray();
    // Cohorts implied by the records are included, not just those that already
    // have a bounds document: a cohort whose mark was lost before its document
    // existed would otherwise be invisible to the very pass meant to catch it.
    const implied = await this.repository.distinctCohorts();
    const keys = [...known.map(({ category, month }) => ({ category, month })), ...implied];
    await this.repository.markCohortsDirty(keys);
    let recomputed = 0;
    while (await this.recomputeOne()) recomputed += 1;
    return recomputed;
  }
}
