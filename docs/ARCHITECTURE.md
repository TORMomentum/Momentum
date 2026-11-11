# Architecture

How TOR Radar is put together: what the pieces are, where each kind of code lives, how a document
travels through the system, and which rules must stay true.

This document answers *where* — where does this behaviour live, where does a change belong. It does
not restate *what* the system must do (that is [SRS.md](SRS.md)) or *how* one slice is built (that
is [superpowers/specs/](superpowers/specs/)). It is deliberately short and changes only a few times
a year, per the [ARCHITECTURE.md convention](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html).

**Legend used throughout:** ✅ built · 🔨 being built now · ⬜ planned, with the slice that brings it.

---

## 1. The problem, in four sentences

Thai government agencies publish procurement Terms of Reference across dozens of websites, as PDFs,
scans, and HTML pages, in no common format. A small vendor cannot practically watch all of them, and
a citizen cannot practically compare prices across them. TOR Radar collects those published
documents, extracts their fields with AI, matches them against vendor skill profiles, emails the
vendors within minutes, and publishes a public dashboard with a documented statistical-anomaly rule.
Everything it publishes is traceable to an unaltered original document.

---

## 2. System context

Who and what the system talks to. (C4 level 1 — [c4model.com](https://c4model.com).)

```mermaid
flowchart TB
    vendor["👤 Vendor<br/><i>SME, freelancer</i><br/>wants TORs matching their skills"]
    public["👤 Public · journalist · researcher<br/>wants to compare and audit spending"]
    admin["👤 Admin<br/><i>platform staff</i><br/>reviews low-confidence extractions"]

    system["<b>TOR Radar</b><br/>collects · extracts · matches · publishes<br/>Thai-language web platform"]

    agencies["🏛️ Government publication sites<br/><i>read-only source</i><br/>agencies are NOT users"]
    vertex["☁️ Google Vertex AI<br/>Document AI OCR · Gemini extraction"]
    smtp["✉️ SMTP provider<br/>the only notification channel"]

    agencies -->|"published PDFs, scans,<br/>HTML announcements"| system
    system -->|"OCR + field extraction<br/>with confidence"| vertex
    vertex -.->|"values + confidence"| system
    system -->|"match emails,<br/>deadline reminders"| smtp
    smtp -.->|"delivered to inbox"| vendor

    vendor -->|"skill profile,<br/>search, bookmarks"| system
    public -->|"dashboard, search, CSV export"| system
    admin -->|"review queue, corrections"| system

    classDef sys fill:#1d63d8,stroke:#12233c,color:#fff,stroke-width:2px
    classDef ext fill:#eef2f8,stroke:#8896ad,color:#12233c
    classDef person fill:#fff,stroke:#12233c,color:#12233c
    class system sys
    class agencies,vertex,smtp ext
    class vendor,public,admin person
```

Two boundaries worth stating out loud, because they are easy to assume wrongly:

- **Agencies are a data source, not users.** There is no agency portal and no agency upload flow
  (SRS §1.3 S8).
- **Email is the only notification channel.** No in-app inbox, no chat webhook, no SMS.

---

## 3. Containers

The runnable pieces and how they talk. (C4 level 2.)

```mermaid
flowchart TB
    browser["🌐 Browser"]

    subgraph compose["Docker Compose network · project tor-radar"]
        web["<b>web</b> ✅<br/>Next.js 16 App Router<br/>:3000"]
        api["<b>api</b> ✅<br/>Express 5 REST<br/>:4000"]
        worker["<b>worker</b> ✅<br/>same image as api,<br/>different command"]
        stats["<b>stats worker</b> ✅<br/>recomputes peer bounds<br/>and rollup cells ·<br/>no Compose service yet"]
        mongo[("<b>mongo</b> ✅<br/>MongoDB 8 (Atlas Local)<br/>metadata, job queue,<br/>peer statistics")]
        gcs[("<b>gcs</b> ✅<br/>fake-gcs-server emulator<br/>original documents")]
    end

    vertex["☁️ Vertex AI ✅<br/>Gemini"]
    smtp["✉️ SMTP ✅<br/>dispatch off until<br/>the match benchmark"]
    realgcs[("☁️ Google Cloud Storage<br/>deployment only")]

    browser -->|"HTTPS, incl. streamed<br/>document bytes"| web
    web -->|"REST<br/>API_BASE_URL"| api

    api -->|"records, dedupe,<br/>enqueue"| mongo
    api -->|"putIfAbsent, getStream,<br/>GCS_API_ENDPOINT"| gcs
    worker -->|"claim job,<br/>write result"| mongo
    worker -->|"fetch bytes by key"| gcs
    worker -->|"OCR + extract"| vertex
    worker -->|"match emails"| smtp
    stats -->|"claim dirty cohort,<br/>write bounds + rollups"| mongo
    api -->|"read bounds,<br/>judge at read"| mongo
    gcs -.->|"same client,<br/>real credentials"| realgcs

    classDef built fill:#e8f0fe,stroke:#1d63d8,color:#12233c,stroke-width:2px
    classDef store fill:#f1f4f9,stroke:#12233c,color:#12233c
    class web,api,worker,stats built
    class mongo,gcs,realgcs,vertex,smtp store
```

**Why the statistics worker is separate from the extraction worker:** a stalled OCR call must not
stop the dashboard's figures going stale-free, and recomputing a peer group is cheap work on a
different cadence from extraction. Dirty cohorts are drained at the queue poll interval; a full
sweep of every cohort runs on its own longer interval, so a mark that never arrived costs one
interval of staleness rather than a record permanently missing from the figures.

**Why the worker is its own service rather than a thread in the API:** restarting the API must not
kill a job in flight, and a failing extraction should be visible in its own logs. It shares the API
image and differs only by command, so this costs one Compose entry, not a second codebase.

**The storage seam:** the browser never reaches storage directly — no signed link, no second
endpoint. It streams through the API and a Next route handler on the app's own origin instead
(object storage spec §5), which is what lets a takedown apply on the very next request and every
response carry `nosniff` and `no-store`. `gcs` in Compose is `fake-gcs-server`, pinned; deployment
points the same `@google-cloud/storage` client at the real service with `GCS_API_ENDPOINT` unset.

---

## 4. Codemap

Where each kind of code lives, and — as importantly — what each folder is not allowed to do.

### Repository root

| Path | Holds | Rule |
| :--- | :--- | :--- |
| `apps/web/` | Next.js frontend | `app/` is routing only; UI code lives in `src/` |
| `apps/api/` | Express API and the worker | Feature modules, ports, adapters |
| `packages/shared/` | Types and Zod schemas both apps import | No runtime dependencies on either app |
| `docs/` | SRS, this file, design specs, plans, benchmark evidence | — |
| `mockups/` | Design-canvas source the UI was ported from | Never built, never linted, never imported |
| `tools/` | Jira seeding, Vertex checks, extraction scoring | Operational scripts, not app code |

### `apps/api/src/`

```mermaid
flowchart LR
    routes["modules/*/**.routes.ts<br/><i>HTTP shape, validation</i>"]
    service["modules/*/**.service.ts<br/><i>the actual rules</i>"]
    repo["modules/*/**.repository.ts<br/><i>the ONLY DB caller</i>"]
    ports["ports/*.port.ts<br/><i>interfaces</i>"]
    adapters["adapters/*.ts<br/><i>GCS, Mongo queue</i>"]
    app["app.ts<br/><i>wiring, once</i>"]

    routes --> service
    service --> repo
    service --> ports
    app -.->|"injects"| adapters
    adapters -.->|"implements"| ports

    classDef mod fill:#e8f0fe,stroke:#1d63d8,color:#12233c
    classDef port fill:#fff8ec,stroke:#b45309,color:#12233c
    class routes,service,repo mod
    class ports,adapters,app port
```

| Path | Holds | Rule |
| :--- | :--- | :--- |
| `core/config.ts` | Every threshold, host, port, credential, model name | No literal thresholds anywhere else |
| `core/db.ts` | Collection handles and index creation | — |
| `core/errors.ts` | Typed errors and the error middleware | Zod failures become 400, never 500 |
| `lib/` | Pure helpers: `hash`, `file-type` (magic bytes), `safe-fetch` (SSRF) | No I/O beyond what the helper is for |
| `ports/` | `Storage`, `VaultStorage`, `Queue`, `Ai`, `TextGenerator`, `Mailer` interfaces | `Storage` exposes `putIfAbsent`, never `put`, and never deletes; `VaultStorage` adds `delete` for a vendor's own files, on a bucket of its own |
| `adapters/` | GCS storage, Mongo-backed queue, Vertex AI (extraction, and plain text for the draft), SMTP and recording mailers | Imported by `app.ts` only |
| `modules/<feature>/` | One feature, files prefixed with its name | `modules/` imports `ports/`, never `adapters/` |
| `workers/` | Extraction, statistics and notification workers, and the orphan reconciler | Same wiring rules as the API |

The feature modules, as of Sprint 4:

| Module | Owns |
| :--- | :--- |
| `intake/` | The three intake routes, dedupe, immutable storage, enqueue |
| `extraction/` | OCR and field extraction, confidence grading |
| `tors/` | Public search, facets, detail and document streaming; the signed-in match-range filter |
| `stats/` · `checklist/` | Dashboard figures and the anomaly rule · the specification-quality checklist |
| `accounts/` | Registration, sign-in, sessions, password reset, PDPA export and deletion |
| `profile/` | The vendor profile, and its separately saved past projects, certifications and personnel |
| `matching/` | TOR classification, the scorer and its signals, a vendor's scored list |
| `notifications/` | Match emails, the dispatch lease, and the staff "send now" |
| `bookmarks/` | A vendor's private saved list |
| `path/` | The company path: a field's sampled TORs read for what they ask for, against the vendor's profile; one route, stores nothing (TOR-224) |
| `drafts/` | The AI cover-letter draft for a TOR: the prompt, the facts it is built from, one rate-limited route; stores nothing (TOR-220) |
| `vault/` | A vendor's own files (CV, certificates, past work): upload, list, download, delete; the bytes in the vault bucket, the record here, written before the bytes; the worker's reconcile pass sweeps unfinished uploads (TOR-218) |
| `behaviour/` | What a consenting vendor viewed, saved, dismissed or prepared, recorded and turned into per-work-type points for the score; the worker's reconcile pass deletes rows of accounts without live consent |
| `admin/` | The review queue, record correction, bulk actions, vendor accounts and their audit |
| `match-quality/` | The labelled benchmark that gates match emails (matching design §7.8) |
| `history/` | `tor_events`, the append-only transition log |

### `apps/web/src/`

Imports flow one direction and never upward:

```mermaid
flowchart LR
    app["app/<br/><i>routes only</i>"] --> views
    views["views/<br/><i>one per screen</i>"] --> features
    features["features/<br/><i>screen parts + their CSS</i>"] --> entities
    entities["entities/<br/><i>domain pieces</i>"] --> shared
    shared["shared/<br/><i>ui, lib, styles/tokens</i>"]

    classDef l fill:#e8f0fe,stroke:#1d63d8,color:#12233c
    class app,views,features,entities,shared l
```

| Path | Holds |
| :--- | :--- |
| `app/(public)/` · `app/(app)/` | One folder per URL; a `page.tsx` composes a view plus route-level boundaries only — `Suspense` on `/login`, `VendorOnly` on `/profile` and `/notifications` |
| `views/` | `DashboardView`, `SearchView`, `TorDetailView`, `VendorProfileView`, `LoginView`, `NotificationsView`, `AdminReviewView` |
| `features/<screen>/` | That screen's components **and** its stylesheet — `dashboard`, `search`, `tor-detail`, `profile`, `notifications`, `admin`, `auth`, `app-shell`, `landing` |
| `shared/ui/` | What genuinely crosses screens: `BudgetRange`, star/bookmark icons, section-title styles |
| `shared/lib/` | Client state: `viewer` (prototype session), `notifications` (read state) |
| `shared/styles/tokens.css` | Every colour, font stack, and rhythm value in the product |
| `data/` | Sample records the screens render until the pipeline fills them |

A feature is one folder, so deleting it is one operation. When a stylesheet needs a `-2` suffix, the
feature it belongs to has not been given its folder yet.

---

## 5. How a document travels

### 5.1 Intake ✅

Three routes, one service. Nothing is accepted twice, and nothing is ever overwritten.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client<br/>(upload · url · api)
    participant R as intake.routes<br/>/api/v1/intake
    participant S as IntakeService
    participant St as Storage port<br/>→ GCS
    participant Db as intake.repository<br/>→ mongo
    participant Q as Queue port<br/>→ mongo

    C->>R: POST /api/v1/intake/upload · /url · / (api key)
    R->>R: Zod validation · size + type caps<br/>API key: constant-time compare<br/>upload buffered to the cap, not streamed
    R->>S: submit(bytes, meta)
    S->>S: contentHash = sha256(bytes)
    S->>Db: findByHash(contentHash)
    alt already stored
        Db-->>S: existing record
        S->>Db: append sourceRef
        S-->>C: 200 { duplicate: true }
    else new document
        S->>St: putIfAbsent(key = contentHash)
        S->>Db: insert(pipeline.state = "queued")
        Note over S,Db: unique index on contentHash is the real<br/>dedupe guarantee — a duplicate-key error<br/>is routed into the branch above
        S->>Q: enqueue({ type: "extract", torId })
        S-->>C: 202 { torId, state: "queued" }
    end
```

**The order is fixed:** store bytes → insert record → enqueue. A crash between steps leaves an
orphaned object in storage, never a job pointing at a record that does not exist.

### 5.2 Extraction ✅

```mermaid
sequenceDiagram
    autonumber
    participant W as extract.worker
    participant Q as ingest_jobs
    participant St as GCS
    participant V as Vertex AI
    participant D as Document AI
    participant T as tors

    loop every poll interval
        W->>Q: findOneAndUpdate(state:"pending") → "running"
        Note over W,Q: atomic claim with lockedUntil —<br/>an expired lock is reclaimable
        W->>St: get(storage.key)
        W->>V: OCR + field extraction
        V-->>W: nine fields, each with confidence
        opt OCR_ENABLED
            W->>D: Document AI: words with positions
            D-->>W: boxes, page images
            Note over W,D: locates each value, and its text never<br/>reaches the extractor (design 2026-11-08)
        end
        alt success
            W->>T: fields + provenance, state = "published"
        else failure
            W->>Q: attempts++, backoff, lastError
            Note over W,T: after JOB_MAX_ATTEMPTS → "failed",<br/>original document still stored
        end
    end

    loop every RECONCILE_INTERVAL_MS
        W->>T: records "queued" older than RECONCILE_MIN_AGE_MS<br/>with no job → enqueue
        Note over W,T: closes the crash gap between insert<br/>and enqueue — enqueue is idempotent
    end
```

### 5.3 Pipeline state

`pipeline.state` is the system's own progress. It is **not** `fields.torStatus`, which is the
agency's status for the procurement (open, closed, awarded) and is extracted, not computed.

```mermaid
stateDiagram-v2
    [*] --> queued: intake accepted
    queued --> extracting: worker claims job
    extracting --> published: fields extracted
    extracting --> queued: attempt failed,<br/>attempts < max
    extracting --> failed: attempts exhausted
    published --> [*]
    failed --> [*]

    note right of published
        Confidence controls MARKING,
        not visibility: medium and low
        both publish, marked
        "unverified extraction"
    end note
    note right of failed
        The original document is
        still stored. Nothing is
        ever deleted (NFR-S3)
    end note
```

---

## 6. Data model

MongoDB holds metadata and extracted fields. Document bytes never go in a Mongo document — the
record stores a storage key, and whoever needs the bytes fetches them.

```mermaid
erDiagram
    TORS ||--o{ TOR_EVENTS : "every transition, append-only"
    TORS ||--o{ INGEST_JOBS : "one job per extraction attempt"
    TORS ||--o{ SOURCE_REFS : "every route that submitted it"
    SOURCES ||--o{ TORS : "collected from (slice 2+)"
    ACCOUNTS ||--o| VENDOR_PROFILES : "states what it does"
    ACCOUNTS ||--o{ BOOKMARKS : "saves"
    ACCOUNTS ||--o{ BEHAVIOUR_EVENTS : "only with its separate consent"
    ACCOUNTS ||--o{ VAULT_DOCUMENTS : "keeps for reuse"
    ACCOUNTS ||--o{ NOTIFICATIONS : "one row per email sent or dry-run"
    ACCOUNTS ||--o{ MATCH_LABELS : "judged for, by staff"
    ACCOUNTS ||--o{ ADMIN_AUDIT : "every staff read or change"
    TORS ||--o| TOR_CLASSIFICATIONS : "classified into the taxonomy"
    TORS ||--o{ MATCH_LABELS : "judged against a vendor"
    TORS ||--o| TOR_PEER_STATS : "judged against, by cohort key"
    TORS ||--o{ TOR_ROLLUPS : "counted into"

    TORS {
        objectId _id PK "Mongo's own key"
        string contentHash UK "sha256 of raw bytes · dedupe key AND storage key"
        object storage "bucket, key, contentType, bytes"
        object pipeline "state, attempts, failedReason"
        object fields "nine extracted fields, each {raw, value, confidence, anchor?}"
        date announcedAt "the AGENCY's date, not createdAt"
        string sourceUrl "public page, when there is one"
        string confidenceLevel "high | medium | low"
        bool unverified "drives the marking, never the visibility"
        object provenance "model, version, extractedAt, thresholdsVersion"
        object embedding "model, vector · title and scope, when EMBEDDINGS_ENABLED"
        int schemaVersion "3: a field may carry an anchor"
        array statusHistory "last 10 transitions, for display only"
        object access "restricted, reason, auditRef · FR-B-6 takedown"
        object cohort "category + month · the peer group's key"
        string cohortDateSource "announced | intake · which date the month came from"
        date createdAt "when WE ingested it"
    }
    TOR_PEER_STATS {
        string category PK "with month, the peer group"
        string month PK "YYYY-MM, Asia/Bangkok"
        int n "eligible budgets in the twelve-month window"
        number q1 "both methods' statistics are stored, so switching"
        number q3 "ANOMALY_METHOD cannot compare against undefined"
        number lowBound "q1 minus the multiplier times the IQR"
        number highBound "q3 plus the multiplier times the IQR"
        number mean "for the z-score alternative"
        number stdDev "for the z-score alternative"
        bool dirty "the worker's queue: set by whatever changed the group"
        int generation "guards a mark that arrives mid-computation"
        date leaseUntil "so two workers cannot recompute one cohort"
        date computedAt
    }
    TOR_ROLLUPS {
        string agency PK
        string category PK
        string month PK
        int torCount "every published budget, verified or not"
        number budgetSum "what the agency spent, as collected"
        int unverifiedBudgetCount "stated beside the total, never hidden"
        int flaggedCount
        date computedAt
    }
    TOR_META {
        string id PK "dashboard"
        date lastIntakeAt "FR-E-6's last-updated line"
        date statsComputedAt "freshness of the figures, a different question"
        int corpusSize
    }
    TOR_EVENTS {
        objectId _id PK
        objectId torId FK
        string from "null on the first transition"
        string to "queued | extracting | published | failed | restricted"
        date at
        string actor "who or what caused it"
        string source "route, worker, or admin"
    }
    INGEST_JOBS {
        objectId _id PK
        objectId torId FK
        string state "pending | running | failed | done"
        int attempts
        date nextRunAt
        string lockedBy
        date lockedUntil "expiry makes a dead worker's job reclaimable"
    }
    SOURCES {
        objectId _id PK
        string key UK
        string url
        bool enabled
        date lastSuccessAt "FR-A-4 shows this"
        string health
    }
    ACCOUNTS {
        objectId _id PK
        string email UK
        string role "vendor | admin"
        object consent "notice version and hash, agreedAt, withdrawnAt"
        date disabledAt "set by staff; revokes every session"
    }
    VENDOR_PROFILES {
        string accountId UK
        array categories "taxonomy node ids"
        array otherCategories "free text the taxonomy lacks"
        object budget "minThb, maxThb · a preference, scored not filtered"
        object notify "preset, minMatch, leadDays"
        array pastProjects "title, year in BE, valueThb · capped by config"
        object certifications "cgd branches, tags, other · absent = not stated"
        array personnel "role, listed certificates, other · no names · capped by config"
        string updatedBy "vendor | admin · shown to the vendor"
    }
    TOR_CLASSIFICATIONS {
        string torId UK
        object classification "coarse, leaves, nodes, evidence, outcome"
        string mapperVersion "a stale version is reclassified on read"
    }
    MATCH_LABELS {
        string accountId PK
        string torId PK
        string label "relevant | not-relevant | unsure"
        number score "frozen at labelling time"
        bool matched "met the vendor's email threshold then"
        string labelledBy
    }
    NOTIFICATIONS {
        string accountId PK
        string torId PK
        string reason PK "match | deadline-reminder | daily-digest"
        bool dryRun PK "a dry run never suppresses a real send"
        date sentAt
    }
    BOOKMARKS {
        string accountId PK
        string torId PK
    }
    BEHAVIOUR_EVENTS {
        string accountId FK
        string torId FK
        string type "view | save | dismiss | prepare"
        date at "ignored by scoring after BEHAVIOUR_WINDOW_DAYS"
    }
    VAULT_DOCUMENTS {
        string accountId FK
        int slot "unique per account: the file cap"
        string status "pending | ready | discarded"
        string kind "cv | certificate | past_work"
        string certificationId "the vendor statement, certificates only"
        string filename
        string contentType "from the bytes"
        int bytes
        string sha256
        string key "in the vault bucket, never shown"
        date uploadedAt
    }
    ADMIN_AUDIT {
        string accountId FK
        string action "viewed, profile-edited, match-email-sent, ..."
        string actor
        date at
    }
```

**Match scores are not stored.** A score is a function of the profile, the TOR and its
classification, all three of which change; it is computed when read
(`matching.scores.ts`) so a vendor never sees a score made from an old profile. What *is* stored is
what must not move afterwards: a sent email (`notifications`) and a staff judgement with the score
it was made against (`match_labels`).

Three shapes are load-bearing:

1. **No array inside a record grows without limit.** `statusHistory` keeps the last ten transitions
   for the detail screen and is capped by the write itself (`$push` with `$slice`); every transition
   is also appended to `tor_events`, which is built to grow. A document is what MongoDB reads,
   rewrites and indexes as one unit, so a document that grows makes every read and every write of
   that record more expensive — while a collection that grows costs nothing per read, because an
   index finds the page you asked for. Referencing when embedded data grows without bounds is
   [MongoDB's own rule](https://www.mongodb.com/docs/manual/data-modeling/best-practices/).
2. **Every extracted field is an object, not a bare value** —
   `budget: { raw: "๑,๒๐๐,๐๐๐ บาท", amount: 1200000, confidence: 0.82 }`. `raw` is what the
   interface displays, exactly as extracted; `amount` is what the anomaly rule computes on.
   Statistics never parse display strings, and a formatting change can never alter a displayed
   budget.
3. **`announcedAt` ≠ `createdAt`.** Ingesting a batch of last year's documents today must not look
   like today's procurement activity. Records without `announcedAt` are excluded from trends rather
   than defaulted.
4. **Provenance is recorded at both levels.** Each field carries its own `confidence`; the record
   carries the model, version, extraction time, and the thresholds version that graded it. NFR-F6
   asks that every AI-produced value be attributable, and one extraction run produces every field on
   a record, so the run's identity lives once and the per-field certainty lives on the field.
5. **`contentHash` identifies the document everywhere.** It is the dedupe key, and it is the
   identity inside the storage key, so a stored object and its record can never disagree about which
   document they are. Objects live at `tors/<year>/<month>/<hash>.<ext>`: grouped by arrival month
   because the console renders prefixes as folders and an intake question is usually scoped to a
   month, and given an extension so an operator and a downloading browser both know what the file
   is. The submitted filename is object metadata, never the key — a key built from a name gives one
   document two homes, and a name known only after extraction would require renaming, which in
   object storage is copy-then-delete and `FR-A-2` forbids touching a stored original.

### Indexes

| Index | Exists for |
| :--- | :--- |
| `tors.contentHash` **unique** | Dedupe under concurrency (FR-A-3) — the guarantee, not the optimisation |
| `tors.pipeline.state + createdAt` | Queue and admin views |
| `tors.fields.category.value + announcedAt` | Peer-group selection for the anomaly rule |
| `tors.announcedAt` | Date-range selection and trends (FR-E-1, FR-E-3) |
| `tors.fields.agency.value + announcedAt + fields.torStatus.value` | The combined filters of FR-E-3 |
| `tors.access.restricted` | Keeps restricted records out of public queries |
| Atlas Search index `tors_text` (`SEARCH_INDEX_NAME`) | Keyword search on title and agency, raw and extracted value, with `lucene.thai` (TOR-201). Created at API start, not by `ensureIndexes`, because it exists only on Atlas |
| `vault_documents.accountId + uploadedAt` | One vendor's files, newest first, and the export and delete of them (TOR-218) |
| `vault_documents.accountId + slot` **unique** | An account has `VAULT_MAX_FILES` slots; an upload takes one before it reads a byte, so the cap holds under concurrent uploads |
| `vault_documents.status + uploadedAt` | The sweep: unfinished or discarded uploads old enough not to be running |
| `behaviour_events.accountId + at` | One vendor's recent activity for their score, and the export and delete of it (TOR-215) |
| `behaviour_events.accountId + torId + type` **unique** | One event per kind per TOR: a repeat refreshes `at` instead of adding a row. Built on a collection that still holds older repeats, `ensureIndexes` removes the older copies (the latest `at` stays) and retries once |
| `tor_events.torId + at` | The audit read: one TOR's history, newest first |
| `ingest_jobs.state + nextRunAt` | The worker's claim query |
| `tors.cohort.category + cohort.month + fields.budget.value`, partial | The peer-statistics scan. Its partial filter IS the eligibility predicate, asserted by a test, so the query and the index cannot drift into disagreeing about what counts |
| `tor_peer_stats.category + month`, unique | One bounds document per peer group, which is what makes a recompute idempotent |
| `tor_peer_stats.dirty + dirtyAt`, partial | The statistics worker's claim query |
| `vendor_profiles.accountId`, unique | One profile per account |
| `tor_classifications.torId`, unique · `classification.leaves.id + updatedAt` · `classification.coarse + updatedAt` | One classification per TOR; the two candidate reads matching runs in parallel (precise leaf, broad coarse group) |
| `match_labels.accountId + torId`, unique | A re-judgement overwrites, so a pair counts once in the figures |
| `notifications.accountId + torId + reason + dryRun`, unique | An email is sent at most once per reason, even with two workers |
| `admin_audit.accountId + at` | One vendor's audit trail, newest first |
| `tor_rollups.agency + month` · `category + month` | The dashboard's two filter shapes. A single `agency + category + month` compound cannot serve "one agency across months with no category", because category sits between the two fields used |

---

## 7. Invariants

Rules that must stay true. Several are stated as absences — the things this system deliberately does
not do — because those are the ones a well-meaning change quietly breaks.

| Invariant | Why | Enforced by |
| :--- | :--- | :--- |
| No in-document array grows without bound | A document is read and rewritten whole; an array with no ceiling makes every operation on that record slower forever | `$push` + `$slice`, with the full trail in `tor_events` |
| Originals are never altered or deleted | FR-A-2, NFR-S3 — a takedown restricts access and writes an audit entry, it does not touch the file | `Storage` port exposes `putIfAbsent`, never `put` |
| No filesystem path is ever shared between services | Separate containers do not share a filesystem; the pointer travels, the bytes do not | Services exchange storage keys only |
| No signed URLs | Google cannot attach `nosniff` to one, and a signed link keeps working after a takedown | Documents are streamed through the API, which checks takedown status on every request |
| `localhost` appears in no source file | The literal that is correct in development is exactly what breaks the shipped system | `core/config.ts` + `${VAR:-default}` in Compose |
| Only `*.repository.ts` touches the database | One place to change when the schema moves | Code review; the module layout makes violations obvious |
| `modules/` imports `ports/`, never `adapters/` | Tests can supply fakes; the wiring lives in one file | `app.ts` is the only place adapters are named |
| Confidence controls marking, not visibility | SRS §4.2.1 — every readable record publishes; low confidence is marked and queued for review | The publish path has no confidence gate |
| Only "statistical anomaly" and "specification-quality check" | NFR-F5 — never "suspicious", "corrupt", or "irregular" about a TOR, budget, or agency | Copy review; the wording lives in the views |
| Every AI value carries confidence, model, version, and a source link | NFR-F6 | `provenance` on every record |
| Extracted values are displayed exactly as extracted | NFR-F7 — never re-worded, re-formatted, or silently corrected | `fields.*.raw` is what renders |
| PDPA-**aligned**, never "PDPA-compliant" | NFR-S2 — no certification is claimed | Copy review |
| Scope is national | SRS §1.2 — the old Bangkok-only rule is withdrawn; agency is a plain extracted field | Nothing rejects a record by agency |

---

## 8. Stack

Decided; not substituted without a design change.

| Layer | Choice | Version | Why this one |
| :--- | :--- | :--- | :--- |
| Frontend | Next.js App Router, React | 16 · 19 | Server rendering for public pages, one routing model for public and vendor screens |
| 3D / motion | Three.js | 0.185 | The landing radar scene |
| API | Express, REST | 5 | Small, well-understood surface; no GraphQL need at this size |
| Validation | Zod | 4 | One schema shared by both apps via `packages/shared` |
| Database | MongoDB (Atlas in deployment; `mongodb-atlas-local` in Compose and CI) | 8 | Extracted fields are irregular and evolve per slice; also serves as the job queue |
| Search | Atlas Search, `lucene.thai` analyzer | ✅ — behind `SEARCH_ATLAS_ENABLED`; a plain `mongod` keeps the substring match | Thai is written without spaces, so a default text index cannot tokenise it. `mongodb/mongodb-atlas-local` runs the same analyzer in Compose and CI |
| Object storage | Google Cloud Storage | 8 (client) | Immutable originals behind a `Storage` port; `fake-gcs-server` in Compose and CI |
| AI | Vertex AI — Gemini (Document AI is in the stack decision but not yet called) | — | Thai OCR quality; confidence values per field |
| Notifications | SMTP email behind a `Mailer` port; Mailpit in Compose | — | The only channel in scope. Dispatch is off (`NOTIFY_DISPATCH_ENABLED`) until the match benchmark exists |
| Runtime | Node | ≥ 22 | Native `fetch`, `process.loadEnvFile` |
| Tests | Vitest, Supertest | 4 · 7 | Same runner across workspaces |
| Infrastructure | Docker Compose, GitHub Actions CI | — | NFR-S6; lint, Mermaid parse, docs drift, build and test on every PR. The dependency audit is not in CI yet (slice 1 task 15) |

**Why Mongo is also the queue (D5):** the alternative is a second infrastructure service for a
workload of a few thousand documents. An atomic `findOneAndUpdate` claim with a lock expiry gives
at-least-once delivery, and the reconciler in §5.2 covers the crash gap. The honest cost is that
this must be re-examined if throughput ever grows past one worker.

---

## 9. Deployment shape

```mermaid
flowchart TB
    subgraph host["Docker host · project name: tor-radar"]
        direction TB
        w["tor-radar-web<br/>:3000"]
        a["tor-radar-api<br/>:4000 · /health"]
        k["tor-radar-worker"]
        m["tor-radar-mongo<br/>healthcheck"]
        s["tor-radar-gcs<br/>fake-gcs-server · ${GCS_EMULATOR_PORT}"]
        mv[("tor-radar-mongo-data")]
        sv[("tor-radar-gcs-data")]
    end

    w --> a
    a --> m
    a --> s
    k --> m
    k --> s
    m --- mv
    s --- sv

    classDef svc fill:#e8f0fe,stroke:#1d63d8,color:#12233c
    classDef vol fill:#f1f4f9,stroke:#12233c,color:#12233c,stroke-dasharray:3 3
    class w,a,m,s,k svc
    class mv,sv vol
```

- **Named volumes, not bind mounts,** for application data: records and documents survive
  `docker compose down` and go only on `down -v`.
- **`api` and `worker` wait on `service_healthy`,** not on container start, which removes the race
  where the API opens a connection before Mongo accepts one.
- **Explicit project and container names,** because Compose otherwise derives them from whatever
  directory it ran in, and the logs differ per machine.
- **The GCS emulator's host port is parameterised** — `${GCS_EMULATOR_PORT:-4443}` — because a
  fixed port collides with another project on the same machine more often than not.
- ⬜ The bullets above are the target. The Compose file has the `worker` service but still no
  health conditions, generic names, and no service for the statistics or notification worker
  (both run by `npm run stats-worker` / `notify-worker`). That is slice 1 task 15.

---

## 10. Build order

Each slice has its own design spec, plan, and build cycle. Slice 1 is first because every later
slice reads the records it writes.

| Slice | Features | Delivers | State |
| :--- | :--- | :--- | :--- |
| **1** | F1 | Config, ports and adapters, three intake routes, immutable storage, dedupe, job queue, worker, admin upload screen, design tokens | ✅ except Compose hardening and the CI audit (task 15) | 🔨 |
| 2 | F2, F3 | Vertex AI OCR and field extraction, confidence tiering, review queue | ✅ |
| 3 | F4, F7, F8, F11 | Search, TOR detail, dashboard, anomaly rule, quality checklist, CSV export | ✅ except CSV export (F11) and Atlas Search |
| 4 | F5, F6, F9, F10 | Auth and vendor profiles, taxonomy, matching, email notification, PDPA and takedown | ✅ except Google sign-in; match emails off until the benchmark |

Task-level progress lives in [TODO.md](TODO.md) and is not repeated here — this document describes
the shape, not the schedule.

The frontend runs ahead of the backend on purpose: the screens are built and navigable against
sample data in `apps/web/src/data/`, so the interaction could be reviewed before the pipeline that
fills it exists. Every such screen says so on the page, because FR-E-6 forbids implying the numbers
are complete.

### Values that are deliberately not yet chosen

| Value | Waits on |
| :--- | :--- |
| `T_low` / `T_high` confidence thresholds | The accuracy measurement in NFR-F3 — see [corpus/BENCHMARK.md](corpus/BENCHMARK.md) |
| `MIN_BID_WINDOW_DAYS` | Calibration; until then checklist C2 reports "not evaluated" |
| `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS` | Calibration |
| IQR vs Z-score as the anomaly method | Comparison on real budget data |

They are declared in `core/config.ts` with their open status recorded. Inventing one is a defect,
not a shortcut. The full register, including the design questions that block slices, is
[PLAN.md](PLAN.md).

---

## 11. Where to look next

| Question | Document |
| :--- | :--- |
| What is still undecided? | [PLAN.md](PLAN.md) — every open question, what it blocks, what unblocks it |
| Is the data model right? | [superpowers/specs/2026-09-09-data-model-review.md](superpowers/specs/2026-09-09-data-model-review.md) — workload, decisions, what is still open |
| What must the system do? | [SRS.md](SRS.md) — every requirement, testable, with verification method |
| Why does it exist, and for whom? | [PROJECT.md](PROJECT.md) — problem, stakeholders, personas, user stories |
| How is the current slice built? | [superpowers/specs/](superpowers/specs/) — decisions, structure, seams, security |
| What is being built right now? | [TODO.md](TODO.md), and the plan in [superpowers/plans/](superpowers/plans/) |
| How good is the extraction? | [corpus/BENCHMARK.md](corpus/BENCHMARK.md) — measured accuracy, every wrong prediction |
| How do I set up Vertex AI? | [gcp-setup.md](gcp-setup.md) |
| How do I run it? | [../README.md](../README.md) |
