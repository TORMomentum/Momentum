# Task 6 — Storage port and MinIO adapter

- [x] read Task 6 in the plan and spec section 5.8
- [x] make the api test runner see the root .env
  - [x] add the config and confirm loadConfig(process.env) resolves in a test
  - [x] discovered: the root `vitest run` (the CI gate) has no config and does not read
        `.env` — a probe test saw `MINIO_BUCKET: undefined`. A `vitest.config.ts` in
        `apps/api` would only cover `npm test -w @tor-radar/api`, so the loader is
        `apps/api/src/test/env.ts`, imported first by the integration test: one
        mechanism, both runners. It uses Node's own `process.loadEnvFile`, so no
        dependency was added, and a variable already set in the environment wins
        over the file (verified).
- [x] write the failing test
  - [x] apps/api/src/adapters/minio.storage.test.ts with the three cases from the plan
  - [x] run it, confirm it fails because the module does not exist
        (`Error: Cannot find module './minio.storage.js'`)
- [x] define ports/storage.port.ts
- [x] implement adapters/minio.storage.ts
  - [x] putIfAbsent returns the existing object untouched rather than overwriting
  - [x] signedUrl is generated against MINIO_PUBLIC_URL, not the internal endpoint
  - [x] discovered: on this host MINIO_ENDPOINT and MINIO_PUBLIC_URL resolve to the
        same origin (localhost:9010), so the third test cannot by itself tell the two
        clients apart. Verified out of band with a throwaway script that built the
        adapter with the Compose-internal endpoint `tor-radar-minio:9000`: the signed
        URL still began `http://localhost:9010/tor-raw/...`, and fetching a signed URL
        returned 200 with the stored bytes.
- [x] run the test against the live MinIO, confirm all three pass
      (`npm test -w @tor-radar/api -- minio` → 3 passed)
- [x] run the repo gates that CI runs
  - [x] npm test at the root → 6 files, 35 passed
  - [x] npm run lint at the root → clean
  - [x] npm run build -w @tor-radar/api → clean
- [x] commit
