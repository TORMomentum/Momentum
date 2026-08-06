# BMA TOR Platform (working name: "TOR Radar BKK")

> University group project — Software Design, Year 2 Semester 2.
> Process: Scrum · Jira · Discord · Docker. Stack: Next.js, Node/Express, MongoDB Atlas, Vertex AI.
> ⚠ Team task: **print the project evaluation form and bring it to class Thursday.**

---

## 1. Problem Statement

Bangkok Metropolitan Administration (BMA — all agencies under Governor Chadchart) publishes
procurement TORs (Terms of Reference) for projects, but they are scattered, hard to discover,
and come in inconsistent formats (PDF text, scanned images, photos behind QR codes). As a result:

- Capable vendors/freelancers/programmers never see opportunities that match their skills.
- Agencies struggle to reach the right people, so they can't "hire the right person."
- The public has no easy way to see what is being procured, at what price, or spot pricing outliers.
- TOR quality/transparency varies and there is no systematic audit.

**Vision:** a centralized platform, Bangkok-only scope, that (1) ingests every BMA TOR regardless of
format, (2) extracts and normalizes the data with AI, (3) matches TORs to registered users by
qualification (LinkedIn-style skill profiles) and notifies them, (4) exposes a public transparency
dashboard with pricing visualizations and outlier detection, and (5) uses AI to audit each TOR for
quality and transparency.

**Known unknown:** there is *no real customer with a clear picture of what they want* — requirements
here are derived from a rough brief and must be validated (see §9 Risks).

---

## 2. Scope

**In scope (MVP-ish):** BMA/Bangkok TORs only · TOR ingestion (PDF/image/QR) · AI extraction ·
skill-profile matching + notifications · public dashboard (pricing plots, outliers, per-agency view) ·
AI TOR quality/transparency score.

**Out of scope (for now):** other provinces/national e-GP coverage · bid submission through the
platform · payments/contracts · mobile native apps.

---

## 3. Stakeholder Analysis

| # | Stakeholder | Type | Interest / stake | Power | Interest | Engagement strategy |
|---|-------------|------|------------------|-------|----------|---------------------|
| S1 | Vendors / freelancers / programmers (job seekers) | Primary user | Find matching project opportunities (e.g. a ฿1.5M project fitting their skills); get notified early, incl. draft TORs | Low | High | Core persona — design for them; onboarding, skill profiles, notifications |
| S2 | BMA agency procurement officers (each agency/district office under BMA) | Primary user / data source | Publish TORs, reach qualified bidders, reduce failed procurements | High | Medium | They control the data. Make publishing/QR flow near-zero effort; show value (more qualified bidders) |
| S3 | General public / citizens of Bangkok | Primary user (read-only) | Transparency: what is procured, prices, outliers | Low | Medium | Public dashboard, no login required |
| S4 | Journalists / anti-corruption watchdogs (e.g. ACT) | Secondary user | Audit trail, pricing outliers, TOR quality scores as leads | Low | High | Export/share features later; they amplify the platform |
| S5 | BMA leadership / Governor's office | Sponsor (hypothetical) | Transparency agenda, public trust, better procurement outcomes | High | Medium | Would be the real "customer" — dashboard is their showcase; needs buy-in for data access |
| S6 | Course instructor / TA | Evaluator | Grading against course rubric (evaluation form) | High | High | Deliverables on time; bring evaluation form Thursday |
| S7 | Student team (us) | Builder | Ship a working system within one semester; learn Scrum | Medium | High | Jira sprints, Discord comms, honest scope cuts |
| S8 | Data source owners (BMA websites, gprocurement.go.th e-GP) | Supplier | Their sites get scraped/linked; format churn breaks ingestion | Medium | Low | Respect robots/ToS; prefer official feeds; isolate scrapers behind adapters |
| S9 | Regulators (Public Procurement Act B.E. 2560, PDPA) | Constraint | Legal use of procurement data; PII in user profiles must comply with PDPA | High | Low | PDPA consent on signup; store minimum PII; procurement data is public record |

**Power/interest summary:** Manage closely: S2, S5, S6. Keep satisfied: S9. Keep informed: S1, S4, S7. Monitor: S3, S8.

