# Dashboard figures and the anomaly rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard show real figures from the corpus, and mark budgets that fall outside their peer group by the documented rule.

**Architecture:** A pure rule function decides a verdict from a record and its peer group's bounds. A worker keeps one bounds document per peer group fresh, recomputing only cohorts marked dirty by the events that can change them. Rollup cells answer totals and the trend. The web app reads both through two public API routes, with filter state in the URL.

**Tech Stack:** Node 24 · TypeScript · Express 5 · MongoDB · Vitest + supertest · Next.js 16 App Router (server components)

**Spec:** [`docs/superpowers/specs/2026-09-17-dashboard-anomaly-design.md`](../specs/2026-09-17-dashboard-anomaly-design.md) — revision 2. Section numbers below (`§4.1`) refer to it.

**Jira:** TOR-61 (rule), TOR-63 (eligibility), TOR-122 (edge tests), TOR-62 (plot), TOR-65 (filter state), TOR-66 (totals and trend). Each card moves to In Progress when its task starts, In Review when its gates pass, Done when verified against the running stack.

---

## How this lands

Branch `feat/sprint3-dashboard-stats`, squash-merged when the live verification in Task 14 passes.

**Gates, each its own command:**

```bash
npm run lint
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npm test
```

Integration tests need `docker compose up -d mongo gcs`.

## File map

| File | Status | Responsibility |
| :--- | :--- | :--- |
| `apps/api/src/modules/stats/cohort.ts` | create | Derive `{category, month}` in Asia/Bangkok (§2.4) |
| `apps/api/src/modules/stats/eligibility.ts` | create | The one eligibility predicate, in code and as a Mongo filter (§2.2) |
| `apps/api/src/modules/stats/anomaly.rule.ts` | create | The rule, pure (§4) |
| `apps/api/src/modules/stats/stats.repository.ts` | create | Bounds, rollups, dirty marking, claims (§3, §5) |
| `apps/api/src/modules/stats/stats.service.ts` | create | Recompute one cohort; assemble the dashboard payload (§8) |
| `apps/api/src/modules/stats/stats.routes.ts` | create | `GET /stats/dashboard` (§8) |
| `apps/api/src/modules/tors/tors.routes.ts` | modify | `GET /tors` list with filters and verdicts (§6.2) |
| `apps/api/src/workers/stats.worker.ts` | create | Claim → recompute → rollups → meta (§5.4) |
| `apps/api/src/core/db.ts` | modify | Three collections, the new fields, the indexes (§3) |
| `apps/api/src/core/config.ts` | modify | The stats block (§9) |
| `apps/api/src/modules/admin/admin.repository.ts` | modify | Budget edits parse to a number; `writeExtraction` returns the preimage (§2.5, §5.2) |
| `apps/api/src/modules/admin/admin.service.ts` | modify | Mark dirty on correct / verify / re-extract / restrict (§5.1) |
| `apps/api/src/modules/intake/intake.service.ts` | modify | Write `cohort` on insert; update `lastIntakeAt` (§3.1) |
| `apps/api/src/modules/extraction/extraction.service.ts` | modify | Mark dirty on publish, from the preimage (§5.1) |
| `tools/backfill_cohorts.mjs` | create | One-shot idempotent backfill (§3.4) |
| `apps/web/src/shared/api/stats.api.ts` | create | `server-only` fetchers |
| `apps/web/src/shared/lib/dashboard-filters.ts` | create | URL ↔ filter state, Zod primitives (§6.4) |
| `apps/web/app/(app)/dashboard/page.tsx` | modify | Server component reading `searchParams` |
| `apps/web/src/views/DashboardView.tsx` | modify | Props instead of samples; stat strip, trend, plot |
| `apps/web/src/features/dashboard/BudgetPlot.tsx` | create | Points, bands, flagged marks (§6.1) |
| `apps/web/app/(app)/methodology/page.tsx` | create | The rule, rendered from the same constants (FR-F-3) |
| `tools/seed_dashboard.mjs` | create | Seeded corpus large enough to exercise `PEER_MIN_N` |

---

### Task 0: Branch and baseline

