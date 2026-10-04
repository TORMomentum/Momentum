# Data Sources — BMA eGP API

Primary ingestion source for the Phase-1 corpus. Reverse-engineered from the official BMA
procurement site's own frontend (Next.js), verified live on 2026-09-03. Public data, no credentials.

**You usually do not need this file.** The source is already wired into our own API — call
`GET /sources/bma-egp/tors` and `GET /sources/bma-egp/tors/:projectId/documents` instead
(see the README). Read on only when changing the adapter itself.

Companion files:
- [`tools/collect_tor.py`](../tools/collect_tor.py) — reference implementation of the whole
  pipeline below (search → announcement detail → file download → metadata CSV).
- [`apps/api/src/sources/bma-egp/client.ts`](../apps/api/src/sources/bma-egp/client.ts) — the typed
  client every part of the app goes through; upstream quirks are contained there.
- [`apps/api/src/data/bma-agencies.json`](../apps/api/src/data/bma-agencies.json) — the canonical
  75-agency BMA list this API returns, seeded for the Bangkok-only check (FR-A4) and the taxonomy
  seed (FR-G3).

## Base URLs

| Purpose | URL |
|---|---|
| Search / list API | `https://egp2.bangkok.go.th/appapi/api` |
| File download | `https://egp2.bangkok.go.th/api/file` |
| Public site (to browse manually) | `https://egp2.bangkok.go.th/project-search` |

## Auth

**None.** No API key, no cookie, no session. All three tiers below were verified from plain
`node` (undici `fetch`) with no credentials on 2026-09-03: reference data, project search, and
file download all return 200.

The earlier belief that the search endpoints needed a browser session cookie was a Python
artifact — `urllib`'s default `User-Agent` is what Cloudflare rejected, not the request's TLS
fingerprint. Send a normal `accept` header and a browser-ish or absent UA and the endpoints
answer directly. Do not build cookie-refresh machinery into the adapter.

## Endpoints

### 1. Reference/dropdown data (agencies, announcement types)

```
GET {api}/Utilities/dropdown?names=<Name1>,<Name2>,...
```

Response: `{"dropdowns":[{"name":"...","items":[{"id":"<uuid>","value":"<Thai label>","code":"<code>"}]}]}`

Valid names: `MasterAnnounceMethodIds`, `MasterAnnounceTypes`, `MasterBudgetYears`,
`MasterBusinessTypes`, `MasterCollateralTypes`, `MasterConditions`, `MasterConsiderationCriterias`,
`MasterContractAvailables`, `MasterContractTypes`, `MasterGoodsIds`, `MasterGuaranteeStatuss`,
`MasterGuaranteeTypes`, `MasterLawsGroups`, `MasterLegalEntityTypes`, `MasterMethodIds`,
`MasterOrgDepartments`, `MasterOrgDivisions`, `MasterOrgGroups`, `MasterOrgSubDivisions`,
`MasterPlanProjectTypes`, `MasterPrefixLegalEntitys`, `MasterProjectCategories`,
`MasterProjectTypes`, `MasterQuarters`, `MasterTypeIds`, `MasterUnits`.

`MasterOrgGroups` is the source of the 75-agency seed (50 district offices, 24 central bureaux,
1 state enterprise). Re-pull it to refresh the seed rather than editing the JSON by hand.

### 2. Search / filter projects

```
GET {api}/Projects/GetProjectFromFilter
      ?externalUserId=&projectSearchText=<keyword>&masterOrgGroupId=&masterOrgDepartmentId=
      &masterAnnounceTypeId=<type-id>&masterMethodIdId=&masterTypeIdId=&masterGoodIdId=
      &masterBussinessTypeId=&masterProjectTypeId=&masterProjectCategoryId=&masterBudgetYearId=
      &startDate=&endDate=&pageNo=1&pageSize=20&sortBy=publishDateDesc
      &bidderName=&bidderTaxNumber=
```

All params must be present, empty when unused (note the API's own typos: `masterMethodIdId`,
`masterBussinessTypeId`).

Returns `{pageCount, currentPage, totalCount, data:[{projectId, projectNumber, projectName,
masterOrgGroupName, masterOrgDepartmentName, masterOrgDivisionName, masterOrgSubDivisionName,
projectBudget, masterContractAvailableName, ...}]}`.

