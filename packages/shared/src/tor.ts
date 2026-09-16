export type IntakeRoute = "upload" | "url" | "api";

export type PipelineState = "queued" | "extracting" | "published" | "failed";

export interface SourceRef {
  route: IntakeRoute;
  url?: string;
  submittedBy: string;
  submittedAt: string;
  /** As submitted, percent-free and unencoded. Used for the download filename (spec §5.3). */
  originalFilename?: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";

/** Every extracted value carries its own confidence and provenance (NFR-F6). */
export interface ExtractedField<T = string> {
  /** Verbatim from the document, displayed unchanged (NFR-F7). */
  raw: string;
  /** Normalised: Arabic digits, ISO date, plain number. `null` when not stated. */
  value: T | null;
  confidence: number;
  /** true only once the field reaches the clean tier or an admin approves it (SRS §4.2.1). */
  verified: boolean;
  /** A short quote from the document supporting the value, for the review queue. */
  evidence?: string;
  /** budget only. */
  currency?: string;
  /** qualifications only: taxonomy tags mapped from `value` (FR-B-4). */
  tags?: string[];
}

/** Extraction provenance recorded on every AI-produced record (NFR-F6). */
export interface Provenance {
  ocrModel: string;
  extractModel: string;
  modelVersion: string;
  extractedAt: string;
  thresholdsVersion: string;
}

/** The nine FR-B-2 fields, plus three cheap extras the detail page can show. */
export interface TorFields {
  title: ExtractedField;
  agency: ExtractedField;
  budget: ExtractedField<number>;
  category: ExtractedField;
  scopeSummary: ExtractedField;
  qualifications: ExtractedField<string[]>;
  deadline: ExtractedField;
  contact: ExtractedField;
  torStatus: ExtractedField<"announced" | "closed" | "awarded" | "cancelled">;
  procurementMethod?: ExtractedField;
  referenceNo?: ExtractedField;
}

/** Why a record entered the review queue (FR-G-1), as stable machine keys. */
export type ReviewReason = string;

export interface TorRecord {
  id: string;
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: SourceRef[];
  pipeline: { state: PipelineState; attempts: number; failedReason?: string };
  /** Empty unless the record is queued for review. */
  reviewReasons?: ReviewReason[];
  fields: Partial<TorFields>;
  announcedAt: string | null;
  sourceUrl: string | null;
  confidenceLevel?: ConfidenceLevel;
  unverified: boolean;
  /** Digital PDF text layer vs an OCR'd scan/photo - drives grading (SRS §4.2.1). */
  hasTextLayer?: boolean;
  provenance?: Provenance;
  access: { restricted: boolean; reason?: string };
  duplicateOf: string | null;
  createdAt: string;
  updatedAt: string;
}
