# TOR Radar BKK — BMA TOR Platform

> University group project — Software Design.
> Process: Scrum · Jira · Discord · Docker. Stack: Next.js, Node/Express, MongoDB Atlas, Vertex AI.
> _v2 — revised after internal review; 22 findings addressed._

---

## 1. Problem Statement

Bangkok Metropolitan Administration (BMA) agencies publish
procurement TORs (Terms of Reference) for projects, but they are scattered, hard to discover,
and come in inconsistent formats (PDF text, scanned images, photographs). As a result:

- Capable vendors and freelance professionals never see opportunities that match their skills.
- Agencies struggle to reach qualified bidders for their TORs.
- The public has no easy way to see what is being procured, at what price, or spot pricing anomalies.
- TOR quality varies and there is no systematic quality check.

**Vision:** a centralized, Thai-language platform, Bangkok-only scope, that (1) ingests publicly
announced BMA TORs regardless of format, (2) extracts and normalizes the data with AI, (3) matches
TORs to registered vendors by qualification (skill profiles + stated preferences) and notifies them
by email, (4) exposes a public transparency dashboard with pricing visualizations and
statistical-anomaly detection, and (5) runs an AI-assisted quality checklist on each TOR.

**Purpose (single sentence):** give vendors and the public easier access to Bangkok TORs, with
skill/preference-based filtering, matching, and email notification — the platform works entirely
from publicly announced TORs and requires no agency cooperation.

**Key assumption:** no committed external customer has validated these requirements yet — everything
below is treated as a hypothesis until validated (Sprint 1 has explicit validation deliverables, §7).

---

## 2. Scope

**In scope:** BMA/Bangkok TORs only · ingestion by file upload/URL (corpus seeded by the admin team
from public announcements) · AI extraction with manual correction · vendor skill profiles +
matching + email notifications · public dashboard (per-agency view, pricing plots, statistical
anomalies) · AI quality checklist (heuristic, explainable) · Thai-language UI.

**Bangkok-only rule (explicit):** the system keeps a canonical list of BMA agencies and district
offices. Ingested records are matched against it; non-BMA records are rejected or tagged
out-of-scope. (National e-GP data is NOT assumed — it mixes non-Bangkok entities.)

**Out of scope (this semester):** other provinces · agency-facing upload or draft-TOR portal (the
platform reads public announcements; agencies are a data source, not platform users) · QR-code
ingestion · bid submission through the platform · payments/contracts · contract-award analysis
beyond a coarse status label · mobile native apps · non-Thai UI.

---

## 3. Stakeholder Analysis

### Product stakeholders

| # | Stakeholder | Type | Interest / stake | Power | Interest | Engagement strategy |
|---|-------------|------|------------------|-------|----------|---------------------|
| S1 | Vendors / freelance professionals (developers, contractors) | Primary user | Discover matching opportunities (e.g. a ฿1.5M project fitting their skills); timely email notice | Low | High | Core persona — onboarding, skill profiles, email notifications |
| S2 | BMA agency procurement officers | Data source (not a platform user) | Their published TORs are the platform's input; they benefit indirectly when qualified bidders discover their TORs | High (they control the data) | Low–Med | Ingest only publicly announced documents; respect ToS; always link to the original source |
| S3 | General public / citizens of Bangkok | User (read-only) | Transparency: what is procured, prices, anomalies | Low–Med (media pressure amplifies) | Medium | Public dashboard, no login |
| S4 | Journalists / anti-corruption watchdogs / researchers | Key validation user | Pricing anomalies + quality scores as investigation and research leads | Low | High | High-impact users for dashboard validation; export/share later |
| S5 | Admin (platform operators) | Internal user | Extraction quality, ingestion health, taxonomy consistency | High (internal) | High | Review queue, correction tools, seeded taxonomy |

**External constraints (not engaged stakeholders, but they shape requirements):**
- **BMA announcement pages** — the only data input; a format change or access block halts ingestion.
  Mitigation: manual upload/URL seeding is the always-available path; scraping stays optional.
- **Law (Public Procurement Act B.E. 2560, PDPA)** — lawful reuse of procurement data; PII in
  profiles and inside TOR documents. Mitigation: PDPA consent, PII minimization in displayed
  extractions, takedown/correction workflow.

