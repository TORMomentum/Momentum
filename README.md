# TOR Radar

Thai government procurement TORs, collected in one place, extracted with AI, matched to vendors, and
published for anyone to audit.

Agencies publish Terms of Reference across dozens of sites as PDFs, scans, and HTML. A small vendor
cannot watch them all; a citizen cannot compare them. TOR Radar collects the published documents,
extracts their fields, emails vendors whose skills match within minutes, and puts the totals on a
public dashboard with a documented statistical-anomaly rule — every figure traceable to an unaltered
original.

> Course project · Software Design, Year 3 Semester 1 · team Momentum. National scope (Thai
> government agencies), seeded from Bangkok sources first.

---

## Quick start

```bash
cp .env.example .env          # fill in the secrets; nothing is committed
npm install
npm run dev                   # web :3000 · api :4000
npm test                      # vitest
npm run lint                  # eslint
npm run build                 # all workspaces
```

The containerised path brings up the datastores:

```bash
docker compose up             # web · api · mongo · minio (host ports from .env)
```

⚠️ Compose is mid-rework: workspace-aware Dockerfiles, the worker service, and health gates arrive
with slice 1 tasks 14–15 ([docs/TODO.md](docs/TODO.md)). Until then `npm run dev` against
`docker compose up mongo minio` is the reliable local setup.

Node 22 or newer. CI runs lint, test, and build on every pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

## Layout

```
apps/web/         Next.js 16 — app/ is routing only, UI code in src/
apps/api/         Express 5 — feature modules, ports, adapters, worker
packages/shared/  types + Zod schemas both apps import
docs/             requirements, architecture, design specs, benchmark evidence
mockups/          design-canvas source the UI was ported from — never built
tools/            Jira seeding, Vertex checks, extraction scoring
```

---

## Documentation

Start with whichever question you have:

| I want to know… | Read |
| :--- | :--- |
| **How it is put together** — containers, data model, invariants, diagrams | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **What it must do** — every requirement, testable, with verification method | [docs/SRS.md](docs/SRS.md) |
| **Why it exists** — problem, stakeholders, personas, user stories, plan | [docs/PROJECT.md](docs/PROJECT.md) |
| **How the current slice is built** — decisions, seams, security, containers | [docs/superpowers/specs/](docs/superpowers/specs/) |
| **What is being built right now** | [docs/TODO.md](docs/TODO.md) — the live checklist |
| **How the current slice is executed** — task by task, with tests | [docs/superpowers/plans/](docs/superpowers/plans/) |
| **What was already built and verified** | [docs/work-log.md](docs/work-log.md) |
| **How accurate the extraction is** | [docs/corpus/BENCHMARK.md](docs/corpus/BENCHMARK.md) |
| **How to set up Vertex AI** | [docs/gcp-setup.md](docs/gcp-setup.md) |

Working in this repo with an AI agent: [CLAUDE.md](CLAUDE.md) (Claude Code) or
[AGENTS.md](AGENTS.md) (any other agent).

---

## Status

Frontend screens are built and navigable against sample data; the pipeline that fills them is being
built now. Sample figures are labelled as such on every screen — the interface never implies the
numbers are complete.

Slice 1 (intake, immutable storage, dedupe, job queue, worker) is in progress; slices 2–4 bring
extraction, the public dashboard, and vendor accounts. The four slices are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §10, and task-level progress lives in
[docs/TODO.md](docs/TODO.md) — the one place it is tracked.

## Stack

Next.js 16 · React 19 · Express 5 · MongoDB 7 · MinIO · Zod 4 · Vitest · Vertex AI (Document AI +
Gemini) · Docker Compose. The reasoning behind each choice is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §8.
