# TOR categories: one closed list

**Date:** 2026-10-06
**Affects:** extraction (FR-B-2), search facets (FR-E-3), the anomaly rule's peer groups (§4.5.1), checklist C5, admin review (FR-G-1)
**Source of truth:** `packages/shared/src/categories.ts`

## 1. What real data showed

On 2026-10-06, 139 published TORs carried 16 free-text categories. The extraction prompt only gave
examples, so the model also coined names of its own — "ซื้อยา" beside "ซื้อเวชภัณฑ์",
"ซื้อวัตถุดิบอาหาร" beside "ซื้อวัสดุ", "งานก่อสร้าง-สะพาน" — splitting one kind of TOR into several
search facets and several anomaly peer groups. Only 41 of 139 categories were verified.

## 1a. What should the categories be (analysis, 2026-10-06)

| Source | Finding |
|---|---|
| Bangkok e-GP, all methods, 277,084 projects, by official procurement type | ซื้อ 59% · จ้างทำของ/จ้างเหมาบริการ 36% · จ้างก่อสร้าง 3.3% · เช่า 0.2% · ที่ปรึกษา/ออกแบบ/ควบคุมงาน 0.1% |
| Same, by official goods/works category (70) | จ้างเหมาอื่นๆ 25% · วัสดุครุภัณฑ์วิทยาศาสตร์และการแพทย์ 21.5% · สำนักงาน 9.8% · การศึกษา 9.3% · อื่นๆ 8.4% · ยานพาหนะ 2.8% · คอมพิวเตอร์ 2.5% · then cleaning, security, repair, and each construction class below 1.5% |
| Our 139 TORs, by budget | Construction is 16% of TORs but 35% of money |

So the list follows e-GP's own grouping — what is bought or done (สาขา), not วัสดุ versus ครุภัณฑ์ —
keeps construction split by what is built because that is where the money is, and folds categories
too small for a peer group (≥ 8 TORs) into their neighbours. Each category maps onto official e-GP
codes, which a later source import can use to state the category instead of reading it:

| Category | e-GP codes |
|---|---|
| ซื้อครุภัณฑ์การแพทย์และวิทยาศาสตร์ | 1006 |
| ซื้อครุภัณฑ์สำนักงานและการศึกษา | 1001, 1002 |
| ซื้อคอมพิวเตอร์และอุปกรณ์ไอที | 1008, 1007 |
| ซื้อยานพาหนะ | 1013 |
| ซื้อวัสดุและครุภัณฑ์อื่น ๆ | 1003, 1004, 1005, 1009, 1011, 1012, 1015–1018 |
| จ้างเหมาบริการ | 4004, 4008–4016 |
| จ้างทำความสะอาดและรักษาความปลอดภัย | 4001, 4002, 4003 |
| จ้างที่ปรึกษาและออกแบบ | types 05–08, 70xx |
| งานก่อสร้าง-อาคาร | 3001, 3004 |
| งานก่อสร้าง-ทาง สะพาน | 3002, 3005 |
| งานก่อสร้าง-ชลประทานและระบบน้ำ | 3003, 3006 |
| งานก่อสร้าง-อื่น ๆ | 3007 |
| เช่า | type 04, 5001–5005, 2001 |

## 2. Decisions

| # | Decision | Answer |
|---|---|---|
| 1 | The list | The 13 categories in §1a (an earlier 11-category draft the same day is superseded) |
| 2 | Extraction | The model **chooses** from the list: an `enum` in the response schema and the list in the prompt, with how to file the common edge cases. A value off the list is mapped onto it by `normalizeCategory` |
| 3 | Grading | A category is verifiable only when it is on the list (and confident, as before) |
| 4 | Admin | The category is picked from a dropdown; the API refuses a value off the list |
| 5 | Existing records | `tools/normalize_categories.mts` maps them without re-extraction, reading the **title** to decide what is bought or built (e-GP writes the title's ซื้อ / จ้าง / เช่า, so it outranks a model's category): `value` changes, `raw` and `verified` stay, the cohort moves and both peer groups are marked for recompute. 161 records changed on 2026-10-06; none unmapped |

## 3. Still open

- The list is a team decision taken quickly for the sprint; changing it later means editing the one file and re-running the normaliser.
- The vendor skill taxonomy (`skill-tags.json`) is a different thing — what a vendor can do — and is not affected.
