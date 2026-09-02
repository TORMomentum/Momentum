# TOR extraction benchmark corpus (TOR-18)

10 real BMA procurement documents + field-level ground truth, for the Sprint-1
extraction-accuracy benchmark (NFR-1) that sets both FR-B3 confidence thresholds.

```
tor-01.pdf … tor-10.pdf   raw source documents (immutable — FR-A2)
labels/tor-NN.json         ground-truth fields per FR-B2 (TOR-21)
SCHEMA.md                  field definitions + labeling conventions
manifest.json              per-doc metadata + source URL + sha256
text/tor-NN.txt            pdftotext -layout dump (digital docs only; convenience, not truth)
_extra/                    10 more BMA PDFs (mostly scanned) for OCR testing — gitignored, re-fetch via manifest pattern
```

## Source

All from **webportal.bangkok.go.th** (BMA's public procurement portal), Sept 2026.
Every file is a public จัดซื้อจัดจ้าง notice. `manifest.json` has the exact URL and
sha256 of each. Re-download and re-hash to verify integrity.

## What's in the 10

| id | doc stage | agency | category | budget stated? | text |
|---|---|---|---|---|---|
| 01 | ร่าง TOR | เขตทวีวัฒนา | ก่อสร้าง-ชลประทาน | ✓ 5.52M | digital |
| 02 | ประกาศยกเลิก | เขตจตุจักร | ซื้อครุภัณฑ์ | – | **scanned** |
| 03 | เอกสารประกวดราคา | กทม. (เขตไม่ระบุ) | ก่อสร้าง-ทาง | – | digital |
| 04 | เอกสารประกวดราคา | เขตทวีวัฒนา | ซื้อครุภัณฑ์ (รถ) | – | digital |
| 05 | ร่าง TOR | ร.ร.วิชูทิศ / เขตดินแดง | จ้างเหมาบริการ | ✓ 0.79M | digital |
| 06 | เอกสารประกวดราคา | กทม. (เขตไม่ระบุ) | ก่อสร้าง-ชลประทาน | – (ดู note) | digital |
| 07 | ร่าง TOR | เขตทวีวัฒนา | ก่อสร้าง-ทาง | ✓ 5.96M | digital |
| 08 | เอกสารประกวดราคา | เขตทวีวัฒนา | ก่อสร้าง-ทาง | – | digital |
| 09 | ประกาศประกวดราคา | เขตทวีวัฒนา | ก่อสร้าง-ทาง | ✓ 4.77M | digital |
| 10 | ร่าง TOR | เขตทวีวัฒนา | ก่อสร้าง-ชลประทาน | ✓ 1.94M | digital |

Deliberate hard cases: **02** (scanned, and it's a *cancellation* not a TOR),
**03/06/08** (budget genuinely absent — tests hallucination), **06** (a large
bid-security figure that must NOT be mistaken for the budget), **03/06** (agency
stated only as "กรุงเทพมหานคร").

## Known limitations — read before trusting the numbers

1. **Agency concentration.** 6 of 10 are สำนักงานเขตทวีวัฒนา, and 8 of 10 share
   the same document template. Accuracy measured on this set will be **optimistic** —
   the extractor effectively sees one layout. Before TOR-22 sets the thresholds,
   add ~10 more from other สำนัก / เขต with different templates.
2. **Digital-text bias.** 9 of 10 have a clean text layer. In reality most BMA
   agencies upload **scans** (see `_extra/` — 6 of those 10 are image-only, plus
   one with a broken font layer). Thai OCR is the actual risk (NFR-1); a corpus
   that is 90% digital will not exercise it. The scanned/`_extra` docs need OCR
   before the extractor runs, and their ground truth still has to be hand-labeled.
3. **No `submission_deadline` anywhere.** All 10 are draft/invitation-stage docs
   where the bid date is blank. Add a few *finalised* ประกาศ (with real dates) so
   that field is exercised.
4. **`_extra/` is gitignored** (~38 MB of scans). Re-fetch from the URLs in a
   future `_extra/manifest` or by the same `webportal.bangkok.go.th` search.

## How to score (TOR-22)

For each doc: run the extraction spike (TOR-20) → compare its output field-by-field
against `labels/tor-NN.json` → per-field precision/recall + a confidence calibration
curve → pick T_low, T_high where tagged-vs-clean and queue-vs-not land acceptably.
Treat `confidence.overall == "medium"` labels as lower-weight in scoring.
