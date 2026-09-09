# TOR Radar — Extraction and Confidence (Slice 2) — Design

**Date:** 2026-09-09
**Status:** draft — **not yet externally cross-checked** (see §11)
**Source of truth:** `docs/SRS.md` v2.0
**Benchmark input:** `docs/corpus/BENCHMARK.md` (TOR-18, phase gate PASSED)
**Covers:** F2 (Thai OCR + nine-field extraction) and the F3 confidence-tiering half of Slice 2 —
the pipeline that turns a stored document into a graded, published TOR record. Realises step 4 and
step 5 of SRS §2.6, and `UC-8` in part.

Jira: story **TOR-88** (subtasks TOR-89 extraction service, TOR-90 confidence + tier logic,
TOR-91 sanity checks, TOR-92 taxonomy mapping, TOR-93 PII minimisation, TOR-120 tests) plus
**TOR-126** (the worker harness — already merged on this branch).

---

## 1. Context

Slice 1 built intake: a document arrives by one of three routes, its bytes are stored immutably,
a `tors` record is inserted in `pipeline.state = "queued"`, and a job is enqueued. TOR-126 added
the worker: it claims the job, moves the record `queued → extracting`, calls an `ExtractionHandler`,
and moves it to `published` or, after retries, `failed`. Slice 1 shipped a **pass-through** handler.

Slice 2 replaces that handler body with the real thing:

1. fetch the stored document,
2. OCR + extract the nine FR-B-2 fields, each with a confidence value (FR-B-1, FR-B-2),
3. grade the record against §4.2.1 using the policy the TOR-18 benchmark settled (FR-B-3),
4. map the extracted qualifications onto the skill taxonomy (FR-B-4),
5. write `fields`, `confidenceLevel`, `unverified`, provenance, and `announcedAt` back,
6. and provide the one serializer that minimises personal data in anything shown publicly (FR-B-5).

The worker still owns the `published`/`failed` transition; every readable record publishes,
because §4.2.1 says confidence controls **marking and review, not visibility**.

### 1.1 What the benchmark already settled

`docs/corpus/BENCHMARK.md` measured 10 labelled + 5 scanned real BMA TORs against `gemini-3.5-flash`
with native-PDF input. Load-bearing results:

- **One multimodal Gemini call does OCR + layout + extraction.** Thai OCR is not the blocker:
  `agency`, `category`, `status`, `procurement_method` scored 100% on digital docs and stayed
  100% on scans; `title` 100%/60%; `budget` 100% digital.
- **Model self-confidence does not discriminate.** Mean confidence was 0.965 on correct answers and
  0.971 on wrong ones. A threshold on the model's number alone is not a usable gate.
- **The failure modes are numeric and date fields on OCR'd documents** — a one-digit budget
  misread (17,295,**8**95 vs 17,295,**8**45) and over-eager `submission_deadline` extraction
  (0/5 correct on scans, all at ~1.0 confidence).
- **O1 is now closed:** `T_low = 0.80`, `T_high = 0.95`, applied **after** deterministic per-field
  rules, never before.

### 1.2 Scope correction carried in

`BENCHMARK.md` still phrases one queue trigger as "`agency` fails the BMA check (FR-A4)". That rule
is **withdrawn** — SRS v2.0 and `CLAUDE.md` make scope national and agency a plain extracted field.
The trigger below is `agency` **missing or empty**, nothing about which province it names.

---

## 2. Decisions

