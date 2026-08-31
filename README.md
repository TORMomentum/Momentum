# TOR Radar BKK

Centralized Thai-language platform for Bangkok (BMA) procurement TORs.
See [docs/PROJECT.md](docs/PROJECT.md) for the full spec.

## Layout

```
apps/web/       Next.js dashboard (public + admin)
apps/api/       Express REST API + matching + notifications
docs/           spec (PROJECT.md), SRS, proposal
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

Node 22+. CI runs lint + test + build on every PR (`.github/workflows/ci.yml`).
