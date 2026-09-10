import type { Queue } from "../../ports/queue.port.js";
import type { HistoryRepository } from "../history/history.repository.js";
import type { AdminRepository, FieldEdit, QueueEntry, ReviewRecord } from "./admin.repository.js";

export interface AdminDeps {
  repo: AdminRepository;
  history: HistoryRepository;
  queue: Queue;
}

export interface QueueView {
  items: QueueEntry[];
  /** Unverified records that never tripped a check, so a reviewer knows the queue is not everything. */
  unverifiedNotQueued: number;
}

/**
 * The review queue's rules (FR-G-1, FR-G-2).
 *
 * Every action here is a state change a reader can later ask about, so each one
 * goes through HistoryRepository rather than writing `pipeline.state` directly:
 * "who approved this, and when" is exactly the question a published figure
 * invites.
 */
export class AdminService {
  constructor(private readonly deps: AdminDeps) {}

  async queue(limit: number, reason?: string): Promise<QueueView> {
    const [items, unverifiedNotQueued] = await Promise.all([
      this.deps.repo.listQueue(limit, reason),
      this.deps.repo.countUnverifiedNotQueued(),
    ]);
    return { items, unverifiedNotQueued };
  }

  async load(torId: string): Promise<ReviewRecord> {
    return this.deps.repo.load(torId);
  }

  async overview() {
    return this.deps.repo.overview();
  }

  async events(limit: number) {
    return this.deps.repo.recentEvents(limit);
  }

  /** Corrections without approval: a reviewer may fix one field and come back. */
  async correct(torId: string, edits: FieldEdit[], actor: string): Promise<ReviewRecord> {
    if (edits.length > 0) {
      await this.deps.repo.applyEdits(torId, edits, actor);
    }
    return this.deps.repo.load(torId);
  }

  /**
   * Approving applies any pending edits first, so one press cannot approve a
   * record while a correction the reviewer typed is still unsaved.
   */
  async approve(torId: string, edits: FieldEdit[], actor: string): Promise<void> {
    if (edits.length > 0) {
      await this.deps.repo.applyEdits(torId, edits, actor);
    }
    await this.deps.repo.approve(torId);
    await this.deps.history.record(torId, {
      from: "published",
      to: "published",
      actor,
      source: "admin",
      reason: "approved",
    });
  }

  /**
   * Re-extraction puts the record back in the pipeline. The record returns to
   * `queued`, which is what the worker claims, and the enqueue is idempotent so
   * pressing twice costs nothing.
   */
  async reextract(torId: string, actor: string): Promise<void> {
    await this.deps.history.record(torId, {
      from: "published",
      to: "queued",
      actor,
      source: "admin",
      reason: "re-extract requested",
    });
    await this.deps.queue.enqueue(torId);
  }

  /** Rejection restricts access and records the reason; the document survives. */
  async reject(torId: string, reason: string, actor: string): Promise<void> {
    await this.deps.repo.reject(torId, reason, actor);
    await this.deps.history.record(torId, {
      from: "published",
      to: "restricted",
      actor,
      source: "admin",
      reason,
    });
  }
}
