# TOR Radar BKK — BMA TOR Platform

> University group project — Software Design.
> Process: Scrum · Jira · Discord · Docker. Stack: Next.js, Node/Express, MongoDB Atlas, Vertex AI.
> _v2 — revised after internal review; 22 findings addressed._

---

## 1. Problem Statement

Bangkok Metropolitan Administration (BMA) agencies publish
procurement TORs (Terms of Reference) for projects, but they are scattered, hard to discover,
and come in inconsistent formats (PDF text, scanned images, photos behind QR codes). As a result:

- Capable vendors and freelance professionals never see opportunities that match their skills.
- Agencies struggle to reach qualified bidders for their TORs.
- The public has no easy way to see what is being procured, at what price, or spot pricing anomalies.
- TOR quality varies and there is no systematic quality check.

**Vision:** a centralized platform, Bangkok-only scope, that (1) ingests BMA TORs regardless of
format, (2) extracts and normalizes the data with AI, (3) matches TORs to registered vendors by
qualification (LinkedIn-style skill profiles) and notifies them, (4) exposes a public transparency
dashboard with pricing visualizations and statistical-anomaly detection, and (5) runs an AI-assisted
quality checklist on each TOR.

**Two operating modes** (they have different feasibility):
- **Mode A — public TOR matching (MVP):** works from publicly announced TORs alone; no agency
  cooperation needed.
- **Mode B — agency draft-TOR flow (stretch / simulated):** agencies upload *draft* TORs to reach
  qualified vendors early. Real agency adoption is outside the team's control this semester, so this
  mode is built and demonstrated with a simulated agency account.

**Key assumption:** no committed external customer has validated these requirements yet — everything
below is treated as a hypothesis until validated (Sprint 1 has explicit validation deliverables, §7).

---

## 2. Scope

**In scope:** BMA/Bangkok TORs only · ingestion by upload/URL/QR-image · AI extraction with manual
correction · vendor skill profiles + matching + notifications · public dashboard (per-agency view,
pricing plots, statistical anomalies) · AI quality checklist (heuristic, explainable).

**Bangkok-only rule (explicit):** the system keeps a canonical list of BMA agencies and district
offices. Ingested records are matched against it; non-BMA records are rejected or tagged
out-of-scope. (National e-GP data is NOT assumed — it mixes non-Bangkok entities.)

**Out of scope (this semester):** other provinces · bid submission through the platform ·
payments/contracts · contract-award analysis beyond a coarse status label · mobile native apps.

---

## 3. Stakeholder Analysis

### Product stakeholders

| # | Stakeholder | Type | Interest / stake | Power | Interest | Engagement strategy |
|---|-------------|------|------------------|-------|----------|---------------------|
| S1 | Vendors / freelance professionals (developers, contractors) | Primary user | Discover matching opportunities (e.g. a ฿1.5M project fitting their skills); early notice on drafts | Low | High | Core persona — onboarding, skill profiles, notifications |
| S2 | BMA agency procurement officers | Primary user / data source | Publish TORs, reach qualified bidders, reduce failed procurements | High | Medium | They control the data. Near-zero-effort publishing; show value (more qualified bidders) |
| S3 | General public / citizens of Bangkok | User (read-only) | Transparency: what is procured, prices, anomalies | Low–Med (media pressure amplifies) | Medium | Public dashboard, no login |
| S4 | Journalists / anti-corruption watchdogs (e.g. ACT) | Key validation user | Pricing anomalies + quality scores as investigation leads | Low | High | High-impact users for dashboard validation; export/share later |
| S5 | BMA leadership / Governor's office | Sponsor (hypothetical) | Transparency agenda, public trust | High | Medium | The real "customer" if this were deployed; dashboard is their showcase |
| S6 | Data source owners (BMA agency websites/announcement pages) | Supplier / operational chokepoint | These pages are the only Mode-A input; a format change or block halts ingestion | **High (operational)** | Low | Isolate behind adapters; respect ToS; keep manual upload as the always-available fallback |
| S7 | Regulators (Public Procurement Act B.E. 2560, PDPA) | Constraint | Lawful reuse of procurement data; PII in profiles AND inside TOR documents | High | Low | PDPA consent; PII redaction in displayed extractions; takedown/correction workflow |

