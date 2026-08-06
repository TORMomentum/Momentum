# CLAUDE.md — TOR Radar BKK

University group project (Software Design, Year 3): centralized platform for Bangkok (BMA) procurement TORs — ingest any format, AI-extract, match to vendor skill profiles, notify, public transparency dashboard with pricing-anomaly visualization.

**Read [PROJECT.md](PROJECT.md) first** — it is the single source of truth for problem statement, stakeholders, user stories (US-01…17), functional requirements (FR-A…G), MoSCoW feature analysis, sprint plan, and risks. Do not re-derive requirements; extend that file when they change.

## Stack (decided — do not substitute)

| Layer | Choice |
|---|---|
| Frontend | Next.js |
| API | Node.js + Express (REST) |
| DB | MongoDB Atlas (metadata/extracted fields only — raw docs go to object storage, never into Mongo documents) |
| AI | Vertex AI (Document AI / Gemini) — Thai OCR, field extraction, qualification normalization |
| Notifications | Discord webhook + email (Nodemailer/Resend) |
| Infra | Docker Compose; CI on PR; secrets in `.env` (gitignored, `.env.example` committed) |
| Process | Scrum · Jira (epics ≈ FR groups) · Discord standups |

## Hard rules (from PROJECT.md — enforce in code review)

- **Bangkok-only:** every ingested record validates against the canonical BMA agency list (seeded JSON); reject/tag non-BMA (FR-A5).
- **Raw documents immutable** in object storage; every displayed record links to its source (FR-A3, NFR-2).
- **Never auto-publish low-confidence extractions** — below-threshold records go to the admin review queue (FR-B3/FR-G1). Threshold comes from the Sprint-1 accuracy benchmark, not from a guess.
- **Anomaly wording:** "statistical anomaly" / "specification-quality check" — never "suspicious" or corruption claims (FR-E2, FR-F2; defamation risk).
- **PDPA:** consent at signup, export/delete, PII minimized in displayed extractions (FR-B5, FR-D3).
- **All AI outputs labeled AI-generated + explainable** (NFR-6).
- **MVP discipline:** Must = Sprints 1–4; Sprint 5 is entirely cuttable. Don't build Stretch (scraping, taxonomy UI) before Must is done.

## Working style

- Follow the engineering playbook at `D:\second-brain\docs\engineering-playbook.md` (no quick patches, no magic numbers, research-before-building for version-sensitive APIs, small verified loops, Conventional Commits, never claim fixed without running the real thing).
- Skills to use here: `superpowers:brainstorming` before new features · `superpowers:test-driven-development` for implementation · `superpowers:systematic-debugging` for bugs · `frontend-design` + `dataviz` for the dashboard · `agent-browser` for live UI verification.
- Definition of Done: reviewed, tests pass, runs in shared Docker Compose, demoable.
- Run tests/builds inside containers, not on the host.

## Commands

_(fill in as the repo grows — no code yet)_

```
docker compose up          # full stack (once compose exists)
```
