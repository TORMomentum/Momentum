import type { ExtractedField, FieldAnchor, TorFields } from "@tor-radar/shared";
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

/** A span of the OCR text, as character offsets: `start` inclusive, `end` exclusive. */
interface Span { start: number; end: number }

/**
 * Where `quote` sits in the OCR text, but only when it sits in exactly one
 * place (inside `scope`, when given). Whitespace is ignored on both sides,
 * because OCR and the model disagree about spaces in Thai more than anything
 * else. A value that appears twice (a budget repeated in a header, `10` inside
 * `100`) has no one place that is "the" place it was read, so it has none.
 */
function uniqueSpan(ocr: OcrResult, quote: string, scope?: Span): Span | null {
  const needle = squeeze(quote).text;
  if (needle === "") return null;
  const hay = squeeze(ocr.text);
  const spans: Span[] = [];
  for (let at = hay.text.indexOf(needle); at >= 0; at = hay.text.indexOf(needle, at + 1)) {
    const span = { start: hay.at[at]!, end: hay.at[at + needle.length - 1]! + 1 };
    if (!scope || (span.start >= scope.start && span.end <= scope.end)) spans.push(span);
    if (spans.length > 1) return null;
  }
  return spans[0] ?? null;
}

/** The first page whose words overlap `span`, as one box per line of text. */
function boxesFor(ocr: OcrResult, { start, end }: Span): FieldAnchor | null {
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

/**
 * Where `quote` was read: its one place in the OCR text, as one box per line on
 * the page it starts on. Returns null when the text is not found or is found in
 * more than one place; it never guesses a nearby or a first one.
 */
export function locate(ocr: OcrResult, quote: string): FieldAnchor | null {
  const span = uniqueSpan(ocr, quote);
  return span ? boxesFor(ocr, span) : null;
}

/** The fields with every anchor removed whose page is not in `pages`. */
export function keepAnchorsOn(fields: TorFields, pages: ReadonlySet<number>): TorFields {
  const out: Record<string, ExtractedField<unknown>> = {};
  for (const [name, field] of Object.entries(fields) as Array<[string, ExtractedField<unknown> | undefined]>) {
    if (!field) continue;
    if (field.anchor && !pages.has(field.anchor.page)) {
      const { anchor: _dropped, ...rest } = field;
      out[name] = rest;
    } else {
      out[name] = field;
    }
  }
  return out as unknown as TorFields;
}

function anchorOf(field: ExtractedField<unknown>, ocr: OcrResult): FieldAnchor | null {
  const evidence = field.evidence ? uniqueSpan(ocr, field.evidence) : null;
  const inEvidence = evidence ? uniqueSpan(ocr, field.raw, evidence) : null;
  if (inEvidence) return boxesFor(ocr, inEvidence);
  return locate(ocr, field.raw) ?? (evidence ? boxesFor(ocr, evidence) : null);
}

/**
 * Puts an anchor on every field the model read from the document. A value the
 * source system stated, or one read from another record, was not read here and
 * gets none. The model's evidence quote, when it is found in one place, says
 * which of several equal values was meant; failing that the value must be unique
 * on its own, and failing that the evidence is boxed as the nearest honest answer.
 */
export function anchorFields(fields: TorFields, ocr: OcrResult): { fields: TorFields; pages: number[] } {
  const pages = new Set<number>();
  const out: Record<string, ExtractedField<unknown>> = {};
  for (const [name, field] of Object.entries(fields) as Array<[string, ExtractedField<unknown> | undefined]>) {
    if (!field) continue;
    const anchor = field.origin === "source" || field.fromDocument ? null : anchorOf(field, ocr);
    if (anchor) pages.add(anchor.page);
    out[name] = anchor ? { ...field, anchor } : field;
  }
  return { fields: out as unknown as TorFields, pages: [...pages].sort((a, b) => a - b) };
}
