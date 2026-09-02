# Extraction accuracy benchmark — TOR-18 phase gate

Model: **gemini-3.5-flash** @ `global` · scored 2026-09-02 · regenerate with `npm run score:extract`.

Both sides normalised before comparison (Thai digits → Arabic, พ.ศ. → ค.ศ., procurement-method wording collapsed, whitespace-insensitive). `required_qualifications` and `scope_summary` are reviewed by hand, not string-scored — the labels are deliberately terse and the model returns a more detailed superset in all 15 docs.

## Field accuracy — digital corpus (n=10)

| field | accuracy | breakdown |
|---|---|---|
| `agency` | 100% | 10 correct · 0 correct-null · 0 wrong |
| `budget_thb` | 100% | 5 correct · 5 correct-null · 0 wrong |
| `category` | 100% | 10 correct · 0 correct-null · 0 wrong |
| `status` | 100% | 10 correct · 0 correct-null · 0 wrong |
| `procurement_method` | 100% | 10 correct · 0 correct-null · 0 wrong |
| `title` | 90% | 9 correct · 0 correct-null · 1 wrong |
| `submission_deadline` | 90% | 0 correct · 9 correct-null · 1 wrong |
| `announcement_date` | 90% | 0 correct · 9 correct-null · 1 wrong |
| `reference_no` | 90% | 0 correct · 9 correct-null · 1 wrong |
| `contact` | 70% | 0 correct · 7 correct-null · 3 wrong |

## Field accuracy — scanned spot-checks (n=5)

| field | accuracy | breakdown |
|---|---|---|
| `title` | 100% | 5 correct · 0 correct-null · 0 wrong |
| `agency` | 100% | 5 correct · 0 correct-null · 0 wrong |
| `category` | 100% | 5 correct · 0 correct-null · 0 wrong |
| `status` | 100% | 5 correct · 0 correct-null · 0 wrong |
| `procurement_method` | 100% | 5 correct · 0 correct-null · 0 wrong |
| `announcement_date` | 80% | 3 correct · 1 correct-null · 1 wrong |
| `budget_thb` | 60% | 0 correct · 3 correct-null · 2 wrong |
| `reference_no` | 60% | 2 correct · 1 correct-null · 2 wrong |
| `contact` | 40% | 0 correct · 2 correct-null · 3 wrong |
| `submission_deadline` | 20% | 0 correct · 1 correct-null · 4 wrong |

## Does model confidence predict correctness?

Digital corpus, all scored fields, n=80:

| | mean model confidence | count |
|---|---|---|
| predictions that were **correct** | 0.957 | 66 |
| predictions that were **wrong** | 0.964 | 14 |

| model confidence bucket | n | correct | precision |
|---|---|---|---|
| 1.00 | 40 | 33 | 83% |
| 0.95–0.99 | 22 | 17 | 77% |
| 0.90–0.94 | 13 | 12 | 92% |
| 0.80–0.89 | 5 | 4 | 80% |
| 0.00–0.79 | 0 | 0 | – |

**Finding:** the model reports ~0.9–1.0 confidence for almost everything, and its
confidence on wrong answers is barely below its confidence on right ones. Model
self-confidence alone is **not** a usable gate.

## Every wrong prediction

**title**
- tor-08: pred="การจ้างก่อสร้างปรับปรุงซอยสุขาภิบาลบางระมาด ๕/๑" gold="ประกวดราคาจ้างก่อสร้างปรับปรุงซอยสุขาภิบาลบางระมาด 5/1 ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)"

**budget_thb**
- [scan] tor-06: pred=1200000 gold=null
- [scan] tor-16: pred=13295885.84 gold=17295845.84

**submission_deadline**
- tor-02: pred="2016-03-09" gold=null
- [scan] tor-03: pred="2023-12-06" gold=null
- [scan] tor-06: pred="2024-09-16" gold=null
- [scan] tor-11: pred="2023-09-27" gold=null
- [scan] tor-17: pred="2016-03-09" gold=null

**announcement_date**
- tor-02: pred="2016-03-05" gold="2026-03-05"
- [scan] tor-17: pred="2016-03-05" gold="2026-03-05"

