import { ObjectId, type Db } from "mongodb";
import type { ConfidenceLevel, DocumentType, ExtractedField, Provenance, SourceProject, TorFields, StoredAnnex } from "@tor-radar/shared";
import { tors, type TorDocument } from "../../core/db.js";
import type { CohortKey } from "../stats/cohort.js";
import { NotFoundError } from "../../core/errors.js";

export interface ExtractionTarget {
  storageKey: string;
  contentType: string;
  /** The TOR's annexes, read with it within the request's size budget. */
  annexes: StoredAnnex[];
  /** Fields the source already stated at intake; extraction keeps them as they are. */
  knownFields: Partial<TorFields>;
  /** The source's publication date, when it stated one; preferred over the document's. */
  sourceAnnouncedAt: Date | null;
  documentType: DocumentType;
  sourceProject: SourceProject | null;
  createdAt: Date;
}

/** The grading reason for a deadline that falls before its document's announcement. */
export const IMPLAUSIBLE_DEADLINE = "deadline-before-announcement";

/** A deadline read from a project's invitation to bid, and which record it came from. */
export interface LinkedDeadline {
  invitationId: string;
  field: ExtractedField;
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
      {
        projection: {
          storage: 1,
          fields: 1,
          announcedAt: 1,
          announcedAtOrigin: 1,
          documentType: 1,
          sourceProject: 1,
          createdAt: 1,
          annexes: 1,
        },
      },
    );
    if (!doc) throw new NotFoundError(`tor ${torId} not found`);

    // Only origin "source" survives a (re-)extraction. Everything else was a
    // model's reading, and reading the document again is the point.
    const knownFields: Partial<TorFields> = {};
    for (const [name, field] of Object.entries(doc.fields ?? {})) {
      if (field?.origin === "source") {
        (knownFields as Record<string, unknown>)[name] = field;
      }
    }

    return {
      storageKey: doc.storage.key,
      contentType: doc.storage.contentType,
      annexes: doc.annexes ?? [],
      knownFields,
      sourceAnnouncedAt: doc.announcedAtOrigin === "source" ? doc.announcedAt : null,
      documentType: doc.documentType ?? "tor",
      sourceProject: doc.sourceProject ?? null,
      createdAt: doc.createdAt,
    };
  }

  /** The deadline an invitation of this project has already yielded, if any. */
  async findInvitationDeadline(projectId: string): Promise<LinkedDeadline | null> {
    const invitation = await tors(this.db).findOne(
      {
        documentType: "invitation",
        "sourceProject.projectId": projectId,
        "fields.deadline.value": { $ne: null },
        // Never a deadline grading found implausible (see linkDeadline's caller).
        reviewReasons: { $ne: IMPLAUSIBLE_DEADLINE },
        "access.restricted": { $ne: true },
      },
      { sort: { updatedAt: -1 }, projection: { "fields.deadline": 1 } },
    );
    if (!invitation?.fields.deadline) return null;
    return { invitationId: invitation._id.toString(), field: invitation.fields.deadline };
  }

  /**
   * Puts an invitation's deadline on every TOR of its project, marked with the
   * invitation it came from (NFR-F6). Covers the TOR extracted before its
   * invitation; the other order is `findInvitationDeadline`.
   */
  async linkDeadline(projectId: string, deadline: LinkedDeadline): Promise<void> {
    await tors(this.db).updateMany(
      { "sourceProject.projectId": projectId, documentType: { $ne: "invitation" } },
      {
        $set: {
          "fields.deadline": { ...deadline.field, fromDocument: deadline.invitationId },
          updatedAt: new Date(),
        },
      },
    );
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