**Conflict to watch:** transparency features (outlier flags, quality scores) serve S3/S4/S5 but can
embarrass individual agencies (S2) — the same officers whose cooperation we need for data. Frame
scores constructively (improvement hints, not accusations).

---

## 4. Personas (brief)

- **P1 — "Nok", freelance full-stack dev.** Has skills (Next.js, GIS), wants gov work but never
  hears about TORs until bidding closed. Wants: profile once → relevant TOR notifications.
- **P2 — "Khun Somchai", procurement officer at a BMA district office.** Publishes TORs as scanned
  PDFs. Wants qualified bidders, minimal extra work.
- **P3 — "Ploy", data journalist.** Wants per-agency spending views and price outliers.
- **P4 — Admin (our team).** Keeps ingestion healthy, fixes bad extractions.

---

## 5. User Stories

Format: As a `<role>`, I want `<capability>` so that `<benefit>`. (MoSCoW tag in §7.)

### Job seeker (S1)
- **US-01** As a job seeker, I want to create a profile listing my skills, certifications, past
  projects, and budget range, so that the system can match me to TORs. *(Accept: profile CRUD, skills as structured tags, PDPA consent.)*
- **US-02** As a job seeker, I want to be notified (email/Discord/in-app) when a new or draft TOR
  matches my qualifications, so that I can prepare a bid early. *(Accept: notification within X min of ingestion; match reason shown.)*
- **US-03** As a job seeker, I want to see *why* a TOR matched me (which qualifications lined up),
  so that I can judge fit fast.
- **US-04** As a job seeker, I want to search/filter TORs by agency, budget range, category, and
  deadline, so that I can browse beyond my matches.
- **US-05** As a job seeker, I want each TOR shown as clean structured data (scope, budget,
  required qualifications, deadlines, contact) with a link to the original document, so that I don't
  have to decode a scanned PDF myself.
- **US-06** As a job seeker, I want to see the AI quality/transparency score of a TOR, so that I can
  avoid poorly specified or risky projects.
- **US-07** As a job seeker, I want to save/bookmark TORs and track their status (draft → announced
  → awarded), so that I can follow opportunities over time.

### Public / journalist (S3, S4)
- **US-08** As a citizen, I want a public dashboard (no login) showing TORs per BMA agency, so that
  I can see what my city is buying.
- **US-09** As a citizen, I want pricing plots (budget distribution per category/agency) with
  outliers highlighted, so that suspicious pricing is visible at a glance.
- **US-10** As a journalist, I want to filter the dashboard by agency, time period, and category and
  see totals/trends, so that I can investigate spending patterns.
- **US-11** As a journalist, I want each TOR's transparency/quality audit score with the reasons,
  so that I can find leads on badly specified procurements.

### Agency (S2)
- **US-12** As a procurement officer, I want to submit a TOR by scanning/uploading (or via QR code
  on the printed announcement), so that publishing to the platform costs me nearly nothing.
- **US-13** As a procurement officer, I want to announce a *draft* TOR to relevant registered
  vendors, so that I get feedback/interest before finalizing and can hire the right person.
- **US-14** As a procurement officer, I want to see how many qualified users viewed/matched my TOR,
  so that I can gauge reach.

### Admin (S7/P4)
- **US-15** As an admin, I want an ingestion queue showing failed/low-confidence extractions, so
  that I can correct them manually before they go live.
- **US-16** As an admin, I want to manage taxonomy (skill tags, categories, agency list), so that
  matching stays consistent.
- **US-17** As an admin, I want ingestion-source health monitoring, so that a silently broken
  scraper doesn't create a coverage gap.

---

## 6. Functional Requirements

### FR-A: TOR Ingestion
- **FR-A1** Accept TOR input via: file upload (PDF/JPG/PNG), URL, and QR-code resolution (QR on
  printed announcements → fetch target document).
- **FR-A2** Support scraping/polling of configured BMA announcement pages (adapter per source;
  sources are pluggable because formats differ per agency).
- **FR-A3** Store the original raw document immutably (audit trail; never delete raw).
- **FR-A4** Deduplicate: the same TOR arriving via multiple routes must resolve to one record.

