# TOR Radar — Foundation and Intake (Slice 1) — Design

**Date:** 2026-09-01
**Status:** approved design, ready for implementation planning
**Source of truth:** `docs/SRS.md` v2.0
**Covers:** F1 (TOR intake and permanent storage), plus the project-wide structural decisions every later slice inherits. F12 is prepared for only in the sense that the `sources` collection shape is defined; no adapter is built in this slice.

---

## 1. Context

`docs/SRS.md` v2.0 specifies twelve features across intake, extraction, matching, profiles, dashboard, checklist, and admin tooling. That is several independent subsystems and too much for one design. The work is therefore split into four slices, each with its own spec, plan, and build cycle:

| Slice | Features | Delivers |
| :---- | :---- | :---- |
| **1 (this document)** | F1 | Config, ports and adapters, three intake routes, immutable storage, dedupe, job queue, worker, admin upload screen, design tokens |
| 2 | F2, F3 | Vertex AI OCR and field extraction, confidence tiering, review queue |
| 3 | F4, F7, F8, F11 | Search, TOR detail, dashboard, anomaly rule, quality checklist, CSV export |
| 4 | F5, F6, F9, F10 | Auth and vendor profiles, taxonomy, matching, email notification, PDPA and takedown |

Slice 1 comes first because every later slice reads records it writes.

### 1.1 Scope corrections carried into this design

Two conflicts between SRS v2.0 and older repository documents were settled before designing:

- **Scope is national, not Bangkok-only.** SRS v2.0 §1.2 describes "Thai government agencies" and Appendix B lists national sources. The Bangkok-only rule in `CLAUDE.md` and `PROJECT.md` — which required validating every record against a canonical BMA agency list and rejecting or tagging non-BMA records — is withdrawn. Agency is a plain extracted field. Those two documents must be updated as part of implementation.
- **Requirement identifiers were renumbered.** `CLAUDE.md` cites the v1 scheme (`FR-A2`, `FR-B3`, `NFR-2`, `NFR-5`). v2.0 uses `FR-A-1`…`FR-G-3`, `NFR-F1`…`NFR-F7`, `NFR-S1`…`NFR-S7`. `CLAUDE.md` must be rewritten against v2.0 so the agent rules and the specification agree.

---

## 2. Decisions

Each decision records what was chosen and why, so a later reader does not reopen a settled question.

| # | Decision | Rationale |
| :---- | :---- | :---- |
| D1 | **Package by feature**, not by layer, in both apps | Higher cohesion, lower coupling, and a feature is deleted or moved in one operation. Layered packaging degrades into low-cohesion buckets as features accumulate |
| D2 | **Domain-prefixed filenames** — `intake.service.ts`, not `service.ts` | Feature grouping without repeated filenames; a file's identity is readable from an editor tab or a search result |
| D3 | **Next.js `app/` holds routing only**; UI code lives in `apps/web/src/` under FSD-lite layers (`views → features → entities → shared`) | Next.js documents this as a supported organisation strategy. Four audiences and twelve features are more than route-local colocation carries comfortably. FSD's full six-layer scheme is not adopted: its own guidance places the payoff at roughly twenty features |
| D4 | **Two apps: `apps/web` and `apps/api`** | The stack decision in `PROJECT.md` fixes Node and Express, and SRS §3.3 requires an authenticated, rate-limited intake API that source adapters call. The extraction worker must also be a long-running process, which a request-scoped route handler is not |
| D5 | **Mongo-backed job queue with an in-process worker**, behind a `Queue` port | NFR-S4 scopes Phase 1 to hundreds of TORs and tens of concurrent users; a dedicated queue service solves throughput this project does not have, at the cost of another service in Compose (NFR-S6). The port keeps a later move to BullMQ a one-adapter change |
| D6 | **Dedupe on SHA-256 of the raw bytes** | Exact, cheap, computed before OCR, enforceable by a unique index, and independent of extraction being correct. A re-scan of the same TOR produces different bytes and therefore a second record; `duplicateOf` exists from the start so a later identity rule needs no migration |
| D7 | **MinIO retained** behind a `Storage` port | Runs in Compose with no cloud account per teammate and speaks S3. Vertex AI Document AI's batch path reads `gs://` URIs; if real Thai TORs exceed the online path's limits, a GCS adapter is added and one config value changes. Current Document AI limits are to be verified against Google's documentation during slice 2, not assumed |
| D8 | **CSS Modules with a token file**, not Tailwind | The mockups are already written as CSS custom properties, so the port is mechanical. Expressing that palette as Tailwind utilities reintroduces the exact values as arbitrary classes, which is the magic-number problem in another form |
| D9 | **Mockups are ported by extracting tokens and rebuilding components**, not pasted as markup | Pasted markup arrives as inline styles and hard-coded values that slice 3 would have to rewrite. The visual result is identical because the values are the same |
| D10 | **Slice 1 ships one live screen** — admin upload — against real ingested data | Proves the web-to-API seam end to end early. Dashboard, search, and detail are ported in slice 3, when there is data worth showing |

