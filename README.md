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
mkdir secrets                 # then drop in the service-account key files the team gives you
cp .env.example .env          # fill in the secrets; nothing is committed
npm install
npm run dev                   # web :3000 · api :4000
npm test                      # vitest
npm run lint                  # eslint
npm run build                 # all workspaces
```

`secrets/` is gitignored and holds the Google service-account keys `.env` points at —
`gcp-sa.json` (Vertex AI) and, if you're testing against real Google Cloud Storage rather than the
local emulator, `gcs-storage-sa.json`. Ask the team for these files; never commit them.

```bash
docker compose up             # web · api · worker · mongo · gcs (fake-gcs-server emulator)
```

The `web` and `api` Dockerfiles install from the workspace root, so `@tor-radar/shared` resolves
inside the image the same way it does locally (TOR-140). `web`'s image prerenders `/` and
`/methodology` at build time; without `API_BASE_URL` set as a build arg, those two pages bake in
their no-data fallback rather than live figures — worth fixing before either page ships behind
Cloud Run.

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
tools/            source collection, seed generation, Jira seeding, Vertex checks, scoring
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
| **What the project is doing next** — decided, undecided, and why | [docs/PLAN.md](docs/PLAN.md) |
| **How the current slice is executed** — task by task, with tests | [docs/superpowers/plans/](docs/superpowers/plans/) |
| **What was already built and verified** | [docs/work-log.md](docs/work-log.md) |
| **Where the TORs come from** — the BMA eGP API, document formats, taxonomy seeds | [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) |
| **How accurate the extraction is** | [docs/corpus/BENCHMARK.md](docs/corpus/BENCHMARK.md) |
| **How to set up Vertex AI** | [docs/gcp-setup.md](docs/gcp-setup.md) |

Working in this repo with an AI agent: [CLAUDE.md](CLAUDE.md) (Claude Code) or
[AGENTS.md](AGENTS.md) (any other agent).

---

## Status

Slices 1 and 2 are both underway — intake, immutable storage (now on Google Cloud Storage), the
extraction pipeline, confidence tiering, and the admin review/upload screens all work end to end.
Sample figures are labelled as such wherever the pipeline hasn't filled them in yet. Slices 3–4
(public dashboard, vendor accounts) are still ahead. The four slices are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §10, and exact task-level progress lives in
[docs/TODO.md](docs/TODO.md) — the one place it is tracked.

## Stack

Next.js 16 · React 19 · Express 5 · MongoDB Atlas · Google Cloud Storage · Zod 4 · Vitest ·
Vertex AI (Document AI + Gemini) · Docker Compose. The reasoning behind each choice is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §8.
