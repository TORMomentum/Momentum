# Extraction provenance, OCR and work location — design

**Cards:** TOR-128 (provenance), TOR-202 (Document AI OCR, embeddings, work location) · **Date:** 2026-11-08
**Builds on:** [extraction and confidence](2026-09-09-tor-radar-extraction-confidence-design.md) §6 ·
**Requirements:** FR-B-1, FR-B-2, FR-G-1, NFR-F6

## 1. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Where do positions come from? | **Document AI for every PDF and image**, not only scans. The positions a text-layer PDF could give for free need a PDF parser dependency and a second coordinate system, and they serve the documents that were already easy. One route, one coordinate system |
| 2 | Does OCR text go to Gemini? | **No.** Gemini keeps reading the document exactly as before, so the accuracy the thresholds (`T_low`, `T_high`) came from is unchanged and nothing needs re-measuring. OCR is used only afterwards, to find where each value was read |
| 3 | How is a field located? | The field's `raw` is searched for in the OCR text (whitespace-insensitive, exact). The matched characters map to tokens, the tokens to boxes. No match means **no anchor**; the review screen then says the place was not found rather than guessing |
| 4 | What is stored per field? | `anchor: { page, boxes[] }`, boxes as `[x0, y0, x1, y1]` fractions of the page (0..1), so a box survives any rendering size. A field spanning pages anchors to its first page |
| 5 | Page images | Stored for pages that carry an anchor, as derived objects under `pages/<contentHash>/<n>.jpg`, written with `putIfAbsent`. The original is never touched. The viewer needs an image to draw on; an embedded PDF cannot be overlaid |
| 6 | Schema version | `TOR_SCHEMA_VERSION` 2 → 3. Records extracted earlier have no anchors and are shown without boxes; re-extraction adds them |
| 7 | Switch | `OCR_ENABLED`, default **off**, because every enabled run spends Document AI calls. Off, extraction is byte-for-byte what it was |
| 8 | Work location | A new field `workLocation`, read by Gemini in the same request. A province is mapped to a seed province id in code; a value not on the list stays unmapped and scores nothing. `MATCH_AREA_SIGNAL_ENABLED` turns the area signal on |
| 9 | Embeddings | A vendor's free-text work type (`otherCategories`) is compared with a TOR by cosine similarity of embeddings instead of a substring. Embeddings are cached by text hash so a phrase is embedded once. Off by default (`EMBEDDINGS_ENABLED`) |

## 2. Budget (TOR-310)

Calls, not currency: unit prices change and were not verifiable from the pricing pages while writing this,
so check them in the console before enabling a switch.

| Switch | Calls per TOR | Bound |
| :--- | :--- | :--- |
| `OCR_ENABLED` | one Document AI `process` call per TOR, first `OCR_MAX_PAGES` pages (default 15, the synchronous limit) | pages × the per-page price; a 15-page TOR is 15 billed pages |
| `EMBEDDINGS_ENABLED` | one embedding call per TOR (title + scope summary), one per distinct vendor free-text phrase, cached by hash | calls ≤ TORs + distinct phrases, each short |
| work location | none: one more field in the existing Gemini request | none |

A re-extraction repeats the OCR call. The 178 failed TORs in TODO.md are not re-run by this work.

## 3. Failure paths

OCR failing never fails an extraction: the fields are saved without anchors and the reason is logged. Anchors
are a convenience for the reviewer, not part of the record's correctness (NFR-S5 is about the record, not the
box).

## 4. Verified live (2026-11-08)

One corpus TOR (`tor-01.pdf`) through the real Gemini, Document AI and embedding calls: 8 of 13 fields were
anchored, the boxes were drawn on the stored page image and sat on the title (two lines), agency and budget;
the work location read `คลองบางน้อย จากที่ดินเอกชนถึงถนนกาญจนาภิเษก`; the record carried schema version 3, the Document AI
processor as `ocrModel`, and a 768-value embedding. Long free-text fields such as the scope summary are not
anchored: the model's `raw` is a paraphrase of several paragraphs, and no exact match exists. That is
decision 3 working as written.

Embedding similarity, on 5 vendor phrases against 8 TOR titles written for the probe: related pairs 0.81–0.91,
unrelated 0.57–0.72, so `EMBEDDING_MIN_SIMILARITY` defaults to 0.75. This is a small sample and the value is
**uncalibrated**; it needs the match-quality benchmark before the switch is turned on for vendors.

## 5. Out of scope

Boxes on a text-layer PDF without OCR · editing a box · anchors for annexes · re-measuring accuracy (decision 2
makes it unnecessary).