---

## 3. Structure

### 3.1 Repository root

```
tor-radar/
├── apps/
│   ├── web/                  Next.js — product surface
│   └── api/                  Express — platform: REST, pipeline, worker
├── packages/
│   ├── shared/               TOR types and Zod schemas, imported by both apps
│   └── seeds/                taxonomy.json · categories.json · sources.json
├── docs/                     SRS.md · PROJECT.md · superpowers/specs/
├── mockups/                  design-canvas source — reference, never built or linted
├── docker-compose.yml        web · api · mongo · minio
├── .env.example              committed; .env stays untracked
└── .github/workflows/ci.yml  lint · test · build
```

### 3.2 `apps/web/`

```
apps/web/
├── app/                          routing only — each page.tsx re-exports a view
│   ├── (public)/                 landing · dashboard · search · tors/[id]   (own root layout)
│   ├── (auth)/                   login · register
│   ├── (vendor)/                 profile · preferences
│   └── (admin)/                  upload · queue · taxonomy                  (own root layout)
└── src/
    ├── views/                    DashboardView.tsx · SearchView.tsx · TorDetailView.tsx · UploadView.tsx
    ├── features/                 tor-upload/ · tor-search/ · anomaly-plot/ · quality-checklist/
    ├── entities/                 tor.ts · agency.ts · vendor.ts
    └── shared/
        ├── ui/                   Button.tsx · Card.tsx · StatTile.tsx
        ├── lib/api/              client.ts · tors.ts
        ├── config/               display constants
        └── styles/               tokens.css
```

Imports flow in one direction only: `views → features → entities → shared`. Route groups give the public site and the admin console separate root layouts.

### 3.3 `apps/api/src/`

```
apps/api/src/
├── modules/
│   ├── intake/       intake.routes.ts · intake.service.ts · intake.repository.ts
│   │                 intake.schema.ts · intake.test.ts
│   ├── tors/         tors.routes.ts · tors.service.ts · tors.repository.ts
│   └── admin/        admin.routes.ts · admin.service.ts · admin.repository.ts
├── ports/            storage.port.ts · queue.port.ts · ai.port.ts · mail.port.ts
├── adapters/         minio.storage.ts · mongo.queue.ts · vertex.ai.ts · smtp.mail.ts
├── workers/          extract.worker.ts
├── core/             config.ts · db.ts · errors.ts · logging.ts · enums.ts
├── lib/              hash.ts · http.ts · pagination.ts
├── app.ts            Express wiring — mounts module routers, injects adapters
└── server.ts         process entry
```

Four rules the structure exists to enforce:

1. Only `*.repository.ts` imports the database.
2. `modules/` imports `ports/`, never `adapters/`; wiring happens once in `app.ts`.
3. Every threshold and tunable lives in `core/config.ts` (NFR-S7).
4. A feature is one folder, so removing it is one operation.

### 3.4 Files slice 1 touches

```
api:  modules/intake · modules/tors · ports/{storage,queue}
      adapters/{minio.storage,mongo.queue} · workers/extract.worker
      core/{config,db,errors,logging}
web:  src/shared/styles/tokens.css · src/features/tor-upload
      src/views/UploadView.tsx · app/(admin)/upload
```

---

## 4. Data model

### 4.1 Collections

| Collection | Holds | Slice |
| :---- | :---- | :---- |
| `tors` | The TOR record: fields, confidence, provenance, history | 1 |
| `ingest_jobs` | One job per extraction attempt, with attempt count and failure reason | 1 |
| `sources` | Per-source adapter state for Appendix B sources (FR-A-4) | defined in 1, written from 2 |
| `vendors`, `matches`, `corrections`, `taxonomy` | Later slices | 3–4 |

### 4.2 `tors`

