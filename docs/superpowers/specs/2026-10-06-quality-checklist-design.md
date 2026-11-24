# Specification-quality checklist on the TOR detail (TOR-48)

Covers **F8** and **FR-F-1 … FR-F-3** of `docs/SRS.md` §4.6, for the TOR detail page. Realises
the Sprint 4 story TOR-48 (US-06) under epic TOR-7.

## Scope

In: the five checks computed for each published TOR, returned on `GET /tors/:id`, and shown on the
TOR detail page with the required label and a link to the methodology page.

Out (deferred, unchanged):
- **FR-F-4**, failed checks beside flagged budgets on the dashboard. The dashboard payload keeps
  `checklist: null` until that story lands (`2026-09-17-dashboard-anomaly-design.md` §1).
- Persisting checklist results. They are computed at read from the record and its peer bounds, so
  they cannot go stale against the anomaly rule.

## The five checks (SRS §4.6.1)

| # | Check | Result rule |
| :-- | :-- | :-- |
| C1 | Budget stated | **pass** when the budget is a number inside `BUDGET_MIN_THB`–`BUDGET_MAX_THB` (the same range the anomaly rule accepts) and `verified` (verified means it reached the clean tier or an admin approved it, §4.2.1). Otherwise **fail**. |
| C2 | Deadline workable | **not evaluated** always. `MIN_BID_WINDOW_DAYS` is open (SRS §8 O2). Owner decision, 2026-10-06: show "not evaluated" rather than a made-up value. |
| C3 | Scope specific | **not evaluated** always. `MIN_SCOPE_CHARS` / `MIN_SCOPE_SECTIONS` are open (O3). Same decision. |
| C4 | Qualifications stated | **pass** when at least one taxonomy tag was mapped from the qualifications (FR-B-4) and the qualifications are `verified`, the same bar C1 sets for the budget. Otherwise **fail**. |
| C5 | Budget within peer norm | Reuses the §4.5.1 verdict. **fail** on `anomaly`. **pass** on `normal`, and on `not-evaluated` with `insufficient-peers` (SRS: a peer group below `PEER_MIN_N` passes). Any other `not-evaluated` reason gives **not evaluated**, and the reason names the cause (for example, an unverified category). |

> **Superseded 2026-11-24 (TOR-200):** the C2 and C3 rows above, written when their thresholds were open, are replaced by §8.

Score: `passed` out of `evaluated`, where `evaluated` excludes "not evaluated" checks. Every check
carries a named reason, so no unexplained score is shown (NFR-F6).

## Output

```ts
type CheckResult = "pass" | "fail" | "not-evaluated";
interface ChecklistCheck { id: "C1" | "C2" | "C3" | "C4" | "C5"; label: string; result: CheckResult; reason: string }
interface Checklist { passed: number; evaluated: number; checks: ChecklistCheck[] }
```

Reasons and labels are Thai (NFR-F7). A fail reason for C5 uses only "statistical anomaly" (NFR-F5).

## Display

- The label, verbatim (FR-F-2): **"AI-generated specification-quality check — not a legal or corruption judgment"**.
- A link to `/methodology` (FR-F-3).
- All five checks are listed with their reasons, so at least three concrete reasons are visible.

## Where it lives

- `apps/api/src/modules/checklist/checklist.ts`: pure function, no I/O.
- `apps/api/src/modules/tors/tors.service.ts` `detail()`: computes C5 from the same verdict code the
  search uses, and attaches `checklist`.
- Types in `packages/shared/src/checklist.ts`, so the web app and the API share them.
- `apps/web/src/features/tor-detail/`: the panel.

## Verification

Unit tests for each check and the score, including C2 and C3 (§8; first written as always "not evaluated") and C5 for
`anomaly`, `normal`, `insufficient-peers` and an unverified budget. A live request against the
running API on a seeded record, then a look at the page in the browser.

## 8. Revision 2026-11-24 — C2 and C3 calibrated (TOR-200)

