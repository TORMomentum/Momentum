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
        api["<b>api</b> 🔨<br/>Express 5 REST<br/>:4000 · /health live,<br/>intake router awaiting wiring"]
        worker["<b>worker</b> ⬜ slice 1 task 11<br/>same image as api,<br/>different command"]
        mongo[("<b>mongo</b> ✅<br/>MongoDB 7<br/>metadata + job queue")]
        minio[("<b>minio</b> ✅<br/>S3-compatible<br/>original documents")]
    end

    vertex["☁️ Vertex AI ⬜ slice 2"]
    smtp["✉️ SMTP ⬜ slice 4"]

    browser -->|HTTPS| web
    web -->|"REST<br/>NEXT_PUBLIC_API_URL"| api
    browser -.->|"signed URL,<br/>MINIO_PUBLIC_URL"| minio

    api -->|"records, dedupe,<br/>enqueue"| mongo
    api -->|"putIfAbsent,<br/>MINIO_ENDPOINT"| minio
    worker -->|"claim job,<br/>write result"| mongo
    worker -->|"fetch bytes by key"| minio
    worker -->|"OCR + extract"| vertex
    worker -->|"match emails"| smtp

    classDef built fill:#e8f0fe,stroke:#1d63d8,color:#12233c,stroke-width:2px
    classDef planned fill:#fff,stroke:#8896ad,color:#5b6879,stroke-dasharray:4 3
    classDef store fill:#f1f4f9,stroke:#12233c,color:#12233c
    class web,api built
    class worker,vertex,smtp planned
    class mongo,minio store
