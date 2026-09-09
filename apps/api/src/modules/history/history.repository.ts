import { ObjectId, type Db } from "mongodb";
import { STATUS_HISTORY_KEPT, torEvents, tors } from "../../core/db.js";

export interface Transition {
  from: string | null;
  to: string;
  actor: string;
  source: string;
  reason?: string;
}

/**
 * Every change to a record's pipeline state, written the same way by whoever
 * causes it — intake, the worker, or an admin.
 *
 * Two writes per transition, and both are needed: `tor_events` is the complete
 * audit trail FR-E-5 requires, and the capped copy on the record is what the
 * detail screen reads without a second query. The record's copy is bounded at
 * STATUS_HISTORY_KEPT by the write itself, because an array that only ever
 * grows makes every later read and write of that record more expensive.
 *
 * It exists as its own repository because the transition is not owned by one
 * feature: the worker used to write `pipeline.state` straight into `tors`,
 * which both skipped the audit trail and crossed the rule that only a
 * `*.repository.ts` touches the database.
 */
export class HistoryRepository {
  constructor(private readonly db: Db) {}

  /**
   * Appends the transition and moves `pipeline.state` to match.
   *
   * The event is written first: if the second write fails, the audit trail is
   * complete and only the record is behind, which a later transition or a
   * rebuild from `tor_events` repairs. The reverse order would leave a record
   * claiming a transition the audit trail has never heard of.
   *
   * `extra` carries fields that belong to the same state change — the failure
   * reason, for instance — so the record moves in one update rather than two.
   */
  async record(torId: string, transition: Transition, extra: Record<string, unknown> = {}): Promise<void> {
    const at = new Date();

    await torEvents(this.db).insertOne({ torId, ...transition, at });

    await tors(this.db).updateOne(
      { _id: new ObjectId(torId) },
      {
        $push: {
          statusHistory: {
            $each: [
              {
                from: transition.from,
                to: transition.to,
                at,
                actor: transition.actor,
                source: transition.source,
              },
            ],
            $slice: -STATUS_HISTORY_KEPT,
          },
        },
        $set: { "pipeline.state": transition.to, updatedAt: at, ...extra },
      },
    );
  }
}
