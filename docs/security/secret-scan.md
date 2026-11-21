# Secret scan of git history

Closes TOR-324 / TOR-365 (ASVS 5.0 criterion 9, threat T13). Compose defaults and
the matching regex are covered in the same story; this page is only the history scan.

## Run

| | |
| :-- | :-- |
| Tool | gitleaks v8.30.1 (`zricethezav/gitleaks:latest`), default ruleset |
| Date | 2026-11-21 |
| Scope | Every ref of `TORMomentum/Momentum` (mirror clone, `--log-opts="--all"`): 530 commits, 6.53 MB |
| Command | `docker run --rm -v <mirror>:/repo zricethezav/gitleaks:latest git /repo --redact -v --log-opts="--all"` |
| Result | 4 findings, 1 rule, 1 file, 1 commit |

The raw JSON report is not committed. Values were redacted by the tool and never printed.

## Findings

| # | Rule | File : line | Commit | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `curl-auth-header` | `docs/superpowers/plans/2026-09-01-slice1-foundation-intake.md:3153` | `a8c3c8d` | False positive |
| 2 | `curl-auth-header` | same file : 3156 | `a8c3c8d` | False positive |
| 3 | `curl-auth-header` | same file : 3181 | `a8c3c8d` | False positive |
| 4 | `curl-auth-header` | same file : 3184 | `a8c3c8d` | False positive |

All four are `curl -H "authorization: Bearer dev-..."` examples in a design plan. The
value is the placeholder development key, not a deployed credential (the file at
`HEAD` shows the same text; no environment uses a `dev-` key). They are allowlisted
in `.gitleaks.toml` by path and by the `Bearer dev-` prefix, so a real token pasted
into that file would still be reported.

**No real credential was found in history. No rotation is required.**

## Limits

- gitleaks reads committed content only. A secret that was never committed (a local
  `.env`, `secrets/`) is out of scope; both are gitignored.
- Default rules recognise known token shapes and high-entropy values next to key
  names. A low-entropy password in prose could be missed.
- The pre-TOR-324 `docker-compose.yml` carried the defaults `change-me-intake-key` and
  `change-me-admin-key`. They are not secrets, but a deployment that ran without
  setting `INTAKE_API_KEYS` / `ADMIN_API_KEYS` used them. Compose now refuses to
  start without those variables; any such deployment should set real keys.

## Keeping it clean

CI runs the same image over the full history on every pull request and push to
`main` (`secret scan` step in `.github/workflows/ci.yml`). A new finding fails the
build; fix it, or allowlist it in `.gitleaks.toml` with a reason once verified.