### Delivery stakeholders (course context — kept separate from product analysis)

| # | Stakeholder | Stake | Strategy |
|---|-----------|-------|----------|
| D1 | Course instructor / TA | Grading against rubric; acts as customer proxy | Deliverables on time; validate assumptions with them |
| D2 | Student development team | Deliver within one semester; apply Scrum | Jira sprints, Discord standups, enforce scope cuts |

**Power/interest summary:** manage closely S2, S5, D1 · keep satisfied S7, S6 (operationally) ·
keep informed S1, S4 · monitor S3.

**Conflict to watch:** anomaly flags and quality scores serve S3/S4/S5 but can embarrass individual
agencies (S2) — the same officers whose data the platform depends on. Frame outputs as "statistical anomaly" and
"specification completeness," never as accusations of wrongdoing.

---

## 4. Personas (brief)

- **P1 — "Nok", freelance full-stack dev.** Skills: Next.js, GIS. Wants gov work but hears about
  TORs after bidding closes. Wants: profile once → relevant TOR notifications.
- **P2 — "Khun Somchai", procurement officer at a BMA district office.** Publishes TORs as scanned
  PDFs. Wants qualified bidders, minimal extra work.
- **P3 — "Ploy", data journalist.** Wants per-agency spending views and anomaly leads.
- **P4 — Admin (platform operator).** Keeps ingestion healthy, corrects bad extractions.

---

## 5. User Stories

Format: As a `<role>`, I want `<capability>` so that `<benefit>`. Acceptance criteria are testable.

### Vendor (S1)
- **US-01** As a vendor, I want to create a profile with my skills, certifications, past projects,
  and budget range, so the system can match me to TORs.
  *Accept: profile CRUD; skills chosen from structured taxonomy; PDPA consent checkbox required.*
- **US-02** As a vendor, I want to be notified (email/Discord/in-app) when a new or draft TOR
  matches my qualifications, so I can prepare early.
  *Accept: notification delivered ≤ 5 min after a TOR is published in the demo environment; message includes match reason.*
- **US-03** As a vendor, I want to see *why* a TOR matched me (which qualifications lined up), so I
  can judge fit fast. *Accept: match detail lists ≥ the top 3 matched skill tags + budget-range fit.*
- **US-04** As a vendor, I want to search/filter TORs by agency, budget range, category, and
  deadline. *Accept: all four filters composable; results < 2 s on seeded corpus.*
- **US-05** As a vendor, I want each TOR shown as clean structured data (scope, budget, required
  qualifications, deadlines, contact) with a link to the original document.
  *Accept: TOR detail page (shared with all roles, see FR-E4) shows all extracted fields + original file.*
- **US-06** As a vendor, I want to see the TOR's quality-checklist result, so I can avoid poorly
  specified projects. *Accept: score + ≥ 3 concrete checklist reasons displayed.*
- **US-07** As a vendor, I want to bookmark TORs and see their coarse status (draft / announced /
  closed / awarded), so I can follow opportunities. *Accept: bookmark list; status history with timestamps.*

### Public / journalist (S3, S4)
- **US-08** As a citizen, I want a public dashboard (no login) showing TORs per BMA agency.
  *Accept: agency list with TOR count + total budget, filterable by date range.*
- **US-09** As a citizen, I want pricing plots with statistical anomalies highlighted.
  *Accept: scatter/box plot of budget grouped by category (and agency); points flagged by the documented anomaly rule (FR-E2); flagged points labeled "statistical anomaly."*
- **US-10** As a journalist, I want to filter the dashboard by agency, period, and category and see
  totals/trends. *Accept: filters compose; totals update; simple trend line per period.*
- **US-11** As a journalist, I want each TOR's quality-checklist score with reasons, so I can find
  leads on badly specified procurements. *Accept: same surface as US-06; score methodology page linked.*

