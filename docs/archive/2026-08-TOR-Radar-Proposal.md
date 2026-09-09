> **Superseded — kept for the record.** This is the original course proposal, written when the
> product was scoped to Bangkok (BMA) only. Two things in it are no longer true: the scope is
> national (SRS v2.0 §1.2), and the requirement identifiers were renumbered. Current documents:
> [../SRS.md](../SRS.md) for requirements, [../PROJECT.md](../PROJECT.md) for problem and
> stakeholders, [../ARCHITECTURE.md](../ARCHITECTURE.md) for how it is built. Nothing new should
> cite this file.

# TOR Radar — BMA Procurement Discovery and Transparency Platform

**Project Proposal for Collaborative Software Process and Project Management — 01219346 (450)**

Team Momentum · version 0.1

Prepared by
Sudha SUTASCHUTO ·
Peerapas CHINNAPATPAKDEEKUL ·
Sran JARURANGSRIPATTANAKUL

Department of Software Engineering, Kasetsart University

> Companion documents: [PROJECT.md](PROJECT.md) (delivery-plan source of truth) ·
> [SRS.md](SRS.md) (requirements specification). This proposal and the accompanying slide deck are
> also source documents; where the proposal's FR01–FR20 numbering and PROJECT.md's FR-A…FR-G
> numbering describe the same requirement, SRS.md Appendix C maps them.

---

## Table of Content