| # | Decision | Rationale |
| :---- | :---- | :---- |
| D1 | **One Gemini multimodal call per document. No separate Document AI OCR pass.** | The benchmark proves it: native-PDF Gemini OCRs Thai well enough, and a second service is throughput this project (NFR-S4) does not have. Document AI stays a fallback for a document class Gemini vision later fails on — added as a second `Ai` adapter, not a rewrite (Slice-1 D7). |
| D2 | **`ports/ai.port.ts` speaks the domain**: `extract(document) → RawExtraction`. The adapter, not the port, knows the word "Gemini". | Rule 2: modules import ports. The extraction service is unit-tested with a fake `Ai`; `vertex.ai.ts` is integration-tested on its own. Swapping models or adding Document AI is one adapter. |
| D3 | **Grading is deterministic rules first, model confidence second** (§6). | The benchmark's central finding. A field only reaches the "clean" tier after passing its structural checks; the model's confidence is a secondary gate inside the band the rules allow. |
| D4 | **`confidenceLevel` is computed from the *critical* fields and the sanity result**, not averaged over all nine. | §4.2.1: "High — every critical field at or above T_high"; "Low — a critical field missing or implausible". Averaging would let a shaky `contact` field drag a solid record down, or a strong `title` hide a missing `budget`. Critical set: **agency, budget** (see §10 Q3 — `deadline` dropped after the corpus showed 0/10 real TORs state one). |
| D5 | **Per-field `verified: false` is the anomaly/matching gate**, set by grading; downstream (§4.5.1, FR-C-1, FR-C-4) reads `field.verified === true`, never the raw confidence. | Keeps "a misreading can neither create a flag nor move one" (§4.5.1) enforceable in one place — the grader — rather than re-implemented in every consumer. |
| D6 | **`hasTextLayer` is detected before the model call** and stored on the record. | The tier rules treat an OCR'd `budget`/date differently from a digital one. Asking the model whether it OCR'd is unreliable; a text-layer probe (`lib/pdf-text.ts`) is deterministic and ~1 ms. Images are always "no text layer". |
| D7 | **Provenance records one model for both OCR and extraction** (D1). `thresholdsVersion` is a config value. | NFR-F6. When O1's thresholds are re-measured, `thresholdsVersion` distinguishes records graded old from new without a migration (Slice-1 §4.2). |
| D8 | **The review queue is a *query*, not a flag**: `confidenceLevel: "low"`. TOR-88 produces the grade; the admin correction flow (FR-G-1/G-2) is a separate FR-G story. | TOR-88's subtasks are the pipeline, not an admin screen. A `low` record is already the queue; `needsReview` would be a denormalised duplicate of `confidenceLevel`. An index on `confidenceLevel + createdAt` serves the queue view. |
| D9 | **PII minimisation lives in `lib/redact.ts`** — one function, imported by every public serializer. | FR-B-5, NFR-S2, and Slice-1 §4.7: "Redaction lives in a single serializer so no route can omit it by accident." `lib/` because both `modules/tors` (read API, Slice 3) and CSV export (Slice 3) need it and neither owns the other. |
| D10 | **A minimal skill taxonomy is pulled forward into `packages/seeds/taxonomy.json`** for FR-B-4; mapping is keyword-based. | FR-B-4 references FR-G-3's taxonomy, which is Slice 4. Matching (Slice 4) needs *something* to match on. A curated ~30-tag seed plus a keyword map is cheap, testable, and replaced wholesale when F9 builds the real editor. **See §10 Q1.** |
| D11 | **The extraction service throws on any failure** (model error, timeout, unparseable output, empty critical extraction). | NFR-S5: the worker already catches, retries, and after `JOB_MAX_ATTEMPTS` marks the record `failed` with the reason, raw document retained. The service adds no partial-write path — it writes the record once, at the end, or not at all. |

---

## 3. Structure

```
apps/api/src/
├── ports/
│   └── ai.port.ts                       NEW  Ai: extract(doc) → RawExtraction
├── adapters/
│   ├── vertex.ai.ts                     NEW  one Gemini multimodal call, structured output
│   └── vertex.ai.test.ts                NEW  integration (skipped without GCP creds)
├── modules/extraction/
│   ├── extraction.service.ts            NEW  the ExtractionHandler body (fetch → extract → grade → write)
│   ├── extraction.service.test.ts       NEW  unit, fake Ai + fake Storage + fake repo
│   ├── extraction.repository.ts         NEW  the only file writing fields/confidence/provenance to `tors`
│   ├── extraction.grading.ts            NEW  pure: RawExtraction + context → GradedFields + confidenceLevel
│   ├── extraction.grading.test.ts       NEW  the §6 policy, table-driven
│   ├── extraction.taxonomy.ts           NEW  pure: qualification strings → taxonomy tags (FR-B-4)
│   └── extraction.taxonomy.test.ts      NEW
├── lib/
│   ├── redact.ts                        NEW  FR-B-5 PII minimisation, one place
│   ├── redact.test.ts                   NEW
│   ├── pdf-text.ts                      NEW  hasTextLayer(bytes, contentType) → boolean
│   └── pdf-text.test.ts                 NEW
├── core/config.ts                       EDIT  T_LOW/T_HIGH promoted from OPEN_VALUES; Vertex + budget bounds
└── workers/extract.worker.ts            EDIT  startWorker wires ExtractionService.run, not passThroughHandler

packages/seeds/
├── package.json                         NEW  @tor-radar/seeds
└── taxonomy.json                        NEW  ~30 curated skill tags + keyword aliases  (see §10 Q1)
```

