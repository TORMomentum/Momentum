import type { Db } from "mongodb";
import { jobs, tors } from "../core/db.js";
import type { Queue } from "../ports/queue.port.js";

/**
 * Closes the gap between inserting a record and enqueueing its job. A process
 * that dies between those two writes leaves a document that is stored,
 * recorded, and never processed - it would sit in "queued" forever without
 * ever surfacing as failed. Enqueue is idempotent, so a sweep that races a
 * successful enqueue produces no duplicate work.
 *
 * Only records old enough that their enqueue cannot still be in flight are
 * touched (`minAgeMs`), so the common path - insert, then enqueue, milliseconds
 * apart - never reaches the reconciler at all.
 */
export async function reconcileOrphanedRecords(
  db: Db,
  queue: Queue,
  minAgeMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs);
  const candidates = await tors(db)
    .find({ "pipeline.state": "queued", createdAt: { $lte: cutoff } })
    .project({ _id: 1 })
    .toArray();

  let requeued = 0;
  for (const candidate of candidates) {
    const torId = candidate._id.toString();
    const live = await jobs(db).countDocuments({ torId, state: { $in: ["pending", "running"] } });
    if (live > 0) continue;
    await queue.enqueue(torId);
    requeued += 1;
  }
  return requeued;
}
