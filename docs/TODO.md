# TOR Radar — working checklist

Hierarchical by law (global CLAUDE.md § Hierarchical todo discipline): one box per deliverable,
a box is expanded into sub-boxes **when it is entered**, nesting goes as deep as the work turns out
to be, and a parent is never ticked while a child is open. Step-level detail for slice 1 lives in
[the plan](superpowers/plans/2026-09-01-slice1-foundation-intake.md).

Decisions that are NOT yet made live in [PLAN.md](PLAN.md) — this file is work,
that file is questions.

_last updated: 2026-10-06_

---

## 1. Requirements and design — DONE

- [x] **SRS v2.0 into the repo**
  - [x] import, repair the Google Docs encoding damage, commit as `docs/SRS.md`
  - [x] map the old identifiers to the new ones for anything still citing `FR-A1` / `NFR-2`
- [x] **Scope correction to national**
  - [x] withdraw the Bangkok-only validation rule
  - [x] propagate through SRS, PROJECT.md, CLAUDE.md
- [x] **Slice-1 design spec**
  - [x] structure — package by feature, ports and adapters, FSD-lite on the web
  - [x] data model — collections, the nine-field record, indexes
  - [x] interaction seams — the intake path, ordering rules, failure paths
  - [x] security §5.6 — SSRF, magic bytes, download headers, query construction
  - [x] containers §5.7 — workspace-aware images, worker service, health gates
  - [x] storage and config discipline §5.8 — two endpoints, no persisted signed URLs, volumes
- [x] **Cross-model check (different company, before building on it)**
  - [x] run Codex against the design
  - [x] SSRF: reject on any resolved address, not just the first
  - [x] admin routes authenticated from the first commit, not by network placement
  - [x] `announcedAt` and `sourceUrl` added, with their indexes
  - [x] reconciler closes the insert-then-enqueue gap
- [x] **Agent-facing docs** — PROJECT.md, CLAUDE.md, AGENTS.md realigned to v2.0
- [x] **Implementation plan** — 16 tasks, TDD steps, live verification

## 2. Slice 1 — foundation and intake — IN PROGRESS (11/16)

_Each box below expands into its own sub-list when it is entered. The plan file holds the steps._

- [x] **Task 1 — workspace plumbing and shared types** — delegated to `mechanic`, verified, `79f45c2`
  - [x] add `packages/shared/package.json` with the build and prepare scripts
  - [x] add `packages/shared/tsconfig.json` (pulled forward from Task 14, so the manifest was not
        written twice)
  - [x] write `src/tor.ts` — `TorRecord`, `ExtractedField`, `SourceRef`, `PipelineState`
  - [x] write `src/intake.ts` — the URL request schema
  - [x] write `src/index.ts` — the barrel
  - [x] register `packages/*` in the root workspaces array
  - [x] verify `@tor-radar/shared` resolves — `npm ls` shows the symlink
  - [x] verify `prepare` produced `dist/`, and that `dist/` is gitignored
  - [x] verify the package actually imports at runtime (`node -e "import(...)"` → `urlIntakeSchema`)
  - [x] commit
- [x] **Task 2 — `core/config.ts`, every threshold validated, fails fast** — delegated to
      `implementer`, verified, `324ade9`
  - [x] zod + vitest added to the api workspace
  - [x] failing test first, confirmed failing for the right reason
  - [x] schema with 24 keys, `Config`, `loadConfig`, `OPEN_VALUES` (O1–O4 names only, no invented
        values)
  - [x] 5/5 tests pass at the root, which is what CI runs
  - [x] parent follow-ups from the agent's findings:
    - [x] `ignoreRestSiblings` at the root eslint config, so the rest-omit pattern stops breaking CI
    - [x] removed the local `eslint-disable` the agent had to add inside the test
    - [x] `z.string().url()` → `z.url()`, since zod resolved to 4.5.4 where the old form is deprecated
