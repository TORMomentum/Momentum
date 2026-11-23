# Ingestion-source health — design

**Cards:** TOR-87 (story, US-16), TOR-292 (record per source), TOR-293 (admin view), TOR-294 (admin email) · **Date:** 2026-11-24
**Builds on:** [foundation and intake](2026-09-01-tor-radar-foundation-intake-design.md) (the `sources` collection, §4.1) · [national e-GP source](2026-10-04-national-egp-source-design.md) · [project stages](2026-11-23-project-stages-design.md)
**Requirements:** FR-A-4, F12 acceptance ("each enabled adapter reports its last successful collection and its health"), NFR-S5, NFR-S7, NFR-F7

## 1. Context

Three things collect from public sources today:

| Source id | What | How it runs |
| :--- | :--- | :--- |
| `national-egp-stages` | e-GP project stages (TOR-205) | **Automatic** — `stages.worker.ts`, continuously |
| `national-egp-import` | e-GP TOR import (`tools/import_national_egp_tors.mts`) | **Manual** — run by hand |
| `bma-egp-import` | BMA e-GP TOR import (`tools/import_egp_tors.mts`) | **Manual** — run by hand |

The risk US-16 names is a source that breaks silently. For the automatic source there are two ways: e-GP
refuses or changes (the worker runs and fails), or the worker stops (nothing runs, so nothing records a
failure). The second can only be seen from another process.

## 2. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Where is state kept? | One document per source in `source_health` (the foundation spec's `sources` collection, named for what it holds), `_id` = source id. Written only through `source-health.repository.ts` |
| 2 | What is recorded? | `lastSeenAt` (the source's process was alive), `lastSuccessAt`, `lastFailureAt`, `lastError` (the message, cut to 300 characters; source messages hold status codes, never credentials), `consecutiveFailures`, `lastRun` (`at`, `items`, `failed`), and `alert` (§5) |
| 3 | A stages pass's outcome | **Failed** when it backed off (three lookups in a row refused) or every project in it failed; otherwise **succeeded**. A pass with nothing due writes a heartbeat (`lastSeenAt`) at most every `SOURCE_HEARTBEAT_MS` (1 h), not a success: e-GP was not asked |
| 4 | An import run's outcome | Written once, when the run ends: **failed** when e-GP's list could not be read, the run threw, or every project failed; otherwise succeeded, with the projects and failures counted |
| 5 | Health | Automatic: **failing** with `consecutiveFailures ≥ SOURCE_ALERT_FAILURES` (3); **stale** when `lastSeenAt` is older than `SOURCE_STALE_HOURS` (48, twice the 24-hour refresh); else **ok**. Manual: **failing** when its last run failed, else **ok** — never stale, since no schedule says when it should have run. A source with no document is **never run** |
| 6 | Who is emailed? | Every admin account with a verified address, not disabled or deleted. No list in configuration to keep in step |
| 7 | When? | Automatic sources only. One email when a source becomes failing or stale, one when it is ok again. Claimed atomically on `alert`, so two workers send one email |
| 8 | Who checks? | The extraction worker, the one worker always running in Compose, every `SOURCE_CHECK_INTERVAL_MS` (1 h), with its other housekeeping. The process that checks is never the one that may have stopped |
| 9 | A source that never ran | Not alerted: the stages worker is not in every environment (Compose does not run it), and a source never started is a deployment choice, shown as such on the page |
| 10 | Wording (NFR-F7) | Thai on the page and in the email: ปกติ · ไม่ได้อัปเดตเกินกำหนด · ล้มเหลวต่อเนื่อง · ยังไม่เคยทำงาน |

## 3. Admin route (TOR-293)

`GET /api/v1/admin/sources` — admin key, as the rest of `/admin`. Returns the registry's sources in order:

```json
{
  "checkedAt": "2026-11-24T09:00:00.000Z",
  "settings": { "alertFailures": 3, "staleHours": 48 },
  "sources": [{
    "id": "national-egp-stages", "name": "e-GP — ขั้นตอนโครงการ", "kind": "automatic",
    "status": "ok", "lastSeenAt": "…", "lastSuccessAt": "…", "lastFailureAt": null, "lastError": null,
    "consecutiveFailures": 0, "lastRun": { "at": "…", "items": 12, "failed": 0 },
    "records": 991, "latestRecordAt": "…", "alertSentAt": null
  }]
}
```

`records` is what the source has given us: TOR records of its system for an import, records whose stages
were read for the stages source; `latestRecordAt` the newest of them.

## 4. Admin page

`/admin/sources`, "แหล่งข้อมูล" in the staff navigation: one row per source with its name and whether it
runs by itself or by hand, the status tag, last success, last failure with its reason, failures in a row,
the last run's counts, and the records collected. The thresholds are stated under the table.

## 5. Alert email (TOR-294)

`checkSources(now)`: for each automatic source, compute its health; if failing or stale with no open
alert, claim `alert = { kind, sentAt }` (only while `alert` is null) and email the admins; if ok with an
open alert, clear it (only while it is set) and send the recovery email. Subjects:
`[TOR Radar] แหล่งข้อมูลมีปัญหา: <name>` and `[TOR Radar] แหล่งข้อมูลกลับมาปกติ: <name>`. The body states the
status, last success, last failure and its reason, failures in a row, and links to `/admin/sources`. With no
admin to send to, the alert is still claimed and `source_alert_no_recipients` is logged, so it is not
retried every hour.

## 6. Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `SOURCE_ALERT_FAILURES` | 3 | Failed passes in a row before an automatic source is failing |
| `SOURCE_STALE_HOURS` | 48 | No sign of an automatic source for this long and it is stale |
| `SOURCE_HEARTBEAT_MS` | 3600000 | How often an idle stages worker says it is alive |
| `SOURCE_CHECK_INTERVAL_MS` | 3600000 | How often the extraction worker checks and alerts |
