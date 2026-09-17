import type { Queue } from "../../ports/queue.port.js";
import { BadRequestError } from "../../core/errors.js";
import { extensionFor } from "../../lib/content-disposition.js";
import { parseBudget } from "../../lib/parse-budget.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
import type { HistoryRepository } from "../history/history.repository.js";
import { cohortFor, type CohortKey } from "../stats/cohort.js";
import { windowKeysFor } from "../stats/stats.repository.js";
import type {
  AdminRepository,
  FieldEdit,
  QueueEntry,
  ReviewFieldName,
  ReviewRecord,
} from "./admin.repository.js";

export interface AdminDeps {
  repo: AdminRepository;
  history: HistoryRepository;
  queue: Queue;
  /** Below this, a field is what put the record in the queue (SRS §4.2.1). */
  tLow: number;
  budgetMaxThb: number;
  stats?: { markCohortsDirty(keys: CohortKey[]): Promise<void>; windowMonths: number; timezone: string };
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

  /**
   * Which fields a reviewer has to look at.
   *
   * NOT "every unverified field": on a low-confidence record none of them are
   * verified, so marking those would paint the whole form as a problem and say
   * nothing. A field earns attention when it is missing, when its own
   * confidence is below T_LOW, or when it is named in the reasons the grader
   * recorded — the same three things that put the record here.
   */
  private flagged(record: ReviewRecord): string[] {
    const flags = new Set<string>();

    for (const reason of record.reviewReasons) {
      const field = reason.split("-")[0];
      if (field) flags.add(field);
    }

    for (const [name, field] of Object.entries(record.fields)) {
      if (!field) continue;
      const empty = field.value === null || field.value === undefined || field.raw.trim() === "";
      if (empty || field.confidence < this.deps.tLow) flags.add(name);
    }

    // A field a reviewer has already corrected is settled, whatever the
    // record-level reason still says: the reason outlives the fix, and leaving
    // the field marked would ask someone to look at work already done.
    for (const [name, field] of Object.entries(record.fields)) {
      if (field?.verified) flags.delete(name);
    }

    return [...flags];
  }

  async load(torId: string): Promise<ReviewRecord> {
    const record = await this.deps.repo.load(torId);
    return { ...record, flaggedFields: this.flagged(record) };
  }

  /**
   * What to stream for a staff request. Unlike the public route, a restricted
   * record is still served — a reviewer must be able to see what they rejected.
   */
  async documentToStream(torId: string): Promise<StreamableDocument> {
    const record = await this.deps.repo.load(torId);
    return {
      key: record.storage.key,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
      filename: record.filename ?? `tor-${torId}${extensionFor(record.storage.contentType)}`,
    };
  }

  async overview() {
    return this.deps.repo.overview();
  }

  private validateEdits(edits: FieldEdit[]): void {
    for (const edit of edits) {
      if (edit.field === "budget" && parseBudget(edit.value, this.deps.budgetMaxThb) === null) {
        throw new BadRequestError("งบประมาณต้องเป็นจำนวนเงินที่มากกว่าศูนย์และไม่เกินขอบเขตที่กำหนด");
      }
    }
  }

  async events(limit: number) {
    return this.deps.repo.recentEvents(limit);
  }

  /** Corrections without approval: a reviewer may fix one field and come back. */
  async correct(torId: string, edits: FieldEdit[], actor: string): Promise<ReviewRecord> {
    if (edits.length > 0) {
      this.validateEdits(edits);
      const before = await this.deps.repo.applyEdits(torId, edits, actor);
      await this.updateCohort(torId);
      await this.markCohorts(before, await this.deps.repo.statsRecord(torId));
    }
    return this.deps.repo.load(torId);
  }

  /** Affirmation is audit history, not a correction or a new model result. */
  async verifyField(
    torId: string,
    field: ReviewFieldName,
    confirmed: boolean,
    actor: string,
  ): Promise<ReviewRecord> {
    const before = await this.deps.repo.setFieldVerification(torId, field, confirmed);
    await this.deps.history.record(torId, {
      from: "published",
      to: "published",
      actor,
      source: "admin",
      reason: confirmed ? `field ${field} confirmed` : `field ${field} confirmation cleared`,
    });
    if (field === "budget" || field === "category") await this.markCohorts(before, await this.deps.repo.statsRecord(torId));
    return this.load(torId);
  }

  /**
   * Approving applies any pending edits first, so one press cannot approve a
   * record while a correction the reviewer typed is still unsaved.
   */
  async approve(torId: string, edits: FieldEdit[], actor: string): Promise<void> {
    if (edits.length > 0) {
      this.validateEdits(edits);
      const before = await this.deps.repo.applyEdits(torId, edits, actor);
      await this.updateCohort(torId);
      await this.markCohorts(before, await this.deps.repo.statsRecord(torId));
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
    await this.markCohorts(await this.deps.repo.statsRecord(torId));
    await this.deps.queue.enqueue(torId);
  }

  /** Rejection restricts access and records the reason; the document survives. */
  async reject(torId: string, reason: string, actor: string): Promise<void> {
    const before = await this.deps.repo.reject(torId, reason, actor);
    await this.deps.history.record(torId, {
      from: "published",
      to: "restricted",
      actor,
      source: "admin",
      reason,
    });
    await this.markCohorts(before);
  }

  private async markCohorts(...records: Array<{ cohort?: CohortKey }>): Promise<void> {
    if (!this.deps.stats) return;
    await this.deps.stats.markCohortsDirty(records.flatMap((record) => (
      record.cohort ? windowKeysFor(record.cohort, this.deps.stats!.windowMonths) : []
    )));
  }

  private async updateCohort(torId: string): Promise<void> {
    if (!this.deps.stats) return;
    const record = await this.deps.repo.statsRecord(torId);
    const category = record.fields.category?.value;
    const derived = cohortFor({
      category: typeof category === "string" ? category : "",
      announcedAt: record.announcedAt,
      createdAt: record.createdAt,
    }, this.deps.stats.timezone);
    await this.deps.repo.setCohort(torId, derived?.cohort, derived?.cohortDateSource);
  }
}
