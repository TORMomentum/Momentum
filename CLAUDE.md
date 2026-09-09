# CLAUDE.md — TOR Radar

Phase-1 build: a Thai-language platform that collects published Thai government procurement TORs,
extracts their fields with AI, matches them to vendor skill profiles, notifies vendors by email, and
publishes a public transparency dashboard with a documented statistical-anomaly rule.

## Read these first, in this order

| Document | Holds | Do not |
| :---- | :---- | :---- |
| [docs/SRS.md](docs/SRS.md) **v2.0** | Every requirement, as a testable statement, with verification method and traceability | Re-derive requirements; extend the SRS when they change |
| [docs/superpowers/specs/](docs/superpowers/specs/) | How it is built: structure, data model, seams, security, containers | Invent a different structure; the current spec is the 2026-09-01 foundation-and-intake design |
| [docs/PROJECT.md](docs/PROJECT.md) | Why it exists, stakeholders, user stories, prioritisation, cost, delivery plan | Look here for requirements — it delegates to the SRS |

Requirement identifiers are the v2.0 scheme: `FR-A-1`…`FR-G-3`, feature-level `NFR-F1`…`NFR-F7`,
system-level `NFR-S1`…`NFR-S7`, features `F1`…`F12`, use cases `UC-1`…`UC-10`. Anything citing the
old `FR-A1` / `NFR-2` style is stale — see PROJECT.md §6 for the mapping.

## Stack (decided — do not substitute)

| Layer | Choice |
| :---- | :---- |
| Frontend | Next.js (App Router) |
| API | Node.js + Express (REST) |
| Database | MongoDB Atlas — metadata and extracted fields only; document bytes never go in a Mongo document |
| Object storage | MinIO (S3-compatible, in Docker Compose) behind a `Storage` port |
| AI | Vertex AI — Document AI for Thai OCR, Gemini for extraction and normalisation |
| Notifications | Email only (SMTP). No in-app inbox, no chat webhook, no SMS |
| Infrastructure | Docker Compose; CI on every pull request; secrets in `.env`, `.env.example` committed |
| Process | Scrum · Jira (epics ≈ FR groups) · Discord standups |

## Structure

```
apps/web/     Next.js — app/ is routing ONLY; UI code lives in src/ as views → features → entities → shared
apps/api/     Express — modules/ per feature, ports/ interfaces, adapters/ implementations, workers/
packages/     shared/ (types + Zod schemas) · seeds/ (taxonomy, categories, sources)
docs/         SRS.md · PROJECT.md · superpowers/specs/
mockups/      design-canvas source — reference only, never built or linted
```

Both apps are packaged **by feature, not by layer**, with domain-prefixed filenames
(`intake.service.ts`, never `service.ts`).

Four rules the structure exists to enforce:

1. Only `*.repository.ts` imports the database.
2. `modules/` imports `ports/`, never `adapters/`. Wiring happens once, in `app.ts`.
3. Every threshold and tunable lives in `core/config.ts`.
4. A feature is one folder, so removing it is one operation.

Web imports flow one direction: `views → features → entities → shared`. Never upward.

## Hard rules

**Scope is national.** TOR Radar covers Thai government agencies (SRS §1.2, Appendix B). The old
Bangkok-only rule — validating against a canonical BMA agency list and rejecting non-BMA records —
is withdrawn. Issuing agency is a plain extracted field; nothing is rejected for being outside
Bangkok. The seeded corpus starts with Bangkok sources as a sequencing choice, not a scope rule.

**Originals are immutable.** Every document is stored in object storage and never deleted or
overwritten (`FR-A-2`, `NFR-S3`). The storage adapter exposes `putIfAbsent`, not `put`. An accepted
takedown restricts access and writes an audit entry; it never alters or removes the stored file
(`FR-B-6`). Every displayed record links to its source.

**Confidence controls marking, not visibility.** Every readable record publishes (SRS §4.2.1). High
confidence publishes clean; medium publishes marked "unverified extraction", with below-threshold
fields excluded from anomaly statistics and matching; low publishes marked and enters the review
queue. `T_low` and `T_high` come from the accuracy measurement in `NFR-F3` — never from a guess.

**Wording is constrained** (`NFR-F5`). Only "statistical anomaly" and "specification-quality check".
Never "suspicious", "corrupt", "irregular", or any equivalent, about a TOR, a budget, or an agency.