`modules/extraction/` is four source files — under the six-file tripwire. `grading.ts` folds tiering
and the sanity checks together because both answer one question: *given the fields, what is the
confidence level*.

---

## 4. Data model

No new required collections. The `tors` record shape from Slice-1 §4.2 is populated, plus two fields.

### 4.1 `tors.fields` after extraction

Each of the nine FR-B-2 fields becomes an `ExtractedField` (`packages/shared/src/tor.ts`):

```js
fields: {
  title:          { raw, value, confidence, verified },
  agency:         { raw, value, confidence, verified },
  budget:         { raw, value, currency: 'THB', confidence, verified },   // value is a number
  category:       { raw, value, confidence, verified },
  scopeSummary:   { raw, value, confidence, verified },
  qualifications: { raw, value: string[], tags: string[], confidence, verified },  // tags from FR-B-4
  deadline:       { raw, value, confidence, verified },                    // value is YYYY-MM-DD
  contact:        { raw, value, confidence, verified },
  torStatus:      { raw, value: 'announced'|'closed'|'awarded'|'cancelled', confidence, verified },
}
```

- `raw` is displayed verbatim (NFR-F7). `value` is normalised (Arabic digits, ISO date, number)
  and is what statistics and filters compute on. A parsing change can never move a displayed value.
- `verified` starts `false`. Grading sets it `true` only for fields that reach the clean tier.
  An admin approval (FR-G story) also sets it `true`.
- `procurement_method` and `reference_no` are extracted (the benchmark does) and stored under
  `fields.*` as extra `ExtractedField`s — useful on the detail page (FR-E-4), not part of the nine,
  never `verified` gated because nothing downstream depends on them.

### 4.2 Two record fields set by this slice

```js
announcedAt,          // from fields' announcement_date; null when the document does not state one.
                      // Slice-1 already reserves this. Records without it are excluded from the
                      // FR-E-1 trend rather than defaulted to createdAt.
confidenceLevel,      // 'high' | 'medium' | 'low' — §4.2.1, computed by grading
unverified,           // Boolean — true for medium and low
hasTextLayer,         // Boolean — digital PDF vs an OCR'd scan/photo (D6), drives grading
provenance: {
  ocrModel, extractModel,   // same value (D1), e.g. "gemini-3.5-flash"
  modelVersion,             // the resolved model version string Vertex returns
  extractedAt,              // Date
  thresholdsVersion,        // config THRESHOLDS_VERSION at grading time
}
```

### 4.3 Index

```
tors.confidenceLevel + createdAt      the review-queue view (D8) and the "unverified" filters
```

### 4.4 `corrections` — shape defined, not written here

FR-G-2 retains every admin correction as an extractor example. The collection is defined so a later
slice needs no migration; nothing in TOR-88 writes it.

```js
{ torId, field, before: ExtractedField, after: ExtractedField, actor, at }
```

---

## 5. Interaction

### 5.1 The extraction handler

```
worker claims the job, sets pipeline.state = "extracting"          (TOR-126, done)
   │
   ▼
ExtractionService.run(torId)
   │  1. repo.load(torId)                         → storage key, contentType
   │  2. Storage.get(key)                         → bytes            (FR-A-2 read path)
   │  3. hasTextLayer = pdfText.hasTextLayer(bytes, contentType)     (D6)
   │  4. Ai.extract({ bytes, contentType })       → RawExtraction    (FR-B-1, FR-B-2)
   │        one Gemini call, structured JSON: nine fields + method + reference,
   │        each { raw, value, confidence, evidence }
   │  5. tags = taxonomy.map(raw.qualifications.value)               (FR-B-4)
   │  6. { fields, confidenceLevel, unverified } =
   │        grading.grade(raw, { hasTextLayer, config })            (FR-B-3, §6)
   │  7. repo.writeExtraction(torId, {
   │        fields, tags, announcedAt, confidenceLevel, unverified,
   │        hasTextLayer, provenance })            ← the single write
   ▼
returns; the worker sets pipeline.state = "published"               (TOR-126, done)

any throw → worker retries; after JOB_MAX_ATTEMPTS → failed + reason, bytes retained  (NFR-S5)
```