1. [Introduction](#introduction)
2. [Client Problem / Challenge](#client-problem--challenge)
3. [Stakeholder](#stakeholder)
4. [User Stories](#user-stories)
5. [Project Scope & Boundaries](#project-scope--boundaries)
6. [Project UI Mockups](#project-ui-mockups)
7. [Our Solution](#our-solution)
8. [Functional Requirements](#functional-requirements)
9. [Timeline & Roadmap](#timeline--roadmap)
10. [Cost Breakdown](#cost-breakdown)
11. [Team & Roles](#team--roles)

---

## Introduction

The Bangkok Metropolitan Administration (BMA) publishes Terms of Reference (ร่างขอบเขตของงาน หรือ TOR) for the projects it procures, and by law those announcements are public. In practice, however, the announcements are spread across the individual websites of bureaus and district offices, each with its own layout and posting rhythm, and the documents themselves arrive as text PDFs, scanned images, or photographs of printed paper. There is no machine-readable feed at the level of document content, which means there is no practical way to search across what Bangkok is buying.

The consequence is uneven access rather than secrecy. Vendors and freelance developers who are perfectly capable of delivering a project often learn about it only after the submission window has closed, because monitoring dozens of announcement pages every day is administrative work that small teams cannot afford. Agencies, in turn, publish correctly and still receive bids from a narrow pool. Citizens and journalists have no consolidated view of spending, and no straightforward way to compare one project's budget against similar ones.

This proposal describes TOR Radar, a Thai-language web platform that ingests publicly announced BMA TORs in whatever format they are published, reads and normalizes them with AI, matches them against vendor skill profiles, notifies matched vendors by email, and publishes the resulting data on a free public dashboard. The platform works entirely from public announcements and therefore requires no cooperation, account, or integration from any agency.

## Client Problem / Challenge

Vendors, freelancers, and the public face several distinct barriers when working with BMA procurement announcements today.

**The Scattered Problem (primary):** TORs are announced on the pages of individual bureaus and district offices rather than in one consolidated place, so discovery means visiting many sites repeatedly and knowing in advance which ones to check.

**The Visibility Problem:** because discovery is manual, qualified vendors miss projects that fit their skills exactly. Nothing today answers the question "which Bangkok TORs match what I can build?"

**The Format Problem:** announcements are published as text PDFs, scanned pages, and photographs. Linking to the original file only moves the reading problem onto the user, and manual summarizing does not scale as the number of tracked agencies grows. This is the reason an automated reading pipeline sits at the centre of the design.

**The Reading Cost Problem:** a reader must work through an entire document to recover a handful of decisive facts: the budget, the submission deadline, the required qualifications, and the contact point. Most of that reading is wasted on projects the reader was never going to bid for.

**The Price Reference Problem:** a vendor without procurement experience has no baseline for judging whether a stated budget is normal for the scope described, and the public has no way of seeing where a figure sits relative to comparable projects.

**The Specification Quality Problem:** TOR quality varies. Some announcements omit a budget, give an implausibly short deadline, or describe scope too vaguely to estimate, and there is no systematic check that flags this before a vendor invests time in preparing a bid.

Underneath all of these sits the engineering challenge that determines whether the platform is possible at all: Thai-language OCR and field extraction from scanned documents. Accuracy cannot be assumed, so it is measured in the first sprint before the rest of the system is built on top of it.

One constraint is stated openly. There is no committed external customer for this platform yet, so every requirement in this document is a hypothesis. The first sprint validates them through interviews and returns a revised backlog before construction begins.

## Stakeholder

| Stakeholder | Role / Relationship | Primary Goals & Motivations | Core Pain Points |
|---|---|---|---|
| Vendors and SME software teams | Primary Users | Find Bangkok IT projects that match their skills early enough to prepare a bid. | Discovery is manual and slow; opportunities are found after closing; long documents must be read before relevance is known. |
| Freelance developers | Primary Users | Find small or subcontracting-scale government work suited to an individual. | No way to filter by realistic project size; no reference point for whether a budget is reasonable. |
| BMA procurement officers | Data Source (not platform users) | Attract a wider and more competitive pool of qualified bidders for published TORs. | Published TORs reach mainly incumbent vendors who monitor the boards daily. |
| Citizens | Secondary Users | See what the city is procuring and at what price, without needing an account. | No consolidated public view of procurement spending. |
| Journalists, watchdogs, researchers | Secondary Users | Find leads in procurement data — unusual pricing, poorly specified projects. | No historical price norms to compare against; no systematic quality signal across TORs. |
| Platform admin | Internal / System Maintainer | Keep ingestion healthy and extraction accurate; keep the taxonomy and agency list consistent. | Announcement pages change format; poor scans lower OCR confidence; misextracted fields reach users. |

## User Stories

### Primary Users: vendors, SME teams, and freelance developers

- As an applicant, I want to create a profile describing my skills, certifications, past projects, and budget range, so that the system can match me to relevant TORs.
- As an applicant, I want to sign up and sign in with email or a Google account, so that I can access the platform without managing another password.
- As an applicant, I want to browse a list of available TORs, so that I know what Bangkok is currently procuring.
- As an applicant, I want each TOR presented as structured data — scope, budget, required qualifications, deadline, and contact — with a link to the original document, so that I do not have to read the full PDF to judge relevance.
- As an applicant, I want to search and filter TORs by agency, budget range, category, and deadline, so that I can narrow the list to projects worth my time.
- As an applicant, I want an email notification when a newly published TOR matches my profile, so that I can start preparing early instead of discovering it late.
- As an applicant, I want to see why a TOR matched me, listing the qualifications that lined up and whether the budget fits my stated range, so that I can judge fit quickly.
- As an applicant, I want to control my notification settings — frequency, minimum match score, and categories — so that alerts stay useful rather than noisy.
- As an applicant, I want to see how a TOR's budget compares with similar past and present projects, so that I can judge whether the stated figure is reasonable for the scope.
- As an applicant, I want to see a specification-quality result for each TOR, so that I can avoid projects that are too poorly defined to estimate.
- As an applicant, I want to see the current status of a TOR (announced, closed, or awarded), so that I do not spend time on a project that is no longer open.
- As an applicant, I want to bookmark TORs and privately mark the ones I pursued, so that I can follow opportunities and keep a personal record of past work.

### Secondary Users: citizens, journalists, watchdogs, and researchers

- As a citizen, I want a public dashboard that requires no login and shows TOR counts and total budget per BMA agency, so that I can see what my city is procuring.
- As a citizen, I want pricing plots in which statistically unusual budgets are highlighted, so that I can see where a figure sits relative to comparable projects.
- As a journalist or researcher, I want to filter the dashboard by agency, period, and category and see totals and trends, so that I can build a picture of spending over time.
- As a journalist or researcher, I want each TOR's specification-quality result with its reasons, so that I can find leads on badly specified procurements.
- As a researcher, I want to export the currently filtered list of TORs as CSV, so that I can analyse the data with my own tools.

### System Maintainer: platform admin

- As an admin, I want to ingest a TOR by uploading a file, submitting a URL, or calling an authenticated API endpoint, so that the corpus can be seeded from public announcements either manually or programmatically.
- As an admin, I want a review queue containing only the very low-confidence or suspicious extractions, shown beside the original document, so that I can correct the worst records first.
- As an admin, I want to manage the skill taxonomy, categories, and the canonical list of BMA agencies, so that matching and the Bangkok-only filter stay consistent.
- As an admin, I want to see extraction confidence per document and correct any field, so that inaccurate data does not reach applicants unnoticed.

## Project Scope & Boundaries

The scope is deliberately bounded so that the platform is achievable within the delivery window and unambiguous for stakeholders.

### In scope

- TORs issued by BMA bureaus and district offices, within Bangkok jurisdiction only. Every ingested record is validated against a canonical list of BMA agencies, and records that do not match are rejected or tagged as out of scope.
- Ingestion of publicly announced TORs by file upload, URL, or an authenticated API endpoint, in PDF, JPG, or PNG form.
- AI reading and normalization of those documents, with manual correction available to admins.
- Vendor skill profiles, match scoring, and email notification with a stated match reason.
- A public dashboard covering per-agency spending, pricing plots with a documented anomaly rule, filtering, and a permanent historical archive.
- A rule-based specification-quality checklist for each TOR.
- A Thai-language user interface.

### Out of scope

- The platform does not assist with the bidding process. It does not draft, prepare, or submit proposals on a user's behalf.
- The platform does not provide legal advice on procurement law or qualification disputes, and its outputs are not legal judgments.
- The platform does not serve agencies as users. There are no agency accounts and no draft-TOR upload portal; agencies are a data source only.
- The platform does not cover provinces or national agencies outside BMA jurisdiction.
- Contract award analysis beyond a coarse status label, payments, contracts, and native mobile applications are excluded from this phase.

In short, the platform exists to improve the visibility and readability of Bangkok TORs. It is a discovery and transparency tool, not a bidding assistant.

## Project UI Mockups

Three wireframes are presented in the accompanying slide deck, and a working demo is delivered at the end of every iteration from Construction C1 onward.

- **Public dashboard:** per-agency spending overview, pricing scatter by category with anomaly points marked, composable filters, and a visible "data last updated" banner with a coverage note.
- **TOR detail page:** structured fields beside a link to the immutable original document, the specification-quality result with its reasons, status history, extraction provenance, and an "unverified extraction" tag where confidence is low.
- **Match notification email:** a short TOR summary, the qualifications that matched, budget fit, days remaining before the deadline, and a link to the detail page.

## Our Solution

We propose a web-based aggregation, matching, and transparency platform built specifically around Bangkok procurement documents and the Thai language.

### Tech stack

- **Frontend:** Next.js
- **Backend:** Node.js with Express
- **Database:** MongoDB Atlas
- **Raw document storage:** MinIO, self-hosted through Docker Compose
- **AI:** Vertex AI (Document AI for Thai OCR, Gemini for field extraction)
- **Notification:** email, via Nodemailer or Resend
- **Infrastructure and process:** Docker Compose, CI on pull requests, Scrum with Jira and Discord

### Core Capabilities

Each capability lists the functional requirements that implement it. See [Functional Requirements](#functional-requirements) for the full specification.

- **Ingestion Engine:** accepts publicly announced TORs by file upload, by URL, or through an authenticated API endpoint. All three routes feed one pipeline, the original file is stored immutably, duplicates resolve to a single record, and every record is checked against the canonical BMA agency list so that coverage stays within Bangkok. → FR01, FR02, FR03, FR04
- **Thai Reading and Normalization:** an OCR and language-model pipeline reads scanned and photographed Thai documents and extracts a consistent set of fields, so that an applicant never needs to open the original file to understand the opportunity. Extracted qualifications are normalized into the shared skill taxonomy used by profiles. → FR05, FR06, FR08
- **Confidence and Review:** every extracted field carries a confidence score. Records publish regardless, but below-threshold records are tagged as unverified and are excluded from anomaly statistics and match notifications until an admin verifies them, so that a reading error cannot produce a false flag or a false match. → FR07, FR15, FR16, FR20
- **Search and Discovery:** applicants browse and filter the normalized catalogue by agency, category, budget range, deadline, and status. → FR09
- **Matching and Notification:** profiles are scored against each newly published TOR, and matched vendors receive an email that states the reason for the match. Frequency, minimum score, and category filters are user-controlled. → FR10, FR11, FR12
- **Public Transparency Dashboard:** a no-login view of TOR counts and budgets per agency over time, with pricing plots and a documented peer-group anomaly rule. Flags are labelled as statistical anomalies, never as accusations, and closed or awarded TORs remain browsable as a historical archive. → FR13, FR14, FR19
- **Specification-Quality Checklist:** a rule-based, explainable check on each TOR — whether a budget is present, whether the deadline is plausible, whether scope and qualifications are specific enough to estimate — reported as a score with its exact reasons and clearly labelled as AI-generated. → FR17
- **Admin Tooling:** a review queue of the worst extractions shown beside the original document, correction and approval, and management of the skill taxonomy and canonical agency list. Corrections are stored and reused as examples to improve the extractor. → FR15, FR16, FR18

## Functional Requirements

Each requirement is atomic and traces back to the capability it implements, noted in brackets.

- **FR01.** The system must accept TOR documents by file upload in PDF, JPG, or PNG format. [Ingestion Engine]
- **FR02.** The system must accept a TOR by URL and through an authenticated REST ingestion endpoint, with all ingestion routes feeding the same processing pipeline. [Ingestion Engine]
- **FR03.** The system must store every original document immutably in object storage and must never delete or overwrite it. [Ingestion Engine]
- **FR04.** The system must match the issuing agency of each record against a canonical list of BMA agencies and district offices, and must reject or tag records outside Bangkok jurisdiction. Duplicate submissions of the same TOR must resolve to a single record. [Ingestion Engine]
- **FR05.** The system must perform optical character recognition optimized for the Thai language on scanned and photographed documents. [Thai Reading and Normalization]
- **FR06.** The system must extract structured fields from each document: title, issuing agency, budget, category, scope summary, required qualifications, submission deadline, contact, and status. [Thai Reading and Normalization]
- **FR07.** The system must record a confidence score for each extracted field and must display an "unverified extraction" tag on records whose confidence falls below the verification threshold. [Confidence and Review]
- **FR08.** The system must normalize extracted qualifications into the shared skill taxonomy used by vendor profiles. [Thai Reading and Normalization]
- **FR09.** The system must allow users to search and filter TORs by agency, category, budget range, deadline, and status, with filters composable. [Search and Discovery]
- **FR10.** The system must allow a user to create and maintain a profile containing skill tags, certifications, past projects, and a budget range, with explicit PDPA consent recorded at signup. [Matching and Notification]
- **FR11.** The system must score each published TOR against vendor profiles on qualification tags, category interests, and budget range, using a configurable match threshold. [Matching and Notification]
- **FR12.** The system must send email notifications to matched vendors, stating the reason for the match, and must allow each user to configure notification frequency, minimum match score, and category filters. [Matching and Notification]
- **FR13.** The system must provide a public dashboard, accessible without login, showing TOR counts and total budget per agency over a selectable date range, together with a "data last updated" timestamp and a coverage note. [Public Transparency Dashboard]
- **FR14.** The system must plot budgets by category and flag statistical outliers using a documented rule that compares only within peer groups of a minimum size, labelling flagged points as statistical anomalies. [Public Transparency Dashboard]
- **FR15.** The system must place very low-confidence or failed-sanity-check records in an admin review queue that shows the original document beside the extracted fields. [Confidence and Review]
- **FR16.** The system must allow an admin to correct any extracted field and approve the record, which clears the unverified tag and permits the record to feed anomaly statistics and matching. Corrections must be stored for reuse as extractor examples. [Admin Tooling]
- **FR17.** The system must produce a rule-based specification-quality score for each TOR together with the exact reasons behind it, labelled as AI-generated and not a legal judgment. [Specification-Quality Checklist]
- **FR18.** The system must allow an admin to manage the skill taxonomy, categories, and the canonical BMA agency list, seeded from configuration files. [Admin Tooling]
- **FR19.** The system must record status transitions for each TOR with a timestamp, source, and actor, and must keep closed and awarded TORs browsable as a historical archive. [Public Transparency Dashboard]
- **FR20.** The system must minimize personal data in displayed extractions and must provide consent, data export, account deletion, and a takedown or correction request workflow. [Confidence and Review]

## Timeline & Roadmap

The project runs over a 12-week window, from 13 August to 5 November, structured as six two-week Scrum sprints tracked on the team's Jira board. The plan front-loads risk: the extraction accuracy benchmark is validated in Sprint 1, before any feature construction begins, and the build reaches feature freeze at the end of Sprint 4 (week 8), leaving Sprints 5 and 6 as a reserve block for hardening, testing, and demo preparation. Every sprint ends in a demo.

- **Sprint 1 — Inception / Elaboration (13–27 Aug).** Validate the backlog through customer and sponsor-proxy interviews; collect a corpus of 10 to 20 real BMA TORs; run the extraction accuracy benchmark and derive both confidence thresholds; stand up the repository, CI, and Docker Compose skeleton; seed the taxonomy and canonical agency list; produce the system architecture and UI/UX wireframes.
- **Sprint 2 — Build Core (27 Aug–10 Sep).** Ingestion by upload, URL, and API; the extraction pipeline with the two-tier confidence policy; the admin review queue; the shared TOR detail page with a source link.
- **Sprint 3 — Dashboard (10–24 Sep).** The public transparency dashboard, pricing plots with the peer-group anomaly rule, and search and filtering across agency, category, budget, and deadline.
- **Sprint 4 — Match + Freeze (24 Sep–8 Oct).** Vendor profiles, authentication and roles, the matching engine, email notifications, and the specification-quality checklist. Feature freeze at the end of this sprint (week 8).
- **Sprint 5 — Harden (8–22 Oct).** Full-stack test pass, performance and security hardening, and bug burn-down; optional items — bookmarks with a personal archive and CSV export — are implemented only if the team is ahead of schedule.
- **Sprint 6 — Demo (22 Oct–5 Nov).** Final demo preparation, documentation, the stakeholder presentation, and schedule buffer.

## Cost Breakdown

Costs fall into two categories. Cash expenditure is small because the application software is open source; the dominant real cost is engineering effort.

### Direct (cash) costs

| Item | Basis | Estimate |
|---|---|---|
| MongoDB Atlas | M0 free tier, 512 MB — sufficient for metadata | THB 0 |
| MinIO, raw document storage | Open source, self-hosted in Docker Compose | THB 0 |
| Vertex AI, Document AI OCR | About US$1.50 per 1,000 pages, Enterprise Document OCR | About US$7.50 for 5,000 pages |
| Vertex AI, Gemini field extraction and checklist assist | Flash tier, per token | Single-digit US$ at about 500 extractions |
| AI development headroom | Benchmark loops and re-runs, three to five times the two AI rows above; covered by a new GCP account's US$300 trial credit where available | About US$30–60 ceiling |
| Email notifications | Nodemailer via SMTP, or Resend free tier | THB 0 at demo volume |
| Hosting, dev and pilot demo | Local Docker Compose | THB 0 |
| Hosting, optional public demo | One small cloud VM, or Cloud Run free tier | About US$5–10 per month if used |
| Domain, optional | — | About US$10 per year if used |
| **Cash total for the phase** | | **About US$0–30; worst case US$50–80** |

Rates should be re-verified against current Google Cloud Document AI and Gemini pricing before any budget is committed.

### Effort (labour) costs

The three-person team has a capacity of approximately 468 person-hours across the 12-week window, at roughly 13 hours per person per week, front-loaded toward the 8-week build and tapering to review and hardening in weeks 9 to 12. The allocation below is planned at that same total; hours are estimates to be refined at each sprint planning and tracked in Jira against actuals.

- **Backend development (20%):** the REST API, ingestion pipeline, matching engine, notification dispatch, and authentication. About 94 hours.
- **Frontend development (17%):** the public dashboard, TOR browsing and detail pages, profile screens, and the admin review queue. About 80 hours.
- **AI integration (12%):** OCR and extraction integration, the accuracy benchmark, and prompt and few-shot tuning. About 56 hours — the heaviest technical risk, not the heaviest hour count.
- **Testing (10%):** unit and integration suites in CI, manual test passes, and bug fixing. About 47 hours.
- **Requirements and data sourcing (8%):** validation interviews, collection of the TOR corpus, and seeding of the canonical agency list. About 37 hours.
- **UI/UX design (8%):** wireframes, Thai interface copy, and design review. About 37 hours.
- **Data analysis (6%):** calibration of the anomaly rule and hand-scored validation of the quality checklist. About 28 hours.
- **Reports and documentation (6%):** milestone reports, technical documentation, and the stakeholder presentation. About 28 hours.
- **Deployment and DevOps (5%):** Docker Compose, CI setup, and demo hosting. About 23 hours.
- **Optimization and polish (4%):** performance work, responsive fixes, and demo hardening. About 19 hours.
- **Maintenance and consultation (4%):** bug triage during the pilot period, sponsor reviews, and Scrum ceremonies. About 19 hours.

For reference, the same 468 hours priced as a commercial engagement would fall between THB 0.56 million and THB 0.70 million at a loaded vendor rate of THB 1,200 to 1,500 per hour, or approximately THB 280,800 valued at a base engineer rate of THB 600 per hour. These rates are stated assumptions rather than market quotations, and the labour cost is internal and non-cash for this phase.

## Team & Roles

### LEAD / PM — Sudha SUTASCHUTO
- **Project leadership:** owns the backlog and the sprint cadence, runs the phase gates, and manages communication with the sponsor.
- **Validation:** runs the Sprint 1 interviews and converts the findings into a revised, confirmed backlog.
- **Feature ownership:** the specification-quality checklist rules and their hand-scored validation against real TORs.

### BACKEND — Peerapas CHINNAPATPAKDEEKUL
- **Thai NLP and AI pipeline:** integrates Vertex AI OCR and configures extraction prompts for budget, qualifications, deadlines, and scope; owns the accuracy benchmark and the confidence thresholds derived from it.
- **Core API:** builds the Express services, the ingestion pipeline, and the deduplication and Bangkok-only validation logic.
- **Feature ownership:** the matching engine, the peer-group anomaly rule, and email notification dispatch.

### FRONTEND — Sran JARURANGSRIPATTANAKUL
- **User interface:** develops the Next.js public dashboard, TOR browsing and detail pages, profile screens, and the admin review queue in Thai.
- **Quality and infrastructure:** maintains Docker Compose parity across development, CI, and pilot, the CI test suites, and MinIO and MongoDB Atlas configuration.
- **Feature ownership:** deployment of the pilot environment, the performance pass against the mobile load target, and the security baseline.

The team works in Scrum with iterations aligned to the phase plan, a Jira board whose epics correspond to requirement groups, and asynchronous standups on Discord. The Definition of Done is that code is reviewed, tests pass, the feature runs in the shared Docker Compose environment, and it can be demonstrated.
