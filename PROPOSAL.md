# TOR Radar — Project Proposal

> Team Momentum · Phase-1 delivery proposal
> Source of truth for scope and requirements: [PROJECT.md](PROJECT.md)
> Status: proposal — requirements are hypotheses until the Sprint-1 validation gate (§5.3)

---

## 1. Intro

Bangkok Metropolitan Administration (BMA) agencies publish procurement TORs (Terms of Reference) for public projects, but the documents are scattered across agency announcement pages and arrive in inconsistent formats — text PDFs, scanned images, photographs. There is no machine-readable feed at the document-content level.

**TOR Radar** is a centralized, Thai-language platform that:

1. **Ingests** publicly announced BMA TORs regardless of format,
2. **Extracts and normalizes** their content with AI (Thai OCR + structured field extraction),
3. **Matches** TORs to registered vendors by qualification and preference, and **notifies them by email**,
4. **Publishes a free public transparency dashboard** with per-agency spending views, pricing plots, and statistical-anomaly detection,
5. **Scores each TOR** with an explainable specification-quality checklist.

**Purpose in one sentence:** give vendors and the public easier access to Bangkok TORs, with skill-based filtering, matching, and email notification — working entirely from public announcements, requiring no agency cooperation.

## 2. Client Problem / Challenge

Because TORs are scattered and unreadable at scale, four groups lose:

| Who | The problem today |
|---|---|
| Vendors / freelance professionals | Never see opportunities that match their skills — e.g. a ฿1.5M project fitting their exact stack — or see them after the window has closed |
| BMA agencies (data source) | Struggle to reach qualified bidders for published TORs |
| The public | No easy view of what is being procured, at what price, or where pricing looks unusual |
| Journalists / watchdogs / researchers | No systematic way to find leads in procurement data |

The technical challenge underneath: **Thai-language OCR and field extraction from scanned documents is the critical path.** Accuracy is unknown until measured — which is why Sprint 1 is a measurement and validation sprint, not a feature sprint (§5.3).

An honest constraint, stated up front: there is **no committed customer yet**. Every requirement is a hypothesis, and the plan budgets for validating them before building on top.

## 3. Our Solution

Phase-1 scope, committed in [PROJECT.md](PROJECT.md):

| Capability | What it does |
|---|---|
| Ingestion (upload / URL / API) | Any format (PDF/JPG/PNG); raw originals stored immutably in MinIO; every record validated against the canonical BMA agency list — Bangkok only |
| AI extraction | Thai OCR + structured fields: budget, category, scope, required qualifications, deadline, contact, status. Two-tier confidence policy: everything publishes; below-threshold records carry a visible **"unverified extraction"** tag, and only very-low/suspicious ones route to the admin review queue. Unverified fields never feed anomaly statistics or match notifications |
| Matching + email notification | Vendor skill profiles + preferences → scored matches with the match reason stated; delivery target ≤ 5 min in the pilot environment; frequency and threshold configurable |
| Public dashboard (Thai UI, no login) | Per-agency TOR counts and budgets, pricing plots with a documented peer-group anomaly rule (flags labeled "statistical anomaly" — never an accusation), full filtering, and a permanent historical archive |
| Quality checklist | Rule-based, explainable specification-quality score per TOR — labeled AI-generated, never a legal judgment |
| Admin tooling | Review queue shipping in Sprint 2 alongside extraction; corrections stored and reused as few-shot examples to improve the extractor |

Trust and safety are requirements, not afterthoughts: PDPA-aligned handling (consent, PII minimization, export/delete, takedown workflow), every displayed record linked to its immutable source document, extraction provenance shown per record ("extracted \<date> by \<model>"), and a dashboard-wide "data last updated" timestamp with a coverage note — the platform never implies its corpus is complete or live.

**Why this stack:** Next.js (frontend) · Node/Express (REST API) · MongoDB Atlas (extracted metadata — flexible schema fits inconsistent TORs) · MinIO (immutable raw documents) · Vertex AI (Thai OCR / Gemini extraction) · Docker Compose + CI.

## 4. Demo or UI Mockups

Wireframes (rendered in the slide deck; a working demo ships at the end of every sprint from Sprint 2):

1. **Public dashboard** — agency spending overview, category pricing scatter with anomaly flags, composable filters, "data last updated" banner.
2. **TOR detail page** — structured fields beside the link to the immutable original, quality-checklist score with reasons, status history, extraction provenance, unverified tag where applicable.
3. **Match notification email** — TOR summary, which qualifications matched and why, budget fit, deadline, link to detail.

## 5. Timeline & Roadmap

### 5.1 Phase-1 delivery — 15 weeks, 5 sprints (Scrum · Jira · sprint-end demos)

| Sprint | Weeks | Delivers |
|---|---|---|
| 1 — Validate | 1–3 | ≥3 customer-proxy interviews with revised backlog (phase-gate deliverable) · 10–20 real BMA TOR corpus · extraction accuracy benchmark → sets both confidence thresholds · repo/CI/Docker skeleton |
| 2 — Ingest & extract | 4–6 | Ingestion (upload/URL/API) → extraction → review queue → published structured TORs + shared detail page |
| 3 — Show | 7–9 | Public dashboard: agency views, pricing plots, anomaly rule, search/filter |
| 4 — Match | 10–12 | Vendor profiles, matching engine, email notifications |
| 5 — Polish | 13–15 | Quality checklist, bookmarks + personal archive, pilot hardening, final demo — *entirely cuttable without breaking the product* |