- [ ] **Step 1:** `git switch main && git pull --ff-only && git switch -c feat/sprint3-dashboard-stats`
- [ ] **Step 2:** Run the four gates. Record the test count; later counts assume it.
- [ ] **Step 3:** `python tools/jira.py start TOR-61` and `start TOR-63`.

---

### Task 1: Configuration

**Files:** modify `apps/api/src/core/config.ts`, `config.test.ts`, `.env.example`

- [ ] **Step 1:** Failing test — `loadConfig` exposes `stats.peerWindowMonths` 12, `stats.peerMinN` 8, `stats.method` `"IQR"`, `stats.iqrMultiplier` 1.5, `stats.zScoreLimit` 3, `stats.sweepIntervalMs` 300000, `stats.leaseMs` 60000, `stats.staleAfterMs` 3600000, `stats.timezone` `"Asia/Bangkok"`; and that `ANOMALY_METHOD=NONSENSE` throws.
- [ ] **Step 2:** Run it, confirm it fails.
- [ ] **Step 3:** Add the keys. Counts and durations are `z.coerce.number().int().positive()`; the method is `z.enum(["IQR", "ZSCORE"]).default("IQR")` with a comment marking it open value O4. **The two anomaly limits are `z.coerce.number().positive()` without `.int()`** — the fence is 1.5, and zod does not validate a default, so an int schema passes its own tests and then rejects the very value `.env.example` ships. Add the block to `.env.example`.
- [ ] **Step 4:** Gates: config tests, lint, api tsc.
- [ ] **Step 5:** `git commit -m "feat(config): the statistics block, with the anomaly method recorded as open"`

---

### Task 2: Cohort derivation (§2.4)

**Files:** create `apps/api/src/modules/stats/cohort.ts` + `cohort.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { cohortFor, monthKey } from "./cohort.js";

const TZ = "Asia/Bangkok";

describe("monthKey", () => {
  it("uses the Bangkok calendar, not UTC", () => {
    // 2026-03-31T17:30:00Z is 2026-04-01 00:30 in Bangkok.
    expect(monthKey(new Date("2026-03-31T17:30:00Z"), TZ)).toBe("2026-04");
  });
  it("keeps a mid-month date in its own month", () => {
    expect(monthKey(new Date("2026-03-15T06:00:00Z"), TZ)).toBe("2026-03");
  });
});

describe("cohortFor", () => {
  const category = "งานก่อสร้าง-ทาง";

  it("prefers the announcement date", () => {
    expect(
      cohortFor({ category, announcedAt: new Date("2026-02-10T03:00:00Z"), createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-02" }, cohortDateSource: "announced" });
  });

  it("falls back to the intake date, and says so", () => {
    expect(
      cohortFor({ category, announcedAt: null, createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-09" }, cohortDateSource: "intake" });
  });

  it("treats an invalid announcement date as absent", () => {
    expect(
      cohortFor({ category, announcedAt: new Date("not a date"), createdAt: new Date("2026-09-01T03:00:00Z") }, TZ),
    ).toEqual({ cohort: { category, month: "2026-09" }, cohortDateSource: "intake" });
  });

  it("returns null when the category is missing, because a cohort without a category is not a peer group", () => {
    expect(cohortFor({ category: "", announcedAt: null, createdAt: new Date() }, TZ)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run, confirm failure.
- [ ] **Step 3: Implement.** `monthKey` uses `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })` and takes the first seven characters — no date arithmetic, no offset table to go stale. Comment WHY the timezone matters (a late-evening Bangkok announcement is the previous month in UTC). `cohortFor` returns `null` for an empty category.
- [ ] **Step 4:** Run; 5 passed.
- [ ] **Step 5:** `git commit -m "feat(stats): derive a record's peer cohort on the Bangkok calendar"`

---

### Task 3: Eligibility (§2.2) — TOR-63

**Files:** create `apps/api/src/modules/stats/eligibility.ts` + test

- [ ] **Step 1: Failing test** covering each rejection reason separately — including `restricted`, which is its own reason and must NOT be reported as `not-published` — and one acceptance. Assert the exported Mongo filter object literally, because it must match the partial index in Task 5:

```ts
expect(eligibleFilter()).toEqual({
  "pipeline.state": "published",
  "access.restricted": { $ne: true },
  "fields.budget.verified": true,
  "fields.category.verified": true,
  "fields.budget.value": { $type: "number", $gt: 0 },
});
```

- [ ] **Step 2:** Run, confirm failure.
- [ ] **Step 3: Implement** `eligibilityOf(record, bounds)` returning `null` when eligible or a `NotEvaluatedReason`, in the §4.1 order, plus `eligibleFilter()`. Both live here so the in-memory rule and the database query cannot drift.
- [ ] **Step 4:** Run; all pass. **Step 5:** commit.

---

### Task 4: The rule (§4) — TOR-61, TOR-122

**Files:** create `apps/api/src/modules/stats/anomaly.rule.ts` + `anomaly.rule.test.ts`

- [ ] **Step 1: Failing test.** These are TOR-122's cases; every one is a real behaviour, not a smoke test.

```ts
import { describe, expect, it } from "vitest";
import { quantile, verdictFor } from "./anomaly.rule.js";