The thresholds were left open until there was real data. On 2026-11-24 the collected corpus was measured
(1028 published TORs on Atlas, read-only, `tools/calibrate_open_values.mts`) and the values set.

### The rule used

Each threshold is the **10th percentile** of its own measure: a TOR fails when it sits in the lowest tenth of
what was collected. It is a stated convention, not a cut validated against a ground truth, so it fails about a
tenth of TORs by construction. Each value stays an overridable default (`MIN_BID_WINDOW_DAYS`,
`MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS`), and re-running the tool shows how it moves as the corpus grows.

### C2 — deadline workable

Measure: calendar days from the announcement day (in `COHORT_TIMEZONE`) to a confirmed deadline.

| n | min | p5 | p10 | p25 | median | p75 | p90 | max |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 347 | -28 | 8 | **8** | 8 | 14 | 22 | 27 | 186 |

`MIN_BID_WINDOW_DAYS = 8`. Eight is also the most common window (86 of 347), so the cut sits at the floor most
announcements already keep. Nine TORs gave a shorter positive window and fail. One TOR has a deadline before its
announcement, which is a misread date more likely than a real window, so it is **not evaluated** and its reason
says to check the original.

C2 is **pass** at or above the minimum, **fail** below it, and **not evaluated** when the announcement day or the
deadline is missing, the deadline is not confirmed (the bar C1 and C4 set), or the deadline precedes the
announcement. Only 347 of 1028 TORs have both dates, so most are still not evaluated on C2.

### C3 — scope specific

Two measures, both only when the pipeline confirmed them:

| Measure | n | min | p5 | p10 | p25 | median | p75 | p90 | max |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Scope summary, characters | 986 | 49 | 95 | **112** | 150 | 201 | 258 | 324 | 763 |
| Concrete requirements listed | 175 | 2 | 4 | **6** | 10 | 16 | 29 | 57 | 257 |

`MIN_SCOPE_CHARS = 112` and `MIN_SCOPE_SECTIONS = 6`. C3 fails when either measure is below its minimum, and the
reason names which. It is **not evaluated** when the scope is in an annex that was not provided or nowhere in
the documents ("not found" is never read as "vague"), or when the summary is missing or unconfirmed. A record
with no requirement count (every record extracted before `scopeItems` existed) is judged on length alone and says so.

Limits to keep in view: the character count measures the AI's *summary* of the scope, a proxy for the scope, and
its length depends on the model's wording; the requirement count exists for 175 of 1028 TORs.

### O4 — IQR or Z-score

Both methods were run over every budget the dashboard evaluates (737 of 768 eligible, in 23 peer groups of 8 to
196, median 34), each against its own peer group and the configured window.

| | Flagged | Of 737 |
| :-- | :-- | :-- |
| IQR (1.5 × IQR) | 56 | 7.6% |
| Z-score (|z| > 3) | 14 | 1.9% |
| Both | 14 | |
| Z-score only | 0 | |

Every Z-score flag is also an IQR flag. Budgets are heavy-tailed, so a large value inflates the standard
deviation that is meant to expose it (masking). And with n values the population z-score cannot exceed
(n − 1)/√n, so in a peer group under 11 it can never reach 3: 18 evaluated TORs sit in such groups.
**`ANOMALY_METHOD` stays `IQR`.** The data has no label saying which budgets are truly anomalous, so this compares
the methods and does not measure either one's accuracy.

### Display and tests

Reasons state the days or counts they used and the minimum, in Thai (NFR-F7), and say only "ต่ำกว่าเกณฑ์"
(below the threshold), never a judgment of the TOR (NFR-F5). `checklistFieldsOf` builds the C2 and C3 inputs once
for the dashboard and the TOR page. Tests: `checklist.test.ts` (boundaries at the minimum and one short, month and
year crossing, each not-evaluated reason, Thai character counting, the configured minimum) and `config.test.ts`.