### Agency (S2 — Mode B, demoed with a simulated agency account)
- **US-12** As a procurement officer, I want to submit a TOR by uploading a file or an image
  containing a QR code, so publishing costs me nearly nothing.
  *Accept: upload path works for PDF/JPG/PNG; QR path = upload image → backend decodes URL → fetches linked document.*
- **US-13** As a procurement officer, I want to publish a *draft* TOR to matched vendors, so I get
  interest before finalizing. *Accept: draft flag routes through the same matching+notification pipeline, labeled DRAFT.*
- **US-14** As a procurement officer, I want to see how many matched vendors were notified and how
  many viewed my TOR. *Accept: per-TOR counts of notifications sent and detail-page views (FR-C5).*

### Admin (D2/P4)
- **US-15** As an admin, I want a queue of failed/low-confidence extractions with the original
  document side-by-side, so I can correct fields before they go live.
  *Accept: below-threshold records held unpublished; edit + approve publishes them.*
- **US-16** As an admin, I want to manage the taxonomy (skill tags, categories, canonical BMA agency
  list), so matching and the Bangkok-only filter stay consistent. *Accept: seeded from JSON; editable in UI (stretch).*
- **US-17** As an admin, I want ingestion-source health monitoring, so a silently broken source
  doesn't create a coverage gap. *(Stretch — only relevant once scraping (FR-A-S1) exists.)*

---

## 6. Functional Requirements

Requirements are split **MVP** vs **Stretch** so core scope is not conflated with aspirational work.

### FR-A: TOR Ingestion (MVP)
- **FR-A1** Accept TOR input via file upload (PDF/JPG/PNG) and by URL.
- **FR-A2** QR route: user uploads an image containing a QR code → backend decodes the URL →
  fetches the linked document into the ingestion pipeline.
- **FR-A3** Store the original raw document immutably in object storage (audit trail; never delete
  raw). Metadata in MongoDB; bytes NOT in MongoDB documents.
- **FR-A4** Deduplicate: the same TOR arriving via multiple routes resolves to one record.
- **FR-A5** Bangkok-only validation: match issuing agency against the canonical BMA agency list;
  reject or tag non-BMA records.

### FR-A-S: Ingestion (Stretch)
- **FR-A-S1** Scraping/polling of configured BMA announcement pages, one adapter per source, with
  per-source health status (pairs with US-17). MVP corpus is manually seeded instead.

### FR-B: Extraction & Normalization (MVP)
- **FR-B1** OCR Thai + English from scanned/image documents (Vertex AI Document AI / Gemini vision).
- **FR-B2** Extract structured fields: title, agency, budget (฿), category, scope summary, required
  qualifications, submission deadline, contact, status (coarse labels only: draft / announced /
  closed / awarded).
- **FR-B3** Per-field confidence score. Records below threshold go to the admin review queue
  (FR-G1) — never auto-published. Threshold set empirically AFTER measuring extraction accuracy on
  a 10–20-document benchmark set (see NFR-1); full automation is not promised.
- **FR-B4** Normalize extracted qualifications into the shared skill taxonomy used by profiles.
- **FR-B5** PII handling inside TOR documents: displayed extractions minimize personal data (e.g.
  officer personal phone numbers, signatures); original documents remain available via source link;
  a takedown/correction request workflow exists.

### FR-C: Matching & Notification (MVP)
- **FR-C1** Match engine: score each published TOR against vendor profiles on qualification tags,
  category interests, and budget range; threshold configurable.
- **FR-C2** Notify matched vendors via email + Discord webhook (and in-app inbox) with the match
  explanation. Demo target: delivery ≤ 5 min after publish.
- **FR-C3** Notification preferences: channels, frequency, minimum match score.
- **FR-C4** Draft-TOR routing (Mode B): drafts flow through the same pipeline flagged DRAFT.
- **FR-C5** Delivery analytics: record notifications sent and TOR-detail views per TOR; expose
  counts to the owning agency account (supports US-14).

### FR-D: Profiles & Auth (MVP)
- **FR-D1** Registration/login (email + OAuth). Roles: vendor, agency, admin, anonymous public.
- **FR-D2** Skill profile CRUD with taxonomy tags + free-text portfolio.
- **FR-D3** PDPA: explicit consent at signup, data export, account deletion.