const settings = { method: "IQR" as const, minN: 8, iqrMultiplier: 1.5, zScoreLimit: 3 };
const bounds = (over: Partial<ReturnType<typeof boundsOf>> = {}) => ({ ...boundsOf([10, 20, 30, 40, 50, 60, 70, 80]), ...over });

function boundsOf(values: number[]) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return { n: values.length, q1, q3, iqr: q3 - q1, lowBound: q1 - 1.5 * (q3 - q1), highBound: q3 + 1.5 * (q3 - q1) };
}

describe("quantile (type 7, linear interpolation)", () => {
  it("matches hand-computed values on an even count", () => {
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80], 0.25)).toBe(27.5);
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80], 0.75)).toBe(62.5);
  });
  it("matches hand-computed values on an odd count", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe("verdictFor", () => {
  it("flags a value above the upper fence", () => {
    expect(verdictFor({ budget: 200, eligible: true }, bounds(), settings)).toEqual({
      kind: "anomaly", side: "high", distance: (200 - 62.5) / 35,
    });
  });

  it("flags a value below the lower fence", () => {
    const v = verdictFor({ budget: -100, eligible: true }, bounds(), settings);
    expect(v).toMatchObject({ kind: "anomaly", side: "low" });
  });

  it("does not flag a value exactly on the fence", () => {
    expect(verdictFor({ budget: bounds().highBound, eligible: true }, bounds(), settings).kind).toBe("normal");
  });

  it("does not evaluate below the minimum peer count", () => {
    expect(verdictFor({ budget: 999999, eligible: true }, boundsOf([10, 20, 30, 40, 50, 60, 70]), settings)).toEqual({
      kind: "not-evaluated", reason: "insufficient-peers", n: 7,
    });
  });

  it("evaluates at exactly the minimum peer count", () => {
    expect(verdictFor({ budget: 50, eligible: true }, bounds(), settings).kind).toBe("normal");
  });

  it("calls a different value an anomaly with no distance when every peer is identical", () => {
    const flat = boundsOf([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(verdictFor({ budget: 9, eligible: true }, flat, settings)).toEqual({
      kind: "anomaly", side: "high", distance: null,
    });
    expect(verdictFor({ budget: 5, eligible: true }, flat, settings).kind).toBe("normal");
  });

  it("does not evaluate when there are no bounds at all", () => {
    expect(verdictFor({ budget: 10, eligible: true }, null, settings)).toEqual({
      kind: "not-evaluated", reason: "insufficient-peers", n: 0,
    });
  });

  it("passes an ineligible record straight through with its reason", () => {
    expect(verdictFor({ budget: 10, eligible: false, reason: "unverified-budget" }, bounds(), settings)).toEqual({
      kind: "not-evaluated", reason: "unverified-budget", n: 8,
    });
  });
});

describe("verdictFor under ZSCORE", () => {
  const z = { ...settings, method: "ZSCORE" as const };
  it("flags beyond the limit and is normal within it", () => {
    const b = { n: 8, mean: 50, stdDev: 10 };
    expect(verdictFor({ budget: 95, eligible: true }, b, z)).toMatchObject({ kind: "anomaly", side: "high" });
    expect(verdictFor({ budget: 55, eligible: true }, b, z).kind).toBe("normal");
  });
  it("handles zero standard deviation the same way as zero IQR", () => {
    expect(verdictFor({ budget: 7, eligible: true }, { n: 8, mean: 5, stdDev: 0 }, z)).toEqual({
      kind: "anomaly", side: "high", distance: null,
    });
  });
});
```

- [ ] **Step 2:** Run, confirm failure.
- [ ] **Step 3: Implement.** `quantile` is type 7: `pos = (n − 1)·p`, interpolate between neighbours. `verdictFor` follows §4.1's order exactly. Zero spread is checked before any division. Comment WHY type 7 is named and why zero spread yields `distance: null`.
- [ ] **Step 4:** Run; all pass. Also compute `27.5` / `62.5` by hand in the comment so a future reader can check the fixture.
- [ ] **Step 5:** `git commit -m "feat(stats): the statistical-anomaly rule, as one documented function"`
- [ ] **Step 6:** `python tools/jira.py move TOR-61 "In Review"` and the same for TOR-122 once its cases are green.

---

### Task 5: Collections, fields, indexes (§3)

**Files:** modify `apps/api/src/core/db.ts` (+ its test if present)

- [ ] **Step 1:** Add `TorPeerStatsDocument`, `TorRollupDocument`, `TorMetaDocument` interfaces exactly as §3.1 lists them, plus accessors `torPeerStats(db)`, `torRollups(db)`, `torMeta(db)`. Add `cohort` and `cohortDateSource` to `TorDocument`.
- [ ] **Step 2:** Add every index in §3.2 to `ensureIndexes`, with the partial filter written to match `eligibleFilter()` field for field. Comment that they must change together.
- [ ] **Step 3:** Integration test: `ensureIndexes` twice on a fresh database is idempotent, and `listIndexes` contains the partial index with the expected filter.
- [ ] **Step 4:** Gates. **Step 5:** commit.

---

### Task 6: Budget edits must be numbers (§2.5)

**Files:** modify `apps/api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, create `apps/api/src/lib/parse-budget.ts` + test

- [ ] **Step 1: Failing test** for `parseBudget`: `"1,200,000"` → `1200000`; `"๑๒๐๐๐๐๐"` (Thai digits) → `1200000`; `"1200000.50"` → `1200000.5`; `"ประมาณ"` → `null`; `"0"` → `null`; `"-5"` → `null`; a value above `BUDGET_MAX_THB` → `null`.
- [ ] **Step 2:** Failing route test: `PATCH` an edit setting budget to `"ไม่ระบุ"` returns 400 and writes nothing; setting it to `"1,200,000"` stores the **number** `1200000`, asserted by reading the document and checking `typeof`.
- [ ] **Step 3:** Implement. `FieldEdit.value` stays `string` at the boundary; the repository converts for `budget` only, and the service rejects a failed parse with a Thai message through `BadRequestError`.
- [ ] **Step 4:** Run; the existing admin tests must stay green. **Step 5:** commit.

---

### Task 7: Dirty marking (§5.1, §5.2)

**Files:** create `apps/api/src/modules/stats/stats.repository.ts` + test; modify `admin.service.ts`, `extraction.service.ts`, `intake.service.ts`, `admin.repository.ts`

- [ ] **Step 1: Failing integration test** — one case per row of §5.1, each asserting the exact set of `(category, month)` keys marked dirty, including that a category correction marks **both** the old and new windows, and that a re-extraction request marks the old window immediately.
- [ ] **Step 2: Failing test** that marking a cohort that has no document creates twelve documents, one per month — the `updateMany` trap.
- [ ] **Step 3: Implement** `markCohortsDirty(keys)` as a `bulkWrite` of `updateOne(..., {upsert:true})`, `$set: {dirty:true, dirtyAt}`, `$inc: {generation:1}`; and `windowKeysFor(cohort, windowMonths)` returning the twelve keys.
- [ ] **Step 4: Wire the callers.** `writeExtraction` becomes `findOneAndUpdate(..., {returnDocument:"before"})` and returns the preimage so both windows can be marked. `intake.service` writes `cohort` on insert and updates `tor_meta.lastIntakeAt`.
- [ ] **Step 5:** Gates. **Step 6:** commit.

---

### Task 8: Recompute and rollups (§5.3, §5.4)

**Files:** extend `stats.repository.ts`, create `stats.service.ts`, `apps/api/src/workers/stats.worker.ts` + tests

- [ ] **Step 1: Failing tests**
  - Recomputing a cohort writes bounds matching hand-computed quartiles over the window, counting only eligible records (seed one unverified budget and one restricted record that must not count).
  - Running the recompute twice changes nothing but `computedAt` — idempotence.
  - A mark arriving mid-computation is not lost: bump `generation` between claim and write, assert `dirty` stays `true`.
  - An expired lease is reclaimable; a live lease is not.
  - `flaggedCount` in the rollup matches the number of points the rule flags.
- [ ] **Step 2:** Run, confirm failure.
- [ ] **Step 3: Implement** `claimDirtyCohort(leaseMs)` (the `findOneAndUpdate` in §5.3), `computeBounds(key)`, `writeBounds(key, generation, bounds)` (generation-guarded), `recomputeRollups(months)`, and the worker loop with sweep, logging and lifecycle per §5.4.
- [ ] **Step 4:** Run; all pass. **Step 5:** commit. **Step 6:** `jira.py move TOR-63 "In Review"`.

---

### Task 9: Backfill (§3.4)

**Files:** create `tools/backfill_cohorts.mjs`

- [ ] **Step 1:** Implement: for every record missing `cohort`, derive it and set `cohort` + `cohortDateSource`; then upsert each distinct cohort dirty. Matches only records missing the field, so re-running is a no-op. Prints counts.
- [ ] **Step 2:** Verify on the dev database: run, check counts; run again, expect `0 records updated`.
- [ ] **Step 3:** commit.

---

### Task 10: API routes (§8)

**Files:** create `stats.routes.ts`, modify `tors.routes.ts`, `app.ts`, + route tests

- [ ] **Step 1: Failing route tests** — the payload shape of §8; restricted records absent; filters composing; the budget-range path NOT reading rollups (assert against seeded data where the rollup sum and the filtered sum differ); `stale: true` when `statsComputedAt` is older than the limit.
- [ ] **Step 2:** Implement both routes, filters parsed by a Zod schema of primitives only.
- [ ] **Step 3:** Gates. **Step 4:** commit.

---

### Task 11: Filter state in the URL (§6.4) — TOR-65

**Files:** create `apps/web/src/shared/lib/dashboard-filters.ts` + test, `stats.api.ts`; modify `dashboard/page.tsx`

- [ ] **Step 1: Failing test** — parse: unknown keys ignored, malformed budget ignored rather than throwing, month range validated, multiple categories as repeated keys; serialise: round-trips, and omits defaults so a clean URL stays clean.
- [ ] **Step 2:** Implement, then make the page a server component reading `searchParams` and passing data down. `stats.api.ts` is `server-only`.
- [ ] **Step 3:** Gates + load the page with filters in the URL and confirm the server rendered them.
- [ ] **Step 4:** commit; `jira.py move TOR-65 "In Review"`.

---

### Task 12: Stat strip, trend, plot (TOR-66, TOR-62)

**Files:** modify `DashboardView.tsx`; create `BudgetPlot.tsx`, `methodology/page.tsx`

- [ ] **Step 1:** Replace the sample arrays with props. Delete `TOTAL_STATS`, `AGENCIES` and the other fixtures — a screen that silently falls back to samples when the API fails is the failure mode Gate 8 exists to prevent.
- [ ] **Step 2:** Stat strip and trend from the payload, with the empty, stale and error states of §7 and the coverage note.
- [ ] **Step 3:** `BudgetPlot` — both shapes of §6.1, flagged points marked, the band drawn when one category is selected, each point linking to its record, tooltip carrying confidence and model version (§7.4). Thai labels only, wording per NFR-F5.
- [ ] **Step 4:** `/methodology` renders the active method, multiplier, window and minimum peer count **from the config values the API returns**, so the page cannot drift from behaviour. States the cohort-date rule (§2.4) and that the checklist half arrives in Sprint 4.
- [ ] **Step 5:** Component tests for the empty, insufficient-peers and stale states.
- [ ] **Step 6:** Gates; commit; `jira.py move TOR-62 "In Review"` and `TOR-66 "In Review"`.

---

### Task 13: Seed enough data to exercise the rule

**Files:** create `tools/seed_dashboard.mjs`

- [ ] **Step 1:** Seed published records across three categories and twelve months, one category holding at least `PEER_MIN_N + 2` eligible budgets with a deliberate outlier, plus one unverified budget and one restricted record that must NOT count. Deterministic ids derived from content, so re-running does not multiply records.
- [ ] **Step 2:** Label every seeded record clearly as sample data; `--clear` removes exactly what it created.
- [ ] **Step 3:** Run it, run the backfill, start the worker, and confirm bounds appear.
- [ ] **Step 4:** commit.

---

### Task 14: Live verification

Against the running stack, on `localhost`.

- [ ] **Step 1:** `/dashboard` renders real totals; the stat strip matches a hand-computed sum from the seeded data.
- [ ] **Step 2:** The plot shows the deliberate outlier flagged, and its distance matches hand arithmetic.
- [ ] **Step 3:** The unverified budget and the restricted record appear in neither the bounds nor the flags.
- [ ] **Step 4:** Unticking `verified` on the review screen removes the record from the statistics within one sweep.
- [ ] **Step 5:** Filters compose, and the URL carries them across a reload.
- [ ] **Step 6:** A category with fewer than 8 eligible budgets says so rather than flagging.
- [ ] **Step 7:** Stopping the worker and ageing `statsComputedAt` shows the recalculating banner.
- [ ] **Step 8:** All four gates green. Squash-merge. Move TOR-61, 62, 63, 65, 66, 122 to Done — and only then.

---

### Task 15: Documents and the board

- [ ] `docs/API.md` — both routes, their filters, their payloads.
- [ ] `docs/ARCHITECTURE.md` — the stats worker and the three collections in the container and data diagrams; `node tools/check_mermaid.mjs` → 0 failed.
- [ ] `docs/PLAN.md` — move Q4's slice-3 half to the settled table, with §2.2 as the record.
- [ ] `docs/TODO.md` — a section for this slice, mirroring the Jira cards.
- [ ] Brain: the rule-derivation pattern and the review's twenty defects, as a skill note.

---

## Self-review

**Spec coverage.** §2.2 eligibility → Tasks 3, 5. §2.3 totals vs statistics → Tasks 8, 10. §2.4 cohort → Task 2. §2.5 numeric budgets → Task 6. §2.6 agency key → Task 8 (rollup key). §2.7 window → Tasks 7, 8. §3 model → Task 5; §3.4 backfill → Task 9. §4 rule → Task 4. §5.1–5.2 dirty marking → Task 7. §5.3–5.4 claim, lease, worker → Task 8. §5.5 staleness → Tasks 10, 12. §6.1 plot → Task 12. §6.2 rows → Task 10. §6.3 rollups vs filtered figures → Tasks 8, 10. §6.4 URL state → Task 11. §7 states → Task 12. §7.4 labelling → Task 12. §8 contracts → Task 10. §9 config → Task 1. §10 tests → every task. §11 stays open.

**Placeholder scan.** None: every step names files, assertions and commands.

**Type consistency.** `AnomalyVerdict`, `NotEvaluatedReason`, `cohortFor`, `monthKey`, `eligibleFilter`, `eligibilityOf`, `verdictFor`, `quantile`, `markCohortsDirty`, `windowKeysFor`, `claimDirtyCohort`, `computeBounds`, `writeBounds`, `recomputeRollups` — used identically throughout.
