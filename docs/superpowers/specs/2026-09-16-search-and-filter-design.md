# Search and filter (TOR-40)

**Date:** 2026-09-16
**Delivers:** TOR-40 (US-04) and its subtasks TOR-41, TOR-42, TOR-43, TOR-125
**Requirements:** `FR-E-3`, `NFR-F2`, `NFR-F5`, `NFR-F6`, `NFR-F7`, `FR-E-6`, `FR-B-5`
**Builds on:** [rendering and data fetching](2026-09-10-rendering-data-fetching-design.md) §3, §4, §5.1, §6.1, §8, §11 ·
[data-model review](2026-09-09-data-model-review.md) §2.1 · [API.md](../../API.md) §4

TOR-40's acceptance criteria: *filters for agency, budget range, category and deadline; the filters
combine; a search returns in under 2 s on the seeded corpus.* `FR-E-3` adds status, and keeps closed and
awarded TORs browsable as historical records.

---

## 1. Decisions

| # | Decision | Answer |
| :--- | :--- | :--- |
| 1 | Keyword search on Thai text | **Interim:** an escaped, length-capped substring match on title and agency. It replaces Atlas Search (`lucene.thai`) only until `mongodb-atlas-local` runs in Compose and CI. See §5 |
| 2 | Pagination | A cursor over `(announcedAt desc, _id desc)`, as the rendering spec §5.1 decides. `API.md`'s `page` parameter is superseded |
| 3 | Total count | Exact `countDocuments` over the same filter. Revisited under Q2 at real volume |
| 4 | "Open" (`ยังเปิดรับ`) | `torStatus = announced` **and** the deadline is today or later in `TIME_ZONE`, or not stated. A status extracted when the TOR was announced goes stale once the deadline passes; the deadline is the signal that doesn't |
| 5 | Filter options | A separate `GET /tors/facets`: agencies and categories that actually occur, with counts, and the budget range. The sidebar never lists a value that can only return nothing |
| 6 | TOR detail for real records | A minimal `GET /tors/:id` and a server-rendered record view, so that search results don't lead to 404s. Sample slugs keep rendering the ported mockup |
| 7 | Demo corpus | A development seed built from the benchmark corpus's real model output (`docs/corpus/predictions/gemini-3.5-flash`), graded by the production `grade()` so each record's confidence tier is the one the pipeline would assign |

---

## 2. `GET /api/v1/tors`

Public, unauthenticated, uncached (rendering spec §6.1).

| Parameter | Type | Meaning |
| :--- | :--- | :--- |
| `q` | string ≤ `SEARCH_QUERY_MAX_CHARS` | NFC-normalised, trimmed. Substring of title or agency, as extracted |
| `agency` | string, repeatable ≤ `SEARCH_MAX_FILTER_VALUES` | Exact extracted agency value; values OR together |
| `category` | string, repeatable | Exact extracted category value; values OR together |
| `status` | `announced` \| `closed` \| `awarded` \| `cancelled` | Extracted TOR status |
| `open` | `true` | Decision 4 |
| `minBudget`, `maxBudget` | number ≥ 0 | Inclusive, on `fields.budget.value`. A record without a budget can't satisfy a budget bound |
| `deadlineFrom`, `deadlineTo` | `YYYY-MM-DD` | Inclusive, on `fields.deadline.value` |
| `from`, `to` | `YYYY-MM-DD` | Inclusive, on `announcedAt`: the agency's date, never ingestion time |
| `cursor` | opaque | From a previous `nextCursor` |
| `pageSize` | 1…`SEARCH_MAX_PAGE_SIZE` | Default `SEARCH_PAGE_SIZE` |

Different parameters combine with AND. Every value is parsed as a primitive by Zod, so no operator
object reaches a query (spec §5.6), and the repository builds the filter field by field.

**Always applied:** `pipeline.state = published`, not `access.restricted`, `duplicateOf = null`. Every
confidence tier is listed (SRS §4.2.1): confidence decides how a record is marked, not whether it
appears.