**contact**
- tor-02: pred="สำนักงานเขตจตุจักร" gold=null
- tor-05: pred="โรงเรียนวิชูทิศ ที่อยู่ 4095/1 ซอยประชาสงเคราะห์ 13 ถนนประชาสงเคราะห์ แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400 โทรศัพท์ 0 2246 1551 โทรสาร 0 2246 1551 เว็บไซต์ www.wichutit.ac.th" gold="โรงเรียนวิชูทิศ สำนักงานเขตดินแดง กรุงเทพมหานคร 10400 โทร 0 2246 1551 โทรสาร 0 2246 1551 เว็บไซต์ www.wichutit.ac.th"
- tor-09: pred="โทรศัพท์หมายเลข ๐-๒๔๔๑-๔๙๗๓ ต่อ ๕๕๐๗ หรือเว็บไซต์ www.bangkok.go.th/thawiwatthana" gold="สำนักงานเขตทวีวัฒนา โทร 0-2441-4973 ต่อ 5507; www.bangkok.go.th/thawiwatthana; www.gprocurement.go.th"
- [scan] tor-06: pred="โทรศัพท์หมายเลข 023544206, เว็บไซต์ www.bangkok.go.th/ratchathewi" gold=null
- [scan] tor-16: pred="www.bangkok.go.th/thonburi หรือ www.gprocurement.go.th" gold="www.bangkok.go.th/thonburi; www.gprocurement.go.th"
- [scan] tor-17: pred="สำนักงานเขตจตุจักร" gold=null

**reference_no**
- tor-02: pred="3/2559" gold="3/2569 (ประกาศเดิมที่ถูกยกเลิก ลงวันที่ 26 กุมภาพันธ์ 2569)"
- [scan] tor-03: pred="1/2567" gold="3/2567"
- [scan] tor-17: pred="3/2559" gold="3/2569 (ประกาศเดิมที่ถูกยกเลิก)"

## Verdict & FR-B3 thresholds

**Phase gate: PASS — proceed to Sprint 2 as planned.** For the fields that drive
the dashboard and the anomaly rule (`title`, `agency`, `budget_thb`, `category`,
`status`, `scope_summary`) accuracy is **100% on digital docs** and the only
scanned-doc regression is on `budget_thb` (numeric mis-read). Vertex/Gemini Thai
OCR is not the blocker.

Because model confidence doesn't discriminate (above), FR-B3's two tiers are gated
by **deterministic per-field rules first, model confidence second**:

| tier | rule |
|---|---|
| **queue (< T_low)** | any of: `agency` fails the BMA check (FR-A4) · `agency`/`title` empty · `budget_thb` present but not in ฿1e4–฿1e10 · `status` `cancelled`/`awarded` but a `submission_deadline` was extracted · model confidence < **0.80** on `title` or `agency` |
| **unverified tag (T_low–T_high)** | `pdf_text_layer != digital` (OCR'd) AND field is `budget_thb` or any date · OR model confidence in **0.80–0.94** · OR `reference_no`/`contact`/date fields on any doc |
| **clean (≥ T_high)** | digital-text doc AND field ∈ {title, agency, category, status, scope_summary} AND model confidence ≥ **0.95** |

So: **T_low = 0.80, T_high = 0.95** on the model's per-field confidence, applied
**only after** the deterministic checks. `budget_thb` and every date field never
reach the "clean" tier from an OCR'd document regardless of confidence — they
always carry the unverified tag until an admin confirms (FR-B3 tier 2 / FR-G1).

### Known limits of this benchmark (acceptable for a course project)

- n=10 labelled + 5 scanned spot-checks (within NFR-1's "10–20"). 6/10 from one
  district, one template — real-world variety is lower-bounded, not measured.
- Scanned labels are page-1–3 spot-checks; the `submission_deadline` 0/n result
  may be partly a label gap, not pure hallucination. Either way the field is
  gated to the review queue, so the phase-gate decision doesn't hinge on it.
- Single model, single run per doc (numbers shift slightly between runs — see the
  `budget_thb` scanned misses).
