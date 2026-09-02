# Ground-truth label schema (TOR-21)

Field-level ground truth for the extraction accuracy benchmark (TOR-18/TOR-22).
One `labels/tor-NN.json` per corpus document. Fields follow **FR-B2** (PROJECT.md).

## Fields

| key | FR-B2 name | type | notes |
|---|---|---|---|
| `title` | title | string | Project/procurement title as written (ชื่อโครงการ / เรื่อง). Keep the full Thai string incl. method suffix. |
| `agency` | agency | string | Procuring BMA entity. Use the name **as the document states it** (e.g. `สำนักงานเขตทวีวัฒนา`, or just `กรุงเทพมหานคร` when no unit is named). `agency_bma_valid` records the FR-A4 check separately. |
| `agency_bma_valid` | — | bool | Does `agency` resolve to an entry on the canonical BMA list (FR-A4)? |
| `budget_thb` | budget (฿) | number \| null | Numeric baht. `null` = **not present in this document** (common in ร่าง TOR where price is a separate ตารางราคากลาง). Do not compute from bid-bond %. |
| `budget_source` | — | string \| null | Where the number came from: `วงเงินงบประมาณ`, `ราคากลาง`, `งบประมาณ`, … or `null`. |
| `category` | category | string | Coarse work type: `งานก่อสร้าง-ทาง`, `งานก่อสร้าง-ชลประทาน`, `งานก่อสร้าง-อาคาร`, `จ้างเหมาบริการ`, `ซื้อครุภัณฑ์`, `จ้างที่ปรึกษา`. Free text; normalization is FR-B4's job. |
| `scope_summary` | scope summary | string | 1–3 sentence Thai summary of the work. Paraphrase allowed. |
| `required_qualifications` | required qualifications | string[] | Distinct substantive bidder requirements. Skip the boilerplate list (ล้มละลาย / ทิ้งงาน / e-GP registration) — keep the ones that discriminate vendors (registration class, มอก., วิชาชีพวิศวกรรม, ...). |
| `submission_deadline` | submission deadline | string \| null | ISO date (`YYYY-MM-DD`, Gregorian) of bid submission, or `null` when the document leaves it blank (all ร่าง/draft docs here). |
| `contact` | contact | string \| null | Phone / office / website for enquiries, as one string, or `null`. |
| `status` | status | enum | `announced` \| `closed` \| `awarded` \| `cancelled`. Coarse only (FR-B2). `cancelled` added for ประกาศยกเลิก. |
| `procurement_method` | — | string | `e-bidding` \| `คัดเลือก` \| `เฉพาะเจาะจง` \| `ราคาตลาด`. Useful metadata, not an FR-B2 field. |
| `announcement_date` | — | string \| null | ISO date the notice was issued, or `null` if blank. |
| `reference_no` | — | string \| null | ประกาศ/เอกสารประกวดราคา number (เลขที่), or `null`. |

## Conventions

- **Thai digits → Arabic.** `๒๕๖๗` → dates converted to Gregorian (2567 BE − 543 = 2024 CE).
- **`null` vs `""`**: `null` = the field is genuinely absent from the document; never guess. This is deliberate — it tests whether the extractor hallucinates.
- **Draft TORs** (`ร่างรายละเอียดขอบเขตของงาน…`) almost always lack `submission_deadline`, `contact`, `announcement_date`, `reference_no` — those live in the paired ประกาศ. Expected, not an error.
- `pdf_text_layer`: `digital` (selectable Thai text) \| `garbled` (text layer present but wrong encoding) \| `scanned` (image only). Drives which docs need OCR before the extractor sees them.
- Each label file carries `labeled_by`, `labeled_at`, and `confidence` (`high` \| `medium`) — `medium` where the source text was ambiguous or OCR-read by hand.