Note: despite `sortBy=publishDateDesc` being accepted, **the search response contains no date
field**. Publish dates are only available per document from endpoint 3 below.

**TOR announcement type id: `24995aa2-d875-4d3d-9dec-d5e22d222aa4`** (`ร่างขอบเขตของงาน (TOR)`).
Filtering on it returned **4,873 TOR announcements** out of ~272,000 total projects as of
2026-09-03 (4,870 on 2026-09-02 — the corpus grows, so treat counts as a moving target).

### 3. A project's announcement documents

```
GET {api}/ProjectAnnouncements/GetAnnouncementDetailInProject?projectId=<projectId>
```

Returns each announcement's `id` (needed for the file URL), `masterAnnounceTypeName`,
`projectAnnouncementPath` (the filename), and `projectAnnouncementPublishDate`. Select the entry
whose `masterAnnounceTypeName` is `ร่างขอบเขตของงาน (TOR)`.

### 4. Download the file

```
GET https://egp2.bangkok.go.th/api/file/<announcement id>/<url-encoded filename>
```

Verified `200 application/pdf`, 3,463,328 bytes for the reference announcement. This URL is the permanent source link every ingested record must keep (FR-A2, NFR-2).

## What the documents actually are

Measured on a 20-document sample spread across the corpus (12 agencies, 2026-09-03):

| Property | Finding |
|---|---|
| Format split | **50% born-digital text PDFs, 50% image-only scans.** No middle ground — scanned files have zero embedded fonts and zero text-showing operators. |
| Scanner software seen | `ScandAll PRO` (Fujitsu), `Epson Scan 2`, `Sharp Scanned Image`, `Scanner System` — these are photocopied paper at ~200 DPI. |
| Size | Mean 2.71 MB. Scans run 0.3–13 MB; born-digital TORs are often under 100 KB. Full corpus ≈ **13 GB** if every document is stored. |
| PII on the page | Scanned TORs carry **handwritten approval signatures**. |
| File type | All 48 **TOR-typed** documents sampled were PDFs — no image or Office attachments, so there is no separate "photo" format for TORs. Across the wider document set (122 documents of every type) 98% are PDF and **2% are `.zip` archives**, which an ingestion pipeline must unpack or reject explicitly. |
| Mix varies by agency | Format tracks the office, not the subject: สำนักการแพทย์ publishes scans, สำนักงานเขตสายไหม publishes born-digital PDFs. A corpus drawn from the newest pages alone skews heavily to scans. |

Consequences:

- **Half the corpus needs OCR**, so the Vertex AI Thai-OCR path is not an edge case — it is the
  path for ~2,400 documents. The other half can be parsed as text and should skip OCR entirely;
  detect which by checking for embedded fonts and text operators, not by file extension.
  `classify_pdf()` in [`tools/collect_tor.py`](../tools/collect_tor.py) implements this, and
  `--recatalog` re-runs it over an existing corpus without re-downloading.
- A per-document `format_type` derived from the `.pdf` extension alone is wrong for half the corpus.
- MinIO needs to be sized for tens of GB, not hundreds of MB.
- Signature images are personal data under PDPA (FR-B5, FR-D3): the raw scan stays immutable in
  MinIO, but displayed extractions must not surface signature crops.

## The TOR type is a narrow slice of this source

`masterAnnounceTypeId` selects one of 13 announcement types. Counts measured 2026-09-03:

| Announcement type | Projects |
|---|---|
| ประกาศรายชื่อผู้ชนะการเสนอราคา (award result) | 198,534 |
| ประกาศราคากลาง (official reference price) | 22,299 |
| ประกาศเชิญชวน (invitation to bid — the live tender) | 11,653 |
| ร่างเอกสารประกวดราคา (draft bidding documents) | 5,800 |
| **ร่างขอบเขตของงาน (TOR)** — what we ingest today | **4,875** |
| ยกเลิกประกาศรายชื่อผู้ชนะ | 4,509 |
| ยกเลิกประกาศเชิญชวน | 1,353 |
| แผนการจัดซื้อจัดจ้าง | 881 |
| (six smaller types) | < 400 each |

