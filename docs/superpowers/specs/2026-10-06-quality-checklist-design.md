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
| C1 | Budget stated | **pass** when the budget is a number and `verified` (verified means it reached the clean tier or an admin approved it, §4.2.1). Otherwise **fail**. |
| C2 | Deadline workable | **not evaluated** always. `MIN_BID_WINDOW_DAYS` is open (SRS §8 O2). Owner decision, 2026-10-06: show "not evaluated" rather than a made-up value. |
| C3 | Scope specific | **not evaluated** always. `MIN_SCOPE_CHARS` / `MIN_SCOPE_SECTIONS` are open (O3). Same decision. |
| C4 | Qualifications stated | **pass** when at least one taxonomy tag was mapped from the qualifications (FR-B-4). Otherwise **fail**. |
| C5 | Budget within peer norm | Reuses the §4.5.1 verdict. **fail** on `anomaly`. **pass** on `normal`, and on `not-evaluated` with `insufficient-peers` (SRS: a peer group below `PEER_MIN_N` passes). Any other `not-evaluated` reason gives **not evaluated**. |

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

Unit tests for each check and the score, including C2/C3 always "not evaluated" and C5 for
`anomaly`, `normal`, `insufficient-peers` and an unverified budget. A live request against the
running API on a seeded record, then a look at the page in the browser.