- [x] **Task 3 — content hashing** — delegated to `mechanic`, verified, `36aea85`
  - [x] failing test first, confirmed failing for the right reason
  - [x] `sha256(Buffer)` over `node:crypto`, three cases pass
  - [x] 8/8 tests at the root, lint and tsc clean
  - [x] parent check: the test's `abc` vector matches a real sha256 digest
- [x] **Task 4 — magic-byte verification** — delegated to `mechanic`, verified, `f4f04fc`
  - [x] failing test first, five cases pass
  - [x] 13/13 tests at the root, lint and tsc clean
  - [x] parent adversarial probe: HTML, SVG-with-script, an html-then-%PDF polyglot, truncated
        magic, zip and empty are all rejected; real PDF/PNG/JPEG accepted
  - [ ] **open question for the Sprint-1 corpus:** a PDF whose `%PDF` header is not at byte 0
        (leading whitespace or junk) is rejected. Strict is right for a security control, but real
        scans sometimes carry leading bytes — check against the 10–20 real TORs before deciding
        whether to scan a bounded prefix instead
- [x] **Task 5 — SSRF-resistant fetch and typed errors** — delegated to `implementer`, verified,
      `26d22d1`
  - [x] every resolved record checked, not just the first (the rebinding bypass the cross-check found)
  - [x] `net.BlockList` instead of string prefixes — catches `::ffff:169.254.169.254`, which the
        plan's version would have passed through. Agent's improvement, kept
  - [x] unparseable addresses fail closed
  - [x] 19 cases: loopback, metadata, private, unique-local, mapped-IPv6, private-record-not-first,
        redirect into private range, scheme change mid-redirect, chain cap, size cap, error status
  - [x] 32/32 tests at the root, lint and tsc clean
  - [x] agent hit a session rate limit before committing; parent verified and committed its work
- [x] **Task 6 — storage port and MinIO adapter** — delegated to `implementer`, verified, `36e71fc`
  - [x] `Storage` port has no `put`, so FR-A-2's no-overwrite rule is a type error not a convention
  - [x] two clients: internal endpoint for server calls, `MINIO_PUBLIC_URL` for signing
  - [x] tests run against live MinIO on port 9010
  - [x] agent added `src/test/env.ts` so both test runners see the root `.env` — a vitest config
        alone would have left the root gate, which is what CI runs, unable to read it
  - [x] parent closed the gap the agent flagged: a Compose-shaped test where the endpoints diverge,
        proven to fail when signing regresses to the internal client
  - [x] 36/36 tests at the root, lint and tsc clean
  - [ ] **carried:** `putIfAbsent` is check-then-write, not atomic. Benign with content-addressed
        keys because concurrent writers store identical bytes, but it is a race — revisit if keys
        ever stop being content hashes
- [x] **Task 7 — queue port and MongoDB adapter** — delegated to `implementer`, verified, `48385dc`
  - [x] `core/db.ts` with the collection shapes and `ensureIndexes`, including the unique
        `contentHash` index and the `announcedAt` indexes the cross-check added
  - [x] atomic claim via `findOneAndUpdate`, lock expiry so a crashed worker's job returns
  - [x] idempotent enqueue, retry with backoff, permanent give-up at `JOB_MAX_ATTEMPTS`
  - [x] 42/42 tests at the root, lint and tsc clean
  - [x] parent stress test beyond the suite: 20 racing claimants produced exactly 1 winner, and
        20 concurrent enqueues of one record produced exactly 1 job document
  - [ ] **carried:** concurrent upserts can duplicate without a unique index, and
        `partialFilterExpression` cannot express `state in (pending, running)`. It held under the
        stress test, but the guarantee is probabilistic. A duplicate job means one wasted extraction
        call rather than corruption — revisit if extraction ever stops being safe to repeat
