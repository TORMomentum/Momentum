# DAST report — OWASP ZAP (TOR-322)

_Scans run 2026-11-20 and 2026-11-21. Story TOR-322 (criterion 15); subtasks TOR-356, TOR-357, TOR-358, TOR-359._

## Status

This is the **pre-freeze** report. The final full scan after code freeze (**TOR-358**, Sun 22 Nov 12:00)
has not been run: the security pull requests (#45 to #51) were still open when this was written, so the
second table below is a local merge of them, not the real `main`. **A human must re-run the scan on the
merged `main` and update the tables** (exact command in [Re-running](#re-running)).

## Tool and method

| | |
| :---- | :---- |
| Tool | OWASP ZAP 2.17.0, image `ghcr.io/zaproxy/zaproxy:2.17.0` (pinned in tools/zap/run.sh) (digest `sha256:9624669d…`) |
| Target | the Docker Compose stack, reached from the ZAP container over the Compose network: web `http://web:3000`, API `http://api:4000` |
| Web scan | `zap-baseline.py`: spider (2 minutes) plus passive rules. About 88 URLs, including the seeded TOR detail pages |
| API scan | `zap-api-scan.py -S` (passive only) over [tools/zap/openapi.json](../../tools/zap/openapi.json): `/health`, `/api/v1/tors`, `/tors/facets`, `/tors/{id}`, `/stats/dashboard`, `/me` |
| Not run | ZAP **active** scanning (attack traffic) and the AJAX spider. The baseline is passive by design; the active scan belongs to TOR-358 |
| Data | 10 seeded benchmark TORs (`tools/seed_search_corpus.mts`), one throwaway vendor account |
| Authenticated scan | a vendor is registered and verified through the API (verification link read from Mailpit), signed in through the web `/api/auth/login`, and the `tor-radar-session` cookie is injected into every ZAP request by a replacer rule (`ZAP_SESSION_COOKIE`). This covers `/profile`, `/profile/path` and the other signed-in pages |
| Rules | [tools/zap/zap-rules.tsv](../../tools/zap/zap-rules.tsv): no rule is ignored; two passive rules (PII Disclosure, Vulnerable JS Library) are set to FAIL; any High alert fails the run |

Counts are alert types (one row of ZAP's report, however many URLs it hit), web and API together.

## Results

| Build | High | Medium | Low | Info |
| :---- | ---: | ---: | ---: | ---: |
| `main` at `c676387`, unauthenticated | 0 | 2 | 9 | 5 |
| `main` plus open PRs #45 #48 #47 #50 #49 #46 #51, unauthenticated | 0 | 0 | 5 | 5 |
| same build, signed in as a vendor | 0 | 0 | 6 | 7 |

The integrated build is a throwaway local merge (trivial conflicts in docs, `app.ts`, `accounts.routes.ts`
and `docker-compose.yml` resolved by keeping both sides). It was not pushed.

## Medium and High findings

| Rule | Risk | On `main` | Verdict |
| :---- | :---- | :---- | :---- |
| 10038 Content Security Policy (CSP) Header Not Set | Medium | web, every page | **Fixed in PR #48** (nonce-based CSP; gone in the integrated scan) |
| 10020 Missing Anti-clickjacking Header | Medium | web, every page | **Fixed in PR #48** (`frame-ancestors 'none'` and `X-Frame-Options: DENY`) |

No High alert on any build. Nothing Medium or High remains on the integrated build, so **no code fix was
made in this branch** (TOR-357): both are closed by an open PR.

## Low and Informational findings

| Rule | Risk | Build | Verdict |
| :---- | :---- | :---- | :---- |
| 10037 `X-Powered-By` leaks information | Low | `main`: web and API | **Fixed in PR #48 (web) and PR #45 (API)** |
| 10021 `X-Content-Type-Options` missing | Low | `main`: web and API. After the PRs: only on static assets under `/_next/static` (fonts, CSS, chunks) | API fixed in PR #45; web pages fixed in PR #48. **Open, low**: static assets are not covered by the header middleware. Harmless (same-origin public files) but a one-line addition to the web header config |
| 10063 Permissions Policy Header Not Set | Low | `main`: web. After the PRs: only static chunks | Pages fixed in PR #48. Static chunks: same as above, **open, low** |
| 90004 Cross-Origin-Resource-Policy missing | Low | `main`: web and API. After the PRs: web static assets only (API fixed in PR #45) | **Accepted risk**: the files are public, same-origin site assets; CORP matters for private responses, which carry it |
| 90004 Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy missing | Low | web `/` | **Accepted risk**: Spectre-class isolation is not needed for a site with no cross-origin popups or embeds; enabling COEP could break future embeds. Revisit if the app ever shows third-party content |
| 10044 Big Redirect Detected | Low | signed-in `/` | **False positive**: the page answers 200 with the landing page body; no redirect carries sensitive data |
| 10049 Storable and Cacheable Content / Non-Storable Content | Info | all builds | **No action**: public search and dashboard JSON and static assets are cacheable by design; signed-in pages are `no-store` |
| 100000 Client error response code | Info | API `/me` (401), `/tors/000…` (404) | **No action**: the scan deliberately sent an anonymous request and an unknown id |
| 10109 Modern Web Application | Info | signed-in web | **No action**: informational, tells the spider to use the AJAX spider |
| 10031 User Controllable HTML Element Attribute | Info | `/profile/path?target=…` | **False positive**: the value is rendered by React, which escapes it, and the CSP forbids inline script |

## Other things the scan turned up

- **Web sign-in is broken on `main` under Compose.** The `web` service gets no `APP_ORIGIN`, so
  `POST /api/auth/login` returns 500 (`APP_ORIGIN is required to serve account routes`). The signed-in
  scan therefore could not be run on `main`. PRs #48 and #51 add the variable to the `web` service; the
  integrated build signs in normally.
- **A session cookie is short-lived on the integrated build** (the idle timeout of PR #50): a cookie
  minted a few minutes before a scan had already expired and the spider was redirected to
  `/login?reason=expired`. Mint the cookie immediately before the scan.
- ZAP's passive scan cannot see authorization flaws (one vendor reading another's data), CSRF, or rate
  limiting. Those are covered by tests and by the ASVS plan, not by this report.

## Accepted risks

Only the Low items marked "Accepted risk" above: CORP on public static assets, and COOP/COEP on the web
app. Each has its reason in the table. No rule is suppressed in `zap-rules.tsv`.

## Re-running

TOR-358 (final scan after code freeze, Sun 22 Nov 12:00) must be run by a person **after the security
PRs have merged**, on `main`:

```bash
git switch main && git pull
cp .env.example .env     # then fill the required secrets with throwaway values (see .env.example)
docker compose up -d --build

# 1. signed out
ZAP_LABEL=final tools/zap/run.sh

# 2. signed in: register and verify a vendor (the mail is in Mailpit), sign in through the web
#    app, copy the value of the tor-radar-session cookie, then
ZAP_SESSION_COOKIE=<cookie value> ZAP_LABEL=final-auth tools/zap/run.sh

docker compose down -v
```

Reports (HTML, JSON, Markdown for web and API) are written to `zap-reports/<label>.<run>/` and are gitignored.
Update the tables above from `*.json` and attach the HTML reports to TOR-359. In CI the same scan runs
from the `ZAP DAST` workflow (weekly, or Actions, "Run workflow"); the reports are the `zap-reports`
artifact of that run.

Exit codes of `tools/zap/run.sh`: 0 clean or WARN only, 1 a FAIL rule or a High alert, 3 a scan did not
run. For the full active scan TOR-358 asks for, run `zap-full-scan.py` the same way against
`http://web:3000` on the Compose network, on a throwaway database.