A project carries a *set* of announcements across its lifecycle — plan → TOR → draft bidding docs →
invitation → award — each with its own file. Fetching only the TOR-typed document therefore
discards most of what the source publishes about the same project.

**Measured coverage gap:** of 40 sampled projects that have a live ประกาศเชิญชวน,
only **14 (35%) also carry a TOR-typed document**. Filtering on TOR alone misses roughly
**65% of live tenders** — about 7,000 projects.

Two consequences worth deciding on before Sprint 2:

- **Notifications (US-01, US-02) key off the wrong stage.** A TOR is the *draft* stage; vendors bid
  on ประกาศเชิญชวน, which is where the deadline lives. Matching only TOR-typed records both misses
  two thirds of biddable work and alerts on drafts that may never become tenders.
- **Pricing anomaly (FR-E2, FR-F2) currently has one number.** Today the only figure available is
  the agency's declared `projectBudget`. ประกาศราคากลาง carries the official reference price and
  the award announcement carries what was actually paid — the comparison those requirements
  describe needs all three, and all three are already in this API.

## Gotchas

- **Python's `urllib` gets blocked** by its default `User-Agent`; that is why
  [`tools/collect_tor.py`](../tools/collect_tor.py) shells out to `curl`. Node needs no such
  workaround — the ingestion adapter can use `fetch` directly.
- The announcement-type filter applies to the **project**, so a project returned under the TOR type
  can still carry non-TOR files (a price summary, for instance). Filter documents by
  `masterAnnounceTypeName` too — `selectTorAnnouncements()` in the client does this.
- Rate-limit politely — the collector sleeps between requests. This is a public government service.

## Taxonomy seeds

`apps/api/src/data/` holds three committed seed files (FR-G3):

| File | Records | Origin |
|---|---|---|
| `bma-agencies.json` | 75 | `MasterOrgGroups` — backs the FR-A4 Bangkok-only check, read from disk at startup |
| `procurement-categories.json` | 87 | `MasterGoodsIds` (70) + `MasterTypeIds` (9) + `MasterProjectCategories` (8) |
| `skill-tags.json` | 23 | hand-authored; they describe vendors, not procurement |

The category seed is **generated** — run `node tools/build_seeds.mjs` to refresh it rather than
editing the JSON, or your edit is lost on the next regeneration. Every skill tag maps onto
goods-category codes that exist in that file (61 of 69 covered; the rest are fuel, weapons, land
and "other" buckets nobody bids on as a skill).

Note that upstream reuses some category codes — `2001` is both ที่ดิน (เช่า) and ที่ดิน (ซื้อ) — so
anything keyed on these records must use `category_id`, not `code`.

## National e-GP (`gprocurement.go.th`) — second source

The e-GP **web site** is an Angular front end gated behind Keycloak OAuth
(`login-process5.gprocurement.go.th/auth/realms/egpms`) and a Cloudflare Turnstile bot check — do
not automate the site. Four **back-end endpoints** under it are public, need no login, cookie or
special header, and were verified live on 2026-10-04:

| Endpoint | Gives |
| :-- | :-- |
| `process.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml?anounceType=B0\|D0&deptId=` | Today's announcements (Windows-874). Each item: title, link, date, and a description starting with the 11-digit project number. Empty at weekends. `process3.` redirects here |
| `process5…/egp-approval-service/apv-common/infoProcureDocAnnounZip?projectId=` | `data.zipId` of the final bid package; `responseCode: "1"`, `data: null` when there is none |
| `process5…/egp-doc-price-estimate-service/dpe-common/infoDocPriceestZipHis?projectId=` | `data.zipFileId` of the reference-price package (`pB0.pdf` line items, `pB1.pdf` budget and price sources) |
| `process5…/egp-upload-service/v1/downloadFileTest?fileId=` | The package ZIP itself (7–10 MB, 9–22 files: `TOR(1).pdf`/`Attach_TOR_n.pdf`, `annoudoc_*.pdf` invitation, bid document, bonds, contract) |

`downloadFileTest` is unofficial and may close; the BMA API above stays the fallback. Collected by
`tools/import_national_egp_tors.mts` through `apps/api/src/sources/national-egp/` — design in
[the national e-GP source spec](superpowers/specs/2026-10-04-national-egp-source-design.md).
