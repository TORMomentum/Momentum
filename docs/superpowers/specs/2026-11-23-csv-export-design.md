# CSV export of the filtered TOR list — design

**Cards:** TOR-69 (story), TOR-70 (endpoint), TOR-71 (personal-data pass), TOR-72 (button) · **Date:** 2026-11-23
**Builds on:** [search and filter](2026-09-16-search-and-filter-design.md) · [extraction provenance](2026-11-08-extraction-provenance-design.md)
**Requirements:** FR-E-7, UC-9, NFR-S2, NFR-F5, NFR-F6, NFR-F7, NFR-S1, NFR-S7

## 1. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Which rows? | **Exactly the search the reader is looking at.** The route takes the same query as `GET /tors` and parses it with the same Zod schema (`parseSearchQuery`), so a filter cannot mean one thing on screen and another in the file. `cursor` and `pageSize` are ignored: the export is the whole result, not a page. Rows come in the list's own order (search spec §10) |
| 2 | How many? | At most `EXPORT_MAX_ROWS` (default 5,000; the corpus is under 1,000). Beyond that the file holds the first `EXPORT_MAX_ROWS` rows and the response says so (`X-Export-Truncated: true`, plus `X-Export-Total`). The rows are read page by page through `TorsService.search`, never one unbounded query |
| 3 | Which columns? | The list's extracted fields, each as the document states it (`raw`) and, where one exists, the normalised value beside it; the record's confidence level, the "unverified extraction" mark and the names of fields not yet verified; the extraction model, model version and time; and two links: the TOR page and the original document. §3 lists them |
| 4 | Personal data (TOR-71) | The export is built from the **list serializer**, the same one `GET /tors` answers with, so it holds nothing a public reader cannot already see: no account, no profile, no contact person. Provenance adds model names and a time only. Restricted (taken-down) records are excluded, as they are from the list |
| 5 | Wording | Values are written as extracted (NFR-F7). Column headers are Thai (NFR-F7). No column judges a TOR, a budget or an agency; the anomaly verdict is not exported (NFR-F5 is easier to keep with nothing to word) |
| 6 | Spreadsheet formulas | A cell starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` (OWASP CSV injection). This is the one change made to a value, and only to its first character's meaning: a spreadsheet must not run a formula from a government document |
| 7 | Encoding | UTF-8 with a byte-order mark, so Excel shows Thai correctly; RFC 4180 quoting; `\r\n` line ends |
| 8 | Response | `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="tor-radar-YYYY-MM-DD.csv"` (Bangkok date), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` |
| 9 | Abuse | A per-client limit of `EXPORT_RATE_LIMIT_PER_MIN` (default 10) on the route, separate from search's 120: one export reads up to `EXPORT_MAX_ROWS / SEARCH_MAX_PAGE_SIZE` pages |
| 10 | The match filter | Same rule as `GET /tors`: `minMatch` / `maxMatch` need a signed-in vendor (`401` otherwise) and use the same personalised score. The code that turns a score range into ids moves out of the router into one helper both routes call |
| 11 | Web | A "ดาวน์โหลด CSV" link beside the result count on `/search`, pointing at the web route `/api/export/tors.csv` with the page's canonical query minus the cursor. The route relays the API response without buffering (the document proxy), forwarding the session cookie as `x-session-id` so the match filter works. Storage stays reachable only by the API |

## 2. Route

`GET /api/v1/export/tors.csv?<the GET /tors query>` — public; rate-limited; `400` on any malformed filter, as
search; `401` for a match filter without a session.

## 3. Columns

> **Superseded by §7** (same day, after reading a real export): the table below is the first version.

| Header | Source |
| :--- | :--- |
| รหัสระเบียน | record id |
| เลขที่โครงการ | `referenceNo.raw` |
| ชื่อโครงการ | `title.raw` |
| หน่วยงาน | `agency.raw` |
| หมวดหมู่ | `category.value` |
| หมวดหมู่ตามเอกสาร | `category.raw` |
| งบประมาณ (บาท) | `budget.value` |
| งบประมาณตามเอกสาร | `budget.raw` |
| กำหนดยื่นข้อเสนอ | `deadline.value` |
| กำหนดยื่นข้อเสนอตามเอกสาร | `deadline.raw` |
| สถานะ | `torStatus.value` |
| วันที่ประกาศ | `announcedAt`, `YYYY-MM-DD` |
| ระดับความมั่นใจ | `confidenceLevel` |
| ยังไม่ยืนยันการสกัด | ใช่ / ไม่ |
| ฟิลด์ที่ยังไม่ยืนยัน | names of the exported fields whose `verified` is false, `;`-separated |
| โมเดลที่สกัด | `provenance.extractModel` |
| เวอร์ชันโมเดล | `provenance.modelVersion` |
| เวลาที่สกัด | `provenance.extractedAt` |
| หน้า TOR | `${APP_ORIGIN}/tors/<id>` |
| เอกสารต้นฉบับ | `${APP_ORIGIN}/tors/<id>/document` |

