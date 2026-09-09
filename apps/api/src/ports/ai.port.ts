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
export interface RawExtraction {
  title: RawField;
  agency: RawField;
  budget: RawField<number>;
  category: RawField;
  scopeSummary: RawField;
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
}

/**
 * OCR + field extraction (FR-B-1, FR-B-2). The port speaks documents and fields;
 * the adapter knows the model. Throws `ExtractionError` (retryable) or
 * `DocumentUnreadableError` (terminal) on failure - never a partial result.
 */
export interface Ai {
  extract(input: ExtractionInput): Promise<RawExtraction>;
}