### Delivery stakeholders (course context — kept separate from product analysis)

| # | Stakeholder | Stake | Strategy |
|---|-----------|-------|----------|
| D1 | Course instructor / TA | Grading against rubric; acts as customer proxy | Deliverables on time; validate assumptions with them |
| D2 | Student development team | Deliver within one semester; apply Scrum | Jira sprints, Discord standups, enforce scope cuts |

**Power/interest summary:** manage closely D1, S5 · keep satisfied S2 (operationally — the data
source) · keep informed S1, S4 · monitor S3.

**Conflict to watch:** anomaly flags and quality scores serve S3/S4 but can embarrass individual
agencies (S2) — the same agencies whose published data the platform depends on. Frame outputs as
"statistical anomaly" and "specification completeness," never as accusations of wrongdoing.

---

## 4. Personas (brief)

- **P1 — "Nok", freelance full-stack dev.** Skills: Next.js, GIS. Wants gov work but hears about
  TORs after bidding closes. Wants: profile once → relevant TOR notifications.
- **P2 — "Khun Somchai", procurement officer at a BMA district office.** Publishes TORs as scanned
  PDFs on the district announcement page. Not a platform user — his documents are the input; he
  benefits when qualified bidders find them.
- **P3 — "Ploy", data journalist.** Wants per-agency spending views and anomaly leads.
- **P4 — Admin (platform operator).** Seeds the TOR corpus, keeps ingestion healthy, corrects bad
  extractions.

---

## 5. User Stories

Format: As a `<role>`, I want `<capability>` so that `<benefit>`. Acceptance criteria are testable.

### Vendor (S1)
- **US-01** As a vendor, I want to create a profile with my skills, certifications, past projects,
  and budget range, so the system can match me to TORs.
  *Accept: profile CRUD; skills chosen from structured taxonomy; PDPA consent checkbox required.*
- **US-02** As a vendor, I want to be notified by email when a new TOR matches my qualifications
  and preferences, so I can prepare early.
  *Accept: email delivered ≤ 5 min after a TOR is published in the demo environment; message includes match reason.*
- **US-03** As a vendor, I want to see *why* a TOR matched me (which qualifications lined up), so I
  can judge fit fast. *Accept: match detail lists ≥ the top 3 matched skill tags + budget-range fit.*
- **US-04** As a vendor, I want to search/filter TORs by agency, budget range, category, and
  deadline. *Accept: all four filters composable; results < 2 s on seeded corpus.*
- **US-05** As a vendor, I want each TOR shown as clean structured data (scope, budget, required
  qualifications, deadlines, contact) with a link to the original document.
  *Accept: TOR detail page (shared with all roles, see FR-E4) shows all extracted fields + original file.*
- **US-06** As a vendor, I want to see the TOR's quality-checklist result, so I can avoid poorly
  specified projects. *Accept: score + ≥ 3 concrete checklist reasons displayed.*
- **US-07** As a vendor, I want to bookmark TORs, see their coarse status (announced / closed /
  awarded), and privately mark ones I pursued as won or completed, so I can follow opportunities
  and keep a personal archive of past projects. *(Personal tracking part is Could.)*
  *Accept: bookmark list; status history with timestamps; self-reported pursue/won/completed marks
  are private to the vendor, move completed items to a personal archive view, and are never shown
  publicly or presented as verified awards.*

### Public / journalist / researcher (S3, S4)

_No agency user stories: BMA officers are a data source, not platform users (§2). An officer
browsing TORs uses the same public views as any citizen._
- **US-08** As a citizen, I want a public dashboard (no login) showing TORs per BMA agency.
  *Accept: agency list with TOR count + total budget, filterable by date range; "data last
  updated" timestamp + coverage note visible (FR-E1).*
- **US-09** As a citizen, I want pricing plots with statistical anomalies highlighted.
  *Accept: scatter/box plot of budget grouped by category (and agency); points flagged by the documented anomaly rule (FR-E2); flagged points labeled "statistical anomaly."*
