# Admin validation screen — port plan

**Date:** 2026-09-11
**Source:** `mockups/TOR Radar App.dc.html` → `data-screen-label="Admin Validation"`
**Replaces:** the current two-column `/admin/review` body
**Scope:** the review page body ONLY. The app-shell header, its staff sections, the mode switch,
the bell and the account menu are unchanged — the mockup's own chrome is not ported.

---

## 1. What the mockup adds

| Piece | Today | In the mockup |
| :--- | :--- | :--- |
| Layout | queue + one panel split into document/fields | three columns: queue · document · fields |
| Queue row | reason, title, source | index, title, confidence **bar**, confidence value, flag |
| Queue filter | reason chips | reason chips + free-text search (unchanged in substance) |
| Document | a dashed placeholder | a real document panel with a toolbar and a footer |
| Field row | label, confidence, input | **confirm tick**, label, "ต้องยืนยัน" badge, "แก้ไขแล้ว" marker, confidence, input, note |
| Footer | three buttons | **"ยืนยันแล้ว x/9" + progress bar**, confirm-all, then the three buttons |

Two of those are new *behaviour*, not new layout: the per-field confirm tick, and the progress it
drives.

---

## 2. Decisions taken before building

### 2.1 The document panel shows the real document

The mockup draws a page facsimile with blue boxes at the positions the model read each value, and a
legend reading "กรอบน้ำเงิน = ตำแหน่งที่ AI อ่านค่า".

**The pipeline cannot support that claim.** `ExtractedField.evidence` is a short text quote; there
are no coordinates, no page index, and no rendered page images. Drawing boxes at invented positions
would fabricate provenance, which is exactly what `NFR-F6` forbids.

Ported instead:

- The panel embeds the **stored original**, fetched by the browser from object storage through a
  short-lived signed URL (§3.1). It is the immutable document `FR-A-2` already guarantees.
- Zoom and paging come from the browser's own viewer rather than being reimplemented.
- The legend and the boxes are dropped. The field ↔ document link survives as the **evidence quote
  shown on each field row**, which is a true statement about what the model used.
- The footer keeps "RAW เก็บถาวรไม่แก้ไข · SHA-256 ✓" with the record's real `contentHash`.

### 2.2 Confirming a field is not correcting it

The tick marks "a human read the document and this value is right". The existing write path,
`PATCH /admin/tors/:id/fields` → `correct()` → `applyEdits()`, records a row in `corrections`, and
those rows are reused as few-shot examples for the extractor. Passing an unchanged value through it
would file a correction whose before and after are identical and teach the model from non-events.

Confirming therefore gets its own operation (§3.2), and:

- it sets `verified: true` on that field and nothing else;
- it does **not** write a correction;
- it does **not** rewrite `confidenceLevel` or the field's `confidence`, which record what the model
  produced — the same rule approval already follows.

### 2.3 The collapse control stays where it is

The mockup draws the chevron back in the queue header and a count chip in the collapsed rail. Both
were deliberately changed on 2026-09-10: the toggle moved to the seam so one control serves both
states, and the count was removed as a duplicate of the figure the page header already states.

The port keeps the current arrangement. This is the one place it knowingly departs from the drawing,
because the drawing predates the decision. Reversing it is one CSS block and one JSX branch.

---

## 3. API work (`apps/api`)

### 3.1 `GET /api/v1/admin/tors/:id/document`

Returns a short-lived signed URL for the record's stored object.

```json
{ "url": "https://…", "expiresInSeconds": 300, "contentType": "application/pdf", "bytes": 184320 }
```

- Uses the existing `Storage.signedUrl(key, ttlSeconds)` and `config.signedUrlTtlSeconds`.
- The URL is generated per request and never persisted (`NFR-S7`, storage rule).
- The key comes from the record, never from the caller — a caller-supplied key would let any object
  in the bucket be signed.
- 404 when the record does not exist. Admin key required, as with every `/admin` route.

### 3.2 `PATCH /api/v1/admin/tors/:id/fields/:field/verification`

Body `{ "confirmed": true | false }`. Sets `fields.<field>.verified` and records an event through
`HistoryRepository`, so the activity log shows who affirmed what. Rejects a `:field` outside the nine
known field names — it is a path segment from the browser.

Returns the reloaded record, so the screen re-renders from one source of truth.

### 3.3 Tests

- Document route: signs the record's own key; 404 for an unknown id; refuses without the admin key.
- Verification route: sets and clears the flag; **writes no `corrections` row** (assert the
  collection count is unchanged — that is the whole point); rejects an unknown field name; refuses
  without the admin key.

---

## 4. Web work (`apps/web`)

`AdminReviewView` becomes three columns. Grid widths named once in `admin.module.css`, beside the
existing `--queue-width` pair, because the seam toggle already reads them.

| Column | Contents |
| :--- | :--- |
| Queue | header with count · search · reason chips · rows with index, title, confidence bar, value, flag |
| Document | toolbar (content type, byte size, open-in-new-tab) · embedded original · footer with hash |
| Fields | header + reason note · nine rows · footer with progress, confirm-all, and the three actions |

- The confirm tick and confirm-all call the new server action wrapping §3.2.
- Progress is `verified` count over `FIELD_ORDER.length`, computed from the record — never held
  separately, so it cannot drift from what the server returned.
- Each field row's note shows its `evidence` quote when present.
- The three existing actions keep their current behaviour and their existing server actions.
- Every new server action calls `requireStaff()` first, as the existing four do.
- Empty state, offline state and the collapse behaviour built on 2026-09-10 all survive unchanged.

---

## 5. Order

1. §3.1 + tests — smallest, unblocks the document column.
2. §3.2 + tests — the correction-pollution guard is the test that matters.
3. §4 layout with the existing data.
4. Wire the tick, the progress and the document panel.
5. Live verification against the running stack with the seeded queue, at real sizes.

## 6. Out of scope

Zoom and page controls reimplemented in-app · highlight boxes and their legend · any change to the
app-shell header · the public screens · the mockup's own navigation chrome.
