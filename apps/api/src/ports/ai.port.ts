import type { EvaluationCriterion, EvaluationMethod, RequiredDocument } from "@tor-radar/shared";

export type TorStatus ="announced" | "closed" | "awarded" | "cancelled";

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
  /** Where the work is done, as written; absent from a model answer that predates it. */
  workLocation?: RawField;
  /** How bids are scored; present only when the model was asked (TOR-209). */
  evaluationMethod?: RawField<EvaluationMethod>;
  /** The scored criteria with their weights in percent; empty for a lowest-price evaluation (TOR-209). */
  evaluationWeights?: RawField<EvaluationCriterion[]>;
  /** The documents and certificates the bidder must show (TOR-210). `certification` is set by grading, not the model. */
  requiredDocuments?: RawField<RequiredDocument[]>;
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
/**
 * What a winner announcement states (TOR-221): who won, at what price, and when it was announced. Names of the
 * officials who signed it are never asked for (FR-B-5).
 */
export interface RawAward {
  /** The winning bidder as named, e.g. "ห้างหุ้นส่วนจำกัด ๘๕สุรินทร์". */
  winner: RawField;
  /** The winning price in baht, VAT included, as the announcement states it. */
  price: RawField<number>;
  /** The announcement's date, ISO `YYYY-MM-DD` in the Gregorian calendar. */
  announcementDate: RawField;
  modelVersion: string;
  /** Tokens the request used, when the provider says: what a run of them costs (TOR-221). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface Ai {
  extract(input: ExtractionInput): Promise<RawExtraction>;
  /** Reads a winner announcement (TOR-221). Optional so a test double for TORs need not implement it. */
  extractAward?(input: Pick<ExtractionInput, "bytes" | "contentType">): Promise<RawAward>;
}
