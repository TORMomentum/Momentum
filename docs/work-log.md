# Work log

Durable record of delegated work. Each entry is written when a task's agent log is
archived, after the parent verified the work against the code - see the hierarchical
todo law in the global CLAUDE.md.

## 2026-09-02 — Task 1 - workspace plumbing and shared types (mechanic)

**Verified:** commit 79f45c2 has the right scope; npm ls resolves the symlink; prepare produced dist/ and dist/ is gitignored; the built package imports at runtime (node -e import -> urlIntakeSchema). One check the agent did not run was added by the parent and passes.

**Completed (10):**

- read Task 1 and Task 14 in the plan
- create packages/shared/package.json (Task 14 version, with build + prepare)
- create packages/shared/tsconfig.json
- create packages/shared/src/tor.ts
- create packages/shared/src/intake.ts
- create packages/shared/src/index.ts
- register packages/* in the root package.json workspaces array
- run npm install and confirm node_modules/@tor-radar/shared exists
- confirm packages/shared/dist/index.js was produced by the prepare script
- commit with the message from the plan


## 2026-09-02 — Task 2 - configuration module (implementer)

**Verified:** commit 324ade9 has the right scope; 5/5 tests pass at the root (what CI runs); lint and tsc clean. Parent applied the agent's own recommendation - ignoreRestSiblings at the root eslint config - then removed its local suppression, and modernised z.string().url() to z.url() for the zod 4.5.4 that actually resolved.

**Completed (24):**

- read Task 2 in the plan
  - note the keys added after the cross-check: ADMIN_API_KEYS, RECONCILE_INTERVAL_MS, RECONCILE_MIN_AGE_MS
- add dependencies to the api workspace
  - zod (`npm install zod -w @tor-radar/api` -> zod ^4.5.4)
  - vitest (dev) (`npm install -D vitest -w @tor-radar/api` -> vitest ^4.1.11)
- write the failing test
  - create apps/api/src/core/config.test.ts with the four cases from the plan (verbatim from the plan)
  - run it and confirm it fails because the module does not exist yet, not for another reason -- `npm test -w @tor-radar/api -- config` -> `Error: Cannot find module './config.js' imported from .../src/core/config.test.ts`
- implement apps/api/src/core/config.ts (verbatim from the plan)
  - the zod schema, every key with its documented default (24 keys; 9 required, 15 defaulted)
  - the Config interface
  - OPEN_VALUES with the O1-O4 open-issue status recorded (names only -- no values invented)
  - loadConfig mapping env to Config
- run the test and confirm all four pass -- `npm test -w @tor-radar/api -- config` -> `Test Files 1 passed (1) / Tests 4 passed (4)`
- confirm the api workspace test script actually runs this file -- `npm test -w @tor-radar/api` -> 2 files / 5 tests; verbose run lists all four `src/core/config.test.ts > loadConfig > ...` cases
- commit with the message from the plan -- `324ade9` `feat(api): add the validated configuration module` (4 files, matching the plan's `git add` list; body + Co-Authored-By trailer added per repo convention)
- repo-wide gates re-run, because CI (`.github/workflows/ci.yml`) runs lint + test + build
  - `npm run build -w @tor-radar/api` (tsc) -- clean
  - `npm run lint` -- initially FAILED on the plan-verbatim test line
  - resolved inside `apps/api/` with a one-line targeted eslint-disable on the rest-omit
  - `npm run lint` -- clean
  - `npm test` (root) -- 2 files / 5 tests passed
  - `npm run build` (root) -- web + shared build clean
  - first attempt used PowerShell here-string quoting inside the Bash tool and produced a stray `@` first line; amended immediately to the correct subject


## 2026-09-02 — Task 3 - content hashing (mechanic)

**Verified:** commit 36aea85 contains exactly the two planned files; 8/8 tests at the root, lint and tsc clean. Parent confirmed independently that the test's abc vector is a real sha256 digest, so the test asserts against the algorithm rather than against the implementation.

**Completed (9):**

- read Task 3 in the plan
  - create apps/api/src/lib/hash.test.ts with the three cases from the plan
  - run it, confirm it fails because the module does not exist, not for another reason
- implement apps/api/src/lib/hash.ts
- run the test, confirm all three pass
  - npm test at the root
  - npm run lint at the root
  - npm run build -w @tor-radar/api
- commit with the message from the plan (36aea85)

**Left open (2):**

- write the failing test
- run the repo gates that CI runs


## 2026-09-02 — Task 4 - magic-byte verification (mechanic)

**Verified:** commit f4f04fc has exactly the two planned files; 13/13 tests at the root, lint and tsc clean. Parent ran adversarial probes the agent did not: HTML, SVG-with-script, an html-then-%PDF polyglot, truncated magic, zip and empty are all rejected, real PDF/PNG/JPEG accepted. Noted that a PDF header not at byte 0 is also rejected - safe default, to be checked against the real corpus.

**Completed (12):**

- read Task 4 in the plan
- write the failing test
  - create apps/api/src/lib/file-type.test.ts with the five cases from the plan
  - run it, confirm it fails because the module does not exist, not for another reason
- write the failing test
- implement apps/api/src/lib/file-type.ts
- run the test, confirm all five pass
- run the repo gates that CI runs
  - npm test at the root
  - npm run lint at the root
  - npm run build -w @tor-radar/api
- commit with the message from the plan


## 2026-09-02 — Task 5 - SSRF-resistant fetch (implementer)

**Verified:** Agent hit a session rate limit before committing; its work was left green and uncommitted. Parent verified: 32/32 tests, lint and tsc clean, multi-address fix applied via lookup(hostname,{all:true}), and range matching upgraded to net.BlockList which catches IPv4-mapped IPv6 forms the plan's prefix comparison would have missed. Committed as 26d22d1.

**Completed (1):**

- read Task 5 in the plan and spec section 5.6

**Left open (15):**

- write the failing test
  - create apps/api/src/lib/safe-fetch.test.ts with the seven cases from the plan
  - add a case asserting that a hostname resolving to BOTH a public and a private address is rejected
  - run it, confirm it fails because the module does not exist
- implement apps/api/src/core/errors.ts
- implement apps/api/src/lib/safe-fetch.ts
  - resolve with { all: true } and reject if ANY address is blocked
  - scheme allowlist, redirect cap, size cap, timeout
  - re-run the address check after every redirect
- run the test, confirm all cases pass
- run the repo gates that CI runs
  - npm test at the root
  - npm run lint at the root
  - npm run build -w @tor-radar/api
- commit with the message from the plan


## 2026-09-02 — Web screens port - Search, TOR Detail, Vendor Profile (mechanic)

**Verified:** Commits 4c184fe and 7a5a906. Verified: lint clean, 32/32 api tests still green, all six routes return 200, and zero literal hex values in the new files so token discipline held. Screenshots of /search and /tors/demo-anomaly checked against the mockup - filter sidebar, dual budget slider, MATCH/UNVERIFIED/STATISTICAL-ANOMALY badges, fact grid, AI checklist and PII note all faithful. Agent flagged five interpretation points; four were forced by existing code and one was a deliberate fix to a date-derivation bug in the mockup.

**Completed (17):**

- read the mockup sections and DashboardView.tsx to learn the pattern
- Search screen
  - SearchView.tsx with the filter sidebar and result list
  - styles added as tokenised CSS Module classes
  - route at app/(app)/search/page.tsx
- TOR Detail screen
  - TorDetailView.tsx
  - styles
  - route at app/(app)/tors/[id]/page.tsx
- Vendor Profile screen
  - VendorProfileView.tsx
  - styles
  - route at app/(app)/profile/page.tsx
- gates
  - npm run lint at the root — clean (after removing an eslint-disable
  - npm run build -w @tor-radar/web — succeeds, routes /search, /profile,
- commit — 4c184fe "feat(web): port Search, TOR Detail, Vendor Profile screens"


## 2026-09-02 — Task 6 - storage port and MinIO adapter (implementer)

**Verified:** Commits 36e71fc and eb19e2b. Verified: 35/35 tests at the root, lint and tsc clean, signedUrl signs on the public client. The agent flagged that its own third test cannot catch a regression on a host where the internal and public origins coincide; parent added a Compose-shaped case with diverging endpoints and PROVED it fails when signing is switched back to the internal client, then restored. Now 36 tests.

**Completed (18):**

- read Task 6 in the plan and spec section 5.8
- make the api test runner see the root .env
  - add the config and confirm loadConfig(process.env) resolves in a test
  - discovered: the root `vitest run` (the CI gate) has no config and does not read
- write the failing test
  - apps/api/src/adapters/minio.storage.test.ts with the three cases from the plan
  - run it, confirm it fails because the module does not exist
- define ports/storage.port.ts
- implement adapters/minio.storage.ts
  - putIfAbsent returns the existing object untouched rather than overwriting
  - signedUrl is generated against MINIO_PUBLIC_URL, not the internal endpoint
  - discovered: on this host MINIO_ENDPOINT and MINIO_PUBLIC_URL resolve to the
- run the test against the live MinIO, confirm all three pass
- run the repo gates that CI runs
  - npm test at the root → 6 files, 35 passed
  - npm run lint at the root → clean
  - npm run build -w @tor-radar/api → clean
- commit


## 2026-09-03 — Task 7 - queue port and MongoDB adapter (implementer)

**Verified:** Commit 48385dc landed before the agent hit a session rate limit. Verified: 42/42 tests at the root, lint and tsc clean, findOneAndUpdate for the claim with lockedUntil expiry, upsert with setOnInsert for idempotent enqueue. Parent stress-tested beyond the suite: 20 racing claimants yielded exactly one winner and 20 concurrent enqueues yielded one job document. Noted that upsert idempotency is probabilistic without a unique index, which partialFilterExpression cannot express for a state set.

**Completed (24):**

- read Task 7 in the plan
- define ports/queue.port.ts
- write core/db.ts
  - TorDocument and JobDocument shapes
  - connect, disconnect, collection accessors
  - ensureIndexes including the unique contentHash index
- write the failing test
  - adapters/mongo.queue.test.ts with the six cases from the plan
  - import ../test/env.js first so config resolves
  - run it, confirm it fails because the module does not exist
- implement adapters/mongo.queue.ts
  - enqueue is idempotent while a job is pending or running
  - claim is atomic and respects lockedUntil
  - fail schedules a retry until attempts are exhausted, then gives up
- **added:** install `mongodb` in the api workspace before the test rather
- **added:** verify `findOneAndUpdate`'s return shape on the installed
- **added:** prove the atomicity test has teeth, not luck (see below)
- **added:** probe whether a crashed worker's job becomes claimable again —
- run the test against the live Mongo, confirm all six pass
- run the repo gates that CI runs
  - npm test at the root
  - npm run lint at the root
  - npm run build -w @tor-radar/api
- commit


## 2026-09-03 — Web update to the 2026-09-03 mockup (mechanic)

**Verified:** Commit 769f767 plus work the parent accidentally swept into an earlier commit. Verified: all 7 routes return 200, lint clean, the header carries only the three real tabs plus the bell, ADMIN/EMAIL chips appear nowhere but a comment explaining their exclusion, and /admin/review is linked from nothing. Notifications screen checked against the mockup in a browser. The agent correctly reported that the parent's git add -A had committed its work-in-progress under an unrelated message.

**Completed (15):**

- read the new mockup and compare against the existing views
  - list what changed in Dashboard, Search, TOR Detail, Vendor Profile
  - header: bell + badge + dropdown are new; ADMIN/EMAIL demo chips and
- header: notification bell, unread badge, dropdown panel
- Notifications screen and its /notifications route
- Admin Review Queue and its /admin/review route, unlinked from vendor navigation
- update the four existing screens where they diverge
  - Dashboard
  - Vendor Profile
  - Search (no changes needed)
  - TOR Detail (no changes needed)
- gates
  - npm run lint at the root — clean
  - npm run build -w @tor-radar/web — compiled, all 8 routes generated
- commit