- [x] **Task 8 — intake repository** — built in-session (implementer rate-limited), `ecb7b38`
  - [x] insert opens the record queued, with its first source ref and status-history entry
  - [x] `appendSourceRef` records a repeat submission against the existing record (FR-A-3)
  - [x] `announcedAt` left null on purpose: the agency's date, extracted in slice 2
  - [x] 7 cases pass; 49/49 at the root, lint and tsc clean
  - [x] dedupe proven under concurrency: 12 simultaneous inserts of one hash gave 1 success,
        11 duplicate-key rejections, 1 record. The unique index is the guarantee, not the
        `findByHash` check in front of it
- [x] **Task 9 — intake service** — built in-session, `be7970a`
  - [x] one entry for all three routes, so they cannot drift apart in what they accept
  - [x] fixed order: store bytes → insert record → enqueue, so a crash orphans an object rather
        than leaving a job pointing at nothing
  - [x] duplicate-key on insert routed into the dedupe path, not surfaced as an error
  - [x] 9 cases with fake ports, no infrastructure needed; two assert the negative space — a failed
        insert enqueues nothing, a rejected type stores nothing
  - [x] 58/58 at the root, lint and tsc clean
- [x] **Task 10 — three intake routes with access control** — built in-session
  - [x] upload, URL and programmatic routes all reach the one service (FR-A-1)
  - [x] separate admin and intake keys, constant-time compare, empty key list opens nothing
  - [x] found and fixed a real fault: a malformed URL answered 500 because a ZodError fell through
        to the generic handler. Schema rejections now answer 400 with the failing paths
  - [x] 20 cases across routes and auth; 78/78 at the root, lint and tsc clean
- [x] **Task 11 — extraction worker and orphan reconciler** — pulled into TOR-88's branch as
      subtask **TOR-126** (the worker is the harness the extraction runs in, not a TOR-73 concern)
  - [x] `workers/reconcile.ts` + 4 integration cases — requeues an orphaned `queued` record,
        leaves a live-job record alone, ignores records younger than `RECONCILE_MIN_AGE_MS`,
        ignores records past `queued`
  - [x] `workers/extract.worker.ts` — `runOnce` (claim → extracting → handler → published |
        retry | failed), a pass-through `ExtractionHandler` as the slice-2 seam, `startWorker`
        loop with scheduled reconcile, entry guard so importing the module in tests starts nothing
  - [x] `runOnce` unit-tested with a fake queue; the seam integration-tested against real Mongo
        (`queued → published`, handler runs while `extracting`, exhausted retries → `failed` with
        the reason, NFR-S5)
  - [x] `worker` / `worker:dev` scripts; `worker` Compose service (shared env anchor with `api`,
        which also gained the `MINIO_PUBLIC_URL` / key vars it was missing)
  - [x] per-file isolated test DBs (`test/mongo.ts`) so `tors`-touching integration files stop
        racing each other under vitest parallelism
  - [x] 89/89 at the root, lint and tsc clean; worker verified live against Mongo
- [ ] Task 12 — TOR read API, signed links, redaction
- [ ] Task 13 — design tokens and the admin upload screen
- [ ] Task 14 — workspace-aware Dockerfiles
- [ ] Task 15 — Compose services, health gates, CI audit
- [ ] Task 16 — live verification and documentation

## 2b. Web — mockup port (outside the slice-1 plan, done on request)

- [x] **Landing page** — ported from `mockups/TOR Radar Landing.dc.html`
  - [x] design tokens extracted; no literal colours in components
  - [x] hero, marquee, counting stats, three steps, anomaly plot, checklist, closing, footer
  - [x] three.js radar backdrop restored, always animating, paused off-screen and when hidden
  - [x] sample-data notice added: the mockup's figures are invented and FR-E-6 forbids implying coverage
- [x] **Dashboard** — `/dashboard`, app shell with the tab bar
  - [x] agency bars filter on click, price plot with tooltips, flagged point links to its detail page
  - [x] bars grow and plot points scale in, staggered; flagged point keeps pulsing