Must-set = Sprints 1–4. Sprint 5 is the scope release valve, enforced at every sprint review.

**Process model — iterative + sequential:** Scrum sprints are the iterations; RUP-style phases sit
on top with a gate at each phase end — **Inception** (S1: requirements/validation) → **Elaboration**
(S1–S2: prove the riskiest piece, the Thai OCR pipeline) → **Construction** (S2–S4: demoable
increment every sprint) → **Transition** (S5: hardening + pilot). Discipline effort shifts per
phase; the §7.2 effort budget is partitioned accordingly and compared against Jira actuals at every
gate, so cost overrun is visible weeks early and the sponsor always knows which phase the project
is in and what the gate deliverable is.

### 5.2 Validation gate (Sprint 1 — go/no-go)

- **Extraction benchmark:** field-level accuracy measured on 10–20 real BMA TORs. No accuracy is promised before this measurement; both confidence thresholds derive from it. **This is the critical path — if extraction quality is insufficient, the plan changes before further build.**
- **Demand interviews:** ≥3 interviews (real freelancers + sponsor as customer proxy) producing a revised, confirmed backlog.

### 5.3 Roadmap beyond Phase 1
Automated source scraping behind per-source adapters · taxonomy admin UI · draft-TOR consultation tracking · expansion beyond Bangkok. Sequenced strictly after the pilot validates extraction quality and demand.

## 6. Team & Roles

Five-person delivery team; roles denote accountability — everyone ships code.

| Role | Owns | Member |
|---|---|---|
| Project lead / Scrum master | Backlog, sprint cadence, sponsor communication | _[name]_ |
| Backend & AI engineer | Express API, ingestion pipeline, Vertex AI extraction, accuracy benchmark | _[name]_ |
| Frontend engineer | Next.js dashboard, TOR browse/detail, Thai UI | _[name]_ |
| Data & matching engineer | Matching engine, anomaly rule, quality checklist, taxonomy | _[name]_ |
| QA / DevOps engineer | CI, Docker Compose, MinIO/Atlas, test coverage, deployment | _[name]_ |

Process: 3-week sprints · Jira (epics ≈ requirement groups) · Discord standups · Definition of Done = reviewed, tests pass, runs in shared Docker Compose, demoable.

## 7. Cost Breakdown

### 7.1 Direct (cash) costs — Phase 1

All application software is open source; cash exposure is AI usage plus optional hosting.

| Item | Basis | Estimate |
|---|---|---|
| MongoDB Atlas (M0 free tier) · MinIO (self-hosted in Compose) · email free tier · local demo hosting | Free tiers | ฿0 |
| Vertex AI — OCR + extraction | ~500 docs × ~10 pages @ ~US$1.50/1k pages + Gemini tokens | ~US$10–15 |
| AI development headroom (benchmark re-runs, 3–5×) | | ≤ ~US$60 — covered by a GCP US$300 trial credit where available |
| Optional public demo VM + domain | | ~US$5–10/month |
| **Cash total, Phase 1** | | **~US$0–30; worst case ~US$80** |

*(Re-verify provider pricing before budgeting; rates change.)*

### 7.2 Effort (labor) — the dominant real cost

Capacity: **5 people × ~10 h/week × 15 weeks ≈ 750 person-hours.** Allocation totals ~790 h — deliberately over-subscribed so scope pressure is visible up front; Sprint-5 items are the release valve.

| Activity | Hours | Share |
|---|---:|---:|
| Backend development (API, ingestion, matching, notifications, auth) | ~160 | 21% |
| Frontend development (dashboard, browse/detail, profiles, admin) | ~135 | 18% |
| AI integration (extraction, benchmark, prompt/few-shot tuning) | ~100 | 13% |
| Testing (CI suites, manual passes, bug fixing) | ~80 | 11% |
| Requirements & data sourcing (interviews, TOR corpus, agency list) | ~60 | 8% |
| UI/UX design (wireframes, Thai UI copy) | ~60 | 8% |
| Reports & documentation (milestones, technical docs, presentation) | ~50 | 7% |
| Data analysis (anomaly calibration, checklist validation) | ~45 | 6% |
| Deployment & DevOps (Compose, CI, pilot hosting) | ~40 | 5% |
| Optimization & polish · maintenance & sponsor reviews | ~60 | 8% |

### 7.3 Commercial value of the scope

Two views of the same 790 hours (rates are stated assumptions, not market quotes):

- **Internal cost view:** 790 h × ฿600/h base engineer rate ≈ **฿474,000**.
- **Commercial contract view:** priced as a vendor fixed-price engagement at a loaded billing rate (overhead, project management, QA, risk buffer, warranty, margin — typically 1.7–2.5× base): 790 h × ฿1,200–1,500 ≈ **฿0.95M–1.2M**. This scope is plausibly a **~฿1M contract** at Bangkok-market vendor pricing.

Labor is an internal, non-cash cost in Phase 1; the figures represent its commercial value.

---

*All figures are planning estimates. Requirements remain hypotheses until the Sprint-1 validation gate; the accuracy benchmark (NFR-1) precedes any accuracy commitment.*
