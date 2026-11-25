import { SUPPORTING_DOCUMENT_TYPES } from "@tor-radar/shared";
import type { Db } from "mongodb";
import { tors } from "../../core/db.js";
import { AWARD_STAGE_CODES } from "../../sources/national-egp/stages.js";

const SYSTEM = "national-egp";

/** A project with a winner stage and no award record yet, and the day that stage was published. */
export interface AwardTarget {
  projectId: string;
  /** The winner stage's day, `YYYY-MM-DD`: the announcement's own publication date. */
  announcedOn: string | null;
}

/** Reads for the e-GP collector (spec 2026-11-25-scheduled-collector). Only this file touches the database for it. */
export class CollectorRepository {
  constructor(private readonly db: Db) {}

  /**
   * The source system that already collected this e-GP number, if another one did. A Bangkok project is
   * published on egp2.bangkok.go.th and on national e-GP under one number; collecting it twice would list
   * it twice and leave this source's invitation unable to link to that TOR.
   */
  async collectedElsewhere(projectNumber: string): Promise<string | null> {
    const existing = await tors(this.db).findOne(
      { "sourceProject.projectNumber": projectNumber, "sourceProject.system": { $ne: SYSTEM } },
      { projection: { "sourceProject.system": 1 } },
    );
    return existing?.sourceProject?.system ?? null;
  }

  /** Whether a record of this kind is held for the project: its TOR, or its invitation (decision 5). */
  async holds(projectId: string, kind: "tor" | "invitation"): Promise<boolean> {
    const documentType = kind === "invitation" ? "invitation" : { $nin: [...SUPPORTING_DOCUMENT_TYPES] };
    const found = await tors(this.db).findOne(
      { "sourceProject.system": SYSTEM, "sourceProject.projectId": projectId, documentType },
      { projection: { _id: 1 } },
    );
    return found !== null;
  }

  /**
   * Records first created since `since` whose first source reference names `submittedBy` (decision 6). A
   * document submitted again is linked onto the stored record as a later reference, so it is not counted.
   */
  async createdSince(submittedBy: string, since: Date): Promise<number> {
    return tors(this.db).countDocuments({ "sourceRefs.0.submittedBy": submittedBy, createdAt: { $gte: since } });
  }

  /**
   * Awarded projects with a winner stage and no award record yet, newest announcement first (TOR-221):
   * national e-GP TOR records whose stage table lists `W0` or `W2`. `projects` narrows to named ones.
   */
  async awardTargets(limit: number, projects: readonly string[] = []): Promise<AwardTarget[]> {
    if (limit < 1) return [];
    const collected = new Set(
      (await tors(this.db).distinct("sourceProject.projectId", { "sourceProject.system": SYSTEM, documentType: "award" })) as string[],
    );
    const records = await tors(this.db)
      .find(
        {
          "sourceProject.system": SYSTEM,
          documentType: { $nin: ["invitation", "award"] },
          duplicateOf: null,
          "stageHistory.code": { $in: [...AWARD_STAGE_CODES] },
          ...(projects.length > 0 ? { "sourceProject.projectId": { $in: [...projects] } } : {}),
        },
        { projection: { "sourceProject.projectId": 1, stageHistory: 1 } },
      )
      .toArray();

    const byProject = new Map<string, AwardTarget>();
    for (const record of records) {
      const projectId = record.sourceProject?.projectId;
      if (!projectId || collected.has(projectId) || byProject.has(projectId)) continue;
      const winner = (record.stageHistory ?? []).find((stage) => AWARD_STAGE_CODES.includes(stage.code));
      byProject.set(projectId, { projectId, announcedOn: winner?.on ?? null });
    }
    return [...byProject.values()].sort((a, b) => (b.announcedOn ?? "").localeCompare(a.announcedOn ?? "")).slice(0, limit);
  }
}
