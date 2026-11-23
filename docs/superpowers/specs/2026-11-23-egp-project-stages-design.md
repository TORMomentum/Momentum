# e-GP project stages and the key that links them — spike result

**Cards:** TOR-204 (spike), TOR-231 (sample), TOR-232 (linking key) · **Date:** 2026-11-23
**Builds on:** [national e-GP source](2026-10-04-national-egp-source-design.md) · [e-GP project linking](2026-09-16-egp-project-linking-design.md)
**Requirements:** FR-A-1, FR-E-3, FR-E-5 · **Feeds:** TOR-205 (stage on the record), TOR-206 (timeline), TOR-207 (stage notifications), TOR-221 (winners)

## 1. Question

From the 2026-10-15 review: a real project publishes several times (plan, draft TOR, invitation to bid,
winner). How is each stage published, and which key ties them to one project?

## 2. Answer

**The key is the 11-digit e-GP project number** (`projectId`), already stored on every e-GP record as
`sourceProject.projectId`. Every stage row e-GP returns carries it.

**The stages come from one public endpoint**, the one e-GP's own project page calls for its
"เอกสาร/ประกาศที่เกี่ยวข้อง" table:

```
GET {NATIONAL_EGP_SERVICE_BASE}/egp-oann10-service/pb/a-egp-allt-project/announcement/greenBook
    ?mode=LINK&tempProjectId=<projectId>&pageAnnounceType=B0
```

- A plain GET with no token, cookie or special header answers `200` with JSON, like the package
  endpoint the source already uses (`infoProcureDocAnnounZip`). The page itself sends an
  `X-Announcement-Token`; the endpoint does not require it. Found by reading the page's own requests in
  a browser, not by working around the site's bot check.
- `pageAnnounceType` is required (without it the list is empty); any stage type returns every row.
  `methodId` is optional and changes only the BOQ row's date.
- Each row: `announceType`, `announceTypeDesc` (Thai name, sometimes null), `announceDate` (Thai midnight
  sent as the previous day's `17:00Z`), `projectId`.

Sampled 2026-11-23 on project `69109234234` (กรมทรัพยากรน้ำ, e-bidding):

| `announceType` | Stage | `announceDate` | Thai day | The project page shows |
| :--- | :--- | :--- | :--- | :--- |
| `B0` | ร่างเอกสารประกวดราคา (draft TOR) | `2026-10-20T17:00Z` | 2026-10-21 | 21/10/2569 |
| `BOQ` | ประกาศราคากลาง | `2026-10-20T17:00Z` | 2026-10-21 | 21/10/2569 |
| `D0` | ประกาศเชิญชวน | `2026-10-29T17:00Z` | 2026-10-30 | 30/10/2569 |

`B0` and `D0` are the same codes as the RSS feed's announcement types, which the source already uses.
The same project's `getProjectDetail` / `getProcurementDetail` give the current step (`stepId` `M03`,
`flowSeqno` 3, `flowName` "หนังสือเชิญชวน/ประกาศเชิญชวน") — the input TOR-205 needs for "which stage
is it at now".

## 3. What was built from it (2026-11-23)

The concrete gap that sent us here: **178 of 658 e-GP TOR records had no announcement date.** The import
dates only the document its list announces, so a TOR collected from the invitation list got none, and
the TOR text rarely states one. Now:

- `sources/national-egp/stages.ts` parses the table (`parseProjectStages`, `torAnnouncedOn`);
  `client.ts` fetches it (`fetchProjectStages`) through the same safe fetch, size cap and retry as the
  other e-GP calls. Path in `NATIONAL_EGP_PROJECT_STAGES_PATH`.
- `tools/import_national_egp_tors.mts`: when the listed date is not the TOR's (invitation list, D0 feed),
  the TOR is dated from its draft-TOR row (`B0`, or `B3` — §3a). A failed lookup leaves the date empty; the TOR is still collected.
- `tools/backfill_egp_announced_dates.mts`: dates existing records from their `B0` row. Dry run by default;
  `--apply` fills empty dates; `--fix-mismatch` also replaces a stored date that disagrees. It writes only
  `announcedAt`, `announcedAtOrigin: "source"`, and the cohort re-derived the way extraction derives it,
  and marks the statistics windows the record leaves and joins as dirty. Without `--fix-mismatch` it asks
  e-GP only about projects with an undated record, one request per project, paced by
  `NATIONAL_EGP_DELAY_MS`; three failed lookups in a row (e-GP answers `429` under load) stop the run
  rather than add to it. Re-running is safe: dated records are skipped.

## 3a. Revision 2026-11-23 — more codes, sampled

Four more projects were read the same way once e-GP answered again (69029401277 and 69119388625 from the
day's winner feed, 69069300968 and 69099528942 from its `D1` feed):

| `announceType` | `announceTypeDesc` | Seen on |
| :--- | :--- | :--- |
| `B3` | ร่างเอกสารประกวดราคา(e-Bidding) | 69069300968, 69099528942 — a **second draft-TOR code** |
| `price` | สรุปข้อมูลการเสนอราคาเบื้องต้น | 69069300968, 69099528942 — lower case |
| `W0` | ประกาศรายชื่อผู้ชนะการเสนอราคา | 69029401277, 69119388625 |
| `D1` | ยกเลิกประกาศเชิญชวน | 69069300968, 69099528942 |

The table is **not in date order** (69069300968 lists `price`, 2026-09-10, before `D0`, 2026-08-24), and a
project collected by the specific method can list `W0` alone. Changes: the parser keeps lower-case codes;
the TOR's announcement date is the earliest of `B0` and `B3` (`DRAFT_TOR_CODES`), so the backfill's
"no B0" count (315 in the first dry run) was in part `B3` projects. `W0` and `D1` are used by TOR-205.

## 4. Open for TOR-205 to decide

- Which other `announceType` codes appear (plan, winner `W0`?, cancellation) — sample a cancelled and an
  awarded project.
- Whether to store the whole stage list on the record (`stageHistory`) from this endpoint, and how often
  to re-read it for projects still open.
- Whether to keep `PROJECT_SEARCH_URL` as the reader's link: the project page itself takes a parameter
  the site encrypts client-side, so the search stays the stable public link.
