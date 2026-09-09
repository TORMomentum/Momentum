import { inflateSync } from "node:zlib";

/**
 * Whether a document carries a real text layer (a digital PDF) rather than being
 * a scan or a photo. The §4.2.1 grading treats a budget or a date read off an
 * OCR'd image more cautiously than one read from selectable text - the TOR-18
 * benchmark's failures were all numeric mis-reads on scans.
 *
 * Deterministic and dependency-free: inflate the PDF's Flate-compressed content
 * streams and count text-showing operators (`Tj` / `TJ`). A digital PDF has
 * hundreds; a single-image scan has none. Anything that is not a PDF (an image
 * upload) has no text layer by definition.
 */
export function hasTextLayer(bytes: Buffer, contentType: string): boolean {
  if (contentType !== "application/pdf") return false;

  let operators = 0;
  // `stream` ... `endstream` blocks; each preceding dictionary usually names the filter.
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(bytes.toString("latin1"))) !== null) {
    const start = match.index + match[0].length;
    const end = bytes.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = bytes.subarray(start, end);
    let text: string;
    try {
      text = inflateSync(chunk).toString("latin1");
    } catch {
      continue; // an image or a raw stream - not a Flate-compressed content stream
    }
    // A content stream draws text between `BT` and `ET`. Scanning a stream
    // without one avoids counting `Tj`/`TJ` byte sequences inside decoded image data.
    if (!text.includes("BT")) continue;
    operators += (text.match(/(?:^|[\s>)\]])(Tj|TJ)(?=[\s(<[])/g) ?? []).length;
    if (operators >= TEXT_LAYER_MIN_OPERATORS) return true;
  }
  return operators >= TEXT_LAYER_MIN_OPERATORS;
}

/** A page of body text is dozens of show operators; a stray label on a scan is a handful. */
const TEXT_LAYER_MIN_OPERATORS = 20;
