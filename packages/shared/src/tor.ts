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
  /**
   * "source" when the source system published the value (the BMA e-GP API, say)
   * rather than a model reading it from the document. Such a value is not
   * AI-produced (NFR-F6), and extraction never overwrites it.
   */
  origin?: "source";
  /**
   * The record this value was read from, when it is not this record's own
   * document — e.g. a TOR's deadline read from its project's invitation to bid.
   */
  fromDocument?: string;
}

/** What a stored document is. A record without one is a TOR. */
export type DocumentType = "tor" | "invitation";

/** The source system's project a document belongs to; every document of one project shares it. */
/** A stored file that belongs to a TOR without being a record of its own — an annex read with it. */
export interface StoredAnnex {
  key: string;
  contentType: string;
  bytes: number;
  /** As the source package named it, e.g. Attach_TOR_2.pdf. */
  filename?: string;
}

export interface SourceProject {
  /** bma-egp: egp2.bangkok.go.th, a UUID projectId. national-egp: Thailand's e-GP, an 11-digit project number. */
  system: "bma-egp" | "national-egp";
  projectId: string;
  projectNumber?: string;
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
  /**
   * Checklist C3: how many concrete requirements the scope states — list items, specification-table
   * rows, bill-of-quantities lines — across the TOR and the annexes read with it, as the model counted
   * them (approximate for a very long scope). Absent from records extracted before it was asked.
   */
  scopeItems?: ExtractedField<number>;
  /** Checklist C3: where the scope is — in what was read, in an annex not read, or nowhere. */
  scopeLocation?: ExtractedField<"in_documents" | "in_annex_not_provided" | "none">;
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
  /** "source" when the source system stated the announcement date, not the document. */
  announcedAtOrigin?: "source";
  /** Absent means "tor". An invitation is a supporting document and is never listed publicly. */
  documentType?: DocumentType;
  sourceProject?: SourceProject;
  /** The TOR's other files — annexes, bills of quantities — read together with it by extraction. */
  annexes?: StoredAnnex[];
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
