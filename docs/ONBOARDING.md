# Onboarding — TOR Radar

_For someone who just joined the team: by the end you can run the system, know what each part does,
and know how the team works._

This document is an **entry point, not a source of truth** — every topic links to the document that
owns it. If anything here disagrees with [SRS.md](SRS.md) or [ARCHITECTURE.md](ARCHITECTURE.md),
trust that document and fix this one.

---

## 1. What this project is (one-minute read)

Thai government agencies publish TORs (Terms of Reference) as PDFs scattered across many sites. A
small vendor cannot watch them all, and the public cannot compare them. TOR Radar:

1. **Collects** published TORs from e-GP
2. **Has AI (Gemini) read them** and extract the key fields — title, agency, budget, deadline,
   category, qualifications
3. **Matches** them to vendor profiles and notifies vendors by email
4. **Publishes a dashboard** anyone can read, with a documented "statistical anomaly" rule

Three kinds of user: **vendors** · **the public / journalists** · **admins** (our team).
**Agencies are not users** — they are only a data source. There is no agency login or upload flow.

---

## 2. Stack

| Layer | Choice |
| :-- | :-- |
| Language / runtime | TypeScript · **Node.js 22 or later** |
| Frontend | Next.js 16 (App Router) · React 19 · Three.js (the landing-page radar scene) |
| Backend | Express 5 (REST) · Zod (validation) · argon2 (passwords) · nodemailer (email) |
| Database | MongoDB Atlas — extracted data, and also the job queue · Atlas Search (`lucene.thai`) |
| File storage | Google Cloud Storage — originals are **never overwritten or deleted** · `fake-gcs-server` locally |
| AI | Vertex AI — Gemini (extraction) · Document AI (OCR for scans) |
| Notifications | Email over SMTP only · Mailpit locally |
| Infrastructure | Docker Compose · Cloud Run · GitHub Actions (CI on every PR) |
| Tests | Vitest · Supertest |
| Collaboration | Scrum · Jira (project **TOR**) · GitHub PRs · Discord |

The full table with versions and reasons: [ARCHITECTURE.md §8](ARCHITECTURE.md)

---

## 3. Setup and first run

### 3.1 What you need

- **Node.js 22+** — on Node 20 the tests (vitest) and some commands will not run. Check with `node -v`
- **Docker Desktop** (to run the containers)
- Access to the GitHub repo, the Jira project TOR, and the secret files from the team

### 3.2 Ask the team for these (never commit them)

| What | Where it goes |
| :-- | :-- |
| `.env` values (Mongo URL, staff secret, SMTP, …) | `.env` at the repo root (copy `.env.example`, then fill it in) |
| `gcp-sa.json` — the Vertex AI service account | `secrets/` |
| `gcs-storage-sa.json` — only to use real GCS instead of the emulator | `secrets/` |

`secrets/` and `.env` are already gitignored.

### 3.3 Commands

```bash
cp .env.example .env        # then fill in the values from the team
npm install
npm run dev                 # development: web :3000 · api :4000
```

Or the full stack in containers:

```bash
docker compose up           # web · api · worker · mongo · gcs (emulator) · mail (Mailpit)
```

Compose refuses to start unless `.env` sets `SESSION_SECRET`, `INTAKE_API_KEYS` and `APP_ORIGIN`: there are no default keys (TOR-324). `.env.example` shows how to
generate each one.

Production mode on your machine:

```bash
npm run build
npm run start -w apps/api   # terminal 1
npm run start -w apps/web   # terminal 2
```

### 3.4 Workers (start them yourself — `npm run dev` / `start` do not)

| Command | What it does |
| :-- | :-- |
| `npm run worker -w apps/api` | **Extraction worker** — has Gemini read queued TORs |
| `npm run stats-worker -w apps/api` | **Stats worker** — computes the dashboard figures and peer groups |
| `npm run notify-worker -w apps/api` | **Notify worker** — sends match emails (really sends only with `NOTIFY_DISPATCH_ENABLED=true`) |

Without the extraction worker, imported TORs stay `queued`. Without the stats worker, the dashboard
does not update.

### 3.5 The admin area

The admin area opens to an account with `role: "admin"`, and to nothing else (TOR-199). Sign up (or sign
in with Google) at `/login`, then make your account an admin:

```bash
npx tsx tools/grant_admin.mts --email you@example.com           # dry run: shows the role change
npx tsx tools/grant_admin.mts --email you@example.com --apply   # writes it and signs the account out
```

Sign in again and go to `/admin`. Later admins can be promoted from `/admin/vendors`.

### 3.6 Check it works