- **US-10** As a journalist or researcher, I want to filter the dashboard by agency, period, and
  category and see totals/trends. *Accept: filters compose; totals update; simple trend line per period.*
- **US-11** As a journalist or researcher, I want each TOR's quality-checklist score with reasons,
  so I can find leads on badly specified procurements.
  *Accept: same surface as US-06; score methodology page linked.*
- **US-12** As a researcher, I want to export the currently filtered TOR list as CSV, so I can
  analyze the data with my own tools. *(Could — ships only if the Must set is done.)*
  *Accept: export respects active filters; includes extracted fields + source links; no PII beyond the displayed extractions.*

### Admin (D2/P4)
- **US-13** As an admin, I want to ingest a TOR by uploading a file (PDF/JPG/PNG), submitting a
  URL, or calling an authenticated ingestion API endpoint, so the corpus can be seeded from public
  announcements manually or programmatically.
  *Accept: all three paths produce a record in the same extraction pipeline; API requires admin
  authentication; duplicates resolve to one record (FR-A3).*
- **US-14** As an admin, I want a queue of only the very-low-confidence or suspicious extractions
  with the original document side-by-side, so I can prioritize correcting the worst records
  without wading through every merely-imperfect one.
  *Accept: only records below T_low or failing sanity checks appear in the queue (FR-B3);
  medium-confidence records carry the "unverified" tag but stay out of the queue; edit + approve
  clears the tag and lets the fields feed anomaly stats and matching.*
- **US-15** As an admin, I want to manage the taxonomy (skill tags, categories, canonical BMA agency
  list), so matching and the Bangkok-only filter stay consistent. *Accept: seeded from JSON; editable in UI (stretch).*
- **US-16** As an admin, I want ingestion-source health monitoring, so a silently broken source
  doesn't create a coverage gap. *(Stretch — only relevant once scraping (FR-A-S1) exists.)*

---

## 6. Functional Requirements

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
  benchmark set (see NFR-1); full automation is not promised.
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
  scope this semester).
- **NFR-8** Security baseline: passwords hashed (bcrypt/argon2), HTTPS on any deployed
  environment, role-based authorization on all admin and API routes, rate limiting on the
  ingestion API, dependency vulnerability audit in CI.
- **NFR-9** Sized for the course demo: corpus of hundreds of TORs and tens of concurrent users. No
  uptime guarantee or horizontal-scaling claim is made this semester.

---

## 7. Feature Analysis (MoSCoW + impact/effort)

| Feature | Stories | MoSCoW | Impact | Effort | Notes |
|---------|---------|--------|--------|--------|-------|
| TOR upload/URL/API ingestion + OCR extraction | US-05, US-13 | **Must** | High | High | Foundation. Vertex AI heavy lifting; benchmark accuracy first (NFR-1) |
| Minimal admin review/correction queue | US-14 | **Must** | Med | Med | Ships WITH ingestion (Sprint 2) — OCR errors are expected; review clears "unverified" tags so fields can feed anomaly stats and matching |
| Shared TOR detail page + search/filter | US-04, US-05 | **Must** | High | Med | First visible value; one page serves all roles |
| Public dashboard: per-agency view + pricing plots + anomaly rule | US-08–US-10 | **Must** | High | Med | High demonstration value; core transparency mission; anomaly rule per FR-E2 |
| Vendor skill profiles | US-01 | **Must** | High | Med | Prereq for matching |
| Matching engine + email notifications | US-02, US-03 | **Must** | High | Med–High | Core differentiator — skill/preference matching with match explanations |
| AI quality checklist (heuristic) | US-06, US-11 | **Should** | High | Med | Differentiator; heuristic + explainable, after extraction is solid |
| Bookmarks + status tracking + personal project archive | US-07 | **Could** | Med | Low | Needs FR-E5 status transitions; archive marks self-reported + private (FR-D4) |
| CSV export of filtered TOR list | US-12 | **Could** | Med | Low | FR-E6; serves researchers/journalists; PII-minimized |
| Automated scraping + source health | US-16 | **Could** | Med | High | High maintenance cost from source-format changes; corpus manually seeded for MVP |
| Taxonomy admin UI | US-15 | **Could** | Low | Low | JSON seed files first |
| Bid submission / award analysis | — | **Won't (this semester)** | — | — | Coarse status labels only |

