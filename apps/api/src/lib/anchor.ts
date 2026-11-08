import type { FieldAnchor } from "@tor-radar/shared";
import type { OcrResult } from "../ports/ocr.port.js";

const BLANK = /\s/;

/** The text with every whitespace character removed, and where each kept character sat originally. */
function squeeze(text: string): { text: string; at: number[] } {
  const at: number[] = [];
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (BLANK.test(text[i]!)) continue;
    out += text[i];
    at.push(i);
  }
  return { text: out, at };
}

/** Whether two boxes share more than half the height of the shorter one: the same line of text. */
function sameLine(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return overlap > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]);
}

/**
 * Where `quote` was read: the first place it appears in the OCR text, as one
 * box per line on the page it starts on. Whitespace is ignored on both sides,
 * because OCR and the model disagree about spaces in Thai more than anything
 * else. Returns null when the text is not found; it never guesses a nearby one.
 */
export function locate(ocr: OcrResult, quote: string): FieldAnchor | null {
  const needle = squeeze(quote).text;
  if (needle === "") return null;
  const hay = squeeze(ocr.text);
  const found = hay.text.indexOf(needle);
  if (found < 0) return null;
  const start = hay.at[found]!;
  const end = hay.at[found + needle.length - 1]! + 1;

  for (const page of ocr.pages) {
    const hits = page.tokens.filter((token) => token.start < end && token.end > start);
    if (hits.length === 0) continue;
    const boxes: FieldAnchor["boxes"] = [];
    for (const { box } of hits) {
      const last = boxes[boxes.length - 1];
      if (last && sameLine(last, box)) {
        boxes[boxes.length - 1] = [Math.min(last[0], box[0]), Math.min(last[1], box[1]), Math.max(last[2], box[2]), Math.max(last[3], box[3])];
      } else {
        boxes.push([...box]);
      }
    }
    return { page: page.number, boxes };
  }
  return null;
}
