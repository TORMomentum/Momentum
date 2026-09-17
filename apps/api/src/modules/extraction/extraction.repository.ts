import { ObjectId, type Db } from "mongodb";
import type { ConfidenceLevel, Provenance, TorFields } from "@tor-radar/shared";
import { tors, type TorDocument } from "../../core/db.js";
import type { CohortKey } from "../stats/cohort.js";
import { NotFoundError } from "../../core/errors.js";

export interface ExtractionTarget {
  storageKey: string;
  contentType: string;
  createdAt: Date;
}

export interface ExtractionResult {
  fields: TorFields;
  announcedAt: Date | null;
  confidenceLevel: ConfidenceLevel;
  unverified: boolean;
  /** Why a reviewer is needed — empty unless the record graded low (FR-G-1). */
  reviewReasons: string[];
  hasTextLayer: boolean;
  provenance: Provenance;
  cohort?: CohortKey;
  cohortDateSource?: "announced" | "intake";
}

/** The only extraction code that touches MongoDB. */
export class ExtractionRepository {
  constructor(private readonly db: Db) {}

  async load(torId: string): Promise<ExtractionTarget> {
    const doc = await tors(this.db).findOne(
      { _id: new ObjectId(torId) },
      { projection: { storage: 1, createdAt: 1 } },
    );
    if (!doc) throw new NotFoundError(`tor ${torId} not found`);
    return { storageKey: doc.storage.key, contentType: doc.storage.contentType, createdAt: doc.createdAt };
  }

  /**
   * The single write for a record's extraction (spec §5.1): fields, the grade,
   * and provenance land together, or not at all. The worker moves
   * `pipeline.state` to `published` afterwards; this method does not touch it.
   */
  async writeExtraction(torId: string, result: ExtractionResult): Promise<TorDocument | null> {
    return tors(this.db).findOneAndUpdate(
      { _id: new ObjectId(torId) },
      {
        $set: {
          fields: result.fields,
          announcedAt: result.announcedAt,
          confidenceLevel: result.confidenceLevel,
          unverified: result.unverified,
          reviewReasons: result.reviewReasons,
          hasTextLayer: result.hasTextLayer,
          provenance: result.provenance,
          ...(result.cohort ? { cohort: result.cohort, cohortDateSource: result.cohortDateSource } : {}),
          updatedAt: new Date(),
        },
        ...(result.cohort ? {} : { $unset: { cohort: "", cohortDateSource: "" } }),
      },
      { returnDocument: "before" },
    );
  }
}