### FR-E: Public Dashboard & Visualization (MVP)
- **FR-E1** Public (no-login) dashboard: TOR counts + total budget per BMA agency over time.
- **FR-E2** Pricing plots with a **documented anomaly rule**: compare budgets only within
  (category × time-window) peer groups; require a minimum peer-group size (e.g. n ≥ 8) before
  flagging; flag = outside 1.5×IQR (or z > 3) of the peer group; label "statistical anomaly," never
  "suspicious." Groups too small to compare are shown unflagged.
- **FR-E3** Filters: agency, category, date range, budget range, status.
- **FR-E4** **Shared TOR detail page** (single feature serving vendors, public, journalists,
  agencies): structured fields + original-document link + quality-checklist result + status history.
- **FR-E5** Status transitions: status changes come from admin action or re-ingestion of an updated
  announcement; each transition records timestamp, source, and actor (supports US-07 history).

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
  list of held records, side-by-side original vs extracted fields, edit + approve.
- **FR-G2** Corrections are stored and reusable as few-shot examples for the extractor.
- **FR-G3** Taxonomy + canonical agency list seeded from JSON files; admin UI to edit = stretch.

### Non-functional
- **NFR-1** Thai OCR/extraction accuracy is the critical path. Sprint 1 deliverable: measure
  field-level accuracy on 10–20 real BMA TORs; set the FR-B3 confidence threshold from that data.
  No fixed accuracy promise until measured.
- **NFR-2** Original documents retained immutably; every displayed record links to its source.
- **NFR-3** Public pages load < 3 s on mobile; responsive.
- **NFR-4** Dockerized (compose) for dev parity; CI runs tests on PR; secrets via env files not
  committed (`.env` in `.gitignore`).
- **NFR-5** PDPA compliance for profile PII AND document PII (FR-B5/FR-D3).
- **NFR-6** All AI outputs explainable and labeled as AI-generated.

---

## 7. Feature Analysis (MoSCoW + impact/effort)

| Feature | Stories | MoSCoW | Impact | Effort | Notes |
|---------|---------|--------|--------|--------|-------|
| TOR upload/URL ingestion + OCR extraction | US-05, US-12 | **Must** | High | High | Foundation. Vertex AI heavy lifting; benchmark accuracy first (NFR-1) |
| Minimal admin review/correction queue | US-15 | **Must** | Med | Med | Ships WITH ingestion (Sprint 2) — OCR errors are expected; without review, incorrect data would be published |
| Shared TOR detail page + search/filter | US-04, US-05 | **Must** | High | Med | First visible value; one page serves all roles |
| Public dashboard: per-agency view + pricing plots + anomaly rule | US-08–US-10 | **Must** | High | Med | High demonstration value; core transparency mission; anomaly rule per FR-E2 |
| Vendor skill profiles | US-01 | **Must** | High | Med | Prereq for matching |
| Matching engine + notifications (email/Discord) | US-02, US-03 | **Must** | High | Med–High | Core differentiator ("LinkedIn for TORs") |
| AI quality checklist (heuristic) | US-06, US-11 | **Should** | High | Med | Differentiator; heuristic + explainable, after extraction is solid |
| Draft-TOR flow (Mode B, simulated agency) | US-13 | **Should** | Med | Low–Med | Same pipeline + DRAFT flag; real agency adoption outside project control |
| QR-image ingestion route | US-12 | **Should** | Med | Low | Thin layer over URL ingestion |
| Bookmarks + status tracking | US-07 | **Could** | Med | Low | Needs FR-E5 status transitions |
| Agency reach analytics | US-14 | **Could** | Low | Low | FR-C5 counters; cheap once notifications exist |
| Automated scraping + source health | US-17 | **Could** | Med | High | High maintenance cost from source-format changes; corpus manually seeded for MVP |
| Taxonomy admin UI | US-16 | **Could** | Low | Low | JSON seed files first |
| Bid submission / award analysis | — | **Won't (this semester)** | — | — | Coarse status labels only |