Ordering rule: **the record is written once, at step 7.** No field is persisted before the whole
extraction and grading succeed, so a crash mid-way leaves the previous state (`extracting`) and the
job is retried — never a half-populated record that publishes as if complete (NFR-S5).

### 5.2 `Ai` port

```typescript
export interface ExtractionInput { bytes: Buffer; contentType: string; }

export interface RawField<T = string> { raw: string; value: T | null; confidence: number; evidence: string; }

export interface RawExtraction {
  title: RawField;  agency: RawField;  budget: RawField<number>;  category: RawField;
  scopeSummary: RawField;  qualifications: RawField<string[]>;  deadline: RawField;
  contact: RawField;  status: RawField<'announced'|'closed'|'awarded'|'cancelled'>;
  announcementDate: RawField;  procurementMethod: RawField;  referenceNo: RawField;
  modelVersion: string;
}

export interface Ai { extract(input: ExtractionInput): Promise<RawExtraction>; }
```

The Vertex adapter reuses the prompt and response schema proven in `tools/extract_spike.mjs`
(rewritten in TS), the retry-on-429/503 and JSON-slice guards from the same file, a timeout from
`EXTRACT_TIMEOUT_MS`, and `google-auth-library` for the service-account credential (already a
dependency from TOR-19). It throws `ExtractionError` on a non-2xx, an unparseable body, or a
response missing a required field.

### 5.3 Errors

`core/errors.ts` gains `ExtractionError` (retryable) and `DocumentUnreadableError` (terminal —
the model returned nothing usable for the critical fields; retrying will not help, so the service
throws it and the worker, seeing a terminal error, fails the record immediately without exhausting
`JOB_MAX_ATTEMPTS`). *(Worker change: `runOnce` distinguishes a terminal error — see §9.)*

### 5.4 Configuration added (`core/config.ts`, NFR-S7)

| Key | Default | Source |
| :---- | :---- | :---- |
| `T_LOW` | `0.80` | **measured** — `BENCHMARK.md`; O1 closed |
| `T_HIGH` | `0.95` | **measured** — `BENCHMARK.md`; O1 closed |
| `THRESHOLDS_VERSION` | `"2026-09-03"` | the benchmark date; bumped when O1 is re-measured |
| `GEMINI_MODEL` | `gemini-3.5-flash` | TOR-19 |
| `VERTEX_LOCATION` | `global` | TOR-19 |
| `GOOGLE_CLOUD_PROJECT` | *(required)* | TOR-19 |
| `GOOGLE_APPLICATION_CREDENTIALS` | *(required)* | TOR-19 |
| `EXTRACT_TIMEOUT_MS` | `120000` | a 20-page scan takes ~15 s; headroom for retries |
| `BUDGET_MIN_THB` | `10000` | sanity floor (§6) |
| `BUDGET_MAX_THB` | `100000000000` | sanity ceiling (§6) — ฿100 bn |

`T_LOW` / `T_HIGH` move out of `OPEN_VALUES`. `MIN_BID_WINDOW_DAYS`, `MIN_SCOPE_*`, `ANOMALY_METHOD`
stay open (O2–O4, not this slice).

---

## 6. The confidence policy (§4.2.1 realised)

Grading is a pure function: `grade(raw, { hasTextLayer, config }) → { fields, confidenceLevel, unverified }`.
It runs in three passes.

### Pass 1 — per-field structural checks (deterministic, model confidence ignored)