```

**Why the worker is its own service rather than a thread in the API:** restarting the API must not
kill a job in flight, and a failing extraction should be visible in its own logs. It shares the API
image and differs only by command, so this costs one Compose entry, not a second codebase.

**Why two MinIO addresses:** `MINIO_ENDPOINT` is how the API reaches MinIO *inside* the Compose
network; `MINIO_PUBLIC_URL` is what a browser can resolve. A URL signed with the internal address
reaches nothing from outside, and nothing catches it until a human clicks the link.

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
    adapters["adapters/*.ts<br/><i>MinIO, Mongo queue</i>"]
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
| `ports/` | `Storage`, `Queue` interfaces | `Storage` exposes `putIfAbsent`, never `put` |
| `adapters/` | MinIO storage, Mongo-backed queue | Imported by `app.ts` only |
| `modules/<feature>/` | One feature, files prefixed with its name | `modules/` imports `ports/`, never `adapters/` |
| `workers/` ⬜ | Extraction worker and the orphan reconciler | Same wiring rules as the API |

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

### 5.1 Intake 🔨

Three routes, one service. Nothing is accepted twice, and nothing is ever overwritten.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client<br/>(upload · url · api)
    participant R as intake.routes<br/>/api/v1/intake
    participant S as IntakeService
    participant St as Storage port<br/>→ MinIO
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

### 5.2 Extraction ⬜ slice 1 task 11 · AI in slice 2

```mermaid
sequenceDiagram
    autonumber
    participant W as extract.worker
    participant Q as ingest_jobs
    participant St as MinIO
    participant V as Vertex AI ⬜
    participant T as tors

    loop every poll interval
        W->>Q: findOneAndUpdate(state:"pending") → "running"
        Note over W,Q: atomic claim with lockedUntil —<br/>an expired lock is reclaimable
        W->>St: get(storage.key)
        W->>V: OCR + field extraction
        V-->>W: nine fields, each with confidence
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
    VENDORS ||--o{ MATCHES : "scored against"
    TORS ||--o{ MATCHES : "scored for"

    TORS {
        objectId _id PK "Mongo's own key"
        string contentHash UK "sha256 of raw bytes · dedupe key AND storage key"
        object storage "bucket, key, contentType, bytes"
        object pipeline "state, attempts, failedReason"
        object fields "nine extracted fields, each {raw, value, confidence}"
        date announcedAt "the AGENCY's date, not createdAt"
        string sourceUrl "public page, when there is one"
        string confidenceLevel "high | medium | low"
        bool unverified "drives the marking, never the visibility"
        object provenance "model, version, extractedAt, thresholdsVersion"
        array statusHistory "last 10 transitions, for display only"
        object access "restricted, reason, auditRef · FR-B-6 takedown"
        date createdAt "when WE ingested it"
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
    VENDORS {
        objectId _id PK
        string email UK
        array skills "taxonomy tags"
        object budgetRange "min, max · scored by FR-C-1"
    }
    MATCHES {
        objectId _id PK
        objectId torId FK
        objectId vendorId FK
        int score "match %"
        date notifiedAt
    }
```

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
5. **`contentHash` is both the dedupe key and the storage key.** One value, so a stored object and
   its record can never disagree about identity.

### Indexes

| Index | Exists for |
| :--- | :--- |
| `tors.contentHash` **unique** | Dedupe under concurrency (FR-A-3) — the guarantee, not the optimisation |
| `tors.pipeline.state + createdAt` | Queue and admin views |
| `tors.fields.category.value + announcedAt` | Peer-group selection for the anomaly rule |
| `tors.announcedAt` | Date-range selection and trends (FR-E-1, FR-E-3) |
| `tors.fields.agency.value + announcedAt + fields.torStatus.value` | The combined filters of FR-E-3 |
| `tors.access.restricted` | Keeps restricted records out of public queries |
| `tor_events.torId + at` | The audit read: one TOR's history, newest first |
| `ingest_jobs.state + nextRunAt` | The worker's claim query |

---

## 7. Invariants

Rules that must stay true. Several are stated as absences — the things this system deliberately does
not do — because those are the ones a well-meaning change quietly breaks.

| Invariant | Why | Enforced by |
| :--- | :--- | :--- |
| No in-document array grows without bound | A document is read and rewritten whole; an array with no ceiling makes every operation on that record slower forever | `$push` + `$slice`, with the full trail in `tor_events` |
| Originals are never altered or deleted | FR-A-2, NFR-S3 — a takedown restricts access and writes an audit entry, it does not touch the file | `Storage` port exposes `putIfAbsent`, never `put` |
| No filesystem path is ever shared between services | Separate containers do not share a filesystem; the pointer travels, the bytes do not | Services exchange storage keys only |
| Signed URLs are never persisted | They expire, so a stored one becomes a broken link at an unpredictable date | Generated on demand from the key |
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
| Database | MongoDB (Atlas in deployment) | 7 | Extracted fields are irregular and evolve per slice; also serves as the job queue |
| Search | Atlas Search, `lucene.thai` analyzer | ⬜ slice 3 | Thai is written without spaces, so a default text index cannot tokenise it. `mongodb/mongodb-atlas-local` runs the same analyzer in Compose and CI |
| Object storage | MinIO, S3-compatible | 8 (client) | Immutable originals behind a `Storage` port, swappable for S3 |
| AI | Vertex AI — Document AI OCR, Gemini | ⬜ slice 2 | Thai OCR quality; confidence values per field |
| Notifications | SMTP email | ⬜ slice 4 | The only channel in scope |
| Runtime | Node | ≥ 22 | Native `fetch`, `process.loadEnvFile` |
| Tests | Vitest, Supertest | 4 · 7 | Same runner across workspaces |
| Infrastructure | Docker Compose, GitHub Actions CI | — | NFR-S6; lint, test, build, dependency audit on every PR |

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
        k["tor-radar-worker ⬜"]
        m["tor-radar-mongo<br/>healthcheck"]
        s["tor-radar-minio<br/>${MINIO_PORT} api · console"]
        mv[("tor-radar-mongo-data")]
        sv[("tor-radar-minio-data")]
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
    classDef planned fill:#fff,stroke:#8896ad,color:#5b6879,stroke-dasharray:4 3
    class w,a,m,s svc
    class k planned
    class mv,sv vol
```

- **Named volumes, not bind mounts,** for application data: records and documents survive
  `docker compose down` and go only on `down -v`.
- **`api` and `worker` wait on `service_healthy`,** not on container start, which removes the race
  where the API opens a connection before Mongo accepts one.
- **Explicit project and container names,** because Compose otherwise derives them from whatever
  directory it ran in, and the logs differ per machine.
- **MinIO host ports are parameterised** — `${MINIO_PORT:-9000}` — because 9000 is commonly taken
  by another project on the same machine. This repository's `.env` maps them to 9010/9011.
- ⬜ The Compose file still has the pre-workspace shape: no `worker` service, no health conditions,
  generic names. That is slice 1 task 15.

---

## 10. Build order

Each slice has its own design spec, plan, and build cycle. Slice 1 is first because every later
slice reads the records it writes.

| Slice | Features | Delivers | State |
| :--- | :--- | :--- | :--- |
| **1** | F1 | Config, ports and adapters, three intake routes, immutable storage, dedupe, job queue, worker, admin upload screen, design tokens | 🔨 |
| 2 | F2, F3 | Vertex AI OCR and field extraction, confidence tiering, review queue | ⬜ |
| 3 | F4, F7, F8, F11 | Search, TOR detail, dashboard, anomaly rule, quality checklist, CSV export | ⬜ |
| 4 | F5, F6, F9, F10 | Auth and vendor profiles, taxonomy, matching, email notification, PDPA and takedown | ⬜ |

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
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

---

## 11. Where to look next

| Question | Document |
| :--- | :--- |
| What is still undecided? | [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — every open question, what it blocks, what unblocks it |
| Is the data model right? | [superpowers/specs/2026-09-09-data-model-review.md](superpowers/specs/2026-09-09-data-model-review.md) — workload, decisions, what is still open |
| What must the system do? | [SRS.md](SRS.md) — every requirement, testable, with verification method |
| Why does it exist, and for whom? | [PROJECT.md](PROJECT.md) — problem, stakeholders, personas, user stories |
| How is the current slice built? | [superpowers/specs/](superpowers/specs/) — decisions, structure, seams, security |
| What is being built right now? | [TODO.md](TODO.md), and the plan in [superpowers/plans/](superpowers/plans/) |
| How good is the extraction? | [corpus/BENCHMARK.md](corpus/BENCHMARK.md) — measured accuracy, every wrong prediction |
| How do I set up Vertex AI? | [gcp-setup.md](gcp-setup.md) |
| How do I run it? | [../README.md](../README.md) |