```js
{
  contentHash,                    // sha256 of the raw bytes — unique index, dedupe key
  storage: { bucket, key, contentType, bytes },
  sourceRefs: [                   // FR-A-3: every route that submitted this document
    { route: 'upload' | 'url' | 'api', url, submittedBy, submittedAt }
  ],
  pipeline: { state, attempts, failedReason },   // queued → extracting → published | failed
  fields: {                       // FR-B-2, exactly nine, populated in slice 2
    title, agency, budget, category, scopeSummary,
    qualifications, deadline, contact, torStatus
  },
  confidenceLevel,                // 'high' | 'medium' | 'low' — §4.2.1
  unverified,                     // Boolean
  provenance: { ocrModel, extractModel, modelVersion, extractedAt, thresholdsVersion },
  statusHistory: [{ from, to, at, actor, source }],   // FR-E-5
  access: { restricted, reason, auditRef },           // FR-B-6 takedown
  duplicateOf,                    // ObjectId or null — always null in slice 1; reserved for a later identity rule (D6)
  createdAt, updatedAt
}
```

Three properties of this shape are load-bearing:

**Pipeline state and TOR status are separate fields.** `pipeline.state` is the system's own progress. `fields.torStatus` is the agency's status for the procurement — open, closed, awarded — which FR-B-2 extracts and FR-E-3 filters on as a historical record. Merging them would corrupt both.

**Every extracted field is an object, not a bare value.** For example:

```js
budget: { raw: '๑,๒๐๐,๐๐๐ บาท', amount: 1200000, currency: 'THB',
          confidence: 0.82, verified: false }
```

`raw` is what the interface displays, exactly as extracted (NFR-F7). `amount` is what the anomaly rule computes on (§4.5.1). Keeping both means a formatting or numeral-parsing change can never silently alter a displayed budget, and statistics never parse display strings.

**`provenance.thresholdsVersion` records which confidence thresholds graded the record.** Open issue O1 settles `T_low` and `T_high` from measurement; when they change, this field distinguishes records graded under the old values from those graded under the new.

### 4.3 `ingest_jobs`

```js
{
  torId, type: 'extract',
  state: 'pending' | 'running' | 'failed' | 'done',
  attempts, lastError, nextRunAt, lockedBy, lockedUntil,
  createdAt, updatedAt
}
```

### 4.4 `sources`

```js
{ key, url, enabled, lastAttemptAt, lastSuccessAt, lastError, health }
```

FR-A-4 requires the last successful collection time and the health of each adapter to be shown; this collection is where those come from.

### 4.5 Indexes

| Index | Purpose |
| :---- | :---- |
| `tors.contentHash` (unique) | Enforces FR-A-3 dedupe under concurrency |
| `tors.pipeline.state + createdAt` | Queue and admin views |
| `tors.fields.agency.value + createdAt` | Per-agency aggregation (FR-E-1) |
| `tors.fields.category.value + createdAt` | Peer-group selection (§4.5.1) |
| `tors.access.restricted` | Excludes restricted records from public queries |
| `ingest_jobs.state + nextRunAt` | Worker claim query |

### 4.6 Known risk: Thai text search

Mongo's built-in text index performs no Thai word segmentation, and Thai does not delimit words with spaces. FR-E-3 search combined with the two-second target in NFR-F2 may require Atlas Search with a Thai analyser, or an n-gram fallback. This is to be verified against current Atlas documentation when slice 3 is specified. Slice 1 requires only exact-match and range filters, so it is not blocked.

### 4.7 Personal data

`fields.contact` may contain personal data. It is stored, but redacted from public API responses and stripped from CSV export (FR-B-5, NFR-S2). Redaction lives in a single serializer so no route can omit it by accident.

---

## 5. Interaction

### 5.1 The intake path

```
route: upload | url | api-key            validates with the Zod schema in packages/shared
   │
   ▼
IntakeService.submit(bytes, meta)        the single entry all three routes share
   │  1. hash = sha256(bytes)
   │  2. repository.findByHash → hit? append sourceRef, return { duplicate: true }
   │  3. Storage.putIfAbsent(key = hash)                       FR-A-2
   │  4. repository.insert(pipeline.state = 'queued')
   │  5. Queue.enqueue({ type: 'extract', torId })
   ▼
202 { torId, state: 'queued' }
   │
   ▼
extract.worker                           claims a job atomically:
   │                                     findOneAndUpdate(state:'pending') → 'running'
   │  hands off to the extraction service (slice 2). Slice 1 ships a pass-through
   │  handler so the seam is exercised end to end before AI is wired.
   ▼
success → pipeline.state = 'published'
failure → attempts++, backoff, lastError recorded; after JOB_MAX_ATTEMPTS
          state = 'failed' with the raw document still in storage      NFR-S5
```

