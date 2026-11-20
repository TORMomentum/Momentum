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
| UT-F4-B1 | FR-E-4 | `BiddingPanel` on the TOR detail page | no fields; price-performance with weights; weights not totalling 100; lowest price; unconfirmed; documents by holder; malformed entries | nothing; table with sum; the stated sum; no table; unconfirmed mark; fixed group order; ignored, no throw | Pass | `BiddingPanel.test.tsx`, `TorRecordView.test.tsx` |
| UT-F9-A1 | FR-C-1 | area signal | served province; outside; whole-country vendor; unverified or unnamed location; switch off | scored with a reason; silent for the rest | Pass | `match-scorer.test.ts` |
| UT-F9-E1 | FR-C-1 | free text by meaning | a phrase near a TOR in meaning; far; edited since embedding; another model; switch off | matched with a reason; not matched; the TOR is a candidate only when near | Pass | `match-scorer.test.ts`, `matching.routes.test.ts`, `profile.routes.test.ts` |
| UT-F2-1 | FR-B-3 | `grade` | a clean digital TOR with the budget missing | confidence `low`; queued for review | Pass | `extraction.grading.test.ts` |
| UT-F2-2 | FR-B-3 | `grade` | a scanned TOR (no text layer), budget read at confidence 1 | budget `verified: false`; record `low` | Pass | `extraction.grading.test.ts` |
| UT-F2-3 | FR-B-3 | `grade` | deadline `2025-12-01`, before the announcement date | deadline not verified; sanity check trips | Pass | `extraction.grading.test.ts` |
| UT-F2-W1 | FR-A-1 | extraction worker without a credential | no project, no credential path, a path to no file, a real file; a cycle with no handler; a cycle with one | the blocker names what is missing; with no handler nothing is claimed and nothing is published | Pass | `extract.worker.test.ts` |
| UT-F3-1 | FR-G-1 | `torStateOf` | `{ torStatus: "announced", deadline: "2026-10-05" }`, today later | `closed` — the date wins over the label | Pass | `tor-state.test.ts` |
| UT-F3-2 | FR-B-6 | `POST /admin/tors/bulk` | `{ action: "reject", ids: [id] }` with no reason | 400; the TOR stays public | Pass | `admin.routes.test.ts` |
| UT-F4-0 | FR-E-3 | `GET /tors?q=` keyword | a Thai word inside an unspaced title; the agency; a word in no record | finds the record by word, matches the agency, returns nothing for a miss; index creation is idempotent | Pass | `tors.atlas-search.test.ts` (needs `mongodb-atlas-local`) |
| UT-F4-1 | NFR-F2 | `GET /tors` search | 5,000-record corpus, every filter at once | answered within 2 s | Pass | `tors.search.timing.test.ts` |
| UT-F4-2 | NFR-F2 | `GET /tors` search | deep pages of the same corpus | each page within 2 s (cursor, not skip) | Pass | `tors.search.timing.test.ts` |
| UT-F5-1 | FR-C-1 | `scoreMatch` | TOR asks "ISO 9001 และ/หรือ ISO 14001"; vendor A holds ISO 14001, vendor B holds both | equal scores; reason `qualification-held` | Pass | `match-scorer.test.ts` |
| UT-F5-2 | FR-C-1 | `scoreMatch` (ว642) | road TOR ≥ ฿5M; vendor holds no กรมบัญชีกลาง road registration | score = registered vendor's × 0.5; first reason `registration-missing` | Pass | `match-scorer.test.ts` |
| UT-F5-3 | FR-C-2 | `scoreMatch` | TOR budget 500, outside the vendor's range | still listed (not excluded), lower score | Pass | `match-scorer.test.ts` |
| UT-F5-5 | FR-D-3 | personnel on the profile | saved with a duplicate and a name; staff only, then company certificates stated; a company certificate (ISO, มอก., SME) listed against a person; saved without the key; the main form saving; an unlisted certificate, empty role, too many; export, then account deletion | no name accepted; stored as it was; survives; `400`, nothing written; in the export and gone with the account | Pass | `profile.routes.test.ts` |
| UT-F5-6 | FR-C-1 | `scoreMatch` with personnel | TOR names an engineer's licence; staff hold it, or not; company ISO plus staff licence; only staff listed and the TOR names ISO; a person listed with ISO 9001 and the TOR asks the company for it | staff licence counted and named as the staff's; company and staff add together; no missing mark for what the company never stated; an employee never satisfies a company certificate | Pass | `match-scorer.test.ts` |
| UT-F5-7 | FR-D-2 | `MatchingExtras` | a role added, a certificate ticked, saved; a member removed | saved with `personnel` and no name; removed from the list | Pass | `MatchingExtras.test.tsx` |
| UT-F5-8 | FR-D-3 | `/me/events`, behaviour consent | an event without consent, with scoring off, for an unknown TOR, of an unknown type; consent at sign-up or later; a bookmark; withdrawal, one before any consent, and one racing a write; export and account deletion | `403`; nothing recorded; `404`; `400`; recorded only with consent, `save` by the server; events deleted on withdrawal and none left by the race, `/me` still answers; in the export; gone with the account | Pass | `behaviour.routes.test.ts` |
| UT-F5-9 | FR-C-1 | `BehaviourRepository.affinity` | repeated views and a save; no consent; switch off; an event older than the window | each (TOR, kind) stored once and counted once into points per work type, a save surviving 2,100 repeats; empty otherwise | Pass | `behaviour.routes.test.ts` |
| UT-F5-10 | FR-C-1 | `scoreMatch` with affinity | interest and dismissal in the TOR's kind of work; huge points; switch off, none, other work; an excluded TOR | score up or down by points times their value, capped, with the reason; unchanged otherwise; never rescues an exclusion | Pass | `match-scorer.test.ts` |
| UT-F5-11 | FR-D-3 | account page and `ViewBeacon` | switch hidden when scoring is off; on then off; already on; a view reported and a failed request | no section; separate calls, the account consent untouched; shown on; one `view` POST, nothing rendered | Pass | `AccountView.behaviour.test.tsx`, `ViewBeacon.test.tsx` |
| UT-F5-12 | FR-D-3 | sign-up form | switch off; on and unticked; on and ticked | no behaviour box, no flag sent; flag absent; `behaviourConsent: true` | Pass | `LoginView.behaviour.test.tsx` |
| UT-F5-13 | FR-D-3 | consent withdrawn while an event is written | the post-write consent read fails; an orphan row; fresh consent over an orphan; consent given again while live | nothing kept and the error surfaces; the sweep removes only unconsented accounts' rows; history cleared; history kept | Pass | `behaviour.routes.test.ts` |
| UT-F5-14 | FR-D-3 | `ensureIndexes` over repeated events | rows repeated per (account, TOR, kind) from before the unique key | older copies removed, latest kept, index built; a clean collection untouched | Pass | `db.behaviour.test.ts` |
| UT-F5-15 | FR-D-3 | vendor vault routes | a file; text called `.pdf`; empty, none, no or unknown type, unknown certificate; over the size cap, a full vault; no session, no origin; another account; storage failing on put and on delete | stored under the vendor's own key, listed, downloaded as an attachment with the same bytes; the bytes decide the type; every refusal stores nothing; another account sees nothing (`404`); a failed delete keeps record and file for a retry | Pass | `vault.routes.test.ts` |
| UT-F5-19 | FR-D-3 | vault upload lifecycle | an upload paused mid-body while the account is deleted (real HTTP); an upload starting on an account being deleted; the row cannot be finished and the file cannot be removed; 12 uploads at once against a cap of 3; a refused upload; a deleted file | `409` and no file, no row; the row keeps naming the file, is never listed, and the sweep (not a young row, not while storage is down) removes both; exactly 3 stored; the slot is given back | Pass | `vault.routes.test.ts` |
| UT-F5-16 | FR-D-3 | vault with the account | deleting the account; `VaultService.removeAll`; the export | files removed first and a storage failure stops the deletion with the account intact; one account's files only; the export lists what is kept, with no storage key | Pass | `accounts.routes.test.ts`, `vault.routes.test.ts` |
| UT-F5-17 | FR-D-3 | `GcsVaultStorage` (emulator) | put, delete, delete again | stored, gone, and removing it twice is not an error | Pass | `gcs.vault.storage.test.ts` |
| UT-F5-24 | FR-D-3 | Company path route (TOR-224) | no session, an unknown field, no target; what a field's TORs ask for, most asked first and each TOR once, with the typical budget; a registration only at or above the budget threshold; a field read below `T_LOW`, a restricted or duplicate TOR and a TOR of another field not counted; the cap takes the newest usable TORs by announcement date, whatever the cache refresh order and not-public rows; a budget that is unverified or out of range left out of the median; held, lacking and not-stated, a licence listed with the certifications counting as held; the vendor's largest project | `holds` is `null` until the section is stated, never "missing" | Pass | `path.routes.test.ts` |
| UT-F5-25 | FR-D-3 | `PathView` | a plain GET form of every group and field; each requirement with its count and held, lacking or not stated; the typical budget beside the vendor's largest project; an empty field; a field that could not be read | the corpus caveat shown; nothing called required | Pass | `PathView.test.tsx` |
| UT-F5-21 | FR-D-3 | AI cover-letter draft route (TOR-220) | a draft from the profile, the TOR and the kept files; which required documents are attached, missing or for the vendor to check; what is withheld (email, name, account id, storage key, hash); nothing stored; the switch off; no session, a foreign origin, an unknown, malformed or restricted TOR; no profile work; the model failing; the hourly limit per account | the model gets the Thai names and the readiness lines (several certifications "check yourself"); none of the withheld values is in what it is sent; no collection gains a row; `404`, `401`, `403`, `409 profile_needed`, `502` with a log that never holds the prompt, `429` for one account and not another | Pass | `drafts.routes.test.ts` |
| UT-F5-22 | FR-D-3 | `VertexText` | the request body and sampling; joined text and model version; an answer that did not end on `STOP` (token cap, `OTHER`, `RECITATION`, `SAFETY`, `CONTINUATION`, no reason) or is empty; a failure | the system prompt and prompt sent as given; `GenerationError` for each of those, never repeating the prompt | Pass | `vertex.text.test.ts` |
| UT-F5-23 | FR-D-3 | `DraftPanel` and its web handler | nothing requested until the button; the draft shown as AI's with the model; confirm before download and an edit takes it back; the downloaded text equals the text on screen; the server's refusal; a network failure; regenerating over edits; the box while a new draft is on its way; the handler's deadline, session, origin and failures | what is sent is said first; download disabled until confirmed; the exact edited text downloads; the server's own words shown; edits kept unless the vendor agrees; the box read-only and download off until the answer arrives; `403`, `401`, `502` before or without calling the API | Pass | `DraftPanel.test.tsx`, `draft.routes.test.ts` |
| UT-F5-20 | FR-D-3 | `readinessOf` and `ReadinessPanel` on the TOR detail page (TOR-219) | a listed certification with and without a matching certificate; a file of another kind or certificate; a document naming no listed certification; one naming several ("and" and "or"), whichever the vault holds; the list unconfirmed; no vault, no required documents | there / missing / "check it yourself", never guessed from the words; counts split between what can and cannot be checked; the block absent otherwise | Pass | `ReadinessPanel.test.tsx` |
| UT-F5-18 | FR-D-3 | `VaultPanel` and its web handlers | the list; a vault that cannot be read; an upload with its type and certificate; over the size limit; a refusal; delete with and without confirming; a full vault; bytes through the handler; a foreign origin; no session or a declared 64 MB; an endless body; 401/404/502 | listed with download links; unreadable says so; the form data sent; nothing sent over the limit; delete only after confirming; bytes unchanged; foreign origin `403`, no session `401` and a declared or streamed excess `413`, each without reading past the limit and before the API is called | Pass | `VaultPanel.test.tsx`, `app/api/vault/vault.routes.test.ts` |
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
