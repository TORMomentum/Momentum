# Requirements v1 — archived from PROJECT.md §6

> **Superseded — not authoritative.** This is the v1 requirement list that sat in PROJECT.md §6
> until 2026-11-03. [SRS.md](../SRS.md) v2.0 holds every requirement; the old-to-new identifier
> map is in [PROJECT.md](../PROJECT.md) §6. Two entries here no longer hold: **FR-A4**
> (Bangkok-only validation) was withdrawn when scope became national, and object storage is
> Google Cloud Storage, not MinIO.


Requirements are split **MVP** vs **Stretch** so core scope is not conflated with aspirational work.

### FR-A: TOR Ingestion (MVP)
- **FR-A1** Accept TOR input via file upload (PDF/JPG/PNG), by URL, and via an authenticated REST
  ingestion endpoint (admin-seeded from public announcements). All routes feed the same pipeline;
  the API route is what future automation (FR-A-S1 scraping) would plug into.
- **FR-A2** Store the original raw document immutably in object storage (MinIO; audit trail; never
  delete raw). Metadata in MongoDB; bytes NOT in MongoDB documents.
- **FR-A3** Deduplicate: the same TOR arriving via multiple routes resolves to one record.
- **FR-A4** Bangkok-only validation: match issuing agency against the canonical BMA agency list;
  reject or tag non-BMA records.

### FR-A-S: Ingestion (Stretch)
- **FR-A-S1** Scraping/polling of configured BMA announcement pages, one adapter per source, with
  per-source health status (pairs with US-16). MVP corpus is manually seeded instead.

### FR-B: Extraction & Normalization (MVP)
- **FR-B1** OCR Thai + English from scanned/image documents (Vertex AI Document AI / Gemini vision).
- **FR-B2** Extract structured fields: title, agency, budget (฿), category, scope summary, required
  qualifications, submission deadline, contact, status (coarse labels only: announced / closed /
  awarded).
