# TOR Radar — security demo script

Presentation Monday 23 November 2026, 13:00 · about 9 minutes of demo · Docker Compose on one laptop.
Slides: [security-slides.html](security-slides.html) (slide 14 is the agenda).

Commands are for a POSIX shell (Git Bash, WSL, macOS, Linux) run from the repository root. Ports below are
the defaults; if you changed `WEB_PORT` / `API_PORT` / `MAIL_UI_PORT` in `.env`, change them here.

## Which steps need which pull request

This script is written for the state where every Sprint 6 security pull request is merged. Until then the
step marked below shows nothing, or the "before" picture. Check the table the morning of the presentation and
cut or reword what has not landed. `[main]` means it runs on `main` today.

| Step | Needs | Verified when written |
| :-- | :-- | :-- |
| 0 Stack and seed | #51 for the "refuses to start without keys" check; the rest `[main]` | Seed script ran twice on `main` (second run idempotent) |
| 1 Web headers and CSP | #48 | `main` shows only `X-Powered-By: Next.js` |
| 2 API headers and CORS | #45 | `main` shows only `X-Powered-By: Express` |
| 3 Login burst gives 429 | `[main]` | Ran on `main`: `401 401 401 401 401 429 429 …` |
| 4 Breached password refused | #49 | Not run here (PR branch); the PR author ran it live |
| 5 Session idle expiry | #50 | Not run here; the PR author ran it live |
| 6 Google sign-in | TOR-315, no PR yet | Not available |
| 7 Vendor B cannot read A's file | `[main]` (test and matrix: #52) | Ran on `main`: A 200, B 404, no session 401 |
| 8 Admin action in the log | #46 | Not run here |
| 9 Reports and pipeline | TOR-322 ZAP, TOR-323 SAST, #44 CD | ZAP and SAST: no PR yet |

## Before the demo (once, the day before)

1. A clean checkout of the branch you present, with the `.env` from README "Install and run" (secrets
   generated, `APP_ORIGIN` matching the web port).
2. Add a password for the two demo vendors to `.env`, one that is not on a breached-password list:

   ```bash
   echo "DEMO_VENDOR_PASSWORD=$(openssl rand -base64 18)" >> .env
   ```

3. `docker compose up -d --build`, then wait until `docker compose ps` shows everything Up.
4. `node tools/demo-seed.mjs` (step 0 below). Dry-run the whole script once.
5. Open these tabs: `http://localhost:3000`, the Mailpit inbox `http://localhost:8025`, the ZAP report, the
   GitHub Actions tab, and a terminal with a large font. Set `export` lines (below) in that terminal.

Shell variables used throughout (put them in the terminal once):

```bash
set -a; . ./.env; set +a                      # reads .env into this shell; never print it on screen
API=http://127.0.0.1:${API_PORT:-4000}/api/v1
```

## 0. Stack and seed (0:00 – 1:30)

Say: "Everything runs from `docker compose up`. Secrets come from `.env`, which is not in git."

```bash
docker compose ps                              # web, api, worker, mongo, gcs, mail all Up
node tools/demo-seed.mjs
```

Show the output: the two storage buckets, `vendor A ... verified`, `vendor B ... verified` (the script read the
verification emails from Mailpit, like a person would), A's private file id, and two sample TORs stored as
`queued`. Run it a second time to show it is idempotent (`already verified`, `already stored`).

Note: no Vertex AI credential on the demo laptop, so the worker leaves the two TORs `queued` and publishes
nothing it did not extract. That is the intended fail-safe, say so if asked.