- `http://localhost:3000` shows the homepage with figures
- `http://localhost:4000/health` answers `{"status":"ok"}`
- `npm test` passes · `npm run lint` passes

---

## 4. How the system works (overview)

```
e-GP ──► import script ──► intake ──► GCS (original) + MongoDB (record: queued)
                                          │
                                   ingest_jobs (queue)
                                          │
                              extraction worker ──► Gemini
                                          │
                               record: published (+ confidence on every field)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
        search / TOR page          stats worker → dashboard      matching → notify worker → email
```

### 4.1 Ingest

The main source is **national e-GP** (`process5.gprocurement.go.th`); the other is BMA e-GP.
Nothing pulls on a schedule — you run the script:

```bash
npx tsx tools/import_national_egp_tors.mts --limit 100                     # newest draft TORs
npx tsx tools/import_national_egp_tors.mts --from invitation --limit 100   # invitations + TORs (with deadlines)
npx tsx tools/reextract.mts --project <project number>                     # extract again
```

For each project: download the whole package ZIP → archive it as an original → take out the TOR PDF
(and the invitation) → intake checks the real file type by its magic bytes, caps it at 25 MB, and
skips duplicates by sha256 → queue it.
Source details: [DATA-SOURCES.md](DATA-SOURCES.md)

### 4.2 Extract

