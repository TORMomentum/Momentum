# AGENTS.md — TOR Radar

Instructions for any coding agent working in this repository (Codex, Gemini, or another). Claude
Code reads [CLAUDE.md](CLAUDE.md), which carries the same rules in fuller form; this file is the
portable version. Where the two disagree, CLAUDE.md and the SRS win.

## What this project is

A Thai-language platform that collects published Thai government procurement TORs, extracts their
fields with AI, matches them to vendor skill profiles, notifies vendors by email, and publishes a
public transparency dashboard with a documented statistical-anomaly rule.

## Read before changing anything

1. [docs/SRS.md](docs/SRS.md) v2.0 — every requirement, as a testable statement. Requirements are
   never re-derived; the SRS is extended when they change.
2. [docs/superpowers/specs/](docs/superpowers/specs/) — how it is built. The current design is the
   2026-09-01 foundation-and-intake spec: structure, data model, interaction seams, security,
   containers.
3. [docs/PROJECT.md](docs/PROJECT.md) — why it exists, who it serves, build order, cost.

Identifiers are the SRS v2.0 scheme: `FR-A-1`…`FR-G-3`, `NFR-F1`…`NFR-F7`, `NFR-S1`…`NFR-S7`,
`F1`…`F12`, `UC-1`…`UC-10`. Anything citing `FR-A1` or `NFR-2` is stale.

## Stack — decided, do not substitute

Next.js (App Router) · Node.js + Express REST · MongoDB Atlas for metadata and extracted fields ·
MinIO for original documents, behind a `Storage` port · Vertex AI (Document AI for Thai OCR, Gemini
for extraction) · email only, over SMTP · Docker Compose · CI on every pull request.

## Structure

```
apps/web/     Next.js — app/ is routing ONLY; UI code in src/ as views → features → entities → shared
apps/api/     Express — modules/ per feature, ports/ interfaces, adapters/ implementations, workers/
packages/     shared/ (types + Zod schemas) · seeds/ (taxonomy, categories, sources)
docs/         SRS.md · PROJECT.md · superpowers/specs/
mockups/      design-canvas source — reference only, never built or linted
```

Packaged **by feature, not by layer**, with domain-prefixed filenames (`intake.service.ts`, never
`service.ts`). Four rules: only `*.repository.ts` imports the database; `modules/` imports `ports/`
and never `adapters/`; every threshold lives in `core/config.ts`; a feature is one folder.

## Rules that reviews reject code for breaking

- **Scope is national.** Thai government agencies, not Bangkok only. Nothing is rejected for being
  outside Bangkok; issuing agency is a plain extracted field.
- **Originals are immutable.** `putIfAbsent`, never `put`. A takedown restricts access and writes an
  audit entry; it never alters or deletes the stored file.
- **Every readable record publishes.** Confidence controls marking and review routing, not
  visibility. Below-threshold fields feed neither anomaly statistics nor matching.
- **Wording:** only "statistical anomaly" and "specification-quality check". Never "suspicious",
  "corrupt", or "irregular" about a TOR, a budget, or an agency.
- **AI output is labelled**, carries confidence, model and version, and a source link.
- **PDPA-aligned, never "compliant."** Personal data minimised in what is displayed; redaction in
  one serializer.
- **No hard-coded values.** Hosts, ports, buckets, credentials, model names, thresholds all come
  from configuration with overridable defaults. `localhost` appears in no source file.
- **Two storage endpoints:** `MINIO_ENDPOINT` internal, `MINIO_PUBLIC_URL` browser-reachable. Signed
  URLs are generated on demand, never persisted.
- **Never share a filesystem path between services** — exchange storage keys and fetch the bytes.
- **Thai UI**, and extracted values displayed exactly as extracted.
- **Agencies are not users** — no agency portal, no upload flow for them.

## Security

Passwords with bcrypt or argon2 · HTTPS in deployed environments · access level enforced on admin
and API routes · intake API key-authenticated with a constant-time compare and rate-limited ·
dependency audit in CI · SSRF defence on the URL intake route (scheme allowlist, resolved-address
range checks, re-check after each redirect, size and timeout caps) · magic-byte verification of
uploads · originals served as attachments with `nosniff` · Zod primitives-only filter parsing so no
operator object reaches a Mongo query.

## Working style

- Plan before building. Non-trivial work gets a design spec in `docs/superpowers/specs/` before code.
- Check current primary documentation before writing against a version-sensitive API.
- One concern per commit; Conventional Commits (`type(scope): subject`).
- Never report a fix as working without running the real thing against the running stack. Unit tests
  passing is not verification.
- Tests and builds run in containers, not on the host. Never commit secrets.

## Commands

```
docker compose up      # web :3000 · api :4000 · mongo · minio :9000/:9001
npm run dev            # web + api dev servers
npm test               # vitest
npm run lint           # eslint
npm run build          # all workspaces
```

## If you are here as a cross-check

State what you verified against the primary source (the code, the SRS, the running stack) and what
you only reasoned about. Disagreement with the other model is the useful output — surface it rather
than smoothing it over, and let the primary source decide.
