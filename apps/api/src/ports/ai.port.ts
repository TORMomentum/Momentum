export type TorStatus = "announced" | "closed" | "awarded" | "cancelled";

/** One extracted field before grading: the model's answer, its own confidence, and its evidence. */
export interface RawField<T = string> {
  /** Verbatim from the document, shown to the reader unchanged (NFR-F7). */
  raw: string;
  /** Normalised - Arabic digits, ISO date, plain number. `null` when the document does not state it. */
  value: T | null;
  /** The model's self-reported confidence, 0..1. Not trusted on its own (BENCHMARK.md). */
  confidence: number;
  /** A short quote the model cites for this value, or why it found nothing. */
  evidence: string;
}

/**
 * The nine FR-B-2 fields plus three the benchmark also extracts cheaply and the
 * detail page (FR-E-4) can show. `announcementDate` becomes the record's
 * `announcedAt`; the other two are stored but never anomaly- or match-gated.
 */
export type ScopeLocation = "in_documents" | "in_annex_not_provided" | "none";

export interface RawExtraction {
  title: RawField;
  agency: RawField;
  budget: RawField<number>;
  category: RawField;
  scopeSummary: RawField;
  /** Concrete requirements in the scope (checklist C3); absent from a model answer that predates it. */
  scopeItems?: RawField<number>;
  /** Where the scope is: in what was read, in an annex not provided, or nowhere (checklist C3). */
  scopeLocation?: RawField<ScopeLocation>;
  qualifications: RawField<string[]>;
  deadline: RawField;
  contact: RawField;
  status: RawField<TorStatus>;
  announcementDate: RawField;
  procurementMethod: RawField;
  referenceNo: RawField;
  /** The resolved model identifier the provider returned, for provenance (NFR-F6). */
  modelVersion: string;
}

export interface ExtractionInput {
  bytes: Buffer;
  contentType: string;
  /**
   * The publish date the source system states for this document, `YYYY-MM-DD`.
   * A check on how dates are read — a scan's ๙ and ๕ look alike, and misread
   * they move a deadline years into the past — never a value to extract.
   */
  sourcePublishedOn?: string;
  /** The document's annexes, read with it — each labelled by its file name. */
  attachments?: Array<{ bytes: Buffer; contentType: string; name: string }>;
  /** Annexes the document has that did not fit in this request, so the model knows it has not seen all. */
  annexesLeftOut?: number;
}

/**
 * OCR + field extraction (FR-B-1, FR-B-2). The port speaks documents and fields;
 * the adapter knows the model. Throws `ExtractionError` (retryable) or
 * `DocumentUnreadableError` (terminal) on failure - never a partial result.
 */
export interface Ai {
  extract(input: ExtractionInput): Promise<RawExtraction>;
}