### 5.2 Ordering and correctness rules

- **Order is fixed:** store bytes, insert the record, then enqueue. A crash between steps leaves an orphaned object, never a job pointing at nothing.
- **The unique index is the dedupe guarantee.** Two simultaneous submissions of the same file can both pass `findByHash`; the duplicate-key error on insert is caught and routed into the dedupe path. The pre-check is an optimisation, not the correctness mechanism.
- **`putIfAbsent`, never `put`.** FR-A-2 forbids overwriting a stored object, and the prohibition is enforced inside the adapter so no caller can bypass it.
- **Services receive ports.** `IntakeService` takes `Storage` and `Queue` as constructor arguments. Tests supply fakes; `app.ts` supplies MinIO and the Mongo queue.

### 5.3 Errors

Typed errors in `core/errors.ts` are translated by one Express error middleware into `{ error: { code, message } }`. Stack traces never leave the process. An intake failure returns the error and leaves no partial record.

### 5.4 Configuration

Every value below lives in `core/config.ts`, read from the environment with a validated default, and nowhere else in the code (NFR-S7):

`MAX_UPLOAD_BYTES`, `ALLOWED_MIME_TYPES`, `JOB_MAX_ATTEMPTS`, `JOB_BACKOFF_MS`, `JOB_LOCK_MS`, `INTAKE_RATE_LIMIT`, `INTAKE_API_KEYS`, `MINIO_BUCKET`, `MONGO_URL`.

### 5.5 Intake API authentication

NFR-S1 requires the intake API to enforce access level and to be rate-limited. Slice 1 authenticates the API route with a static key presented in an `Authorization` header and compared in constant time against `INTAKE_API_KEYS`, which is supplied through the environment and never committed. Rate limiting applies per key. The upload and URL routes are admin-only and move behind the session authentication built in slice 4; until then they are reachable only on the local Compose network, which is recorded here so the gap is deliberate rather than forgotten.

Thresholds belonging to later slices (`T_LOW`, `T_HIGH`, `PEER_MIN_N`, `PEER_WINDOW`, `ANOMALY_METHOD`, `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS`, `MIN_BID_WINDOW_DAYS`) are declared in the same module with their open-issue status recorded, so no later slice introduces a literal.

### 5.6 Security

NFR-S1 states the security baseline; the controls below are how slice 1 meets it. Each is built with the feature it protects, not retrofitted.

**Server-side request forgery, URL intake route.** The URL route causes the server to fetch an attacker-supplied address, which without controls reaches cloud metadata endpoints and internal services such as the database and object store. Every fetch therefore:

- accepts `http` and `https` schemes only;
- resolves the hostname and rejects the address if it falls in a loopback, private, link-local, or unique-local range, checked against the resolved address rather than the hostname string;
- re-runs that check after each redirect and caps the redirect chain, so a host that resolves differently on the second lookup cannot slip through;
- enforces a response size cap and a request timeout, both from `core/config.ts`.

The fetch is performed by a single helper in `lib/http.ts`. No module issues an outbound request to a user-supplied address by any other route.

**Declared content type is not trusted.** The `Content-Type` header and the file extension are attacker-controlled. The received stream's leading bytes are checked against the signatures for PDF, JPEG, and PNG, and a mismatch with `ALLOWED_MIME_TYPES` rejects the submission before anything is stored.

**Serving an original document.** FR-E-4 links every record to its source file. User-supplied files served from the application origin permit stored cross-site scripting. Originals are therefore served with `Content-Disposition: attachment`, the verified content type, and `X-Content-Type-Options: nosniff`. Serving them from a separate origin is preferred and is recorded as the deployment default.

**Database query construction.** Filter parameters are parsed by Zod schemas that accept primitives only, so an operator object such as `$gt` or `$where` cannot arrive through a query string. Repositories build filters field by field and never spread a request-derived object into a query.

**Upload resource limits.** Uploads are streamed to storage and hashed in the same pass rather than buffered in memory. Multipart parsing caps file count, field count, and field size in addition to `MAX_UPLOAD_BYTES`. Rate limiting applies to all three intake routes, not only the API route.