### FR-B: Extraction & Normalization (AI)
- **FR-B1** OCR Thai + English text from scanned/image documents (Vertex AI Document AI / Gemini
  vision).
- **FR-B2** Extract structured fields: title, agency, budget (฿), category, scope summary, required
  qualifications, submission deadline, contact, status (draft/announced/awarded).
- **FR-B3** Attach a per-field confidence score; records below threshold go to the admin review
  queue (FR-G2) instead of auto-publishing.
- **FR-B4** Normalize qualifications into the shared skill taxonomy used by user profiles.

### FR-C: Matching & Notification
- **FR-C1** Match engine: score each new TOR against every user profile on qualifications, category
  interests, and budget range; configurable threshold.
- **FR-C2** Notify matched users via email and Discord (and in-app inbox) with the match
  explanation.
- **FR-C3** Users can tune notification preferences (channels, frequency, minimum match score).
- **FR-C4** Draft-TOR early notice: drafts are flagged and routed to matched users before final
  announcement.

### FR-D: Profiles & Auth
- **FR-D1** User registration/login (email + OAuth); roles: job seeker, agency, admin, public
  (anonymous read).
- **FR-D2** Skill profile CRUD with structured tags (from taxonomy) + free-text portfolio.
- **FR-D3** PDPA: explicit consent at signup, data export, account deletion.

### FR-E: Public Dashboard & Visualization
- **FR-E1** Public (no-login) dashboard: TOR counts and total budget per BMA agency, over time.
- **FR-E2** Pricing plots: budget distribution per category/agency (scatter/box), with statistical
  outliers highlighted.
- **FR-E3** Filters: agency, category, date range, budget range, status.
- **FR-E4** TOR detail page: structured fields + original document link + audit score + status
  history.

### FR-F: AI TOR Audit
- **FR-F1** Score each TOR on quality/transparency: completeness of spec, clarity of qualifications
  (are they justified or vendor-locking?), budget plausibility vs comparable TORs, timeline
  reasonableness.
- **FR-F2** Publish score + machine-generated reasons on the TOR page; label clearly as
  AI-generated assessment, not an accusation.
- **FR-F3** Flag anomalies (e.g. budget far outside category norm) for the dashboard outlier view.

### FR-G: Admin
- **FR-G1** Source management: add/remove/monitor ingestion sources; health status per source.
- **FR-G2** Review queue for low-confidence extractions with side-by-side original vs extracted
  fields; corrections feed back as few-shot examples.
- **FR-G3** Taxonomy management (skills, categories, agencies).

### Non-functional (short)
- **NFR-1** Thai-language OCR accuracy is the pipeline's critical path — measure it; target ≥90%
  field-level accuracy on the review set before auto-publish.
- **NFR-2** Original documents retained immutably (transparency/audit).
- **NFR-3** Dashboard public pages load < 3s on mobile; responsive.
- **NFR-4** Dockerized services; reproducible dev env; CI runs tests on PR.
- **NFR-5** PDPA compliance for all PII (profiles); procurement docs are public record.
- **NFR-6** AI audit outputs must be explainable (reasons listed) and clearly labeled as AI opinion.

---

## 7. Feature Analysis (MoSCoW + impact/effort)