| Field | `verified` requires | else |
| :---- | :---- | :---- |
| `agency` | non-empty after trim | never verified |
| `title` | non-empty after trim | never verified |
| `budget` | `value` is a number in `[BUDGET_MIN_THB, BUDGET_MAX_THB]`, **and** `hasTextLayer` (a budget read off a scan is never clean — the benchmark's one-digit misread) | never verified |
| `deadline` | parses to a valid date **≥** `announcedAt` (when both known), **and** `hasTextLayer` | never verified |
| `torStatus` | one of the four enum values | never verified |
| `category` | non-empty | never verified |
| `scopeSummary` | ≥ 40 characters after trim | never verified |
| `qualifications` | at least one tag mapped (FR-B-4) | never verified |
| `contact` | — (never anomaly- or match-gated; `verified` tracks display confidence only) | — |

### Pass 2 — model confidence, second

For a field that passed Pass 1, `verified = confidence >= T_high`. A field that passed Pass 1 but
scored `T_low ≤ confidence < T_high` is published unmarked-per-field but **not** `verified`
(so it does not feed anomaly stats or matching until an admin confirms). Below `T_low` it is
treated as a Pass-1 failure.

### Pass 3 — sanity checks (FR-B-3 "a critical field missing or implausible"; TOR-91)

The record is **low** if any of:

- `agency` or `budget` is missing (no `value`, or confidence `< T_low`).
  **Not `deadline`** — resolved against the corpus (§10 Q3): most Thai draft
  TORs state no submission date, so a missing deadline is not a queue trigger; a
  deadline that is *present but implausible* still trips the checks below.
- `budget.value` present but outside `[BUDGET_MIN_THB, BUDGET_MAX_THB]`;
- `deadline.value` present and **before** `announcedAt`;
- `torStatus.value` is `cancelled` **and** a `deadline.value` was extracted — a cancellation notice
  states no submission date, so one that carries a deadline is the benchmark's
  `submission_deadline` hallucination signature;
- `torStatus.value` is `closed` / `awarded` **and** the deadline is still in the **future** — a
  finished procurement legitimately has a past deadline, so only a future one is a contradiction
  (narrowed 2026-09-09 in review: the original rule flagged every historical closed record that
  stated its deadline, which is most of them);
- the model returned identical `raw` for three or more distinct fields (a copy-through failure).

### Record `confidenceLevel`

| Level | Condition |
| :---- | :---- |
| **low** | any Pass-3 sanity check fired, **or** either of {agency, budget} failed Pass 1 |
| **high** | not low, **and** both critical fields {agency, budget} are `verified` |
| **medium** | otherwise |

`unverified = confidenceLevel !== "high"`. A `low` record is the review queue (D8).

Worked expectation against the benchmark corpus: the 10 digital docs with a stated budget grade
**high**; the drafts with no budget/deadline stated grade **low** and queue (correctly — a TOR with
no budget *is* a record an admin should look at); the scanned cancellation notice grades **low**
(Pass-3 status+deadline rule catches the hallucinated date). TOR-89 validates this on the real
corpus before TOR-90–93 build on the grade (§8).

---

## 7. FR-B-5 — personal data (`lib/redact.ts`, TOR-93)

`redactTor(record, { audience: 'public' | 'admin' })`:

- `audience: 'admin'` returns the record unchanged (the review queue shows everything).
- `audience: 'public'` returns a copy with `fields.contact` reduced to its non-personal parts:
  an office name and a `bangkok.go.th` / `gprocurement.go.th` URL are kept; a personal name, a
  mobile number, an email, and a signature line are dropped. A bare office phone (`0-2xxx-xxxx`)
  is kept; anything matching a mobile prefix (`06`, `08`, `09`) is dropped. The rule set is a
  small table in the file, not scattered regexes.
- The original document stays reachable through its source link regardless (FR-B-5, NFR-S3).

Nothing serves a TOR publicly in Slice 2 (the read API is Slice 3). TOR-93 delivers the function
and its tests; Slice 3's `modules/tors` serializer and Slice 3's CSV export both call it.

---

## 8. Verification

| Level | Proves | How |
| :---- | :---- | :---- |
| Unit | The §6 policy | `extraction.grading.test.ts` — table-driven over crafted `RawExtraction`s: each Pass-3 trigger, each critical-field-missing path, the T_low/T_high bands, the OCR'd-budget rule |
| Unit | The handler orchestration | `extraction.service.test.ts` — fake `Ai`, `Storage`, repo: a clean extraction writes once with `high`; an `Ai` throw propagates (no write); a `DocumentUnreadableError` propagates terminal |
| Unit | Redaction | `redact.test.ts` — a contact string with a mobile, an office line, a name, and a URL: mobile and name gone, office and URL kept; admin audience untouched |
| Integration | The Vertex adapter | `vertex.ai.test.ts` against real Vertex with the GCP service account — **skipped when the credential is absent**, so CI without secrets stays green; run locally and in the nightly |
| **Corpus** | The grade is right on real documents | **TOR-89 gate:** run `ExtractionService` (real `Ai`, fake `Storage` feeding `docs/corpus/tor-*.pdf`) over all 10 labelled docs; assert the resulting `confidenceLevel` and per-field `verified` match a hand-written expectation table derived from `docs/corpus/labels/`. This is the check that the schema and policy survive contact with reality before TOR-90–93 are built on them |
| Live | The requirement | Upload a real scanned Thai TOR through the running stack (TOR-73's route or a direct `curl`); confirm the record reaches `published`, carries nine `fields` each with a confidence, a `confidenceLevel`, and provenance naming the model and version (F2 acceptance, SRS §6) |

CI adds no new required secret: the corpus gate uses the same `GOOGLE_APPLICATION_CREDENTIALS`
the nightly already needs for `vertex.ai.test.ts`; on a PR from a fork without the secret both are
skipped and the pure grading/redaction/taxonomy tests still run.

---

## 9. Worker change

`workers/extract.worker.ts`:

- `startWorker(config, handle?)` — `handle` defaults to a real `ExtractionService.run` bound to
  MinIO storage, the Vertex adapter, and `ExtractionRepository`, instead of `passThroughHandler`.
  `passThroughHandler` stays exported for tests and for a `--dry-run` mode.
- `runOnce` gains a terminal-error branch: a `DocumentUnreadableError` fails the record immediately
  (`onFailed`) without calling `queue.fail`'s retry path. Every other throw keeps the existing
  retry-with-backoff behaviour.

---

## 10. Open questions for review

Flagged because this design has **not** had the different-company cross-check Slice 1 got (§11).
Status added after the TOR-89 corpus gate ran.

| # | Question | Answer | Status |
| :---- | :---- | :---- | :---- |
| Q1 | FR-B-4 taxonomy mapping now, or defer to Slice 4 when F9 seeds the real taxonomy? | Pull a ~30-tag seed forward (`packages/seeds/taxonomy.json`), keyword-map now (D10). `qualifications.value` keeps the raw strings; only `.tags` would be recomputed if F9's shape differs. | **open** — TOR-92 |
| Q2 | Is the `hasTextLayer` probe the right OCR/digital signal? | Deterministic Flate-stream `Tj`/`TJ` count (D6). Corpus gate: correct on all 10 (5 digital true, plus `_extra` scans false). | **resolved for the corpus.** A garbled-text-layer PDF (`_extra/tor-16`) would still fool it — noted for a future text-density second check if such a doc appears. |
| Q3 | Critical fields include `deadline`? A TOR with a stated budget but no public deadline would grade `low` forever. | **No.** Critical = {agency, budget}. Most Thai draft TORs state no deadline (it lives in the paired ประกาศ); the corpus is 0/10 with a deadline. A missing deadline leaves that field unverified; a *present-but-implausible* deadline still trips Pass 3. | **resolved** against the corpus. §6 and the code updated. |
| Q4 | `procurementMethod` / `referenceNo` as extra `ExtractedField`s — scope creep? | Keep — cheap, the detail page shows "the structured fields", never anomaly- or match-gated. | **open** — reviewer's call |
| Q5 | The corpus gate asserts the grade against a hand table; is 10 docs enough? | Assertions relaxed to *allowed sets* per doc (high↔medium wobble on a correct budget is expected — BENCHMARK.md), plus a distribution check. Gate result: agency/budget/status match labels on all 10; grade distribution high:5 / low:5. | **resolved** — reviewer should still read `ALLOWED_LEVELS` against §4.2.1. |

---

## 11. Cross-check record

**Not yet done.** Slice 1's design was reviewed by Codex (a different-company model) before anything
was built on it; this one has had only the author's structured self-review against SRS v2.0, the
Slice-1 spec, and `BENCHMARK.md`. The §10 questions are the known-unknowns from that review.

**Requested at PR time:** a reviewer (Sudha owns epic TOR-3) reads §4, §6, and §10 against
SRS §4.2, §4.2.1, and FR-B-1…B-5 before approving the implementation commits stacked behind this
spec. TOR-89 is deliberately gated on the real corpus (§8) so a policy error surfaces there rather
than after TOR-90–93.

---

## 12. Out of scope for slice 2

The admin review-queue screen and the correction/approval flow (FR-G-1/G-2 — a separate FR-G
story) · the public TOR read API and detail page (Slice 3) · the anomaly rule and the dashboard
(Slice 3) · the real editable taxonomy (F9, Slice 4) · Document AI as a live OCR path (added only
if a later corpus shows Gemini vision failing) · live source adapters (F12).