**Dependency audit.** CI runs a dependency audit on every pull request and fails on high-severity advisories, which is the enforcement NFR-S1 requires.

**Logging.** Extracted field values and document contents are never written to logs. Log entries carry the record identifier and the storage key, both of which are safe to retain.

**Transport.** Deployed environments serve over HTTPS (NFR-S1). Local Compose runs over HTTP on a private network; this difference is deliberate and is the only place the baseline is relaxed.

**Configuration added by this section:** `FETCH_TIMEOUT_MS`, `FETCH_MAX_REDIRECTS`, `FETCH_MAX_BYTES`, `MULTIPART_MAX_FILES`, `MULTIPART_MAX_FIELD_BYTES`.

### 5.7 Containers and the deployment shape

NFR-S6 requires the system to run under Docker Compose. The skeleton's Dockerfiles predate the workspace layout in §3 and need reworking before `packages/shared` exists, because every problem below is silent rather than loud.

**Workspace-aware builds.** Both images currently copy a single application manifest and run `npm install`, which cannot resolve a workspace dependency and does not use the root lockfile. Each image instead copies the root `package.json`, the root `package-lock.json`, and every workspace manifest, runs `npm ci`, and only then copies sources. Builds become reproducible and `@tor-radar/shared` resolves.

**The API image compiles.** The API currently runs TypeScript through `tsx` at runtime. It becomes a two-stage build: compile with `tsc`, then run `node dist/server.js` in a runtime stage without development dependencies.

**Next.js standalone output inside a monorepo.** `output: 'standalone'` is set, but `outputFileTracingRoot` is not. Next.js traces from the project directory by default and excludes files outside it, so a workspace import would be omitted from the standalone bundle without any build error. `outputFileTracingRoot` is therefore set to the repository root. This also relocates the emitted server to `.next/standalone/apps/web/server.js`, which the image's copy paths and start command must reflect.

**The worker is its own service.** The worker and the HTTP server share one image and differ only by command. Running them as separate Compose services means restarting the API does not interrupt a job in flight, and the worker's failures are visible in its own logs. This does not contradict D5: the queue is still Mongo, with no additional queue service.

**Compose services:** `web`, `api`, `worker`, `mongo`, `minio`. `mongo` and `minio` declare health checks, and `api` and `worker` wait on `service_healthy` rather than on container start, which removes the race where the API opens a connection before the database accepts one.

**Container hardening.** Images run as a non-root user. The API exposes the existing `/health` endpoint as its container health check. `.dockerignore` already excludes `node_modules`, build output, `.git`, `.env`, and the mockups.

**Continuous integration.** The existing workflow runs lint, test, and build. A dependency audit step is added, failing on high-severity advisories, which is the enforcement NFR-S1 requires.

### 5.8 Object storage, volumes, and configuration discipline

These rules come from a previous build in which each of the failures below actually happened, and each one was invisible on a development host and only appeared in containers.

**Never share a filesystem path between services.** A service that writes a file locally and stores only the path, expecting another service to read it, is relying on a shared filesystem that separate containers do not have. The pointer travels, the bytes do not, and the reader returns not-found while the writer insists the file exists. In this system the storage key is the only cross-service reference, and any service needing the bytes fetches them from object storage. Temporary files created during processing are local to the process that made them and are never referenced by another service.

**Two endpoints, not one.** The address the API uses to reach MinIO inside the Compose network is not the address a browser can resolve. `MINIO_ENDPOINT` is internal, used for every server-side call; `MINIO_PUBLIC_URL` is the externally reachable origin used whenever a URL is handed to a browser. A URL signed with the internal endpoint reaches nothing from outside the network, and this failure is invisible until someone clicks a link.

**Never persist a signed URL.** Signed URLs expire, so a stored one becomes a broken link at an unpredictable later date. Records store the storage key. A URL is generated at the moment it is needed, with a lifetime from `SIGNED_URL_TTL_SECONDS`, or the document is streamed through an API route that reads the key and applies the download headers from §5.6. FR-E-4's original-document link is produced this way, never saved.

**Every service that touches storage carries its storage configuration.** The worker needs the same MinIO settings as the API. A Compose service missing that environment fails only on the path that reaches storage, which is rarely the first path exercised.

**Volumes.** `mongo_data` and `minio_data` are named volumes mounted at the containers' data directories, so records and documents survive `docker compose down` and are removed only by `docker compose down -v`. FR-A-2 and NFR-S3 require stored originals to remain unaltered for the life of the system, which a container-local directory cannot promise. No bind mount of host paths is used for application data; source is mounted only in development, never in the images that are shipped.

