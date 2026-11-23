import { SUPPORTING_DOCUMENT_TYPES } from "@tor-radar/shared";
import { ObjectId, type Db, type WithId } from "mongodb";
import type { ProjectStageEntry } from "@tor-radar/shared";
import { torEvents, tors, type TorDocument } from "../../core/db.js";

/** What a pass needs from a claimed record. */
export type ClaimedRecord = Pick<WithId<TorDocument>, "_id" | "sourceProject">;

/** A public TOR record of a project, as the pass writes it. */
export type ProjectRecord = Pick<WithId<TorDocument>, "_id" | "stage" | "announcedAt" | "createdAt">;

/** Public TOR records of a project: the ones that carry its stages (spec 2026-11-23-project-stages decision 2). */
function publicTorsOf(system: string, projectId: string) {
  return {
    "sourceProject.system": system,
    "sourceProject.projectId": projectId,
    documentType: { $nin: [...SUPPORTING_DOCUMENT_TYPES] },
    duplicateOf: null,
  };
}

/** Reads and writes for the stages worker (TOR-205). Only this file touches the database for it. */
export class StagesRepository {
  constructor(private readonly db: Db) {}

  /**
   * Gives every record of `system` that has never been read a due time of `now`, once. Records added later
   * are given one by their import; this catches the corpus that predates the worker.
   */
  async seedDue(system: string, now: Date): Promise<number> {
    const result = await tors(this.db).updateMany(
      {
        "sourceProject.system": system,
        documentType: { $nin: [...SUPPORTING_DOCUMENT_TYPES] },
        duplicateOf: null,
        stagesCheckedAt: { $exists: false },
        stagesDueAt: { $exists: false },
      },
      { $set: { stagesDueAt: now } },
    );
    return result.modifiedCount;
  }

  /**
   * Claims the record due longest, moving its due time to `holdUntil` in the same atomic write, so two
   * workers never read one project at once and a pass that crashes is picked up again after the hold.
   */
  async claimNext(system: string, now: Date, holdUntil: Date): Promise<ClaimedRecord | null> {
    return tors(this.db).findOneAndUpdate(
      { "sourceProject.system": system, stagesDueAt: { $type: "date", $lte: now } },
      { $set: { stagesDueAt: holdUntil } },
      { sort: { stagesDueAt: 1 }, projection: { _id: 1, sourceProject: 1 } },
    );
  }

  async projectRecords(system: string, projectId: string): Promise<ProjectRecord[]> {
    return tors(this.db)
      .find(publicTorsOf(system, projectId), { projection: { _id: 1, stage: 1, announcedAt: 1, createdAt: 1 }, sort: { createdAt: 1, _id: 1 } })
      .toArray();
  }

  /** The project's invitation record, if we hold one: what a D0 stage links to. */
  async invitationOf(system: string, projectId: string): Promise<string | null> {
    const invitation = await tors(this.db).findOne(
      { "sourceProject.system": system, "sourceProject.projectId": projectId, documentType: "invitation", duplicateOf: null },
      { projection: { _id: 1 }, sort: { createdAt: 1, _id: 1 } },
    );
    return invitation ? invitation._id.toString() : null;
  }

  /** The project's winner announcement record, if we hold one: what a W0 or W2 stage links to (TOR-221). */
  async awardOf(system: string, projectId: string): Promise<string | null> {
    const award = await tors(this.db).findOne(
      { "sourceProject.system": system, "sourceProject.projectId": projectId, documentType: "award", duplicateOf: null },
      { projection: { _id: 1 }, sort: { createdAt: 1, _id: 1 } },
    );
    return award ? award._id.toString() : null;
  }

  /**
   * Stores what the source listed. A changed stage is written to the audit trail first (FR-E-5), so a
   * record never shows a stage the trail has not heard of — the same order HistoryRepository keeps.
   */
  async write(
    record: ProjectRecord,
    update: { stageHistory: ProjectStageEntry[]; stage: TorDocument["stage"] | null; checkedAt: Date; dueAt: Date | null },
    event: { source: string; actor: string } | null,
  ): Promise<void> {
    if (event && update.stage && update.stage.code !== record.stage?.code) {
      await torEvents(this.db).insertOne({
        torId: record._id.toString(),
        kind: "stage",
        from: record.stage?.code ?? null,
        to: update.stage.code,
        at: update.checkedAt,
        actor: event.actor,
        source: event.source,
      });
    }
    await tors(this.db).updateOne(
      { _id: new ObjectId(record._id) },
      {
        $set: {
          stageHistory: update.stageHistory,
          stagesCheckedAt: update.checkedAt,
          stagesDueAt: update.dueAt,
          ...(update.stage ? { stage: update.stage } : {}),
        },
      },
    );
  }
}
