# TOR Radar BKK

Centralized Thai-language platform for Bangkok (BMA) procurement TORs.
See [docs/PROJECT.md](docs/PROJECT.md) for the full spec.

## Layout

```
apps/web/       Next.js dashboard (public + admin)
apps/api/       Express REST API + matching + notifications
docs/           spec (PROJECT.md), SRS, source API reference (DATA-SOURCES.md), proposal
mockups/        design-canvas mockups — not app code, not built or linted
tools/          source collection, seed generation, Jira seeding
.github/        CI
```

## Local dev

```
cp .env.example .env        # then edit secrets
docker compose up           # web :3000, api :4000, mongo :27017, minio :9000/:9001
```

## Without Docker

```
npm install
npm run dev                 # runs web + api dev servers
npm test                    # vitest
npm run lint                # eslint
npm run build               # build all apps
```

## Source data

The BMA eGP source system is wired up behind our own API — no key, no cookie, nothing to
configure. With the stack running, `GET /sources/bma-egp/tors` lists TOR announcements and
`/sources/bma-egp/tors/<projectId>/documents` returns their source PDFs.

```
npm run dev                     # terminal 1 — wait for "listening on 0.0.0.0:4000"
node tools/check-source.mjs     # terminal 2 — verify the whole chain; non-zero on failure
node tools/build_seeds.mjs      # regenerate the generated taxonomy seed (no server needed)
```

Endpoints, upstream quirks, document formats and the taxonomy seeds:
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

Node 22+. CI runs lint + test + build on every PR (`.github/workflows/ci.yml`).