**No hard-coded values anywhere.** Every host, port, bucket, credential, model name, and threshold is read from configuration with an overridable default — `${VAR:-default}` in Compose, a validated field in `core/config.ts`. `localhost` appears in no source file. This is what makes the same images run unchanged on a teammate's machine, in CI, and on a deployed host; a literal that is correct in development is precisely the value that breaks the shipped system.

**Names are meaningful, not generated.** Compose derives container names from the directory it happens to run in, which produces opaque names that differ per machine and make logs and `docker ps` hard to read. The Compose file therefore sets an explicit project `name: tor-radar`, and each service sets `container_name` — `tor-radar-web`, `tor-radar-api`, `tor-radar-worker`, `tor-radar-mongo`, `tor-radar-minio`. Volumes and the bucket follow the same rule: `tor-radar-mongo-data`, `tor-radar-minio-data`, bucket `tor-raw`.

**Configuration added by this section:** `MINIO_PUBLIC_URL`, `SIGNED_URL_TTL_SECONDS`.

---

## 6. Verification

| Level | What it proves | How |
| :---- | :---- | :---- |
| Unit | Hashing, the dedupe decision, backoff arithmetic, job claiming | `vitest`, ports replaced with fakes |
| Integration | Intake against a real database and object store | `vitest` against Mongo and MinIO in Compose |
| Container reality | The §5.8 rules hold | A document uploaded through the running stack is fetched successfully from a browser using the returned link, and survives `docker compose down` followed by `up` |
| Security | The controls in §5.6 hold | Automated tests that a private-range URL, a redirect into a private range, a content-type mismatch, and an operator-object filter parameter are each rejected |
| Live | The requirement is actually met | `curl` upload against the running stack; confirm the object exists in MinIO and the record in Mongo; repeat the upload and confirm one record with two source references |

Unit tests passing is not sufficient evidence that a requirement is met. Acceptance for F1 (SRS §6) requires a TOR submitted by upload, by URL, and by API to produce one record; the API to refuse an unauthenticated caller; and a repeat submission to converge on the existing record. Each is demonstrated live before the slice is considered done.

---

## 7. Out of scope for slice 1

OCR and field extraction (slice 2) · confidence tiering and the review queue (slice 2) · dashboard, search, TOR detail, checklist, CSV export (slice 3) · authentication, vendor profiles, taxonomy, matching, email (slice 4) · live source adapters, which need the `sources` collection and per-source scraping (F12, scheduled after slice 2).

The nine extracted fields are defined in the record shape but are not populated in slice 1.

---

## 8. Documentation tasks this slice carries

- Rework both Dockerfiles for the workspace layout, add the `worker` Compose service and health checks, set `outputFileTracingRoot`, and add the CI audit step (§5.7).
- Rewrite `CLAUDE.md` against SRS v2.0: replace v1 requirement identifiers, remove the Bangkok-only rule, and record the structural decisions D1–D10 as the agent rules for this repository.
- Update `PROJECT.md` where it states Bangkok-only scope.
- Add a structure section to `README.md` describing the root layout and the four enforcement rules.

---

## 9. Open issues inherited from the SRS

| # | Open point | Blocks | Settled by |
| :---- | :---- | :---- | :---- |
| O1 | `T_low`, `T_high` | Slice 2 confidence tiering | Accuracy measurement, NFR-F3 |
| O2 | `MIN_BID_WINDOW_DAYS` | Checklist C2 | Calibration against the collected corpus; until then C2 reports "not evaluated" |
| O3 | `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS` | Checklist C3 | Calibration against the collected corpus |
| O4 | IQR or ZSCORE as the active anomaly method | Slice 3 dashboard | Comparison of both on real budget data |

None blocks slice 1.

---

## 10. Tripwires

Conditions that mean the design needs revisiting rather than extending:

- A module folder exceeds roughly six files, or one service file passes 300 lines — split by responsibility.
- A second module needs to import another module's repository — the boundary is wrong; introduce a service-level call or move the shared concern.
- Document AI cannot process representative Thai TORs through the online path — add the GCS storage adapter rather than working around the limit in the extraction service.
- Thai search cannot meet NFR-F2 with the chosen index strategy — resolve before slice 3 builds the search interface on top of it.