**Sprint plan (Must-first; each sprint demoable):**
1. **Sprint 1:** requirement validation (interview 2–3 real freelancers + instructor-as-customer;
   revised backlog = graded deliverable) · collect 10–20 real BMA TORs · extraction spike +
   accuracy benchmark (NFR-1) · repo/CI/Docker skeleton.
2. **Sprint 2:** ingestion (upload/URL) → extraction → **minimal review queue** → published
   structured TORs + shared detail page.
3. **Sprint 3:** public dashboard (agency view, pricing plots, FR-E2 anomaly rule) + search/filter.
4. **Sprint 4:** profiles + matching + notifications (email/Discord).
5. **Sprint 5:** quality checklist + draft-TOR mode (simulated agency) + QR route + polish/demo.
   *(Everything in Sprint 5 is Should — cuttable without breaking the product.)*

---

## 8. Tech Stack Mapping

| Layer | Choice | Used for |
|-------|--------|----------|
| Frontend | Next.js | Dashboard (public), TOR browse/detail, profile UI, admin queue |
| API | Node.js + Express | REST API, matching engine, notification dispatch |
| DB | MongoDB Atlas | TOR metadata/extracted fields (flexible schema fits inconsistent TORs), profiles, match records; Atlas Search for text search |
| Raw document storage | Object storage (GCS bucket; local Docker volume for class demo) | Original PDFs/images — NOT stored as Mongo documents |
| AI | Vertex AI (Document AI / Gemini) | Thai OCR, field extraction, qualification normalization, checklist assist |
| Notifications | Discord webhook + email (Nodemailer/Resend) | Match alerts, draft-TOR notices |
| Infra | Docker Compose; deploy target = one small VM or Cloud Run (decide Sprint 1); secrets via env vars | Dev parity + demo hosting |
| Process | Scrum, Jira (epics ≈ FR groups), Discord | Sprints, board, comms |

---

## 9. Risks & Open Questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **No real customer** — requirements are hypotheses | High | Sprint 1 validation deliverables: interview script, ≥ 3 interviews (freelancers + instructor proxy), revised backlog with confirmed acceptance criteria |
| Thai OCR on scanned/photographed TORs is poor | High | Sprint-1 accuracy benchmark on real TORs; confidence threshold + review queue; never promise full automation |
| No official machine-readable TOR feed; scraping fragile | High | MVP corpus manually seeded via upload/URL; scraping = Could behind adapters; S6 treated as operational chokepoint |
| MVP still too large for one semester | High | Must set = Sprints 1–4 only; Sprint 5 entirely Should/cuttable; enforce at sprint reviews |
| Agency cooperation (drafts, QR) never materializes | Med | Mode B demoed with simulated agency account; platform fully functional in Mode A |
| Quality score reads as accusation → defamation risk | Med | Heuristic checklist framing, explainable reasons, "not a legal judgment" label (FR-F2); anomaly ≠ suspicious wording (FR-E2) |
| PII inside TOR documents (names, phones, signatures) | Med | FR-B5 redaction/minimization + takedown workflow |
| PDPA on vendor profiles | Med | Minimal PII, consent, delete/export (FR-D3) |

**Open questions for the team / instructor:**
1. Who is the graded "customer" — instructor as proxy, or a recruited real user group?
2. Is there an official BMA data source available, or is the corpus manually seeded all semester?
3. "Dashboard illustrates the TORs that pass" — pass = announced (vs draft), passed procurement
   approval, or passed the quality checklist? *(Assumed: status pipeline + checklist score shown
   together. Verify with instructor.)*
4. How should the quality checklist be validated so it is defensible at demo (e.g. hand-score 10
   TORs and compare against the automated scores)?

---

## 10. Team Process

- **Scrum:** 1–2-week sprints, Jira board (epics ≈ FR groups), Discord async standups.
- **Definition of Done:** code reviewed, tests pass, runs in shared Docker Compose, demoable.
- **Immediate next steps:** assign Sprint-1 validation tasks (interviews, TOR corpus collection,
  extraction spike).