- [x] **Search** — `/search`, delegated to `mechanic`, verified, `4c184fe`
- [x] **TOR Detail** — `/tors/[id]`
- [x] **Vendor Profile** — `/profile`
- [x] **Updated to the 2026-09-03 mockup** — delegated to `mechanic`, verified, `769f767`
  - [x] header gains the notification bell, unread badge and dropdown
  - [x] **Notifications** screen at `/notifications`
  - [x] **Admin Review Queue** at `/admin/review` — staff-only, and nothing links to it. The role
        gate arrives with authentication in slice 4; until then the route exists unprotected and
        unlinked, which is the honest state
  - [x] **Match Email not built as a route.** It is the email that lands in a vendor's inbox, not a
        page. It stays in the mockup as the template for slice 4's notification work
  - [x] `ADMIN` and `EMAIL` nav chips deliberately not reproduced: prototype-only demo navigation
  - [x] Dashboard stat strip now recomputes when an agency filter is applied; profile notification
        card rebuilt with presets and an advanced section; Search and TOR Detail already matched
  - [x] all 7 routes serve, lint clean, no literal hex values in the new files
- [ ] **Carried forward from the port** (decide before these screens meet real data):
  - [ ] no signed-out state exists in the app shell; every screen renders the signed-in branch. Slice 4 builds auth and must add it
  - [ ] starred and bookmarked lists on the profile are seeded samples; they need real cross-route state once accounts exist
  - [ ] `/tors/demo-anomaly` is a hard-coded slug pointing at the sample anomaly TOR; replaced by real ids when ingestion lands

## 2c. Slice 2 — extraction and confidence (TOR-88) — IN PROGRESS

_Design: [`specs/2026-09-09-tor-radar-extraction-confidence-design.md`](superpowers/specs/2026-09-09-tor-radar-extraction-confidence-design.md) — drafted on this branch, NOT yet externally cross-checked; §10 holds the open questions. Reviewed at PR time._

- [x] **TOR-126 — extraction worker + reconciler (pipeline harness)** — see §2 Task 11
- [x] **Slice-2 design spec** — decisions D1–D11, the §6 confidence policy, §10 questions
      (Q2/Q3/Q5 resolved after the corpus gate ran)
- [x] **TOR-89 — Vertex AI extraction service** — `ports/ai.port.ts`, `adapters/vertex.ai.ts`,
      `modules/extraction/{service,repository}.ts`, `lib/pdf-text.ts`, config (T_low/T_high promoted).
      Corpus gate (spec §8, real Vertex, `extraction.corpus.test.ts`): 10/10 — agency/budget/status
      match the labels; grade distribution high:5 / low:5. `dc4cfcf`
- [x] **TOR-90 — per-field confidence + tier logic** — `extraction.grading.ts`, the §6 three-pass
      policy; 10 table-driven cases. Built with TOR-89 as one testable unit. `dc4cfcf`
- [x] **TOR-91 — sanity checks** — `grading.ts` Pass 3 (missing critical field, implausible budget,
      deadline before announcement, cancelled-with-deadline, copy-through). Corpus-validated. `dc4cfcf`
- [x] **TOR-92 — qualification → taxonomy mapping** — `extraction.taxonomy.ts` + `taxonomy.seed.json`
      (~30 tags, keyword aliases; pulled forward from F9, `.tags` recomputable). `a317daf`
- [x] **TOR-93 — PII minimisation** — `lib/redact.ts`, the single serializer: `redactTor(record,
      "public")` reduces `fields.contact` (office name / landline / gov URL kept; name / mobile /
      email / signature removed). Slice 3's read API + CSV export call it. `a317daf`
- [x] **TOR-120 — tests: two-tier logic + sanity checks** — grading (10 cases) + service + worker +
      taxonomy + redact + pdf-text + the corpus gate. 125/125 CI unit run.
