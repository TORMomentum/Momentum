import type { DocumentType, SourceProject, StoredAnnex, TorFields } from "@tor-radar/shared";
import { sha256 } from "../../lib/hash.js";
import { storageKeyFor } from "../../lib/storage-key.js";
import { detectMimeType } from "../../lib/file-type.js";
import { BadRequestError, PayloadTooLargeError } from "../../core/errors.js";
import type { Storage } from "../../ports/storage.port.js";
import type { Queue } from "../../ports/queue.port.js";
import type { IntakeRepository, SourceRefInput } from "./intake.repository.js";
import { cohortFor } from "../stats/cohort.js";

export interface SubmitSource {
  route: "upload" | "url" | "api";
  url?: string;
  submittedBy: string;
  /** What the submitter called the file, when the route knows it. */
  filename?: string;
  /**
   * Fields the caller already knows authoritatively, because the source published them rather
   * than the document merely containing them (FR-B-2). Recorded verified at full confidence, so
   * §4.2.1 never marks them an unverified extraction. Absent for a plain upload, where the
   * document is all there is.
   */
  knownFields?: Partial<TorFields>;
  /** What the source says this document is and when it published it. */
  context?: SourceContext;
  /**
   * The document's other files — a TOR's annexes and bills of quantities — stored as originals and
   * recorded on it, so extraction reads them together. Never records of their own.
   */
  annexes?: Array<{ bytes: Buffer; filename?: string }>;
}

/**
 * What a source states about a document beyond its fields: which project it
 * belongs to, what kind of document it is, and its publication date. Absent for
 * a plain upload.
 */
export interface SourceContext {
  sourceProject?: SourceProject;
  documentType?: DocumentType;
  /** The source's publication date, as a calendar day. Extraction never overwrites it. */
  announcedAt?: Date;
  /** Stored annexes; set by submit from `SubmitSource.annexes`. */
  annexes?: StoredAnnex[];
}

export interface SubmitResult {
  torId: string;
  duplicate: boolean;
  state: "queued";
}

export interface IntakeLimits {
  allowedMimeTypes: string[];
  maxUploadBytes: number;
}

export class IntakeService {
  constructor(
    private readonly storage: Storage,
    private readonly queue: Queue,
    private readonly repository: IntakeRepository,
    private readonly limits: IntakeLimits,
    private readonly stats?: { timezone: string },
  ) {}

  /**
   * The single entry point for all three intake routes (FR-A-1).
   *
   * The order is fixed and load-bearing: store the bytes, insert the record,
   * then enqueue. A crash between steps leaves an orphaned object in storage,
   * which is harmless, rather than a job pointing at a record that does not
   * exist. The reconciler in Task 11 covers the remaining gap, where the record
   * lands but the enqueue does not.
   */
  private async storeAnnexes(annexes: Array<{ bytes: Buffer; filename?: string }>): Promise<StoredAnnex[]> {
    const stored: StoredAnnex[] = [];
    for (const annex of annexes) {
      if (annex.bytes.byteLength > this.limits.maxUploadBytes) continue;
      const contentType = detectMimeType(annex.bytes);
      if (!contentType || !this.limits.allowedMimeTypes.includes(contentType)) continue;
      const object = await this.storage.putIfAbsent(
        storageKeyFor(sha256(annex.bytes), contentType, new Date()),
        annex.bytes,
        contentType,
        { originalFilename: annex.filename, route: "url" },
      );
      stored.push({ key: object.key, contentType, bytes: object.bytes, ...(annex.filename ? { filename: annex.filename } : {}) });
    }
    return stored;
  }

  async submit(bytes: Buffer, source: SubmitSource): Promise<SubmitResult> {
    if (bytes.byteLength > this.limits.maxUploadBytes) {
      throw new PayloadTooLargeError("Document exceeds the maximum accepted size");
    }

    // The declared content type and the file extension are attacker-controlled,
    // so the bytes decide what this document actually is (spec section 5.6).
    const contentType = detectMimeType(bytes);
    if (!contentType || !this.limits.allowedMimeTypes.includes(contentType)) {
      throw new BadRequestError("Unsupported document type");
    }

    const contentHash = sha256(bytes);
    // Annexes are originals too: same type check, same size cap, same immutable content-addressed
    // storage. One that is not an accepted type, or too big, is left out — not the whole document.
    const annexes = await this.storeAnnexes(source.annexes ?? []);
    if (annexes.length > 0) source = { ...source, context: { ...source.context, annexes } };
    const sourceRef: SourceRefInput = {
      route: source.route,
      url: source.url,
      submittedBy: source.submittedBy,
      submittedAt: new Date(),
      ...(source.filename ? { originalFilename: source.filename } : {}),
    };

    const existing = await this.repository.findByHash(contentHash);
    if (existing) {
      await this.repository.appendSourceRef(existing.id, sourceRef);
      // A source can say more on a later visit than on the first — this is how a
      // record ingested before project linking gains its project.
      if (source.context) await this.repository.attachSourceContext(existing.id, source.context);
      await this.repository.recordIntake(sourceRef.submittedAt);
      return { torId: existing.id, duplicate: true, state: "queued" };
    }

    // The key is derived from the hash, never from the filename: content
    // addressing is what makes an overwrite impossible and dedupe exact.
    const storageKey = storageKeyFor(contentHash, contentType, sourceRef.submittedAt);
    const storedObject = await this.storage.putIfAbsent(storageKey, bytes, contentType, {
      originalFilename: source.filename,
      route: source.route,
    });

    let torId: string;
    try {
      const category = source.knownFields?.category?.value;
      const cohort = this.stats && typeof category === "string"
        ? cohortFor(
            // The source's publication date, when it states one, places the record in its real month.
            { category, announcedAt: source.context?.announcedAt ?? null, createdAt: sourceRef.submittedAt },
            this.stats.timezone,
          )
        : null;
      torId = await this.repository.insert(
        contentHash,
        storedObject,
        sourceRef,
        source.knownFields,
        source.context,
        cohort,
      );
    } catch (error) {
      // The unique index is the real dedupe guarantee (FR-A-3): two callers can
      // both pass the findByHash check above, and the loser arrives here.
      if ((error as { code?: number }).code === 11000) {
        const winner = await this.repository.findByHash(contentHash);
        if (winner) {
          await this.repository.appendSourceRef(winner.id, sourceRef);
          return { torId: winner.id, duplicate: true, state: "queued" };
        }
      }
      throw error;
    }

    await this.repository.recordIntake(sourceRef.submittedAt);
    await this.queue.enqueue(torId);
    return { torId, duplicate: false, state: "queued" };
  }
}
