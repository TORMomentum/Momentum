import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { Config } from "../../core/config.js";
import { accounts, behaviourEvents, torClassifications, type BehaviourEventType } from "../../core/db.js";

/** Most recent events read for one vendor's affinity; a vendor with more than this has plenty to go on. */
const EVENTS_READ_CAP = 2000;

/** Points per kind of work (a taxonomy leaf id), from a consenting vendor's own activity. */
export type BehaviourAffinity = Record<string, number>;

/** The only behaviour code that addresses the events collection. */
export class BehaviourRepository {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  /** Behaviour consent given, not withdrawn, and the account's own consent not withdrawn either. */
  async hasConsent(accountId: string): Promise<boolean> {
    if (!ObjectId.isValid(accountId)) return false;
    const account = await accounts(this.db).findOne(
      { _id: new ObjectId(accountId), deletedAt: { $exists: false } },
      { projection: { behaviourConsent: 1, "consent.withdrawnAt": 1 } },
    );
    const consent = account?.behaviourConsent;
    return Boolean(consent?.agreedAt) && !consent?.withdrawnAt && !account?.consent?.withdrawnAt;
  }

  /** Whether anything is recorded at all: with scoring off there is no use for the data, so none is kept. */
  get enabled(): boolean {
    return this.config.matching.behaviour.enabled;
  }

  /**
   * Records one event; false, and nothing kept, when scoring by behaviour is off or the vendor has not consented.
   *
   * One document per (account, TOR, kind): doing the same thing again only refreshes its time, so repeats can
   * neither crowd out other events nor pile up points. Withdrawing consent can land between the consent check
   * and the write, so consent is read again afterwards and the event removed if it has gone: withdrawal flags
   * first and deletes second, which leaves no order in which a withdrawn vendor's event survives.
   */
  async record(accountId: string, torId: string, type: BehaviourEventType): Promise<boolean> {
    if (!this.enabled || !(await this.hasConsent(accountId))) return false;
    const key = { accountId, torId, type };
    try {
      await behaviourEvents(this.db).updateOne(key, { $set: { at: new Date() } }, { upsert: true });
    } catch (error) {
      // A concurrent identical event won the unique index; it is already recorded.
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    }
    if (await this.hasConsent(accountId)) return true;
    await behaviourEvents(this.db).deleteMany(key);
    return false;
  }

  /**
   * What the vendor's recent activity says about the kinds of work they care for. Empty unless scoring by
   * behaviour is on and the vendor consented. Each (TOR, kind of event) counts once, so reloading a page
   * does not pile up points. (Recording keeps one per kind already; the check also covers older rows.)
   */
  async affinity(accountId: string): Promise<BehaviourAffinity> {
    const { enabled, weights, windowDays } = this.config.matching.behaviour;
    if (!enabled || !(await this.hasConsent(accountId))) return {};
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const events = await behaviourEvents(this.db).find({ accountId, at: { $gte: since } }).sort({ at: -1 }).limit(EVENTS_READ_CAP).toArray();
    if (events.length === 0) return {};

    const pointsByTor = new Map<string, number>();
    const seen = new Set<string>();
    for (const event of events) {
      const key = `${event.torId}:${event.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pointsByTor.set(event.torId, (pointsByTor.get(event.torId) ?? 0) + weights[event.type]);
    }

    const classified = await torClassifications(this.db)
      .find({ torId: { $in: [...pointsByTor.keys()] } }, { projection: { torId: 1, "classification.leaves": 1 } })
      .toArray();
    const affinity: BehaviourAffinity = {};
    for (const row of classified) {
      const points = pointsByTor.get(row.torId) ?? 0;
      for (const leaf of row.classification.leaves) affinity[leaf.id] = (affinity[leaf.id] ?? 0) + points;
    }
    return affinity;
  }
}