- [ ] **TOR-88 (parent) — in review** — PR open; Sudha (epic TOR-3 owner) to read the Slice-2
      spec §4 / §6 / §10 before approving. Design has NOT had the external cross-check Slice 1 got.

## 2d. Admin validation screen and the staff gate — DONE (2026-09-10 → 11)

_Design: [`plans/2026-09-11-admin-validation-port.md`](superpowers/plans/2026-09-11-admin-validation-port.md)._

- [x] **Staff session** — `requireStaff()` before every admin action, signed httpOnly cookie,
      constant-time compare, Thai sign-in screen. Closed a real hole: the four review actions spent
      the admin key with no caller check, and the only "gate" was a client component reading
      prototype browser storage. `39c3704`
  - [x] sign-out ends BOTH sessions, awaited so navigation cannot cancel it. `ab303fd`
  - [x] a way back into the staff area from the public side, one style for both directions.
        `ab303fd`, `21a9020`
- [x] **Two API operations** the screen needed. `db9fcaa`
  - [x] `GET /admin/tors/:id/document` — signed URL, key read from the record, never the caller
  - [x] `PATCH /admin/tors/:id/fields/:field/verification` — confirming is NOT correcting; the test
        asserts the `corrections` count is unchanged, because those rows are replayed to the
        extractor as few-shot examples
- [x] **The screen, ported to the redesigned mockup** — three columns, locked shell, real stored PDF
      in the middle, confirm ticks and progress. `48e82fc`
- [x] **Confirmation dialogs**, and the reject reason is no longer a hardcoded constant. `27e7e49`
- [x] `GET /admin/tors/:id/document` — superseded 2026-09-16: the route streams the document instead
      of returning a signed URL (§2e)

## 2e. Object storage on Google Cloud Storage — MERGED, AWAITING THE REAL BUCKET