The worker claims a job → fetches the PDF from GCS by its storage key → Gemini returns each field
with a confidence → plausibility checks (for example, a date's year) → classified onto 13
categories → `published`. A failure retries with backoff; once attempts run out it becomes `failed`
(the original is still stored).

**Confidence controls marking, not visibility:** high → shown normally · medium → marked
"unverified extraction" and kept out of statistics and matching · low → marked, and sent to the
admin review queue.

Measured accuracy (gemini-3.5-flash): **95%** on digital PDFs · **72%** on scans
— [corpus/BENCHMARK.md](corpus/BENCHMARK.md)

### 4.3 Main features

| Feature | How it works, briefly | Code |
| :-- | :-- | :-- |
| Search (F4) | Thai Atlas Search + filters (category, agency, budget, deadline) | `modules/tors` · `features/search` |
| TOR page (F7) | Every field with its confidence and source link · the PDF opens in the app · checklist | `features/tor-detail` |
| Dashboard + anomaly (F8) | A budget is compared with its **peer group** (same category, 12 months) by IQR · groups under 8 never flag | `modules/stats` · `features/dashboard` |
| Quality checklist (F11) | C1 budget stated · C2 deadline workable · C3 scope specific · C4 qualifications stated · C5 budget within peer norm | `modules/checklist` |
| Accounts + profile (F5, F6) | Registration (argon2, email verification, PDPA consent) · work types, budget, areas, past projects, certifications | `modules/accounts` · `modules/profile` |
| Matching (F9) | A 0–100% score from work type (heaviest), budget, past projects, qualifications — **every point carries a reason sentence** | `modules/matching/match-scorer.ts` |
| Email (F10) | Notify worker every 60 s · all / high / daily / off · never sends twice · must arrive within 5 minutes | `modules/notifications` |
| Admin | Review queue · corrections (audited) · takedown · vendor accounts · send-matches button · benchmark labelling | `modules/admin` · `features/admin` |
| Vault / draft letter / company path | The vendor's own files (separate bucket) · an AI cover-letter draft · the company path | `modules/vault` · `drafts` · `path` |
| Source health (F12) | **Not built yet** (TOR-87) | — |

---

## 5. Where the code lives

```
apps/web/     Next.js — app/ is routing only · UI code lives in src/
              src/views → features → entities → shared  (imports go one way, never upward)
apps/api/     Express — modules/<feature>/ · ports/ (interfaces) · adapters/ (GCS, Mongo, Vertex, SMTP)
              workers/ (extract, stats, notify) · core/config.ts (every setting)
packages/     shared/ (types + Zod shared by both apps) · seeds/ (taxonomy, categories, provinces)
tools/        Scripts: import TORs, re-extract, benchmark, test report
docs/         All documentation (see section 7)
mockups/      Design source — reference only, never built
```

One API feature (for example `modules/matching/`) has:
`*.routes.ts` (HTTP + validation) → `*.service.ts` (the rules) → `*.repository.ts` (**the only code
that touches the database**)

**The four structure rules:**
1. Only `*.repository.ts` imports the database
2. `modules/` imports `ports/`, never `adapters/` — wiring happens once, in `app.ts`
3. Every threshold and tunable lives in `core/config.ts`
4. A feature is one folder, so removing it is one operation

---

## 6. Rules not to break

| Rule | Why |
| :-- | :-- |
| **Originals are never overwritten or deleted** (`putIfAbsent` only) | Every figure on the site must trace back to the real document |
| **The only allowed terms are "statistical anomaly" and "specification-quality check"** | Never "suspicious", "corrupt", "irregular" about a TOR, a budget or an agency |
| **Every AI value carries its confidence, model and source link** | Explainable and checkable |
| **Extracted values are shown exactly as extracted** — never re-worded or silently corrected | Accuracy |
| **The UI is in Thai** | Our users are Thai |
| **"PDPA-aligned", never "PDPA-compliant"** | We hold no certification |
| **Nothing hard-coded** — host, port, bucket, credential, model name, threshold | Everything comes from config · `localhost` appears in no source file |
| **Never share a filesystem path between services** | Pass a storage key; fetch the bytes from GCS |
| **Never guess an uncalibrated value** | `T_low`/`T_high`, `MIN_BID_WINDOW_DAYS`, `MIN_SCOPE_*`, IQR vs Z-score (TOR-200) |
| **Never commit secrets** | `.env` and `secrets/` |

---

## 7. What to read, in order

1. [SRS.md](SRS.md) — what the system must do (every requirement, testable) — **the source of truth**
2. [ARCHITECTURE.md](ARCHITECTURE.md) — nine diagrams, where code lives, data model, stack
3. [superpowers/specs/](superpowers/specs/) — the design of each feature (file names start with a date)
4. [TODO.md](TODO.md) — **where we are now**: done, in progress, open
5. [API.md](API.md) — every route · [TESTING.md](TESTING.md) — what is tested
6. [PROJECT.md](PROJECT.md) — why it exists, user stories · [PLAN.md](PLAN.md) — what comes next

The full "which document answers what" table is in [README.md](../README.md#documentation).
`archive/` holds old documents — never cite them.

---

## 8. How the team works

### 8.1 Picking up work
- Work lives in **Jira project TOR** (momentumm.atlassian.net) — Jira is the truth for sprint contents
- Stories are split into sub-tasks · epics ≈ requirement groups (FR-A … FR-G)
- Stand-ups on Discord

### 8.2 Writing code
- **Plan non-trivial work first:** a design spec in `docs/superpowers/specs/` → a plan → build
- Branch from `main`, named like `feat/tor-203-days-left` or `fix/...`
- **Conventional Commits**, one concern per commit: `feat(search): show days left before a TOR closes (TOR-203)`
- Open a PR into `main` — CI runs lint, tests, build, the Mermaid check and **the docs-drift check**

### 8.3 Docs are updated in the same PR (part of Done)

| When you change | Update |
| :-- | :-- |
| A route, its body, query parameters or auth | [API.md](API.md) |
| A collection, field, index, module or worker | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Behaviour a spec describes | That spec — a dated revision section, never a silent edit |
| Tests | [TESTING.md](TESTING.md) |
| A config value or env var | `.env.example` + the doc that explains it |
| Anything finished, started or found open | [TODO.md](TODO.md) + bump its "last updated" date |

Before saying it is done: `node tools/check_docs_drift.mjs` and `node tools/check_mermaid.mjs`.
Doc changes go in their own `docs:` commit.

### 8.4 Definition of Done
Reviewed · tests pass · runs in Docker Compose · **demoable** — passing tests alone is not done;
try it against the running system first.

---

## 9. Common problems

| Symptom | Cause / fix |
| :-- | :-- |
| `npm test` fails strangely | Node older than 22 — upgrade Node |
| Imported TORs stay `queued` | The extraction worker is not running (`npm run worker -w apps/api`) |
| The dashboard does not change | The stats worker is not running |
| Some locally imported TORs `failed` with "object … not found" | Atlas is shared, and the Cloud Run worker (pointed at another bucket) claims jobs from the same queue — the file is not lost; re-extract it (root cause not fixed yet) |
| Admin login bounces back to the login page (`npm start` over `http://`) | Production mode sets the cookie `Secure`, so the browser drops it over http — use `npm run dev` or serve over https |
| Verification or match emails do not arrive | Check the spam folder · is the notify worker running · `NOTIFY_DISPATCH_ENABLED` |
| `apps/web/next-env.d.ts` changes by itself | Next.js rewrites it — do not commit it |
| A TOR is skipped with "over the limit" | The file is larger than 25 MB — skipped on purpose |

**Shared data:** Mongo Atlas and the GCS bucket are shared by the whole team — never delete data.
Tests that write data use the local Mongo (Docker), not Atlas.
