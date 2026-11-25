# Search: recommended-for-you first, filters on demand — design

**Cards:** TOR-217 (TOR-265, TOR-266) · **Date:** 2026-11-25 · **Status:** approved 2026-11-25 (drawer: option A)
**Builds on:** [rendering and data fetching](2026-09-10-rendering-data-fetching-design.md) (its §3.1 and §8 rules still hold) · the dashboard's matched-TOR panel · `/me/matches`
**Requirements:** FR-E-3 (search), FR-C-1 (matching), FR-E-6 (coverage note and last-updated time always shown),
NFR-F6 (AI output explainable), NFR-F7 (Thai UI)

## 1. Context

From the 2026-10-15 review: the search page opens on a 270 px filter sidebar with every group expanded, which reads
as an old-style search form. The vendor arrives asking "is there anything for me", and the answer already exists —
`/me/matches`, shown as "TOR ที่ตรงกับคุณ" on the dashboard — but not on the search page.

## 2. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Where do the filters go? | **Into a drawer**, closed when the page opens (TOR-266). A filter (funnel) icon button beside the search box opens it, named "ตัวกรอง" for screen readers, with the number of active filters as a badge on its corner. The drawer slides in from the left over the results with a backdrop; Escape, the backdrop, ✕ and "ดูผลลัพธ์" close it, and focus returns to the button. Filters still apply as they change, so the results behind it update live |
| 2 | How does a reader see what is filtering? | Unchanged: the applied-filter chips above the results, each removable without opening the drawer |
| 3 | Where do the coverage note and last-updated time go? | Under the result list, always visible (FR-E-6). They were in the sidebar's footer |
| 4 | What leads the page? | **"แนะนำสำหรับคุณ"** (TOR-265): the vendor's top 5 from `/me/matches`, the same rows, score, days left and work reason as the dashboard panel |
| 5 | When is it shown? | To a signed-in account, and only while no keyword or filter is set. Once the reader searches, the panel steps aside: the list is then their question, not ours |
| 6 | When it cannot be shown | Signed out: the existing sign-up banner, no panel. A profile with no categories: the scorer's reason with a link to the profile. Matches could not be read: no panel (the search still renders) |
| 7 | "See all" | Links to the search with the existing "ตรงกับคุณ" filter at its lowest step (`minMatch=5`), which lists every match |
| 8 | One component, two pages | `MatchedTorsPanel` moves from `features/dashboard` to `shared/ui` (two features use it), with the title and the "see all" link as props |
| 9 | Unchanged | The search order, the API, and the dashboard's own panel |

## 3. Also in this change: the winners-by-category table

The dashboard's "ผู้ชนะตามหมวดหมู่" table (TOR-281) stretched four columns across the full width, leaving a wide gap
between each category and its figures, and wrapping the column heads. It becomes two columns across the panel: the
category with its counts beneath it ("40 โครงการ · ผู้ชนะ 39 ราย"), and the top-winners' share as a bar with its
percentage beside it. Same figures, same order, same notes (NFR-F5 wording unchanged).

## 4. Docs this changes

TESTING.md (new view and panel tests, a manual case), TODO.md (TOR-217), ARCHITECTURE.md if the web module table
names the panel's home.