- **FR-B3** Per-field confidence score with a two-tier policy. All records auto-publish:
  - **High confidence (≥ T_high):** published clean; fields feed everything.
  - **Medium confidence (T_low–T_high):** published with a visible **"unverified extraction"** tag
    and source-document link; below-threshold fields are excluded from the anomaly rule (FR-E2)
    and match notifications until verified, so OCR errors cannot create false anomaly flags or
    false matches. Not queued — admin can correct from the TOR page at any time.
  - **Very low / suspicious (< T_low, or sanity-check hit: missing critical fields such as
    budget/agency/deadline, implausible values):** published tagged as above AND routed to the
    admin review queue (FR-G1) for priority correction.

  Both thresholds set empirically AFTER measuring extraction accuracy on a 10–20-document
  benchmark set (see NFR-1); full automation is not promised. **Sprint-1 result
  (`docs/corpus/BENCHMARK.md`, TOR-18):** phase gate PASSED. Model confidence alone
  does not discriminate correct from wrong, so the two tiers are gated by
  deterministic per-field rules first (BMA check, budget-range sanity,
  `cancelled ⇒ no deadline`, OCR'd doc ⇒ `budget_thb`/dates never "clean"), then
  model confidence at **T_low = 0.80 / T_high = 0.95**.
- **FR-B4** Normalize extracted qualifications into the shared skill taxonomy used by profiles.
- **FR-B5** PII handling inside TOR documents: displayed extractions minimize personal data (e.g.
  officer personal phone numbers, signatures); original documents remain available via source link;
  a takedown/correction request workflow exists.

### FR-C: Matching & Notification (MVP)
- **FR-C1** Match engine: score each published TOR against vendor profiles on qualification tags,
  category interests, and budget range; threshold configurable.
- **FR-C2** Notify matched vendors via email with the match explanation. Demo target: delivery
  ≤ 5 min after publish.
- **FR-C3** Notification preferences: frequency (immediate/daily digest), minimum match score, and
  filters (category, budget range).

### FR-D: Profiles & Auth (MVP)
- **FR-D1** Registration/login (email + OAuth). Roles: vendor, admin, anonymous public.
- **FR-D2** Skill profile CRUD with taxonomy tags + free-text portfolio.
- **FR-D3** PDPA: explicit consent at signup, data export, account deletion.
- **FR-D4** (Could) Personal project tracking on bookmarks: vendor marks a TOR pursuing / won /
  completed; completed items move to a personal archive view. Self-reported and private — never
  displayed publicly, never treated as a verified award (the platform has no bid data to verify
  against).

### FR-E: Public Dashboard & Visualization (MVP)
- **FR-E1** Public (no-login) dashboard: TOR counts + total budget per BMA agency over time. The
  dashboard always shows a **"data last updated"** timestamp (time of the latest successful
  ingestion) and a coverage note that figures reflect the ingested corpus, not necessarily all BMA
  procurement.
- **FR-E2** Pricing plots with a **documented anomaly rule**: compare budgets only within
  (category × time-window) peer groups; require a minimum peer-group size (e.g. n ≥ 8) before
  flagging; flag = outside 1.5×IQR (or z > 3) of the peer group; label "statistical anomaly," never
  "suspicious." Groups too small to compare are shown unflagged.
- **FR-E3** Filters: agency, category, date range, budget range, status. Closed/awarded TORs stay
  browsable indefinitely — the dashboard doubles as a historical archive (raw documents are never
  deleted, NFR-2).
- **FR-E4** **Shared TOR detail page** (single feature serving vendors, public, and journalists):
  structured fields + original-document link + quality-checklist result + status history + per-record
  extraction provenance ("extracted <timestamp> by <AI model/version>", per NFR-6; re-extraction or
  admin correction updates the timestamp).
- **FR-E5** Status transitions: status changes come from admin action or re-ingestion of an updated
  announcement; each transition records timestamp, source, and actor (supports US-07 history).
- **FR-E6** (Could) CSV export of the currently filtered TOR list: extracted fields + source links,
  PII-minimized per FR-B5 (supports US-12).

### FR-F: AI Quality Checklist (Should — ship after extraction is solid)
Deliberately scoped as a specification-quality checklist rather than an "AI audit": judging
vendor-locking or corruption requires domain expertise and historical data beyond this project's
scope, and overclaiming carries defamation risk.
- **FR-F1** Heuristic, explainable checklist per TOR: budget present? deadline present and
  plausible (≥ X days)? scope specific (length/section heuristics)? qualifications stated with
  rationale? budget within peer-group norm (reuses FR-E2 rule)?
- **FR-F2** Output = score + the exact checklist reasons; clearly labeled "AI-generated
  specification-quality check — not a legal or corruption judgment."
- **FR-F3** Checklist anomalies feed the dashboard anomaly view.

### FR-G: Admin (MVP-minimal)
- **FR-G1** Review queue (minimal version ships WITH ingestion in Sprint 2, not at the end):
  list of very-low-confidence/suspicious records only (FR-B3 tier 3), side-by-side original vs
  extracted fields, edit + approve (clears the "unverified" tag).
- **FR-G2** Corrections are stored and reusable as few-shot examples for the extractor.
- **FR-G3** Taxonomy + canonical agency list seeded from JSON files; admin UI to edit = stretch.

### Non-functional
- **NFR-1** Thai OCR/extraction accuracy is the critical path. Sprint 1 deliverable: measure
  field-level accuracy on 10–20 real BMA TORs; set both FR-B3 confidence thresholds (T_low,
  T_high) from that data. No fixed accuracy promise until measured.
- **NFR-2** Original documents retained immutably — never edited in place — and every displayed
  record links to its source. An accepted PDPA takedown request (FR-B5) restricts access to the
  document with an audit-trail entry; it does not silently alter or delete the stored original.
- **NFR-3** Public pages target < 3 s load on mobile (verified against the demo deployment with
  the seeded corpus); responsive layout.
- **NFR-4** Dockerized (compose) for dev parity; CI runs tests on PR; secrets via env files not
  committed (`.env` in `.gitignore`).
- **NFR-5** PDPA-aligned data handling: explicit consent, PII minimization, export and deletion
  implemented (FR-B5/FR-D3). This is engineering alignment with PDPA principles — no formal legal
  compliance certification is claimed.
- **NFR-6** All AI-derived content labeled as AI-generated. Checklist outputs include their exact
  rule-based reasons (fully explainable); extracted fields carry a confidence score and a link to
  the source document for verification.
- **NFR-7** The web app UI is in Thai (extracted fields displayed as-is; an English UI is out of
  Phase-1 scope).
- **NFR-8** Security baseline: passwords hashed (bcrypt/argon2), HTTPS on any deployed
  environment, role-based authorization on all admin and API routes, rate limiting on the
  ingestion API, dependency vulnerability audit in CI.
- **NFR-9** Sized for the Phase-1 pilot: corpus of hundreds of TORs and tens of concurrent users.
  No uptime guarantee or horizontal-scaling claim is made in Phase 1.