**Sprint plan (Must-first; each sprint demoable):**
1. **Sprint 1:** requirement validation (interview 2–3 real freelancers + instructor-as-customer;
   revised backlog = graded deliverable) · collect 10–20 real BMA TORs · extraction spike +
   accuracy benchmark (NFR-1) · repo/CI/Docker skeleton.
2. **Sprint 2:** ingestion (upload/URL) → extraction → **minimal review queue** → published
   structured TORs + shared detail page.
3. **Sprint 3:** public dashboard (agency view, pricing plots, FR-E2 anomaly rule) + search/filter.
4. **Sprint 4:** profiles + matching + email notifications.
5. **Sprint 5:** quality checklist + bookmarks/status tracking + polish/demo prep.
   *(Everything in Sprint 5 is Should/Could — cuttable without breaking the product.)*

---

## 8. Tech Stack Mapping

| Layer | Choice | Used for |
|-------|--------|----------|
| Frontend | Next.js | Dashboard (public), TOR browse/detail, profile UI, admin queue |
| API | Node.js + Express | REST API, matching engine, notification dispatch |
| DB | MongoDB Atlas | TOR metadata/extracted fields (flexible schema fits inconsistent TORs), profiles, match records; Atlas Search for text search |
| Raw document storage | MinIO (S3-compatible object storage, self-hosted in Docker Compose) | Original PDFs/images — NOT stored as Mongo documents |
| AI | Vertex AI (Document AI / Gemini) | Thai OCR, field extraction, qualification normalization, checklist assist |
| Notifications | Email (Nodemailer/Resend) | Match alerts |
| Infra | Docker Compose; deploy target = one small VM or Cloud Run (decide Sprint 1); secrets via env vars | Dev parity + demo hosting |
| Process | Scrum, Jira (epics ≈ FR groups), Discord | Sprints, board, comms |

---

## 9. Cost Breakdown

Costs fall into two categories: **direct (cash) costs** (§9.1) and **effort (labor) costs** (§9.2).
For a student project the labor is unpaid, but it is the dominant real cost and is budgeted in
person-hours; an imputed commercial value is shown for comparison.

### 9.1 Direct (cash) costs

All application software is open source (Next.js, Express, MongoDB Community drivers, MinIO,
Docker). Paid usage is limited to cloud AI calls and optional hosting. Estimates below assume a
demo-scale corpus of ~500 documents × ~10 pages and must be re-verified against current provider
pricing before budgeting.

| Item | Plan / rate | Semester estimate |
|------|-------------|-------------------|
| MongoDB Atlas | M0 free tier (512 MB — sufficient for metadata) | ฿0 |
| MinIO (raw document storage) | Open source, self-hosted in Docker Compose | ฿0 |
| Vertex AI — Document AI OCR | ~US$1.50 per 1,000 pages (Enterprise Document OCR) | ~US$7.50 for 5,000 pages |
| Vertex AI — Gemini (field extraction, checklist assist) | Flash tier, per-token (e.g. Flash-Lite ~US$0.10/M input, ~US$0.40/M output) | Single-digit US$ at ~500 extractions |
| AI development headroom | Benchmark loops and re-runs multiply usage | Budget 3–5× the two rows above (~US$30–60 ceiling); a new GCP account's free-trial credit (US$300) covers this if available |
| Email notifications | Nodemailer via SMTP or Resend free tier | ฿0 at demo volume (verify current free-tier limits) |
| Hosting (dev + class demo) | Local Docker Compose | ฿0 |
| Hosting (optional public demo) | One small cloud VM or Cloud Run free tier | ~US$5–10/month if used |
| Domain (optional) | — | ~US$10/year if used |

**Cash bottom line:** ~US$0–30 for the semester using free tiers and trial credits; worst case
~US$50–80 with paid AI headroom and a public VM. Pricing sources: Google Cloud Document AI and
Gemini pricing pages (cloud.google.com/document-ai/pricing, ai.google.dev/gemini-api/docs/pricing)
— re-check before committing a budget; rates change.

