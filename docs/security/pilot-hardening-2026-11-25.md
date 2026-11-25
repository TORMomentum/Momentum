# Pilot hardening pass — 2026-11-25 (TOR-110)

**Cards:** TOR-111 (end-to-end), TOR-112 (mobile), TOR-113 (security checklist), TOR-114 (burn-down)
**Requirements:** NFR-F2, NFR-F4 (performance), NFR-S1 (security baseline), NFR-S6 (Compose)
**Where:** the full Compose stack built from this branch, on side ports (project `tor110`: web :3200, api :4200),
with `docker-compose.vertex.yml` so extraction ran against real Vertex AI. Two demo TORs and two demo vendors from
`tools/demo-seed.mjs`. No Atlas data was read or written by the stack.

Every result below is from a live request against that stack unless it says otherwise.

## 1. End to end (TOR-111)

| Step | How | Result |
| :--- | :--- | :--- |
| Ingest | `demo-seed.mjs` → `POST /api/v1/intake` with the intake key, `tor-01.pdf` and `tor-05.pdf` | `202`, both `queued` |
| Extract | Compose `worker` with a Vertex identity | both `job_published` (3 min 48 s for the first, which included the cold start; 17 s for the second); `gemini-3.5-flash`, confidence `high` |
| Publish | `GET /api/v1/tors/:id` | title, agency, category `งานก่อสร้าง-ชลประทานและระบบน้ำ`, budget `5524000` from `๕,๕๒๔,๐๐๐.๐๐ บาท`, model named on the record |
| Statistics | Compose `stats-worker` (new) | 24 cohorts swept; `/stats/dashboard` totals 2 TORs, ฿6,316,000; the "ยังไม่เคยคำนวณ" banner gone |
| Match | vendor A sets `construction.irrigation`, then `GET /me/matches` | the irrigation TOR, score 0.85, reason "ตรงกับหมวดงานที่คุณเลือก: เขื่อน คลอง และงานชลประทาน" |
| Notify | Compose `notify-worker` (new), `NOTIFY_DISPATCH_ENABLED=true` | Mailpit received "TOR ใหม่ 1 รายการตรงกับทักษะของคุณ" for vendor A |
| Web | `/dashboard` signed in as vendor A, production build | "TOR ที่ตรงกับคุณ" with the 85% match |

**Found and fixed:** the Compose stack could not run the chain. (a) The worker had no Vertex identity, so records stayed
`queued` — `docker-compose.vertex.yml` mounts the host key file read-only into the worker alone. (b) There was no
`stats-worker` or `notify-worker` service, so the dashboard never computed and no email was sent — both are Compose
services now; `stages-worker` is behind a profile because it calls e-GP.

## 2. Mobile (TOR-112)

Phone width 375 × 812 in the built-in browser, production build.

| Page | Before | After |
| :--- | :--- | :--- |
| Every page with the header | page 458–647 px wide: brand, tabs and the sign-in pair on one row | header on two rows (brand and account / tabs), page 375 px |
| `/dashboard` | the 44 px stat figures and long agency names pushed the page sideways; the baht total wrapped onto three lines | stats in two shrinkable columns with the baht total on its own row; the chart column shrinks (`minmax(0, 1fr)`) and agency names truncate |
| "TOR ที่ตรงกับคุณ" (dashboard, search) | title squeezed to a 100 px column, one word a line | score and days on one line, then the title at full width, then the budget |
| `/`, `/search`, `/tors/:id`, `/login`, `/methodology`, `/admin/login` | — | 375 px, no sideways scroll |

**NFR-F4 (dashboard ≤ 3 s on a mobile browser):** at phone width, signed in, production build: TTFB 240 ms,
`DOMContentLoaded` 386 ms, `load` 468 ms. This is a local machine with no network throttling; it shows the server and
bundle are not the bottleneck, not what a phone on a cellular network sees. The deployed site's first request after
idle takes about 30 s (Cloud Run scale to zero, `minScale: 0`); that is a deployment choice, kept for cost.

## 3. Security baseline (TOR-113, NFR-S1 and CLAUDE.md §Security baseline)

| Control | Probe | Result |
| :--- | :--- | :--- |
| Passwords hashed with bcrypt or argon2 | the stored hash of a demo account | `$argon2…` ✅ |
| HTTPS in deployment | `http://` on the deployed web URL | `302` to `https://` ✅ (IAP answers before the app, so the app's own HSTS is not visible there) |
| Access level on admin routes | `GET /admin/sources` anonymous / vendor / admin | `401` / `403` / `200` ✅ |
| Admin intake | `POST /intake/upload` anonymous / vendor | `401` / `403` ✅ |
| Intake key | `POST /intake` with no key / a wrong key | `401` / `401` ✅; compared with `timingSafeEqual` (`intake.auth.ts`) |
| Intake rate limit | 70 requests in a minute | 9 × `401`, then 61 × `429`, `RateLimit-Limit: 60` ✅ |
| Magic bytes | HTML declared as `application/pdf` | `400` "Unsupported document type" ✅ |
| SSRF on URL intake | `127.0.0.1`, `169.254.169.254`, `10.0.0.1`, `localtest.me`, `[::1]`, `file://` | all refused: "non-public address" ×4, "did not resolve", "Unsupported URL scheme" ✅ |
| Operator injection in filters | `?agency[$eq]=<real agency>` | ignored: 2 results, as unfiltered (applied, it would be 1) ✅ |
| Originals | `GET /tors/:id/document` | `nosniff`, `private, no-store`, `attachment` ✅ |
| API headers | `GET /tors` | CSP `default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, CORP `same-origin`, no `X-Powered-By` ✅ |
| CORS | a foreign `Origin` | no `Access-Control-Allow-Origin` ✅ |
| Cross-origin writes | `PUT /me/profile` from a foreign `Origin` with a valid session | `403` ✅ |
| Web headers | `GET /` | nonce CSP with `strict-dynamic`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` ✅; the pages also refused to load in an iframe |
| Dependency audit | `npm audit --audit-level=high` (also in CI) | 0 vulnerabilities ✅ |

No control failed.

## 4. Burn-down (TOR-114)

| Found | Done |
| :--- | :--- |
| Compose could not extract, compute statistics or send email | fixed (§1) |
| Phone layout overflowed on every page with the header, and on the dashboard | fixed (§2) |
| `API.md` intake example still sent `X-Api-Key: $ADMIN_API_KEY` (gone since TOR-199) | fixed: `x-session-id` |
| `API.md` named the intake limit `INTAKE_RATE_LIMIT_PER_MINUTE`; the code reads `INTAKE_RATE_LIMIT`, which `.env.example` did not list | fixed in both |
| ARCHITECTURE drew the match-email arrow from the extraction worker and said there was no stats service | fixed |
| The worker prints `MaxListenersExceededWarning` on a `PassThrough` while reading a stored document | open: our code reads the stream once (`collect`, `for await`); the listeners are added inside the storage client. Both jobs published; logged in TODO |
| An unknown API path answers Express's default HTML 404 ("Cannot GET …") | open, low: the CSP is `default-src 'none'`, so nothing in it runs; a JSON 404 would be tidier |
