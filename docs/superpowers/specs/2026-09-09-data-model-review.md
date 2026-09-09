# Data model review

**Date:** 2026-09-09
**Reviews:** §4 of [2026-09-01-tor-radar-foundation-intake-design.md](2026-09-01-tor-radar-foundation-intake-design.md)
**Status:** three decisions made, three open and awaiting a call

The slice 1 data model was derived from the requirements rather than from the query workload, which
inverts [MongoDB's own schema design process](https://www.mongodb.com/docs/manual/data-modeling/schema-design-process/)
— it starts from the operations the application runs most often. This review checks the shape
against that guidance and against their published
[anti-patterns](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/) and
[patterns](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/).

---

## 1. The workload, stated late but stated

| Operation | Frequency | Reads | Currently served by |
| :--- | :--- | :--- | :--- |
| Dedupe check on intake | every submission | `tors` by `contentHash` | unique index ✅ |
| Worker claims a job | every poll | `ingest_jobs` by `state + nextRunAt` | compound index ✅ |
| Search with filters | highest read volume | `tors` by agency, category, date, status, free text | partly — Thai text was unsolved, see §2.1 |
| TOR detail | high | one `tors` document by id | `_id` ✅ |
| Dashboard totals and trend | high, public | aggregate over the whole corpus by agency × category × month | live aggregation — see §3.1 |
| Anomaly flagging | per record, and per dashboard view | IQR over a peer group (category × period) | recomputed per request — see §3.1 |
| Vendor matching | per published record × vendors | vendor profiles vs one TOR | not yet designed — see §3.2 |

Two of the three highest-volume operations are aggregations over the whole corpus, and neither has a
precomputed form. That is the review's main finding.

---

## 2. Decided

### 2.1 Thai full-text search → Atlas Search with the Thai analyzer

Thai is written without spaces between words, so MongoDB's default `$text` index cannot tokenise it:
searching `ก่อสร้าง` does not match `จ้างก่อสร้างถนน`. This was recorded as a known risk in the slice 1
spec §4.6 and left open.

**Decision:** use Atlas Search with the `lucene.thai` analyzer, which performs Thai word segmentation.

- No new vendor or service: Atlas is already the chosen database (CLAUDE.md), and Search is a
  feature of the cluster.
- The free M0 tier allows [three search indexes](https://www.mongodb.com/docs/atlas/atlas-search/limitations/);
  this needs one.
- Local and CI parity is solved by [`mongodb/mongodb-atlas-local`](https://hub.docker.com/r/mongodb/mongodb-atlas-local),
  which bundles `mongod` and `mongot` in one image, so the same analyzer runs in Compose. The
  Compose file swaps `mongo:7` for it during task 15.

Rejected alternatives: segmenting at ingest into a `searchTokens` array (portable, but a dictionary
dependency of our own to maintain and re-run over the corpus); unindexed regex substring matching
(collection scan, no ranking, wrong beyond a few thousand records).

### 2.2 Records carry a schema version

`TOR_SCHEMA_VERSION` is stamped on every inserted record. Slices 2–4 each add fields; without a
marker, "this field is absent" and "this record predates that slice" are indistinguishable, and a
migration has nothing to select on. This is MongoDB's
[document versioning pattern](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/) and
costs one integer.

### 2.3 One index removed, one corrected

- Removed `tors.fields.agency.value + createdAt`. The three-field compound
  `agency + announcedAt + torStatus` already covers `agency` as a prefix, and dashboards select on
  the agency's date, not ours. Unnecessary indexes are a documented anti-pattern: every one of them
  is paid for on every write.
- `tors.fields.category.value + createdAt` → `+ announcedAt`. Peer groups for the anomaly rule are
  category × period, and the period means the agency's date.

---

## 3. Open — decisions that change the build

### 3.1 Where dashboard figures come from

The dashboard sums by agency, category and month, and the anomaly rule needs the interquartile range
of a peer group. Today both are computed live, over the whole collection, on every page load. At the
current sample size this is instant; at 100k records it is seconds per visitor.

The alternative is MongoDB's [computed values pattern](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/):
a scheduled job writes one small rollup document per agency × category × month, including the IQR
bounds, and the dashboard reads that. Figures are then minutes old — which FR-E-6 already requires
the page to disclose, since it must show a last-updated time.

**Held open at the reviewer's request.** It was correctly pointed out that this is part of a larger
unanswered question — what renders on the server, what renders in the browser, where data is fetched
and cached — which is worth settling as its own design pass rather than deciding piecemeal for one
screen. Recorded as such; nothing is built on either answer yet.

### 3.2 Which vendor–TOR pairs are stored

Matching (slice 4) scores vendors against published TORs. Storing every scored pair grows as
vendors × TORs — 1,000 vendors against 100,000 TORs is 100 million documents, most of them low
scores nobody reads. Storing only pairs at or above the notify threshold keeps the collection
proportional to what was actually emailed, at the cost of not being able to answer "why was I not
matched?" without recomputing.

**Held open at the reviewer's request** for a fuller explanation before deciding.

### 3.3 Status history growth

`tors.statusHistory[]` records every transition, in the document, forever. Unbounded arrays are the
first-listed MongoDB anti-pattern: the document grows without limit, and every index on it pays for
that growth.

The usual shape is to keep the most recent entries in the document for display and write every
transition to a separate events collection for audit. FR-E-5's requirement — that the history is
visible — is met by the first; the audit trail is complete in the second.

**Held open**: the trade-off needs explaining before it is decided, not deciding first.

---

## 4. Not changed, and why

- **Nine named field objects, not an attribute-pattern array.** FR-B-2 fixes the set at nine, so
  named paths index cleanly and type properly in Zod. The attribute pattern earns its keep when the
  key set is open or per-document, which this is not.
- **`sourceRefs[]` stays in the document for now.** It grows only when the same file is submitted
  again, which is rare in practice, and §3.3's decision on history will settle the same question for
  this array.
- **Collection count stays small.** Nothing here proposes splitting a collection per agency or per
  month, which is its own anti-pattern.
- **`contentHash` remains both the dedupe key and the storage key.** One value means a stored object
  and its record cannot disagree about identity.