### 9.2 Effort (labor) costs

**Capacity assumption (named, adjustable):** team of 5 × ~10 h/week × ~15 working weeks ≈ **750
person-hours** for the semester. Percentages below allocate that capacity; hours are planning
estimates to be refined at each sprint planning and tracked in Jira against actuals.

| Activity | Covers | Share | Est. hours |
|----------|--------|-------|-----------|
| Requirements & data sourcing | Validation interviews, TOR corpus collection, agency-list seeding | 8% | ~60 |
| UI/UX design | Wireframes, Thai UI copy, design review | 8% | ~60 |
| Backend development | API, ingestion pipeline, matching engine, email notifications, auth | 21% | ~160 |
| Frontend development | Dashboard, TOR browse/detail, profiles, admin queue | 18% | ~135 |
| AI integration | OCR/extraction integration, Sprint-1 accuracy benchmark, prompt/few-shot tuning | 13% | ~100 |
| Data analysis | Anomaly rule calibration, checklist validation (hand-scored comparison) | 6% | ~45 |
| Testing | Unit/integration tests in CI, manual test passes, bug fixing | 11% | ~80 |
| Deployment & DevOps | Docker Compose, CI setup, demo hosting | 5% | ~40 |
| Optimization & polish | Performance (NFR-3), responsive fixes, demo hardening | 4% | ~30 |
| Reports & documentation | Course deliverables, README/docs, final presentation | 7% | ~50 |
| Maintenance & consultation | Bug triage during demo period, instructor/TA meetings, Scrum ceremonies | 4% | ~30 |
| **Total** | | 100% | **~790** |

*(Total slightly exceeds the 750 h capacity — that is the point: scope pressure is visible up
front, and the Sprint-5 Could/Should items are the release valve.)*

**Imputed commercial value (illustrative only):** at an assumed blended junior-developer rate of
฿R/hour, project labor ≈ 790 × R. Example: R = ฿300 → ≈ ฿237,000. The rate is an assumption, not
a market quote — replace R with a sourced local rate if the evaluation requires a defensible
figure. Actual cash labor cost this semester: ฿0 (student team).

---

## 10. Risks & Open Questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **No real customer** — requirements are hypotheses | High | Sprint 1 validation deliverables: interview script, ≥ 3 interviews (freelancers + instructor proxy), revised backlog with confirmed acceptance criteria |
| Thai OCR on scanned/photographed TORs is poor | High | Sprint-1 accuracy benchmark on real TORs; confidence threshold + review queue; never promise full automation |
| No official machine-readable TOR feed; scraping fragile | High | MVP corpus manually seeded via upload/URL; scraping = Could behind adapters; announcement pages treated as an operational chokepoint |
| MVP still too large for one semester | High | Must set = Sprints 1–4 only; Sprint 5 entirely Should/cuttable; enforce at sprint reviews |
| Quality score reads as accusation → defamation risk | Med | Heuristic checklist framing, explainable reasons, "not a legal judgment" label (FR-F2); anomaly ≠ suspicious wording (FR-E2) |
| PII inside TOR documents (names, phones, signatures) | Med | FR-B5 redaction/minimization + takedown workflow |
| PDPA on vendor profiles | Med | Minimal PII, consent, delete/export (FR-D3) |

**Open questions for the team / instructor:**
1. Who is the graded "customer" — instructor as proxy, or a recruited real user group?
2. Is there an official BMA data source available, or is the corpus manually seeded all semester?
3. "Dashboard illustrates the TORs that pass" — pass = passed procurement approval, or passed the
   quality checklist? *(Assumed: status pipeline + checklist score shown together. Verify with
   instructor.)*
4. How should the quality checklist be validated so it is defensible at demo (e.g. hand-score 10
   TORs and compare against the automated scores)?

---

## 11. Team Process

- **Scrum:** 1–2-week sprints, Jira board (epics ≈ FR groups), Discord async standups.
- **Definition of Done:** code reviewed, tests pass, runs in shared Docker Compose, demoable.
- **Immediate next steps:** assign Sprint-1 validation tasks (interviews, TOR corpus collection,
  extraction spike).
