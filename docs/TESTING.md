# Testing — TOR Radar

_Last updated: 2026-11-03. Kept current by the rule in [CLAUDE.md](../CLAUDE.md) ("Docs stay
current"); CI fails a pull request that adds or removes a test file without updating this one._

The [SRS](SRS.md) states every requirement as a testable statement with a verification method (T
test, D demonstration, I inspection, A analysis) and gives each feature an acceptance criterion
(SRS §6). This document maps those to the automated tests that cover them and to the manual cases
that only a running stack can prove.

## 1. Running the tests

| Command | What runs | Needs |
| :---- | :---- | :---- |
| `npm test` | The whole Vitest suite: unit, route and integration tests | `docker compose up -d mongo gcs` — integration tests use a real MongoDB and the GCS emulator, each on an isolated database |
| `npm run build && npm test` | The CI order. Packages ship compiled output, so testing before building tests a source tree the app never sees | as above |
| `npx vitest run <path>` | One file | as above |
| `node tools/check_mermaid.mjs` | Parses every Mermaid block under `docs/` | nothing |
| `node tools/check_docs_drift.mjs` | Fails when code changed without its doc (rules in `tools/docs_drift.mjs`) | `git fetch origin` |
| `RUN_LIVE_VERTEX=1 npx vitest run apps/api/src/adapters/vertex.ai.test.ts` | One real Vertex AI extraction — **paid**, run deliberately | Vertex credentials |
| `GCS_REAL_TEST_BUCKET=… GCS_CREDENTIALS=… npx vitest run apps/api/src/adapters/gcs.storage.real.test.ts` | Storage contract against a real, disposable bucket (also the `gcs-real` workflow) | a throwaway bucket |

No test in the default suite calls a paid service or writes to the shared Atlas cluster.

**Unit tests passing is not verification.** A change is verified when the manual case in §3 for its
feature passes against the running stack (`docker compose up`).

## 2. Automated coverage by feature

| Feature | Requirements | Tests (paths under `apps/api/src/` unless marked `web:` = `apps/web/src/`) |
| :---- | :---- | :---- |
| **F1** Intake | FR-A-1…3, NFR-S1, S3, S5 | `modules/intake/*` (auth, routes, service, repository) · `lib/safe-fetch` · `lib/file-type` · `lib/hash` · `lib/storage-key` · `adapters/gcs.storage` · `adapters/mongo.queue` · `workers/reconcile` · `app` |
| **F2** Thai reading | FR-B-1, B-2, B-4, NFR-F3, F6 | `modules/extraction/*` (service, grading, corpus, taxonomy, categories) · `adapters/vertex.ai` · `lib/pdf-text` · `lib/parse-budget` · `workers/extract.worker*` |
| **F3** Confidence and review | FR-B-3, FR-G-1, G-2 | `modules/admin/admin.routes` · `modules/admin/admin.repository` · `lib/tor-state*` · web: `views/AdminReviewView` · `features/admin/RecordPanel` |
| **F4** Search and detail | FR-E-3…5, NFR-F2, F7 | `modules/tors/*` (routes, search, search.timing — NFR-F2 two-second bound) · `lib/stream-document` · `lib/byte-range` · `lib/content-disposition` · web: `views/SearchView` · `views/TorRecordView` · `features/search/search.params` |
| **F5** Matching and email | FR-C-1…4, NFR-F1 | `modules/matching/*` (match-scorer, tor-classifier, routes) · `modules/notifications/*` · `modules/match-quality/*` · `adapters/*mailer*` · web: `features/dashboard/MatchedTorsPanel` · `features/admin/MatchLabelSheet` |
| **F6** Profiles and accounts | FR-D-1…3, NFR-S1, S2 | `modules/accounts/*` (routes, repository, tokens, password, sessions) · `modules/profile/profile.routes` · `modules/bookmarks/*` · `core/auth-middleware` · `core/db.accounts` · `modules/admin/admin-accounts.routes` · web: `views/VendorProfileView` · `features/profile/*` · `views/AdminVendorView` |
| **F7** Dashboard and anomaly | FR-E-1, E-2, E-6, NFR-F4, F5 | `modules/stats/*` (anomaly.rule, cohort, eligibility, repository, routes) · `core/db.stats` · `lib/budget-year` · `tools/backfill_cohorts` · web: `views/DashboardView` · `shared/lib/dashboard-filters` |
| **F8** Quality checklist | FR-F-1…4, NFR-F5, F6 | `modules/checklist/checklist` · `modules/tors/tors.service.checklist` · web: `features/tor-detail/ChecklistPanel` |
| **F9** Taxonomy | FR-G-3, FR-B-4 | `packages/seeds/src/work-categories` · `packages/seeds/src/provinces` · `modules/extraction/extraction.taxonomy` · web: `features/profile/TaxonomyPicker` |
| **F10** PII and takedown | FR-B-5, B-6, NFR-S2, S3 | `lib/redact` · `modules/admin/admin.routes` (reject/restore) · `modules/accounts/accounts.routes` (export, delete) |
| **F11** CSV export | FR-E-7 | — not built |
| **F12** Automated collection | FR-A-4 | `sources/national-egp/*` · `sources/bma-egp/enrich` · `routes/sources` (collection only; per-adapter health reporting is not built) |
| Cross-cutting | NFR-S7 config, admin UI | `core/config` · `lib/metadata-header` · web: `views/AdminTorsView` · `features/admin/AdminTorsTable` · `features/admin/admin.actions` · `features/admin/StaffLoginForm` · `shared/lib/staff-session` · `shared/api/api-client` · `shared/lib/format` · `shared/ui/BudgetRange` |

## 3. Manual acceptance cases

Run against `docker compose up` with the seeded corpus. Each case is the SRS §6 criterion turned into
steps. Record the date and result in the last column when a case is run for a review or demo.

| ID | Feature | Steps | Expected | Last run |
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
