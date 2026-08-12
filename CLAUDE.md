# CLAUDE.md — TOR Radar BKK

University group project (Software Design, Year 3): centralized Thai-language platform for Bangkok (BMA) procurement TORs — ingest any format, AI-extract, match to vendor skill profiles, notify by email, public transparency dashboard with pricing-anomaly visualization.

**Read [PROJECT.md](PROJECT.md) first** — it is the single source of truth for problem statement, stakeholders, user stories (US-01…16), functional requirements (FR-A…G), MoSCoW feature analysis, cost breakdown, sprint plan, and risks. Do not re-derive requirements; extend that file when they change.

## Stack (decided — do not substitute)

| Layer | Choice |
|---|---|
| Frontend | Next.js |
| API | Node.js + Express (REST) |
| DB | MongoDB Atlas (metadata/extracted fields only — raw docs go to MinIO, never into Mongo documents) |
| Raw storage | MinIO (S3-compatible, self-hosted in Docker Compose) |
| AI | Vertex AI (Document AI / Gemini) — Thai OCR, field extraction, qualification normalization |
| Notifications | Email only (Nodemailer/Resend) — no Discord webhook, no in-app inbox |
| Infra | Docker Compose; CI on PR; secrets in `.env` (gitignored, `.env.example` committed) |
| Process | Scrum · Jira (epics ≈ FR groups) · Discord standups |

## Hard rules (from PROJECT.md — enforce in code review)

- **Bangkok-only:** every ingested record validates against the canonical BMA agency list (seeded JSON); reject/tag non-BMA (FR-A4).
- **Raw documents immutable** in MinIO; every displayed record links to its source (FR-A2, NFR-2).
- **No agency-facing features:** agencies are a data source, not users — no upload portal, no draft-TOR flow, no QR ingestion (out of scope, PROJECT.md §2).
- **Thai UI** (NFR-7) — user-facing strings in Thai.
- **Low-confidence extractions auto-publish TAGGED, never clean:** two-tier policy (FR-B3/FR-G1) — medium confidence publishes with an "unverified extraction" tag; only very-low/suspicious records also hit the admin review queue. Below-threshold fields never feed anomaly stats or match notifications until verified. Both thresholds come from the Sprint-1 accuracy benchmark, not from a guess.
- **Anomaly wording:** "statistical anomaly" / "specification-quality check" — never "suspicious" or corruption claims (FR-E2, FR-F2; defamation risk).
- **PDPA:** consent at signup, export/delete, PII minimized in displayed extractions (FR-B5, FR-D3).
- **All AI outputs labeled AI-generated + explainable** (NFR-6); every TOR shows extraction provenance (timestamp + model), and the dashboard always shows "data last updated" + a coverage note (FR-E1/FR-E4) — never imply the corpus is complete or live.
- **MVP discipline:** Must = Sprints 1–4; Sprint 5 is entirely cuttable. Don't build Stretch (scraping, taxonomy UI) before Must is done.

## Working style

- Plan before building for non-trivial work; fix root causes, not symptoms; no magic numbers — derive values from named constants, config, or env.
- Check current library/framework documentation before implementing against version-sensitive APIs.
- Small verified loops: implement → review → test → verify. One concern per commit; Conventional Commits (`type(scope): subject`).
- Never claim a fix works without running the real thing (live app, real request against the API) — unit tests passing alone is not verification.
- Definition of Done: reviewed, tests pass, runs in shared Docker Compose, demoable.
- Run tests/builds inside containers, not on the host. Never commit secrets; `.env` stays untracked with a committed `.env.example`.

## Commands

_(fill in as the repo grows — no code yet)_

```
docker compose up          # full stack (once compose exists)
```
