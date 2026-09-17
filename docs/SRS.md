# Software Requirements Specification — TOR Radar

**Team Momentum**
**Version 2.0**

## Table of contents

1. [Introduction](#1-introduction)
2. [Product Overview](#2-product-overview)
3. [External Interface Requirements](#3-external-interface-requirements)
4. [Functional Requirements](#4-functional-requirements)
5. [Nonfunctional Requirements](#5-nonfunctional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Traceability](#7-traceability)
8. [Open Issues](#8-open-issues)
- [Appendix A: Glossary](#appendix-a-glossary)
- [Appendix B: Initial TOR Sources](#appendix-b-initial-tor-sources)
- [Appendix C: Document History](#appendix-c-document-history)

---

# 1. Introduction

## 1.1 Stakeholders

Who has a stake in TOR Radar. §2.4 states which features each access level reaches.

| Class | Characteristics | Served by |
| :---- | :---- | :---- |
| Vendor / freelance professional | Builds a skill profile; consumes matches and search; technical literacy varies | F5, F6 |
| Public user | Occasional dashboard reader; no training assumed | F7 |
| Journalist / researcher / watchdog | Power user of filters, anomaly data, and optional CSV export | F7, F11 |
| Admin | Monitors intake, corrects extractions, and manages the taxonomy | F1, F3, F9, F12 |
| Procurement officer | Not a platform user; published documents are system input, while public views remain available anonymously | §1.3 S8 |
| People named inside TOR documents | Appear in documents they did not publish; need a route to correction | F10 |

## 1.2 Purpose

| Question | Answer |
| :---- | :---- |
| What is TOR Radar? | A Thai-language web platform. It collects Terms of Reference (TOR) documents that Thai government agencies have already published, reads them with AI, turns them into structured records, matches those records to vendor skill profiles, notifies matched vendors by email, and publishes a public dashboard of agency spending with a documented rule for flagging unusual budgets |
| Who is this document for? | The delivery team, who build from it, and the stakeholders, who accept against it |
| What does it describe? | What the system does, and how its behaviour will be judged correct |
| What does it not describe? | How the software is designed internally, and when the work happens. An SRS is neither an architecture nor a plan |

## 1.3 Product Scope

**In Phase 1, TOR Radar will:**

| # | Capability | Detail in |
| :---- | :---- | :---- |
| S1 | Take in published TOR documents through file upload, a submitted URL, and an authenticated API, and keep every original unchanged | §4.1 |
| S2 | Read Thai and English TOR documents — including scans and photographs — and extract a fixed set of fields with a confidence value for each | §4.2 |
| S3 | Show every extracted record on a shared detail page, marking any field the system is not confident about | §4.2, §4.5 |
| S4 | Let vendors describe their skills and receive email about TORs that match them, with the reason for the match stated | §4.3, §4.4 |
| S5 | Publish a dashboard of TOR counts and budgets per agency, with filters and a documented statistical rule for flagging unusual budgets | §4.5 |
| S6 | Produce a rule-based checklist of how completely each TOR specifies its own requirements | §4.6 |
| S7 | Give admins the tools to correct the least reliable extractions and maintain the skill taxonomy | §4.7 |

**Phase 1 deliberately stops short of the following:**

| # | Boundary | Why |
| :---- | :---- | :---- |
| S8 | TOR Radar asks issuing agencies for no account, integration, or cooperation | It works from documents agencies have already published, so it needs no agreement from them to operate |
| S9 | TOR Radar does not write, prepare, or submit bids | The platform helps a vendor find and understand an opportunity. What the vendor does next is theirs |
| S10 | TOR Radar makes no legal, procedural, or ethical judgement about any procurement | It reports what a document says and where a number sits relative to its peers. Interpretation belongs to the reader — see §5.1 NFR-F5 |
| S11 | Phase 1 ships a Thai-language responsive web interface, not native mobile applications | The pilot audience works in Thai on desktop and mobile browsers |

## 1.4 How to Read This Document

Read the section that matches what you need, not the document end to end.

| If you are | Start at | Then read |
| :---- | :---- | :---- |
| A developer | §4 Functional Requirements — each requirement is one testable statement | §3 for the external interfaces, §5 for the constraints every feature works under |
| A tester | §6 Acceptance Criteria | §4 for the requirement each test is proving, §5.1 for the measurable targets |
| Stakeholders | §1 Introduction and §2 Product Overview | §7 Traceability, to confirm every feature is covered by a requirement |
| Joining the team | §1.1 Stakeholders and §1.3 Product Scope, then §2.4 and §2.6 | §7 Traceability, which links every part of the document to every other part |

Section §2 summarises; §§3–6 specify. Where §2 describes something briefly, it names the section that specifies it fully.

## 1.5 Terms Used in This Document

These four terms carry specific meaning from §2 onward.

| Term | What it means here |
| :---- | :---- |
| **TOR** | Terms of Reference (ร่างขอบเขตของงาน) — the document a Thai government agency publishes to describe a procurement project it intends to run. TOR Radar's records are public TOR documents. Where a source links a TOR to the same project's invitation to bid (ประกาศเชิญชวน), that invitation is collected as a supporting document only, to supply the fields a TOR does not state (FR-B-2) |
| **Extraction confidence** | A number the AI reports for each field it reads, saying how sure it is. TOR Radar does not hide a low-confidence record; it marks it. §4.2.1 defines exactly what happens at each confidence level |
| **Statistical anomaly** | The only label TOR Radar puts on an unusual budget. It means the number falls outside the normal range for comparable projects by the rule in §4.5.1. It does not mean anything is wrong |
| **Peer group** | The set of TORs a budget is compared against — same category, same time window. A budget is only ever called unusual relative to its peer group |

Appendix A lists the remaining abbreviations.

## 1.6 Assumptions and Dependencies

These assumptions sit outside the delivery team's control.

| # | What is assumed | Why it matters | If it proves false |
| :---- | :---- | :---- | :---- |
| A1 | The public procurement sources in Appendix B stay reachable in a form we are permitted to retrieve | §4.1 assumes documents can be collected automatically or by URL | Admins submit files by hand; FR-A-4 automation is not delivered for that source |
| A2 | Thai OCR and extraction on real scanned TORs is accurate enough to be worth publishing | §4.2 rests on this; NFR-F3 measures it | The confidence thresholds tighten, more records route to human review, and the scope of §4.2 is re-cut before further work |
| A3 | Vertex AI stays available and within the pilot budget | §3.3 names it as the only OCR and extraction provider | AI calls are capped and the accuracy benchmark is re-run less often |
| A4 | Published TOR documents contain limited personal data | §4.2 minimises what is displayed; §5.2 NFR-S2 governs handling | The minimisation rules in FR-B-5 tighten before publication is enabled |

## 1.7 References

| # | Reference |
| :---- | :---- |
| R1 | ISO/IEC/IEEE 29148:2018 — Systems and software engineering, requirements engineering |
| R2 | IEEE 830-1998 — Recommended practice for software requirements specifications |
| R3 | Public Procurement and Supplies Management Act B.E. 2560 (Thailand) |
| R4 | Personal Data Protection Act B.E. 2562 (Thailand) |

---

# 2. Product Overview

## 2.1 Product Perspective

| Aspect | Statement |
| :---- | :---- |
| What it is | A new, self-contained system |
| What it is not | A module of an existing government platform. It connects to no agency's internal systems |
| What it takes in | Documents and pages agencies have already published, plus the skill profiles vendors create for themselves |
| Why that matters | This independence is why §1.3 S8 rules out agency accounts |
| What it rests on | The continued public availability of each source in Appendix B — a dependency the team does not control, per §1.6 A1 |

## 2.2 What Users Can Do

Every action a user can take. Journalists and public readers share one actor because their access is identical, per §2.4.

*Figure 2.1 — Use cases and the actors who reach them.*

| Use case | Who does it | Specified by |
| :---- | :---- | :---- |
| **UC-1** Submit a TOR for processing | Admin | §4.1 |
| **UC-2** Review and correct a low-confidence extraction | Admin | §4.7 |
| **UC-3** Search and filter published TORs | Vendor, journalist, public | §4.5 |
| **UC-4** Read a TOR's structured detail and open the original | Vendor, journalist, public | §4.5 |
| **UC-5** Manage a skill profile and notification preferences | Vendor | §4.4 |
| **UC-6** Receive notification of a matching TOR | Vendor | §4.3 |
| **UC-7** Explore agency budgets and flagged figures | Vendor, journalist, public | §4.5 |
| **UC-8** Request a correction or takedown | Anyone | §4.2 |
| **UC-9** Export a filtered result set | Vendor, journalist, public | §4.5 |
| **UC-10** Maintain the skill taxonomy | Admin | §4.7 |

## 2.3 Product Features

Twelve features. These numbers are used in §2.4, §4 and §7.

| # | Feature | What it gives the user | Specified by |
| :---- | :---- | :---- | :---- |
| **F1** | TOR intake and permanent storage | Any published TOR can enter the system by three routes, and the original stays as it was | §4.1 |
| **F2** | Thai document reading | Scans and photographs become structured, searchable fields | §4.2 |
| **F3** | Confidence marking and review | Nothing is silently wrong: uncertain fields are visibly marked and routed to a human | §4.2.1, §4.7 |
| **F4** | Search, filter, and TOR detail | One shared page per TOR, and filters that compose | §4.5 |
| **F5** | Vendor matching and notification | Vendors hear about relevant TORs without watching for them | §4.3 |
| **F6** | Vendor profiles and sign-in | A vendor describes their capability once | §4.4 |
| **F7** | Public transparency dashboard | Anyone can see what agencies are spending, without an account | §4.5 |
| **F8** | Specification-quality checklist | A reader can see how completely a TOR specifies itself | §4.6 |
| **F9** | Skill taxonomy | Vendor skills and TOR qualifications use one shared vocabulary | §4.7 |
| **F10** | Personal data minimisation and takedown | People named in published documents have a route to correction | §4.2 |
| **F11** | CSV export | Researchers can take the filtered data away and work on it | §4.5 |
| **F12** | Automated source collection | Sources that permit it are collected without an admin | §4.1 |

## 2.4 Feature Access

Which features from §2.3 each access level from §1.1 reaches:

| Feature | Anonymous | Vendor | Admin |
| :---- | :---- | :---- | :---- |
| **F4** Search, filter, and TOR detail | ✔ | ✔ | ✔ |
| **F7** Public transparency dashboard | ✔ | ✔ | ✔ |
| **F8** Specification-quality checklist | ✔ | ✔ | ✔ |
| **F11** CSV export | ✔ | ✔ | ✔ |
| **F10** Takedown request | ✔ | ✔ | ✔ |
| **F5** Matching and notification | ✘ | ✔ | ✔ |
| **F6** Profiles and sign-in | ✘ | ✔ | ✔ |
| **F1** TOR intake | ✘ | ✘ | ✔ |
| **F3** Review queue | ✘ | ✘ | ✔ |
| **F9** Skill taxonomy | ✘ | ✘ | ✔ |
| **F12** Automated source collection | ✘ | ✘ | ✔ |

## 2.5 Technology Context

Phase 1 is constrained to these technologies. They bound what the requirements can assume.

*Figure 2.2 — Technology context. What the user touches, what the team runs, and what the system depends on from outside.*

| Constraint | Consequence for the requirements |
| :---- | :---- |
| AI reading is provided by Vertex AI | Extraction accuracy and cost are external dependencies, per §1.6 A2 and A3. AI call volume and spend shall be recorded per run so usage stays inside the pilot budget |
| Documents are held in object storage, not in the database | Makes the no-overwrite rule of FR-A-2 enforceable |
| Notification is by email only | Phase 1 has no in-app inbox, SMS, or push channel |
| The interface is a responsive browser application | Follows from §1.3 S11 |

## 2.6 How a TOR Moves Through the System

*Figure 2.3 — The path every TOR takes, whichever route it arrived by. Step 5 is specified in §4.2.1.*

The same path, with the requirement that specifies each step:

| Step | What happens | Specified by |
| :---- | :---- | :---- |
| 1 | A published TOR arrives by file upload, submitted URL, or the intake API | FR-A-1 |
| 2 | The original is stored and is not altered afterwards | FR-A-2 |
| 3 | Repeat submissions of the same TOR converge on one record | FR-A-3 |
| 4 | Thai and English OCR runs, then nine fields are extracted, each with a confidence value | FR-B-1, FR-B-2 |
| 5 | The confidence level decides the path: published clean, published marked unverified, or marked and queued for an admin | §4.2.1, FR-B-3 |
| 6 | The record becomes visible on the shared TOR detail page and on the dashboard | FR-E-4, FR-E-1 |
| 7 | Verified fields feed the anomaly rule and vendor matching. Fields below the threshold feed neither | §4.5.1, FR-C-1 |
| 8 | Matched vendors are emailed, with the reason for the match stated | FR-C-2 |

## 2.7 User Documentation

All delivered documentation is in Thai, per §5.1 NFR-F7.

| Document | For | Covers |
| :---- | :---- | :---- |
| Dashboard methodology page | Public, journalists | The active anomaly rule, the coverage note, and the limits of the "statistical anomaly" label |
| Extraction and confidence note | TOR readers | What the unverified marking means and how to ask for a correction |
| Vendor onboarding help | Vendors | Building a profile, how matching works, and setting notification preferences |
| Admin runbook | Admins | Intake routes, source adapters, the review queue, and the taxonomy |
| PDPA and takedown notice | Everyone | Consent, export, deletion, and correction requests |
| README and Docker Compose guide | Delivery team | Running the system locally, tests, and environment variables |

---

# 3. External Interface Requirements

## 3.1 User Interfaces

The interface is Thai throughout, per §5.1 NFR-F7. Values read from a TOR are shown exactly as extracted, not re-worded, re-formatted, or corrected silently.

| Screen | Must show | Governed by |
| :---- | :---- | :---- |
| Authentication | Registration, sign-in, and the PDPA consent step | FR-D-1, FR-D-3 |
| Public dashboard | Per-agency count and budget, date range, budget plot, filters, last-updated time, coverage note | FR-E-1, FR-E-2, FR-E-3 |
| TOR detail | Structured fields, original-document link, checklist result and reasons, status history, provenance, unverified marking | FR-E-4, FR-B-3, FR-F-2 |
| Search and browse | Agency, category, budget, deadline, and status filters that combine | FR-E-3 |
| Vendor profile | Skill tags, certifications, past projects, budget range, consent, notification preferences | FR-D-2, FR-D-3, FR-C-3 |
| Review queue | Original document beside extracted fields, per-field confidence, edit and approve | FR-G-1 |
| Match notification email | TOR summary, matched skill tags, budget fit, days remaining, link to the detail page | FR-C-2 |

## 3.2 Hardware Interfaces

| Interface | Requirement |
| :---- | :---- |
| Client hardware | None beyond a standard browser-capable device |
| Server hardware | None specified. Deployment runs under Docker Compose, per §5.2 NFR-S6 |

## 3.3 Software Interfaces

| Interface | Direction | Purpose | Used by |
| :---- | :---- | :---- | :---- |
| Vertex AI Document AI | Outbound | Thai and English OCR of scans and photographs | FR-B-1 |
| Vertex AI Gemini | Outbound | Field extraction, normalisation, checklist assistance | FR-B-2, FR-B-4, FR-F-1 |
| Document database | Internal | Extracted fields, profiles, matches, search | §4.8 |
| Object storage | Internal | Permanent storage of original documents | FR-A-2 |
| Email service (SMTP) | Outbound | Match notifications | FR-C-2 |
| OAuth provider | Outbound | Alternative vendor sign-in | FR-D-1 |
| Intake API | Inbound, authenticated, rate-limited | Programmatic TOR submission and source-adapter entry | FR-A-1, NFR-S1 |
| Public procurement sources | Inbound | Announcement discovery and original documents | FR-A-4, Appendix B |

## 3.4 Communications Interfaces

| Channel | Requirement |
| :---- | :---- |
| Browser to API | REST, exchanging JSON |
| Transport security | HTTPS in every deployed environment, per §5.2 NFR-S1 |
| Outbound notification | Email over SMTP. Phase 1 has no other outbound channel |

---

# 4. Functional Requirements

Each requirement below is one testable statement.

| Convention | Meaning |
| :---- | :---- |
| **shall** | Phase 1 is not complete without it |
| **may** | Delivered only once the core is finished |
| **Verify: T** | Proved by automated test |
| **Verify: D** | Proved by live demonstration |
| **Verify: I** | Proved by inspecting code, interface, or document text |
| **Verify: A** | Proved by measurement or calculation against data |

| Group | Covers | Where |
| :---- | :---- | :---- |
| **FR-A** | Taking TORs in — the three intake routes and permanent storage | §4.1 |
| **FR-B** | Reading and normalising — OCR, field extraction, confidence, personal data | §4.2 |
| **FR-C** | Matching and notifying — scoring TORs against vendor profiles and emailing the result | §4.3 |
| **FR-D** | Vendor profiles — registration, skill profile, consent | §4.4 |
| **FR-E** | Public access and the dashboard — search, detail page, budgets, export | §4.5 |
| **FR-F** | Specification-quality checklist — the five checks and how the result is shown | §4.6 |
| **FR-G** | Admin tools — the review queue and the skill taxonomy | §4.7 |

## 4.1 FR-A — Taking TORs In

Covers feature **F1**, and **F12** for FR-A-4. Realises **UC-1**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-A-1** | The system shall accept a TOR as a PDF, JPG, or PNG upload, as a submitted URL, and through an authenticated intake API, and shall pass all three routes into the same processing pipeline. | T, D |
| **FR-A-2** | The system shall store every original document in object storage and shall not delete or overwrite a stored object. | T, I |
| **FR-A-3** | The system shall resolve repeat submissions of the same TOR, from any route, to a single record carrying every source reference. | T |
| **FR-A-4** | The system may collect announcements from the sources in Appendix B through one adapter per source, and where it does, shall show the last successful collection time and the health of each adapter. | D |

## 4.2 FR-B — Reading and Normalising

Covers feature **F2**, **F3**, and **F10**. Realises **UC-8**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-B-1** | The system shall perform Thai and English OCR on scanned and photographed documents using a Thai-capable model. | T, A |
| **FR-B-2** | The system shall extract nine fields from each TOR: title, issuing agency, budget, category, scope summary, required qualifications, submission deadline, contact, and status. A TOR document does not usually state its submission deadline; where the source links the TOR to its project's invitation to bid, the deadline shall be read from that invitation and marked with the document it came from. Values the source system itself states are recorded as source values, not as extractions. | T |
| **FR-B-3** | The system shall record a confidence value for every extracted field and apply §4.2.1 to it. | T, D |
| **FR-B-4** | The system shall map extracted qualifications onto the shared skill taxonomy of FR-G-3. | T |
| **FR-B-5** | The system shall minimise personal data in what it displays, while keeping the original document reachable through its source link. | I, T |
| **FR-B-6** | The system shall provide a correction and takedown request route. An accepted takedown shall restrict access and record an audit entry, and shall not alter or delete the stored original. | D, I |

### 4.2.1 What Happens at Each Confidence Level

Every record that can be read is published. Confidence controls how a record is marked and whether a human reviews it, not whether the public can see it.

| Level | Condition | What the system does |
| :---- | :---- | :---- |
| High | Every critical field at or above T_high | Publishes with no marking. Fields may feed the dashboard, the anomaly rule, and matching |
| Medium | Confidence between T_low and T_high | Publishes marked "unverified extraction". Below-threshold fields are excluded from anomaly statistics and from matching until verified. No review is queued |
| Low | Below T_low, or a critical field missing or implausible | Publishes marked "unverified extraction" and enters the review queue of FR-G-1 |

T_low and T_high shall be derived from the accuracy measurement of NFR-F3.

## 4.3 FR-C — Matching and Notifying

Covers feature **F5**. Realises **UC-6**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-C-1** | The system shall score every published TOR against each vendor profile on qualification tags, category interest, and budget range, using a configurable match threshold. | T |
| **FR-C-2** | The system shall email each matched vendor, and every such email shall state at least the three highest-scoring matched skill tags and how the TOR's budget fits the vendor's stated range. | T, D |
| **FR-C-3** | The system shall let a vendor choose immediate or daily delivery, a minimum match score, and category and budget filters, and shall honour those choices. | T |
| **FR-C-4** | The system shall not use a field marked unverified as the basis of a notification. | T |

## 4.4 FR-D — Vendor Profiles

Covers feature **F6**. Realises **UC-5**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-D-1** | The system shall support registration and sign-in by email and password and by OAuth, distinguishing vendor, admin, and anonymous access. | T |
| **FR-D-2** | The system shall let a vendor create, read, update, and delete a skill profile holding taxonomy tags, certifications, past projects, a budget range, and free-text portfolio material. | T |
| **FR-D-3** | The system shall record explicit PDPA consent at registration, and shall provide data export and account deletion on request. | T, I |

## 4.5 FR-E — Public Access and the Dashboard

Covers features **F4**, **F7**, and **F11**. Realises **UC-3**, **UC-4**, **UC-7**, and **UC-9**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-E-1** | The system shall provide a dashboard, reachable without signing in, showing the TOR count and total budget for each issuing agency over a selectable date range, together with the trend across that range. | D, T |
| **FR-E-2** | The system shall plot budgets by category and shall label any figure the rule in §4.5.1 selects as "statistical anomaly". | T, A |
| **FR-E-3** | The system shall provide agency, category, date, budget, and status filters that combine, and shall keep closed and awarded TORs browsable as historical records. | T |
| **FR-E-4** | The system shall provide one shared detail page per TOR showing the structured fields, the original-document link, the checklist result, the status history, and the extraction timestamp and model version. | D, I |
| **FR-E-5** | The system shall record every status change with its timestamp, its source, and the actor responsible. | T |
| **FR-E-6** | The system shall show the time of the most recent successful intake, and shall state that the figures cover only the TORs it has collected rather than every procurement announcement in Thailand. | I |
| **FR-E-7** | The system may export the current filtered result as a CSV containing the extracted fields and source links, minimised for personal data. | T |

### 4.5.1 The Anomaly Rule

Exactly one method is active in any deployment. The dashboard methodology page in §2.7 names which.

| Parameter | Default | Meaning |
| :---- | :---- | :---- |
| PEER_GROUP_KEY | category + time window | A budget is compared only against TORs in the same peer group |
| PEER_WINDOW | rolling 12 months | The time half of the peer group |
| PEER_MIN_N | 8 | Below this many peers, nothing is flagged at all |
| ANOMALY_METHOD | IQR | Flags values outside Q1 − 1.5·IQR and Q3 + 1.5·IQR. The documented alternative is ZSCORE, flagging absolute z-score above 3 |

Fields below the confidence threshold are excluded from the peer-group statistics, so a misreading can neither create a flag nor move one.

## 4.6 FR-F — Specification-Quality Checklist

Covers feature **F8**. The checklist measures how completely a TOR specifies its own requirements. NFR-F5 constrains how the result is worded.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-F-1** | The system shall compute a checklist result from the five checks in §4.6.1, and shall record an independent pass or fail reason for each check it evaluated. | T, A |
| **FR-F-2** | The system shall display the result and every reason together with the words "AI-generated specification-quality check — not a legal or corruption judgment". | I |
| **FR-F-3** | Every displayed checklist result shall link to the methodology page describing the checks and the active anomaly rule. | I |
| **FR-F-4** | The system shall show failed checks on the dashboard alongside flagged budgets. | D |

### 4.6.1 The Five Checks

| # | Check | Passes when | Parameter |
| :---- | :---- | :---- | :---- |
| C1 | Budget stated | A budget was extracted at or above the confidence threshold | — |
| C2 | Deadline workable | The deadline is at least MIN_BID_WINDOW_DAYS after the announcement | Not yet calibrated — see §8 |
| C3 | Scope specific | The scope meets the configured length and section-count heuristics | MIN_SCOPE_CHARS, MIN_SCOPE_SECTIONS |
| C4 | Qualifications stated | At least one qualification was extracted and mapped to the taxonomy | — |
| C5 | Budget within peer norm | The budget is unflagged, or the peer group is smaller than PEER_MIN_N | Reuses §4.5.1 |

Until MIN_BID_WINDOW_DAYS is calibrated against real data, C2 shall report "not evaluated" rather than a pass or a fail.

## 4.7 FR-G — Admin Tools

Covers features **F3** and **F9**. Realises **UC-2** and **UC-10**.

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **FR-G-1** | The system shall provide a review queue holding only low-confidence and failed-check records, showing the original document beside the extracted fields, and allowing a correction and approval that clears the unverified marking. | T, D |
| **FR-G-2** | The system shall retain every admin correction as a worked example for the extractor. | T |
| **FR-G-3** | The system shall seed the skill taxonomy and the category list from configuration, and may provide an interface for editing them. | I, T |

## 4.8 Data Requirements

| What is held | What it contains |
| :---- | :---- |
| TOR record | The extracted fields, the status history, the confidence level, the extraction provenance, the source URL, the storage key, and any duplicate links |
| Original document | The unaltered file in object storage, referenced by the TOR record |
| Vendor profile | Account, skills, experience, budget range, notification preferences, and consent record |
| Match record | The vendor–TOR pair, the score, the matched tags, the budget fit, and when notification was sent |
| Taxonomy | The shared skill tags and categories |
| Correction record | The original and corrected values, retained as extractor examples |
| Source state | Each adapter's URL, whether it is enabled, its last attempt and last success, and its most recent error |

---

# 5. Nonfunctional Requirements

Nonfunctional requirements sit in two layers.

| Layer | What it holds | Where |
| :---- | :---- | :---- |
| Feature-level | Requirements belonging to one feature, verified through that feature | §5.1 |
| System-level | Requirements the whole system meets, whichever feature is exercised | §5.2 |

## 5.1 Feature-Level

The figures are pilot demo targets, measured against the seeded corpus.

| ID | Feature | Requirement | Verify |
| :---- | :---- | :---- | :---- |
| **NFR-F1** | F5 | A match notification shall reach the vendor within five minutes of the TOR being published, in the demo environment. | T, D |
| **NFR-F2** | F4, F7 | A search or filter shall return within two seconds against the seeded demo corpus. | T |
| **NFR-F3** | F2, F3 | Field-level Thai OCR and extraction accuracy shall be measured on 10–20 real TORs, and both confidence thresholds of §4.2.1 shall be derived from that measurement. No accuracy figure is claimed before it is measured. | A |
| **NFR-F4** | F7 | A dashboard page shall load within three seconds on a mobile browser against the seeded demo corpus. | T |
| **NFR-F5** | F7, F8 | Text shown to users shall use only the words "statistical anomaly" and "specification-quality check". It shall not call a TOR, a budget, or an agency suspicious, corrupt, irregular, or any equivalent. | I |
| **NFR-F6** | F2, F8 | Every AI-produced value shall be labelled as AI-generated and shall carry its confidence, the model and version that produced it, and a link to the source document. Checklist results shall break down into named reasons; no unexplained score shall be shown. | I, T |
| **NFR-F7** | All | The interface and all delivered documentation shall be in Thai, and extracted values shall be displayed exactly as extracted. | I |

## 5.2 System-Level

| ID | Requirement | Verify |
| :---- | :---- | :---- |
| **NFR-S1** | Passwords shall be stored using bcrypt or argon2; every deployment shall serve over HTTPS; admin and API routes shall enforce access level; the intake API shall be rate-limited; and the build shall audit its dependencies. | T, I |
| **NFR-S2** | Personal data handling shall be aligned with the PDPA through consent, minimisation, export, deletion, and takedown. No certification of compliance is claimed. | I |
| **NFR-S3** | A stored original document shall remain unaltered for the life of the system. A takedown shall restrict access and write an audit entry rather than change or remove the file. | T, I |
| **NFR-S4** | Phase 1 is built for hundreds of TORs and tens of concurrent users. No uptime figure and no horizontal-scaling behaviour is promised. | A |
| **NFR-S5** | A failed intake or extraction shall keep the raw document and record the reason for failure. It shall not silently drop a document or publish a partial extraction as if it were complete. | T, D |
| **NFR-S6** | The system shall run under Docker Compose; every change shall be tested before merge; and no secret shall be committed to the repository. | I, D |
| **NFR-S7** | Every decision threshold shall come from a measurement or from named configuration, not from a value written into the code. | I |

---

# 6. Acceptance Criteria

Stakeholders accept Phase 1 when each feature meets its criterion. Verification runs against the system in Docker Compose; timed figures are measured against the deployed demo with the seeded corpus.

| Feature | Accepted when |
| :---- | :---- |
| **F1** | A TOR submitted by upload, by URL, and by API produces one record; the API refuses an unauthenticated caller; a repeat submission converges on the existing record |
| **F2** | A scanned Thai TOR yields all nine fields, each with a confidence value |
| **F3** | Only low-confidence and failed-check records appear in the queue, and an approval clears the unverified marking |
| **F4** | Every filter combines with every other and returns within two seconds; the detail page shows every field and the original-document link |
| **F5** | A vendor receives one email within five minutes, naming at least three matched skill tags and the budget fit |
| **F6** | Profile creation works end to end, skills come only from the taxonomy, and consent is required before an account exists |
| **F7** | Agency totals, the date filter, the trend, the last-updated time, and the coverage note are all visible without signing in; the budget plot marks points as "statistical anomaly" |
| **F8** | A checklist result shows its score and at least three concrete reasons, with the methodology link and the required label |
| **F9** | The taxonomy and category list load from configuration |
| **F10** | A takedown request restricts access, writes an audit entry, and leaves the original file unchanged |
| **F11** | An export honours the active filters, includes source links, and carries no unnecessary personal data |
| **F12** | Each enabled adapter reports its last successful collection and its health |

---

# 7. Traceability

How every feature, use case, requirement and user class connects.

| Feature | Use case | Functional requirements | Nonfunctional | Reachable by |
| :---- | :---- | :---- | :---- | :---- |
| **F1** TOR intake | UC-1 | FR-A-1, FR-A-2, FR-A-3 | NFR-S1, NFR-S3, NFR-S5 | Admin |
| **F2** Thai reading | — | FR-B-1, FR-B-2, FR-B-4 | NFR-F3, NFR-F6 | — |
| **F3** Confidence and review | UC-2 | FR-B-3, §4.2.1, FR-G-1, FR-G-2 | NFR-F3, NFR-S5 | Admin |
| **F4** Search and detail | UC-3, UC-4 | FR-E-3, FR-E-4, FR-E-5 | NFR-F2, NFR-F7 | Anonymous, vendor, admin |
| **F5** Matching | UC-6 | FR-C-1, FR-C-2, FR-C-3, FR-C-4 | NFR-F1 | Vendor |
| **F6** Profiles | UC-5 | FR-D-1, FR-D-2, FR-D-3 | NFR-S1, NFR-S2 | Vendor |
| **F7** Dashboard | UC-7 | FR-E-1, FR-E-2, FR-E-6, §4.5.1 | NFR-F2, NFR-F4, NFR-F5 | Anonymous, vendor, admin |
| **F8** Quality checklist | — | FR-F-1, FR-F-2, FR-F-3, FR-F-4, §4.6.1 | NFR-F5, NFR-F6 | Anonymous, vendor, admin |
| **F9** Taxonomy | UC-10 | FR-G-3, FR-B-4 | — | Admin |
| **F10** PII and takedown | UC-8 | FR-B-5, FR-B-6 | NFR-S2, NFR-S3 | Anonymous, vendor, admin |
| **F11** CSV export | UC-9 | FR-E-7 | NFR-S2 | Anonymous, vendor, admin |
| **F12** Automated collection | — | FR-A-4 | NFR-S5 | Admin |

---

# 8. Open Issues

Four values depend on data the team does not yet have.

| # | Open point | Used by | Settled by |
| :---- | :---- | :---- | :---- |
| O1 | T_low and T_high | §4.2.1 | The accuracy measurement of NFR-F3 |
| O2 | MIN_BID_WINDOW_DAYS | §4.6.1 C2 | Calibration against the collected corpus. Until then C2 reports "not evaluated" |
| O3 | MIN_SCOPE_CHARS, MIN_SCOPE_SECTIONS | §4.6.1 C3 | Calibration against the collected corpus |
| O4 | Whether IQR or ZSCORE is the active method | §4.5.1 | Comparison of both on real budget data |

---

# Appendix A: Glossary

Terms carrying specific meaning in TOR Radar are defined in §1.5. This appendix covers the remainder.

| Term | Meaning |
| :---- | :---- |
| T_low / T_high | The two confidence thresholds of §4.2.1, derived from measurement rather than chosen |
| Coverage note | The statement, required by FR-E-6, that the dashboard reflects only the TORs collected |
| DoD | Definition of Done: reviewed, tested, runnable, demonstrable |
| IQR | Interquartile range — the middle-half spread of a set of numbers, used by §4.5.1 |
| OCR | Optical character recognition — reading text out of an image |
| PDPA | Personal Data Protection Act B.E. 2562 (Thailand) |
| PII | Personally identifiable information |
| Provenance | The extraction timestamp and model version recorded against every AI-produced field |
| TOR | Terms of Reference (ร่างขอบเขตของงาน) — defined in §1.5 |
| Unverified extraction | The visible marking on a field below the confidence threshold, defined in §4.2.1 |

# Appendix B: Initial TOR Sources

These are the sources Phase 1 collects from, referenced by FR-A-4 and by assumption §1.6 A1. Collection respects each source's access controls and rate limits; where automated collection is not permitted, an admin submits the URL or the file by hand.

| Source | Address | How it is collected | If that fails |
| :---- | :---- | :---- | :---- |
| Government Procurement e-GP | process5.gprocurement.go.th | An adapter reads the public search view, follows announcement links, and downloads the linked documents | Admin submits the announcement URL or file |
| eGP procurement index | egp-gprocurement.com | Scheduled retrieval of the server-rendered listing, following each record to the official announcement. A secondary index, not an official source | Use the linked official announcement |
| Bangkok procurement project search | egp2.bangkok.go.th | A browser-capable adapter renders the dynamic results and submits the linked documents | Admin submits project URLs |
| Comptroller General's Department draft TOR page | cgd.go.th | Admin submits by URL or file: automated requests currently return HTTP 403 | Re-evaluate if the site's access behaviour changes |
| Department of Internal Trade draft TOR page | dit.go.th | Scheduled retrieval of the server-rendered listing, downloading the linked PDFs | Admin submits a listed PDF URL or file |

# Appendix C: Document History

| Version | Date | Change |
| :---- | :---- | :---- |
| 1.0 | 2026-08-24 | First issue |
| 2.0 | 2026-08-31 | Restructured around a single functional model; planning and prioritisation removed |
