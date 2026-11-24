# Winners by category — design

_2026-11-25 · TOR-223 (TOR-280, TOR-281) · builds on the winner announcements of
[TOR-221](2026-11-24-winner-announcements-design.md)_

## 1. Context

The 2026-10-15 review asked for the dashboard to show vendors where competition is lighter: the average number of
bidders and the win share of the top winners per category. Bidders were taken out of scope on 2026-11-24
(FR-B-2, the TOR-221 spec §3), so the number of bidders cannot be shown. What the system holds is who won each
awarded project (TOR-221), which gives the second half.

## 2. Decisions

| # | Question | Decision |
| :-- | :-- | :-- |
| 1 | What is measured? | Per category: awarded projects with a named winner, the number of different winners, and the share of those projects the `COMPETITION_TOP_WINNERS` (3) most frequent winners took |
| 2 | Which records count? | Public TORs (published, not restricted, not a supporting document) with a confirmed category and an award that is not `unverified` and names a winner. Below `T_high` a reading is excluded, as an unconfirmed budget is from the anomaly figures (SRS §4.2.1) |
| 3 | What is one project? | One award record. A project with several TOR records is counted once |
| 4 | Which category? | `cohort.category`, the one the dashboard's budget plot groups by |
| 5 | When is a category comparable? | At `PEER_MIN_N` (8) awarded projects, the bar the anomaly rule uses. Fewer: the row is listed ("ยังเทียบไม่ได้") and not ranked, never given a share to rank by |
| 6 | Who is named? | Nobody. The API returns counts and a share; winner names stay on each TOR's page where a natural person is already redacted (FR-B-5, `redactAward`). A name is only a key to count by |
| 7 | Same name, different spacing | One winner. Whitespace is collapsed for counting only; no name is changed or displayed |
| 8 | Wording (NFR-F5) | "ผู้ชนะ 3 รายแรกได้ N%", counts, and a line saying the figure shows how wins are spread and not whether a category is worth entering. Never "less competitive", "easy", or any judgment of an agency or a TOR |
| 9 | Order | Comparable categories by share, lowest first: the categories where wins are spread widest lead. The ordering is a view choice and is not stated as ease |
| 10 | Coverage and freshness (FR-E-6) | The panel says it covers only the collected corpus and only confirmed readings, and shows when the latest announcement was read. It sits inside the dashboard, which carries the corpus coverage note and last-intake time |

## 3. Shape

- `GET /stats/competition` (API.md §5). Computed per request, not cached, from a partial index on `award.recordId` (confirmed awards only), and
  limited per client like search. `meta.awardedProjects` is the distinct awards among the rows the figures keep, so the
  count over the table never exceeds what the table accounts for; a project whose TOR records fall in two categories is
  counted once there and in each category's own row.
- `competitionByCategory` (`modules/stats/competition.ts`) is pure; `StatsRepository.awardedProjects` is the read.
- Web: `CompetitionPanel` in `features/dashboard`, fetched beside the dashboard by the page. A failed read leaves the
  panel out; it never takes the dashboard down and never shows placeholder figures.

## 4. Verification

- Unit: `competition.test.ts` (counting, one project once, spacing, minimum sample, boundary, configured top-N,
  empty and ordering); `CompetitionPanel.test.tsx` (order, thin categories, coverage wording, forbidden words, no winner named).
- Route, on real MongoDB: `stats.routes.test.ts` (counts, one project once, exclusions, empty corpus, no name in the response).
- Live: the real API server on a scratch database answered `GET /stats/competition`, and the Next server rendered the
  panel on `/dashboard` from it. On Atlas (read-only) the read returned 193 awarded projects in 12 categories, 9 comparable
  (top-3 share from 10% to 43%).