## 4. Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `EXPORT_MAX_ROWS` | 5000 | Rows in one file |
| `EXPORT_RATE_LIMIT_PER_MIN` | 10 | Exports per client per minute |

## 5. Tests

- Integration: the export holds the same ids, in the same order, as walking `GET /tors` with the same filter;
  `400` for a malformed filter; `401` for a match filter signed out; truncation at a small `EXPORT_MAX_ROWS`
  sets the headers; restricted records are absent; response headers per decision 8.
- Unit: quoting of commas, quotes and line breaks; the formula prefix; the BOM; Thai text round-trips.
- Web: the link carries the canonical query without `cursor`.

## 6. Out of scope

Excel (`.xlsx`) files · exporting the dashboard's statistics · scheduled or e-mailed exports.

## 7. Revision 2026-11-23 — columns a reader can use

Reading the first export against the Atlas corpus (703 rows) changed §3:

| Change | Why |
| :--- | :--- |
| Status, confidence and the unverified field names are written in Thai | They came out as code (`announced`, `high`, `category;torStatus`), against NFR-F7. The status uses the five words of the `/search` badge, decided the same way, so it is the state **on the day of the export** |
| "เวอร์ชันโมเดล" merged into "โมเดล AI ที่สกัด" | The two held the same string on every row; the version is added in brackets only when it differs |
| "รหัสระเบียน" removed | An internal id; the TOR page link already carries it, and the project number is the key a reader knows |
| "งบประมาณตามเอกสาร" removed | 702 of 703 rows were the number with commas or a trailing `.00`. The text as written stays on the TOR page, one link away. The deadline keeps both columns: a deadline extraction left as text has no ISO value, and the text is then the only one |
| "ประกาศต้นทาง" added | The page the record was collected from: the e-GP project search for an e-GP record (the detail page's own link), otherwise its source URL. Lets a reader check against the government site |

Columns now, in order: เลขที่โครงการ · ชื่อโครงการ · หน่วยงาน · หมวดหมู่ · หมวดหมู่ตามเอกสาร · งบประมาณ (บาท) ·
กำหนดยื่นข้อเสนอ · กำหนดยื่นข้อเสนอตามเอกสาร · สถานะ · วันที่ประกาศ · ระดับความมั่นใจ (สูง / กลาง / ต่ำ) ·
ยังไม่ยืนยันการสกัด (ใช่ / ไม่) · ฟิลด์ที่ยังไม่ยืนยัน · โมเดล AI ที่สกัด · เวลาที่สกัด · หน้า TOR · เอกสารต้นฉบับ ·
ประกาศต้นทาง.

## 8. Revision 2026-11-23 — empty cells

An empty cell in the first export could mean "nothing extracted", "no invitation to bid yet" or "the
value is a number we have none of"; a reader could not tell which. Now:

| Column | Empty becomes | Why |
| :--- | :--- | :--- |
| กำหนดยื่นข้อเสนอ | **stays empty** | A date column: Excel must still sort and filter it as dates |
| กำหนดยื่นข้อเสนอตามเอกสาร, when the ISO column is empty too | "ยังไม่มีประกาศเชิญชวน" when the state is รอประกาศเชิญชวน; otherwise "ไม่พบข้อมูล" | The state already says the invitation is not out; the wording column says why there is no deadline. Read from the same `torState` as the สถานะ column, so the two cannot disagree |
| เลขที่โครงการ · ชื่อโครงการ · หน่วยงาน · หมวดหมู่ · หมวดหมู่ตามเอกสาร | "ไม่พบข้อมูล" | Text read from the TOR. A filter in Excel can select the missing ones by name |
| งบประมาณ (บาท) · วันที่ประกาศ · เวลาที่สกัด | **stay empty** | Numbers and dates: a word in them breaks sorting, sums and filters |
| โมเดล AI ที่สกัด · ประกาศต้นทาง | **stay empty** | About the record, not read from the TOR; one sits beside เวลาที่สกัด, the other is a link column |
| ฟิลด์ที่ยังไม่ยืนยัน | **stays empty** | Empty means every field is confirmed, not that something is missing |

"ไม่พบข้อมูล" is the only wording, and never "เอกสารไม่ระบุ": a document can state a value that extraction
could not read, so the export may say we did not find it, not that it is absent. A value that is there
is still written exactly as extracted (NFR-F7); whitespace alone counts as empty. The words live once,
as `NOT_FOUND` and `NO_INVITATION_YET` in `export.csv.ts`. The two optional columns (เลขที่โครงการ,
หมวดหมู่) were decided by the rule "text read from the TOR", the user having left the choice open.