```json
{
  "items": [{
    "id": "66f0…", "announcedAt": "2026-08-11T00:00:00.000Z",
    "confidenceLevel": "medium", "unverified": true,
    "title":    { "raw": "…", "verified": true },
    "agency":   { "raw": "…", "value": "…", "verified": true },
    "category": { "raw": "…", "value": "…", "verified": false },
    "budget":   { "raw": "…", "value": 5524000, "verified": true },
    "deadline": { "raw": "…", "value": "2026-08-25", "verified": false },
    "torStatus": { "value": "announced", "verified": true }
  }],
  "total": 15,
  "nextCursor": null,
  "coverage": { "lastUpdatedAt": "2026-09-16T09:00:00.000Z" }
}
```

A list row carries no contact, evidence, or storage detail: a data transfer object holds only what the
screen renders. `coverage.lastUpdatedAt` is the latest `createdAt` among visible published records,
which is the most recent successful intake (`FR-E-6`).

## 3. `GET /api/v1/tors/facets` and `GET /api/v1/tors/:id`

**Facets** returns `{ agencies: [{value, count}], categories: [{value, count}], budget: {min, max} | null }`
over the same always-applied filter, capped at `SEARCH_FACET_LIMIT` values per dimension and ordered by
count. It's computed in one aggregation pipeline (rendering spec §5).

**Detail** returns one visible record: every extracted field as `{raw, value, confidence, verified}`,
`announcedAt`, `sourceUrl`, `provenance`, `confidenceLevel`, `unverified`, `contentHash`, and
`contentType`. The record passes through `redactTor(…, "public")`, the one redaction serializer
(`FR-B-5`). `evidence` is not returned. A restricted, unpublished, or unknown id is a 404; a takedown
never shows as a 403 (`FR-B-6`).

## 4. Indexes and the two-second target (TOR-43, TOR-125)

The existing compound indexes already serve the agency and category filters. One change:
`{ announcedAt: -1 }` becomes `{ announcedAt: -1, _id: -1 }`. That lets the default unfiltered listing
read the cursor order straight from the index instead of sorting in memory, with the same prefix
coverage as before and no extra index.

The timing test inserts a synthetic corpus of 5,000 published records, far larger than the seeded demo
corpus, into an isolated database. It asserts that each composed query returns in under 2 s and that the
agency and category queries don't plan a collection scan.

## 5. The interim keyword match, and what retires it

A regular expression is built from the escaped query and anchored nowhere. Thai substrings match
correctly (`ก่อสร้าง` finds `จ้างก่อสร้างถนน`), which a `$text` index can't do. It isn't indexed, so its
cost grows with the collection. That's acceptable at seeded and pilot volume, and the timing test above
measures it. It's recorded as open in [PLAN.md](../../PLAN.md). When `mongodb-atlas-local` replaces
`mongo:7`, the repository's keyword clause becomes a `$search` stage on a `lucene.thai` index. The API
contract doesn't change.

## 6. The web screen

- `app/(app)/search/page.tsx` is a **server component**. It reads `searchParams` and fetches facets and
  results in parallel through `shared/api/tors.api.ts` (`server-only`, `API_BASE_URL`, a timeout).
- `features/search/search.params.ts` is the one canonicaliser (rendering spec §3.1, §11). It sorts keys
  and repeated values, normalises Unicode to NFC, and drops empty and default values, so that two
  spellings of one search give one URL.
- `SearchView` stays a client component, but it no longer owns results. It renders props, and every
  filter pushes a URL through `router.push` inside `startTransition`, so Back undoes the last filter. The keyword field and budget
  slider hold a local draft and commit on Enter, on release, or after a debounce. The previous results
  stay on screen, dimmed, while the next ones load.
- New: a deadline range (`กำหนดยื่นข้อเสนอ`). Removed from rows: the quality score, match percentage, and
  anomaly badge, because none is computed yet. A number nobody calculated is not shown (`NFR-F6`).
- Values display exactly as extracted (`NFR-F7`). An unverified value carries `*` and the row carries
  the unverified badge.
- States (rendering spec §8): no data yet · filtered to nothing (it names the filters and offers to clear
  them) · API unavailable (search fails closed with a stated reason).

## 7. Out of scope

Atlas Search itself · the dashboard (TOR-56/57) · anomaly flags (TOR-60) · checklist and match scores ·
CSV export (TOR-69) · the tree-wide Cache Components migration · status history on the detail page.
