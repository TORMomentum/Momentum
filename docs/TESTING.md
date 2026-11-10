# Testing — TOR Radar

_Last updated: 2026-11-03. Kept current by the rule in [CLAUDE.md](../CLAUDE.md) ("Docs stay
current"); CI fails a pull request that adds or removes a test file without updating this one._

The [SRS](SRS.md) states every requirement as a testable statement with a verification method (T
test, D demonstration, I inspection, A analysis) and gives each feature an acceptance criterion
(SRS §6). This document turns them into test cases: automated ones (§2, with every test in the generated
[test-report.md](test-report.md)) and manual ones that only a running stack can prove (§3).

## 1. Running the tests

| Command | What runs | Needs |
| :---- | :---- | :---- |
| `npm test` | The whole Vitest suite: unit, route and integration tests | the local stack and test environment below |
| `npm run build && npm test` | The CI order. Packages ship compiled output, so testing before building tests a source tree the app never sees | as above |
| `npm run test:report` | The whole suite, then regenerates [test-report.md](test-report.md): every test with its result, grouped by feature | as above |
| `npx vitest run <path>` | One file | as above |
| `node tools/check_mermaid.mjs` | Parses every Mermaid block under `docs/` | nothing |
| `node tools/check_docs_drift.mjs` | Fails when code changed without its doc (rules in `tools/docs_drift.mjs`) | `git fetch origin` |
| `RUN_LIVE_VERTEX=1 npx vitest run apps/api/src/adapters/vertex.ai.test.ts` | One real Vertex AI extraction — **paid**, run deliberately | Vertex credentials |
| `GCS_REAL_TEST_BUCKET=… GCS_CREDENTIALS=… npx vitest run apps/api/src/adapters/gcs.storage.real.test.ts` | Storage contract against a real, disposable bucket (also the `gcs-real` workflow) | a throwaway bucket |

**Point the suite at the local stack first.** `vitest.setup.ts` renames the database to `*_test`
but keeps the host from `MONGO_URL`, so a `.env` aimed at Atlas sends the integration tests to the
shared cluster. Set the values CI uses before running; a variable already set wins over `.env`:

```bash
docker compose up -d mongo gcs
export MONGO_URL="mongodb://localhost:27017/tor_radar?directConnection=true" GCS_BUCKET=tor-raw \
  GCS_API_ENDPOINT=http://localhost:4443 INTAKE_API_KEYS=ci-intake-key ADMIN_API_KEYS=ci-admin-key \
  SESSION_SECRET=local-test-only APP_ORIGIN=http://web:3000
npm run build && npm run test:report
```

The opt-in tests in the last two rows of the table are the only ones that call a paid or real
external service; they are skipped unless their variables are set.

**Unit tests passing is not verification.** A change is verified when the manual case in §3 for its
feature passes against the running stack (`docker compose up`).

## 2. Test cases

Each case states what is tested, the input, the expected result, and the result of the latest run.
These are the key cases per feature, with inputs copied from the test code. **Every test** — 781 at
the last run — is listed with its result in the generated [test-report.md](test-report.md).

Result column: the run of 2026-11-03 at commit `81ad2ef` — full suite 771 passed · 0 failed · 10
skipped (opt-in). `npm run test:report` refreshes the report.

| ID | Req. | Function under test | Input | Expected | Result | Test file |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| UT-F1-1 | FR-A-1, NFR-S1 | `POST /api/v1/intake/upload` | PDF upload with no `x-api-key` | 401; nothing stored | Pass | `intake.routes.test.ts` |
| UT-F1-2 | FR-A-3 | `POST /api/v1/intake/upload` | the same file submitted a second time | 200 (not 202) with the existing record's id | Pass | `intake.routes.test.ts` |
| UT-F1-3 | NFR-S1 | `isBlockedAddress` (SSRF guard) | `169.254.169.254` · `10.1.2.3` · `::ffff:10.1.2.3` · `not-an-address` | `true` for each — blocked | Pass | `safe-fetch.test.ts` |
| UT-F1-4 | NFR-S1 | `safeFetchDocument` | a public URL that redirects into a private range | rejected when the redirect is re-checked | Pass | `safe-fetch.test.ts` |
| UT-F1-5 | NFR-S1 | `detectMimeType` (magic bytes) | `"<html><script>alert(1)</script>"` sent as a PDF | `null` — not accepted as a PDF | Pass | `file-type.test.ts` |
| UT-F2-A1 | FR-B-2 | `locate`, `anchorFields` | a quote in OCR text, whitespace differing; a value the source stated; a value found twice, with and without an evidence quote that says which | one box per line on the page; none for a missing quote, a source value, a borrowed one or an ambiguous one; the evidence quote picks the place when it is unique | Pass | `anchor.test.ts` |
| UT-F2-A2 | FR-B-2 | `ExtractionService.run` with OCR | OCR succeeds; a page image cannot be stored; OCR throws; OCR not wired | fields anchored, page image kept, OCR model recorded; the anchor on that page dropped and the record still saved; without anchors and still saved; no OCR call | Pass | `extraction.service.test.ts` |
| UT-F2-L2 | NFR-F3 | `systemPrompt`, `responseSchema` | `EXTRACT_WORK_LOCATION_ENABLED` off and on | off: the prompt and schema the thresholds were measured on, no `work_location`; on: only that line and key are added | Pass | `vertex.ai.test.ts` |
| UT-F2-A3 | FR-G-1 | `GET /admin/tors/:id/pages/:page` | page 2; page 0 or `abc`; no key; no stored image | image `nosniff` `no-store`; `400`; `401`; `404` | Pass | `admin.routes.test.ts` |
| UT-F2-A4 | FR-G-1 | review screen | a field with an anchor | the page image appears with a box at the stored position, and a second click returns to the PDF | Pass | `RecordPanel.test.tsx` |
| UT-F2-L1 | FR-B-2 | work location | a confident location naming a province; one naming none | verified; not verified; never a reason to queue the record | Pass | `extraction.grading.test.ts`, `province.test.ts` |
| UT-F2-B1 | FR-B-2 | `systemPrompt`, `responseSchema`, `parseExtraction` | `EXTRACT_BIDDING_FIELDS_ENABLED` off and on; a malformed weight or document entry; an unknown method | off: the measured prompt and schema; on: only the three keys and lines added; bad entries dropped, unknown method is `null` | Pass | `vertex.ai.test.ts`, `vertex.factory.test.ts` (the worker and the benchmark send the same request) |
| UT-F2-B2 | FR-B-3 | evaluation method and weights | weights adding to 100, to 100.2, to 90, out of range, empty (lowest price and not); a low-confidence value | verified only for a valid total; empty accepted for lowest price only; unverified never queues the record | Pass | `extraction.grading.test.ts` |
| UT-F2-B3 | FR-B-2 | required documents | names matching ISO 9001, the engineer licence in both wordings, and none; empty; low confidence | tagged with the listed certification; unverified when empty or low; record unaffected | Pass | `extraction.grading.test.ts` |
| UT-F9-A1 | FR-C-1 | area signal | served province; outside; whole-country vendor; unverified or unnamed location; switch off | scored with a reason; silent for the rest | Pass | `match-scorer.test.ts` |
| UT-F9-E1 | FR-C-1 | free text by meaning | a phrase near a TOR in meaning; far; edited since embedding; another model; switch off | matched with a reason; not matched; the TOR is a candidate only when near | Pass | `match-scorer.test.ts`, `matching.routes.test.ts`, `profile.routes.test.ts` |
| UT-F2-1 | FR-B-3 | `grade` | a clean digital TOR with the budget missing | confidence `low`; queued for review | Pass | `extraction.grading.test.ts` |
| UT-F2-2 | FR-B-3 | `grade` | a scanned TOR (no text layer), budget read at confidence 1 | budget `verified: false`; record `low` | Pass | `extraction.grading.test.ts` |
| UT-F2-3 | FR-B-3 | `grade` | deadline `2025-12-01`, before the announcement date | deadline not verified; sanity check trips | Pass | `extraction.grading.test.ts` |
| UT-F3-1 | FR-G-1 | `torStateOf` | `{ torStatus: "announced", deadline: "2026-10-05" }`, today later | `closed` — the date wins over the label | Pass | `tor-state.test.ts` |
| UT-F3-2 | FR-B-6 | `POST /admin/tors/bulk` | `{ action: "reject", ids: [id] }` with no reason | 400; the TOR stays public | Pass | `admin.routes.test.ts` |
| UT-F4-0 | FR-E-3 | `GET /tors?q=` keyword | a Thai word inside an unspaced title; the agency; a word in no record | finds the record by word, matches the agency, returns nothing for a miss; index creation is idempotent | Pass | `tors.atlas-search.test.ts` (needs `mongodb-atlas-local`) |
| UT-F4-1 | NFR-F2 | `GET /tors` search | 5,000-record corpus, every filter at once | answered within 2 s | Pass | `tors.search.timing.test.ts` |
| UT-F4-2 | NFR-F2 | `GET /tors` search | deep pages of the same corpus | each page within 2 s (cursor, not skip) | Pass | `tors.search.timing.test.ts` |
| UT-F5-1 | FR-C-1 | `scoreMatch` | TOR asks "ISO 9001 และ/หรือ ISO 14001"; vendor A holds ISO 14001, vendor B holds both | equal scores; reason `qualification-held` | Pass | `match-scorer.test.ts` |
| UT-F5-2 | FR-C-1 | `scoreMatch` (ว642) | road TOR ≥ ฿5M; vendor holds no กรมบัญชีกลาง road registration | score = registered vendor's × 0.5; first reason `registration-missing` | Pass | `match-scorer.test.ts` |
| UT-F5-3 | FR-C-2 | `scoreMatch` | TOR budget 500, outside the vendor's range | still listed (not excluded), lower score | Pass | `match-scorer.test.ts` |
| UT-F5-4 | FR-C-3 | `NotifyService.dispatch` | vendor with email preset `off`, a bookmarked TOR due soon | 0 emails, reminders included | Pass | `notify.service.test.ts` |
| UT-F6-1 | FR-D-1 | `POST /api/v1/register` | `{ email, password }` with `consent` absent or `false` | 400; 0 accounts; 0 emails | Pass | `accounts.routes.test.ts` |
| UT-F6-2 | NFR-S2 | `DELETE /me` | the correct current password | account tombstoned, sessions revoked, owned records removed, TORs untouched | Pass | `accounts.routes.test.ts` |
| UT-F7-1 | §4.5.1 | `verdictFor` (IQR, minN 8) | peers 10…80 (Q1 27.5, Q3 62.5, IQR 35); budget 200 | `anomaly`, side `high`, distance (200 − 62.5) / 35 | Pass | `anomaly.rule.test.ts` |
| UT-F7-2 | §4.5.1 | `verdictFor` | budget exactly on the upper fence (115) | `normal` | Pass | `anomaly.rule.test.ts` |
| UT-F7-3 | §4.5.1 | `verdictFor` | budget 999,999 with only 7 peers | `not-evaluated`, reason `insufficient-peers` | Pass | `anomaly.rule.test.ts` |
| UT-F8-1 | FR-F-2, NFR-F5 | `evaluateChecklist` | a record whose budget is a statistical anomaly | C5 fails; the reason uses only the approved wording | Pass | `checklist.test.ts` |
| UT-F8-2 | FR-F-1 | `evaluateChecklist` | budget extracted but not verified | C1 fails | Pass | `checklist.test.ts` |
| UT-F10-1 | FR-B-5 | `redactContactString` | `"ติดต่อ โทร 02-246-1551 มือถือ 081-234-5678"` | office line kept, mobile removed | Pass | `redact.test.ts` |
| UT-F10-2 | FR-B-6, NFR-S3 | takedown and restore routes | reject (reason "ไม่ใช่เอกสาร TOR"), then restore, a TOR | restricted with the reason, then public again; both logged; same storage key — the original is kept | Pass | `admin.routes.test.ts` |

F11 (CSV export) has no test because it is not built. F12's automated tests cover collection only;
per-adapter health reporting is not built.

## 3. Manual acceptance cases

Run against `docker compose up` with the seeded corpus. Each case is the SRS §6 criterion turned into
steps. When a case is run for a review or demo, record what happened, Pass or Fail, and the date in
the last column.

| ID | Feature | Steps (input) | Expected | Actual · Pass/Fail · date |
| :---- | :---- | :---- | :---- | :---- |
| TC-F1-1 | F1 | Admin → upload a TOR PDF; submit the same file again | One record; the second submit returns the existing record | |
| TC-F1-2 | F1 | `POST /api/v1/intake/upload` without `x-api-key` | 401, nothing stored | |
| TC-F1-3 | F1 | Intake by URL pointing at `http://127.0.0.1/…` | Refused (SSRF guard), nothing stored | |
| TC-F2-1 | F2 | Upload a scanned Thai TOR; open its record | All nine fields, each with a confidence and the model that produced it | |
| TC-F3-1 | F3 | Admin → review queue | Only low-confidence and failed-check records; approving one clears the "unverified extraction" mark | |
| TC-F4-1 | F4 | Search; combine category, budget, agency and date filters | Results within two seconds; every combination works | |
| TC-F4-2 | F4 | Open a TOR | Every field shown exactly as extracted, plus a working link to the original | |
| TC-F5-1 | F5 | Vendor with a profile → dashboard matches | Each match shows a score and Thai reasons naming the matched work and the budget fit | |
| TC-F5-2 | F5 | Admin → vendor → "send matches now" (dispatch enabled, test inbox) | One email within five minutes naming at least three matched tags and the budget fit | |
| TC-F6-1 | F6 | Register without ticking consent | Refused; no account exists | |
| TC-F6-2 | F6 | Register, verify, build a profile from the taxonomy picker | Profile saved; only taxonomy entries selectable | |
| TC-F7-1 | F7 | Open the dashboard signed out | Agency totals, date filter, trend, last-updated time and coverage note visible; plot points labelled "statistical anomaly" | |
| TC-F8-1 | F8 | Open a TOR's checklist | Score, at least three named reasons, methodology link, "specification-quality check" label | |
| TC-F9-1 | F9 | Inspect the profile picker and category filter | Both load from the seeded taxonomy, no hard-coded list | |
| TC-F10-1 | F10 | Admin → reject (takedown) a TOR with a reason | Public page refuses it; audit entry written; original in storage unchanged | |
| TC-F10-2 | F10 | Vendor → export data, then delete account | Export downloads; account and its data are gone | |
| TC-F11-1 | F11 | Export CSV with filters active | Not built — case stands for when FR-E-7 lands | |
| TC-F12-1 | F12 | Run `tools/import_national_egp_tors.mts` twice | Second run adds no records. The SRS criterion — each adapter reports its last collection and health — is not built | |

Wording check for every case: no screen says "suspicious", "corrupt" or "irregular" (NFR-F5).
