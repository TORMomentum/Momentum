# TOR Radar BKK

Centralized Thai-language platform for Bangkok (BMA) procurement TORs.
See [docs/PROJECT.md](docs/PROJECT.md) for the full spec.

## Layout

```
apps/web/       Next.js dashboard (public + admin)
apps/api/       Express REST API + matching + notifications
docs/           spec (PROJECT.md), SRS, source API reference (DATA-SOURCES.md), proposal
mockups/        design-canvas mockups — not app code, not built or linted
tools/          Jira seeding
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

## Source data — no setup needed

The BMA eGP source system is wired up behind our own API (no key, no cookie, nothing to configure).
With the stack running:

```
curl "localhost:4000/sources/bma-egp/tors?pageSize=5"              # TOR announcements (4,873 upstream)
curl "localhost:4000/sources/bma-egp/tors?q=พัฒนาระบบ"              # keyword search
curl "localhost:4000/sources/bma-egp/tors/<projectId>/documents"   # that project's TOR PDFs + source URLs
```

To confirm the whole chain (upstream reachable → our routes → a downloadable source PDF):

```
node tools/check-source.mjs                       # against localhost:4000
API_URL=http://localhost:4123 node tools/check-source.mjs
```

It prints PASS/FAIL per step and exits non-zero on failure.

Endpoint reference and upstream quirks: [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

Node 22+. CI runs lint + test + build on every PR (`.github/workflows/ci.yml`).