_Design: [`specs/2026-09-14-object-storage-gcs-design.md`](superpowers/specs/2026-09-14-object-storage-gcs-design.md) rev 3 ·
Plan: [`plans/2026-09-14-gcs-storage.md`](superpowers/plans/2026-09-14-gcs-storage.md) — 16 tasks, squash-merged as `22a7344` (#6)._

- [x] **Design spec, three revisions, cross-checked** — the first revision rested on a truncated
      quote about noncurrent versions and had to be corrected. `ab94958`, `b4efa79`, `ab5f205`
- [x] **Implementation plan, cross-checked by Codex before any code** — 15 of 16 findings applied.
      `4ae4ef2`
- [x] **Built and merged** — byte-range parser, disposition allowlist, `streamDocument`, the
      `GcsStorage` adapter, one `createStorage` factory for the API and the worker, both document
      routes streaming `GET`/`HEAD`, the two Next proxy handlers, MinIO and `signedUrl` deleted,
      emulator in Compose and CI, seeder, docs. `22a7344`
- [x] **Live verification against the running stack** (2026-09-16, `localhost`)
  - [x] admin document streams `200 application/pdf`, `nosniff`, `private, no-store`,
        `Accept-Ranges`, RFC 6266 filename
  - [x] range request → `206`, `Content-Range: bytes 0-4/277234`, body begins `%PDF-`
  - [x] admin document without the key → `401`; through the web proxy signed out → `404`
  - [x] public document through the Next proxy → `200`; `?disposition=inline` → `inline`, range `206`
  - [x] re-running the seeder takes the precondition path — "already stored" — and leaves 3 records,
        which is the duplicate-write protection proving itself outside a test
  - [x] gates: lint clean, both type-checks clean, 241 passed / 10 skipped, emulator suite 6/6
- [ ] **Zen, in the Google Cloud console** (plan Task 16 — not an agent task)
  - [ ] confirm the Bangkok (`asia-southeast3`) storage price
  - [ ] create the originals bucket — uniform access, public access prevention, retention period,
        **unlocked**; no lifecycle rule
  - [ ] create the disposable test bucket, same region, one-day lifecycle delete
  - [ ] create the `tor-storage` service account and the `torStorageWriter` custom role
        (`storage.objects.create` + `storage.objects.get`), bound at the bucket, no project roles
  - [ ] issue its key, store it outside the repository, point `GCS_CREDENTIALS` at it
- [ ] **After the first real original is stored** — run the real-bucket workflow
      (`gcs-real.yml`, manual), then drop the retained `minio_data` volume from `docker-compose.yml`;
      rollback is forward-only from that point (spec §9)

## 2f. Sprint 3 — dashboard figures and the anomaly rule — BUILT AND VERIFIED (2026-09-17)

_Design: [`specs/2026-09-17-dashboard-anomaly-design.md`](superpowers/specs/2026-09-17-dashboard-anomaly-design.md) rev 2 ·
Plan: [`plans/2026-09-17-dashboard-anomaly.md`](superpowers/plans/2026-09-17-dashboard-anomaly.md) · branch `feat/sprint3-dashboard-stats`._

- [x] **Design spec, cross-checked before any code** — a review against the code found twenty faults
      in revision 1, all carried into revision 2 and listed in its §12
- [x] **TOR-61 — the anomaly rule as one documented function** — type-7 quartiles, the 1.5×IQR fence,
      the z-score alternative, zero-spread and missing-statistics cases
- [x] **TOR-63 — ineligible budgets excluded** — one predicate shared by the in-memory rule and the
      Mongo query, and used as the partial index's filter so the two cannot drift
- [x] **TOR-122 — the edge-case tests** — `n` below, at and above the minimum; both tails; a value
      exactly on the fence; identical peers; unverified, unpublished and taken-down records
- [x] **TOR-65 — filters in the URL** — Zod primitives, unknown and malformed values ignored,
      shareable and reload-proof
- [x] **TOR-66 — totals and the trend** — from rollup cells, or from records when a budget or status
      filter is active, because a cell holds a sum rather than the budgets inside it
- [x] **TOR-62 — the plot** — points with the band they are judged against, flagged points with their
      distance, each carrying the confidence and model version behind it
- [x] **Live verification against the running stack** (2026-09-17)
  - [x] fence matches hand arithmetic: q1 1,675,000 · q3 2,700,000 · fence 4,237,500
  - [x] the seeded outlier is the only flagged record, at 47.01×IQR
  - [x] unticking a verified budget dropped it from the peer statistics within seconds (11 → 10)
  - [x] the unverified and taken-down records, both with absurd budgets, moved no bound
  - [x] a category below the peer minimum reports "not enough comparable TORs", and its flagged count
        is omitted rather than shown as zero
  - [x] a budget-range filter bypasses the rollup cells: 8 records / ฿163.1M against 18 / ฿172.15M
  - [x] ageing the statistics raised the recalculating banner; a fresh run cleared it
  - [x] gates: lint, both type-checks, 299 passed / 10 skipped
- [ ] **Open, carried** (see PLAN.md §3)
  - [ ] real corpus collection is blocked on Vertex AI credentials (`secrets/gcp-sa.json`)
  - [ ] `ANOMALY_METHOD` stays open value O4 until IQR and z-score are compared on real budgets
  - [ ] the agency key is the extracted string; whether it should be a canonical identifier needs
        real data showing how many spellings one agency has
  - [ ] TOR-57 and TOR-41 are Sran's cards but were built here, because TOR-62/65/66 could not be
        demonstrated without them — needs a word with the team

## 2g. Review feedback, 2026-10-06 — five of eight done

_Triage: [feedback-2026-10-06.md](feedback-2026-10-06.md). Decisions in [PLAN.md](PLAN.md)._

- [x] **TOR-149 — ประกาศเชิญชวน as an explicit state**, counted on the dashboard as
      clickable filters and offered as search filters. One vocabulary in
      `lib/tor-state.ts`; the in-memory rule and the database predicate are tested
      against each other so a TOR cannot be open on one screen and missing on another
- [x] **TOR-150 — a deadline says which document it came from.** The detail page
      already did; the results list does now, because a bare date in a row reads as
      the TOR's own
- [x] **TOR-151 — ปีงบประมาณ**, derived from the announcement date (Thai fiscal year,
      October–September, named for the BE year it ends in) rather than stored. Not yet
      a filter
- [x] **TOR-152 — filters ordered by what narrows a list first** — สถานะ, กำหนดยื่น,
      หมวดหมู่, งบประมาณ, หน่วยงาน — and the agency list capped at the busiest six
- [x] **TOR-153 — one save action.** The star is gone; bookmark stays
- [x] **Dashboard rebuilt around the states** — chips that filter, every breakdown row
      a filter, unknown values named and sorted last, one source for every figure
- [ ] **TOR-154 — signed-in dashboard** (on hand, closing soon, matched to me)
- [ ] **TOR-155 — search ranked by relevance to the vendor.** The closing-soonest half
      already works; the relevance half needs matching
- [ ] **TOR-156 — no ThaiD, no national ID.** A constraint on registration, which does
      not exist yet
- [ ] **Carried:** removing the star left nothing recording "I have done work like
      this", which FR-D-2 asks for and matching would use — PLAN.md Q5 reopened
- [ ] **Carried:** "closing soon" as its own reading mode, distinct from search

## 3. Open values carried from the SRS — BLOCKED ON DATA

- [x] O1 — `T_low` = 0.80 / `T_high` = 0.95, from the TOR-18 accuracy measurement
      (`docs/corpus/BENCHMARK.md`, NFR-F3). Promoted from `OPEN_VALUES` to real config in TOR-89.
- [ ] O2 — `MIN_BID_WINDOW_DAYS`; checklist C2 reports "not evaluated" until then
- [ ] O3 — `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS`
- [ ] O4 — IQR or ZSCORE as the active anomaly method

## 3b. Carried debt — small, keeps costing time

- [x] **Split the dev and test databases.** Fixed in `vitest.setup.ts`, before any test file loads:
      the database name is forced to end in `_test`, so a suite added later cannot reintroduce it.
      Development runs against `tor_radar_dev`. `37a7daf`
- [ ] **`npm run dev` cannot start the web app on this machine.** Windows Application Control blocks
      `@next/swc-win32-x64-msvc`, Next falls back to WASM, and Turbopack requires the native binary.
      `next dev --webpack` works. Decide whether `--webpack` belongs in the script or the policy
      should be changed — until then the two dev servers are started separately (2026-09-16)
- [ ] Record the Q1 rendering decisions in `PLAN.md` §3 and correct the
      `NEXT_PUBLIC_API_URL` line in `API.md` — the decision is made and the spec is written, the
      register has not caught up
- [ ] `CLAUDE.md`'s stack table names Document AI for OCR; the code has never called it. Either the
      table or the pipeline is wrong, and §2e decides which

## 4. Environment

- [x] **Tiered trio installed** — `implementer`, `mechanic`, `verifier` in `~/.claude/agents/`
- [x] **Vault skills installed** — crosscheck, backtest-validation, safe-refactoring
- [x] **Delegation and cross-check rules inlined** into the global CLAUDE.md
- [x] **`brain_doctor.py`** — verifies installed state, wired as a SessionStart hook
- [x] **Hierarchical todo law** written into the global rules, the playbook, and QUEUE.md
- [ ] Restart and confirm the todo panel returns
- [ ] Test whether agent teams and the todo panel can coexist
  - [ ] run `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude`, check for both
  - [ ] if both work, restore the flag in `settings.json` permanently
- [ ] Decide whether `pixel-agents` stays — it rewrote `settings.json`, hooked every event, and
      changed the model from `claude-fable-5[1m]` to `opus`
- [ ] Decide whether Fable goes back as the architect model
