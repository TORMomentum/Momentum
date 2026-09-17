import type { Provenance } from "@tor-radar/shared";
import type { Ai } from "../../ports/ai.port.js";
import type { Storage } from "../../ports/storage.port.js";
import { hasTextLayer } from "../../lib/pdf-text.js";
import { grade } from "./extraction.grading.js";
import { IMPLAUSIBLE_DEADLINE, type ExtractionRepository } from "./extraction.repository.js";

export interface ExtractionConfig {
  model: string;
  tLow: number;
  tHigh: number;
  thresholdsVersion: string;
  budgetMinThb: number;
  budgetMaxThb: number;
}

export interface ExtractionServiceDeps {
  storage: Storage;
  ai: Ai;
  repo: ExtractionRepository;
  config: ExtractionConfig;
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The body of the worker's ExtractionHandler (spec §5.1): fetch the stored
 * document, OCR + extract (FR-B-1, FR-B-2), grade against §4.2.1 (FR-B-3), and
 * write the record once. Any failure throws - the worker retries, and after
 * JOB_MAX_ATTEMPTS marks the record failed with the raw document retained
 * (NFR-S5). Nothing is persisted before the whole extraction succeeds.
 */
export class ExtractionService {
  constructor(private readonly deps: ExtractionServiceDeps) {}

  run = async (torId: string): Promise<void> => {
    const target = await this.deps.repo.load(torId);
    const { storageKey, contentType, knownFields } = target;
    const bytes = await collect(await this.deps.storage.getStream(storageKey));
    const textLayer = hasTextLayer(bytes, contentType);

    const raw = await this.deps.ai.extract({ bytes, contentType });
    // The source's own date wins: a TOR document rarely states when it was published.
    const announcedAt = target.sourceAnnouncedAt ?? parseDate(raw.announcementDate.value);

    const { fields, confidenceLevel, unverified, reviewReasons } = grade(raw, {
      hasTextLayer: textLayer,
      announcedAt,
      tLow: this.deps.config.tLow,
      tHigh: this.deps.config.tHigh,
      budgetMinThb: this.deps.config.budgetMinThb,
      budgetMaxThb: this.deps.config.budgetMaxThb,
      knownFields,
    });

    const provenance: Provenance = {
      ocrModel: this.deps.config.model,
      extractModel: this.deps.config.model,
      modelVersion: raw.modelVersion,
      extractedAt: new Date().toISOString(),
      thresholdsVersion: this.deps.config.thresholdsVersion,
    };

    // A TOR rarely states its submission deadline; its project's invitation to
    // bid does (spec 2026-09-16 e-GP project linking). Whichever of the two is
    // extracted second makes the link.
    const projectId = target.sourceProject?.projectId;
    let publishedFields = fields;
    if (projectId && target.documentType === "tor") {
      const linked = await this.deps.repo.findInvitationDeadline(projectId);
      if (linked) {
        publishedFields = { ...fields, deadline: { ...linked.field, fromDocument: linked.invitationId } };
      }
    }

    await this.deps.repo.writeExtraction(torId, {
      fields: publishedFields,
      announcedAt,
      confidenceLevel,
      unverified,
      reviewReasons,
      hasTextLayer: textLayer,
      provenance,
    });

    // A deadline before the invitation's own announcement is a misreading — on a
    // scan, ๙ read as ๕ turns 2569 into 2565. Grading already queued it for a
    // reviewer; it must not travel to the TOR as if it were a date.
    const deadlinePlausible = !reviewReasons.includes(IMPLAUSIBLE_DEADLINE);
    if (projectId && target.documentType === "invitation" && fields.deadline.value !== null && deadlinePlausible) {
      await this.deps.repo.linkDeadline(projectId, { invitationId: torId, field: fields.deadline });
    }
  };
}
