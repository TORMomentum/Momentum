/** One recognised word: its character range in the page text and its box on the page. */
export interface OcrToken {
  /** Offsets into `OcrResult.text`, end exclusive. */
  start: number;
  end: number;
  /** `[x0, y0, x1, y1]` as fractions of the page (0..1), so a box survives any rendering size. */
  box: [number, number, number, number];
}

export interface OcrPage {
  /** 1-based. */
  number: number;
  tokens: OcrToken[];
  /** The page rendered as an image, when the provider returned one. */
  image?: { bytes: Buffer; contentType: string };
}

export interface OcrResult {
  text: string;
  pages: OcrPage[];
  /** The processor that read the document, for provenance (NFR-F6). */
  model: string;
}

/**
 * Reads a document and says where each word is (FR-B-1, TOR-128). Used only to
 * locate values the extractor already read; its text never reaches the extractor.
 * Throws `ExtractionError` on failure.
 */
export interface Ocr {
  read(input: { bytes: Buffer; contentType: string }): Promise<OcrResult>;
}