Secret handling (needs #51): open `.env.example` and point at the empty `SESSION_SECRET=`, `INTAKE_API_KEYS=`,
`ADMIN_API_KEYS=` and `STAFF_ACCESS_SECRET=` lines, then at `docker-compose.yml`, where each is `${NAME:?... is required}`:
Compose refuses to start without them, and no default key exists.

## 1. Web security headers (1:30 – 2:45) — needs #48

Browser: open `http://localhost:3000`, DevTools (F12) → Network → click the first document request → Headers →
Response Headers. Point at:

- `Content-Security-Policy`: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`,
  `frame-ancestors 'none'`
- `Strict-Transport-Security` (production only; absent on http in this stack, say so)
- `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
- no `X-Powered-By`

Reload: the nonce in the header changes on every request. Terminal alternative:

```bash
curl -sI http://127.0.0.1:${WEB_PORT:-3000}/ | grep -iE "content-security|x-frame|x-content|referrer|strict-transport|x-powered"
```

Before #48 merges this prints only `X-Powered-By: Next.js`. Backup evidence: `docs/security/evidence/web-headers.png`
(added by #48).

## 2. API headers and CORS (2:45 – 3:15) — needs #45

```bash
curl -sI http://127.0.0.1:${API_PORT:-4000}/health | grep -iE "content-security|x-content|x-powered|access-control"
# foreign origin: no Access-Control-* headers come back
curl -si -X OPTIONS "$API/tors" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: GET" | grep -i access-control || echo "no CORS headers for evil.example"
# the app's own origin is echoed, never *
curl -si -X OPTIONS "$API/tors" -H "Origin: $APP_ORIGIN" -H "Access-Control-Request-Method: GET" | grep -i access-control
```

## 3. Rate limit on login (3:15 – 4:00) — works on `main`

Say: "Fourteen wrong passwords from one client."

```bash
for i in $(seq 1 14); do
  curl -s -o /dev/null -w "%{http_code} " -X POST "$API/login" -H "Origin: $APP_ORIGIN" \
    -H 'content-type: application/json' -d '{"email":"vendor-a@demo.example","password":"wrong-password"}'
done; echo
```

Expect `401` five times, then `429` (observed on `main`: `401 401 401 401 401 429 429 429 429 429 429 429 429 429`).
The limiter has its own buckets per IP and per email; with #47 the IP is the real client behind the web server
(`X-Forwarded-For`), not the web container. Wait a minute before the next login step, or the vendors are throttled.

## 4. Breached password refused, in Thai (4:00 – 4:45) — needs #49

Browser: `http://localhost:3000/register`, enter a new email, password `password123`, tick consent, submit.
Show the Thai error. Or by curl:

```bash
curl -s -X POST "$API/register" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' \
  -d '{"email":"new@demo.example","password":"password123","consent":true}' | head -c 300; echo
# a strong password is accepted (202)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/register" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"new@demo.example\",\"password\":\"$DEMO_VENDOR_PASSWORD\",\"consent\":true}"
```

Expect `422` with code `password_breached` for the first. Explain: bundled top-10k list first, then Have I Been
Pwned; only a 5-character SHA-1 prefix leaves the machine.

## 5. Session idle expiry (4:45 – 6:00) — needs #50

Prepare before the demo: set `SESSION_IDLE_TIMEOUT_MS=20000` in `.env` and `docker compose up -d api` (Compose
passes it through). Remember to remove it afterwards.

```bash
SID=$(curl -s -X POST "$API/login" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"vendor-a@demo.example\",\"password\":\"$DEMO_VENDOR_PASSWORD\"}" | sed 's/.*"sessionId":"\([^"]*\)".*/\1/')
curl -s -o /dev/null -w "now: %{http_code}\n" "$API/me" -H "x-session-id: $SID"     # 200
sleep 25
curl -s -o /dev/null -w "after 25 s idle: %{http_code}\n" "$API/me" -H "x-session-id: $SID"   # 401
```

Browser version: log in, leave the tab 25 seconds, click a page: you land on
`/login?reason=expired` with "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง". Mention the absolute lifetime
(`SESSION_LIFETIME_MS`) and that a new login revokes the account's other sessions.

## 6. Google sign-in (not available yet)

TOR-315 has no pull request at the time of writing. When it merges: open `/login`, show the "Sign in with Google"
button, and explain authorization-code flow with PKCE, `state` and `nonce`. It needs a Google OAuth client id and
secret in `.env` (names in `.env.example` after the PR). If it has not merged, skip this step and say it is a
known gap (slides 6 and 13).

## 7. Vendor B cannot read vendor A's file (6:00 – 7:00) — works on `main`

Say: "Vendor A has a private file. Vendor B logs in, knows the file's id, and asks for it."

```bash
login() { curl -s -X POST "$API/login" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"$DEMO_VENDOR_PASSWORD\"}" | sed 's/.*"sessionId":"\([^"]*\)".*/\1/'; }
A=$(login vendor-a@demo.example); B=$(login vendor-b@demo.example)
FID=<VENDOR_A_FILE_ID printed by the seed script>

curl -s -o /dev/null -w "A reads A: %{http_code} %{content_type}\n" "$API/me/vault/$FID/file" -H "x-session-id: $A"   # 200 application/pdf
curl -s -w "  B reads A: %{http_code}\n" "$API/me/vault/$FID/file" -H "x-session-id: $B"                          # 404 not_found
curl -s "$API/me/vault" -H "x-session-id: $B"                                                                     # {"documents":[],...}
curl -s -w "  no session: %{http_code}\n" "$API/me/vault/$FID/file"                                               # 401
```

Explain: `/me` routes take the account from the session, never from an id in the request; another account's id
returns the same `404` as a missing one, so B cannot even tell the file exists. After #52 merges, point at
`docs/security/access-control-matrix.md` and run the proof:
`npx vitest run apps/api/src/core/access-control.test.ts` (77 cases, needs Mongo and GCS up; see README).

## 8. Admin action in the security log (7:00 – 8:00) — needs #46

```bash
ADMIN=${ADMIN_API_KEYS%%,*}
# a harmless admin write (restoring a TOR that does not exist) is still an audited admin action
curl -s -X POST "$API/admin/tors/000000000000000000000000/restore" -H "X-Api-Key: $ADMIN" -H "Origin: $APP_ORIGIN"; echo
# wrong key: refused and logged
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/admin/tors/000000000000000000000000/restore" -H "X-Api-Key: wrong"
docker compose logs api | grep -E "admin.action|auth.denied" | tail -3
```

Show the JSON lines: `admin.action` with actor, route pattern and target id; `auth.denied` 401. Then show the
sanitizer: `docker compose logs api | grep -ciE "$ADMIN|$DEMO_VENDOR_PASSWORD"` prints `0`.

## 9. Reports and pipeline (8:00 – 9:00)

- SAST report: the CI run's code-scanning or Semgrep output (TOR-323, no PR yet). Slide 12 has the counts.
- ZAP report: open the HTML report from the ZAP baseline run (TOR-322, no PR yet).
- Secret scan: `docs/security/secret-scan.md` (#51): 530 commits, 4 false positives, none real.
- CI/CD: GitHub Actions tab → a green `CI` run on `main` → `Deploy to Cloud Run` run with the smoke-check step (#44).

## After the demo

```bash
docker compose down -v        # stops the stack and deletes its volumes (database, stored files, mail)
```

Remove `SESSION_IDLE_TIMEOUT_MS` from `.env` if step 5 set it.

## If something fails live

| Symptom | Likely cause | Fix |
| :-- | :-- | :-- |
| Every login is `429` | A burst earlier in the same minute | Wait 60 s |
| Seed: `no verification email … in Mailpit` | Wrong `MAIL_UI_PORT`, or the api cannot reach `mail` | `docker compose ps`, `docker compose logs api` |
| Seed: password refused (`422`) | Password on a breached list (after #49) | Set another `DEMO_VENDOR_PASSWORD` |
| `Internal server error` on upload | Storage buckets missing | Run `node tools/demo-seed.mjs` again (it creates them) |
| Register/login `403` | Missing `Origin: $APP_ORIGIN` header | Add the header; account writes check it |
