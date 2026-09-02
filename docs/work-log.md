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