| Feature | Stories | MoSCoW | Impact | Effort | Notes |
|---------|---------|--------|--------|--------|-------|
| TOR upload + OCR extraction (PDF/image) | US-05, US-12 | **Must** | High | High | The foundation; nothing works without structured TOR data. Vertex AI does the heavy lifting |
| Structured TOR listing + search/filter | US-04, US-05 | **Must** | High | Med | First visible value even before matching |
| Public dashboard w/ per-agency view + pricing plots + outliers | US-08–US-10 | **Must** | High | Med | The demo-day wow + the transparency mission |
| Skill profiles | US-01 | **Must** | High | Med | Prereq for matching |
| Matching engine + notifications (email/Discord) | US-02, US-03 | **Must** | High | Med–High | The core differentiator ("LinkedIn for TORs") |
| Admin review queue for low-confidence extraction | US-15 | **Must** | Med | Med | Realistically OCR will fail; without this, garbage goes live |
| AI TOR quality/transparency audit score | US-06, US-11 | **Should** | High | Med | Strong differentiator but subjective — ship after extraction is solid |
| Draft-TOR early notification flow | US-13 | **Should** | Med | Med | Needs agency cooperation — riskiest external dependency |
| QR-code ingestion route | US-12 | **Should** | Med | Low | Thin layer over upload-by-URL; cheap once upload exists |
| Bookmark/track TOR status | US-07 | **Could** | Med | Low | Nice retention feature |
| Agency reach analytics | US-14 | **Could** | Low | Low | Only matters once agencies actually use it |
| Automated multi-source scraping | US-17, FR-A2 | **Could** | Med | High | Start with manual/URL ingestion; scraping per-agency is a format-churn tarpit |
| Taxonomy admin UI | US-16 | **Could** | Low | Low | Seed taxonomy from a JSON file first |
| Bid submission / awarded-contract tracking beyond status | — | **Won't (this semester)** | — | — | Out of scope |

**MVP cut (sprint-sized):**
1. **Sprint 1–2:** ingestion (upload + URL) → Vertex AI extraction → structured TOR list + detail page.
2. **Sprint 3:** public dashboard (agency view, pricing plots, outliers).
3. **Sprint 4:** profiles + matching + notifications.
4. **Sprint 5:** AI audit score + admin review queue + polish/demo.

---

## 8. Tech Stack Mapping

| Layer | Choice | Used for |
|-------|--------|----------|
| Frontend | Next.js | Dashboard (public), TOR browse/search, profile UI, admin queue |
| API | Node.js + Express | REST API, matching engine, notification dispatch |
| DB | MongoDB Atlas | TOR documents (flexible schema fits inconsistent TOR fields), profiles, match records; Atlas Search for text search |
| AI | Vertex AI (Document AI / Gemini) | OCR (Thai), field extraction, qualification normalization, TOR audit scoring |
| Notifications | Discord webhook + email (e.g. Resend/Nodemailer) | Match alerts, draft-TOR notices |
| Infra | Docker (compose) | Local dev parity + deploy |
| Process | Scrum, Jira, Discord | Sprints, board, team comms |

---

## 9. Risks & Open Questions

| Risk | Severity | Mitigation |
|------|----------|------------|
| **No real customer** — requirements are guesses | High | Treat §5–§7 as hypotheses; interview 2–3 real freelancers + (if possible) one BMA officer in sprint 1; adjust backlog |
| Thai OCR on scanned/photographed TORs is bad | High | Measure early on 10–20 real TOR PDFs; confidence threshold + admin review queue (FR-B3/G2); don't promise full automation |
| No official machine-readable TOR feed; scraping fragile/ToS-unclear | High | MVP ingests by upload/URL (manual seed corpus); scraping is a "Could" behind adapters |
| Agency cooperation (draft TORs, QR flow) may never materialize | Med | Draft-flow demoted to Should; platform works read-only from public announcements |
| AI audit score could defame an agency ("corrupt!") | Med | Score = "specification quality," explainable reasons, clear AI-opinion label (FR-F2) |
| PDPA on user profiles | Med | Minimal PII, consent, delete/export (FR-D3) |
| Scope too big for one semester | High | MoSCoW enforced; Musts only ≈ sprints 1–4; everything else cuttable |

**Open questions for the team / instructor:**
1. Who is the graded "customer" — instructor as proxy, or do we find a real user group?
2. Is there any official BMA/e-GP data source we're allowed to pull from, or is the corpus manually seeded?
3. Does "pass" in "dashboard illustrates the TOR that pass" mean *awarded* TORs, TORs passing the AI audit, or TORs passing procurement approval? (Assumed: status pipeline draft→announced→awarded + audit score. Verify.)
4. How is the audit score validated so it's defensible in the demo?

---

## 10. Team Process

- **Scrum:** 1–2 week sprints, Jira board (Epics ≈ FR groups above), Discord for daily async standup.
- **Definition of Done:** code reviewed, tests pass, deployed to shared Docker env, demoable.
- **This week:** print the project evaluation form → bring to Thursday class. Validate open questions §9 with instructor.
