# Scheduled e-GP collector — design

**Cards:** none yet · **Date:** 2026-11-25
**Builds on:** [national e-GP source](2026-10-04-national-egp-source-design.md) (the import it schedules; its "out of scope: the scheduled collector") · [winner announcements](2026-11-24-winner-announcements-design.md) (the award collection it schedules) · [project stages](2026-11-23-project-stages-design.md) (the worker pattern it follows) · [source health](2026-11-24-source-health-design.md) (how it reports)
**Requirements:** FR-A-4, F12 ("sources that permit it are collected without an admin"), NFR-S5, NFR-S7

## 1. Context

Two national e-GP collections are run by hand today:

| Source id | Tool | What it queues |
| :--- | :--- | :--- |
| `national-egp-import` | `tools/import_national_egp_tors.mts` | New TORs and invitations from e-GP's public announcement lists |
| `national-egp-awards` | `tools/collect_egp_awards.mts` | Winner announcements for projects whose stages list `W0`/`W2` |

Only the stages worker runs on its own. F12 asks for the rest to arrive without an admin. Every document
queued is a billed extraction (Document AI + Gemini), so running without an admin needs a ceiling.

## 2. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | One code path or two? | **One.** The per-project work of both tools moves into `modules/collector/` (`collector.service.ts`); the tools keep their command-line targeting and call it. A fix to one is a fix to both |
| 2 | How is e-GP reached? | Through a port, `ports/egp-collect.port.ts`, implemented by `adapters/national-egp.collect.ts` over the existing `sources/national-egp/client.ts`. The module never fetches |
| 3 | Its own process? | Yes — `workers/collector.worker.ts`, like the stages worker: a slow or refusing e-GP never stalls extraction. It only queues; the extraction worker reads |
| 4 | What does a pass read? | `COLLECTOR_LIST_PAGES` pages (50 rows each) of e-GP's **invitation** list, then of its **draft-TOR** list, newest first — the same lists the import tool reads by default. Then the award targets the award tool picks |
| 5 | What is skipped before any download? | A project collected by another source system (as the tool does); from the invitation list, a project whose invitation we hold; from the draft-TOR list, a project whose TOR we hold. Without this every pass would re-download every listed package to find it a duplicate |
| 6 | The ceiling | `COLLECTOR_MAX_NEW_PER_DAY` (default 50): records first created in the last 24 hours whose first source reference was submitted by the collector — a rolling day, so a pass just after midnight cannot spend a second day's allowance on top of the first. A pass stops queuing once it is reached; a duplicate (linked onto a stored record) costs nothing and is not counted |
| 7 | How often? | Every `COLLECTOR_INTERVAL_HOURS` (6). e-GP's lists move daily; four passes a day reach a day's new invitations well before their deadline |
| 8 | Pacing | `COLLECTOR_REQUEST_DELAY_MS` (2000) between requests, as the tools pace. Three project failures in a row stop the pass and wait `COLLECTOR_BACKOFF_MS` (1 h): e-GP refusing is not something to add load to |
| 9 | Off by default | `COLLECTOR_ENABLED=false`. Billed extraction is switched on deliberately. The worker exits at start, with a log line saying why, when it is off |
| 10 | Source health | Each pass records one run per source id (§1), counted as the tools count (source-health decision 4). While the collector is enabled the two sources are **automatic**, so they go stale and are alerted on; while it is off they stay **manual**, so environments that never run it are not alerted on (source-health decision 9) |
| 11 | Who submits | `sourceRefs.submittedBy = "national-egp-collector"`, so the ceiling counts only what the collector queued, and a record shows how it arrived. The tools keep their own names |

## 3. What is not done here

- The BMA e-GP source (`tools/import_egp_tors.mts`) stays manual.
- The RSS feed (`--from feed`) and named projects (`--project`) stay tool-only.
- Deployment: Compose gains a `collector` service under a profile; Cloud Run runs only the extraction worker
  today, and adding the stages and collector workers there is a separate decision.