**AI output is labelled and explainable** (`NFR-F6`). Every AI-produced value carries its confidence,
the model and version that produced it, and a link to the source document. Checklist results break
into named reasons. The dashboard always shows the last-updated time and the coverage note stating
the figures cover only the collected corpus (`FR-E-6`).

**PDPA-aligned, never "PDPA-compliant"** (`NFR-S2`) — no certification is claimed. Consent at
registration, export and deletion on request, personal data minimised in what is displayed
(`FR-B-5`, `FR-D-3`). Redaction lives in one serializer.

**No hard-coded values.** Every host, port, bucket, credential, model name, and threshold comes from
configuration with an overridable default (`NFR-S7`). `localhost` appears in no source file. Storage
has two endpoints: `MINIO_ENDPOINT` (internal, server-side) and `MINIO_PUBLIC_URL` (browser-
reachable). Signed URLs are generated on demand and never persisted.

**Never share a filesystem path between services.** Services exchange storage keys; whoever needs
bytes fetches them from object storage. A path written by one container does not exist in another.

**Agencies are not users.** No agency portal, no upload flow for agencies, no QR ingestion. They are
a data source (SRS §1.3 S8).

**Thai UI** (`NFR-F7`). User-facing strings are Thai, and extracted values are displayed exactly as
extracted — never re-worded, re-formatted, or silently corrected.

## Security baseline (`NFR-S1`, spec §5.6)

Passwords with bcrypt or argon2 · HTTPS in deployed environments · access level enforced on admin
and API routes · intake API rate-limited and key-authenticated with a constant-time compare ·
dependency audit in CI. Plus: SSRF defence on the URL intake route (scheme allowlist, resolved-
address range checks, re-check after every redirect, size and timeout caps, through one helper);
magic-byte verification because the declared content type is attacker-controlled; originals served
as attachments with `nosniff`; Zod primitives-only filter parsing so no operator object reaches a
Mongo query; streamed uploads with multipart caps.

## Working style

- **Plan before building.** Non-trivial work goes through `superpowers:brainstorming` →
  a design spec in `docs/superpowers/specs/` → `superpowers:writing-plans` → implementation.
- Research version-sensitive APIs against current primary documentation before writing against them.
- Small verified loops: implement → review → test → verify. One concern per commit, Conventional
  Commits (`type(scope): subject`).
- Never claim a fix works without running the real thing — a live request against the running stack.
  Unit tests passing is not verification.
- Run tests and builds inside containers, not on the host. Never commit secrets.
- Definition of Done: reviewed, tests pass, runs in shared Docker Compose, demoable.

## Build order

Four slices, each with its own design spec, plan, and build cycle. Slice 1 comes first because every
later slice reads the records it writes.

| Slice | Features | Delivers |
| :---- | :---- | :---- |
| 1 | F1 | Foundation and intake: config, ports and adapters, three intake routes, immutable storage, dedupe, job queue, worker, admin upload screen, design tokens |
| 2 | F2, F3 | Vertex AI OCR and field extraction, confidence tiering, review queue |
| 3 | F4, F7, F8, F11 | Search, TOR detail, dashboard, anomaly rule, quality checklist, CSV export |
| 4 | F5, F6, F9, F10 | Auth and vendor profiles, taxonomy, matching, email notification, PDPA and takedown |

## Open values (SRS §8) — never invent these

`T_low` / `T_high` await the accuracy measurement. `MIN_BID_WINDOW_DAYS` awaits calibration, and
until then checklist C2 reports "not evaluated". `MIN_SCOPE_CHARS` and `MIN_SCOPE_SECTIONS` await
calibration. Whether IQR or ZSCORE is the active anomaly method awaits comparison on real budget
data. All are declared in `core/config.ts` with their open status recorded.

## Commands

```
docker compose up                 # full stack: web :3000 · api :4000 · mongo · minio :9000/:9001
npm run dev                       # web + api dev servers (no containers)
npm test                          # vitest
npm run lint                      # eslint
npm run build                     # build all workspaces
python tools/jira_seed.py         # (re)seed Jira — needs JIRA_EMAIL + JIRA_TOKEN, never hardcoded
```

Jira: project **TOR** at momentumm.atlassian.net. Jira is the operational truth for sprint contents;
PROJECT.md is the summary.
