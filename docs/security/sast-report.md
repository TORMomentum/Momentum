# SAST and dependency audit report

Story TOR-323 (subtasks TOR-360 to TOR-363). Threat T12, NFR-S1, ASVS V15.2.1. Grading criterion 14.

| | |
| :---- | :---- |
| Date | 2026-11-20 |
| Baseline scanned | `main` at `c676387` (before any change in this PR) |
| Final state | this PR's head commit; the PR run of every tool below is the authoritative record |
| Scope | whole repository; `mockups/`, build output and `node_modules` excluded (`.semgrepignore`, CodeQL `paths-ignore`) |

## 1. Tools, versions, rulesets

| Tool | Version | Ruleset | Runs | Gate |
| :---- | :---- | :---- | :---- | :---- |
| CodeQL | `github/codeql-action@v4` (pinned by SHA), query bundle chosen by the action | `security-and-quality` suite, `javascript-typescript` | every PR, push to `main`, Mondays 02:17 UTC (`.github/workflows/codeql.yml`) | alerts appear in the Security tab and the PR check; branch protection decides whether they block |
| Semgrep OSS | container `semgrep/semgrep:1.186.0` | `p/default`, `p/nodejs`, `p/typescript`, `p/secrets` | every PR and push to `main` (`.github/workflows/semgrep.yml`); no Semgrep account or token | `--error`: any finding fails the job; SARIF uploaded as an artifact and to code scanning |
| npm audit | npm bundled with Node 22 | the GitHub advisory database | every PR (`ci.yml`, step "Dependency audit") | `npm audit --audit-level=high`: a high or critical advisory fails the build |

Decisions:

- **CodeQL suite.** `security-and-quality`, not the default. The default runs only high-precision
  security queries; the extended suite adds reliability and maintainability queries, which are cheap
  to triage on a codebase this size, and the story is graded on finding defects.
- **Audit scope.** All dependencies, not `--omit=dev`. The dev tree (vite, eslint, concurrently) runs
  on CI runners and developer machines, so it is part of the supply chain. It also passes today, so
  the stricter choice cost nothing. Moderate and low advisories are listed in section 4 and do not
  break the build.
- **Actions pinned by commit SHA.** Every `uses:` in every workflow names a 40-character SHA with the
  tag in a comment (Semgrep `github-actions-mutable-action-tag`).

## 2. Semgrep: baseline findings and verdicts

Baseline run on `main` plus the new workflow files: **26 findings**. After the fixes below, the same
command reports **0 findings** (512 rules, 557 files).

| # | Rule | Where | Verdict |
| :---- | :---- | :---- | :---- |
| 1 to 14 | `github-actions-mutable-action-tag` | every `uses:` in `ci.yml`, `deploy.yml`, `gcs-real.yml`, and the new `codeql.yml`, `semgrep.yml` | **Fixed.** Pinned to commit SHAs, so a moved tag can no longer change what runs with the repository token. |
| 15 | `run-shell-injection` | `ci.yml` docs-drift step, `${{ github.base_ref }}` inside `run:` | **Fixed.** The value goes through `env: BASE_REF` and is quoted in the shell. A branch name is attacker-controlled text. |
| 16 | `missing-user` | `apps/api/Dockerfile` | **Fixed.** `USER node`. Verified on Compose: `docker exec` shows `uid=1000(node)` and an upload through the running API still returns 202. |
| 17 | `missing-user` | `apps/web/Dockerfile` | **Fixed.** `USER node`; the web container serves 200 as uid 1000. |
| 18 to 20 | `run-as-non-root` | `deploy/cloudrun/{api,web,worker}.yaml` | **False positive.** The rule looks for the Kubernetes `runAsNonRoot` field, which Cloud Run's service YAML does not have. The images set `USER node`, so they never start as root. `nosemgrep` comment on each file. |
| 21 | `detect-non-literal-regexp` | `admin-accounts.repository.ts` `literal()` | **False positive.** Input is escaped (`[.*+?^${}()\|[\]\\]`) before it reaches `RegExp`, so a search term matches as literal text. |
| 22 | `detect-non-literal-regexp` | `admin.repository.ts` `literal()` | **False positive.** Same escaping. |
| 23 | `detect-non-literal-regexp` | `tors.repository.ts` search fallback | **False positive.** `escapeRegExp(criteria.q)` neutralises every metacharacter. |
| 24 | `detect-non-literal-regexp` | `sources/national-egp/client.ts` `tag()` | **False positive.** `name` is only ever the literals `description`, `link`, `title`, `pubDate`; no feed content reaches it. |
| 25, 26 | `dynamic-urllib-use-detected` | `tools/jira.py`, `tools/jira_seed.py` | **False positive.** Developer-only scripts; the URL is the operator's own Atlassian site (https default) from their environment, not request input. Never part of a deployed service. |

Each suppression is an inline `nosemgrep:` comment with the rule id and the reason, so the next
reader sees the justification at the line and a different finding on the same line still fires.
Path exclusions are in `.semgrepignore` (`mockups/`, build output, `package-lock.json`).

## 3. CodeQL

First PR run (PR 54, `security-and-quality`, javascript-typescript): **0 alerts**. See section 6.

## 4. npm audit

Baseline on `main`: **12 production vulnerabilities (1 low, 5 moderate, 4 high, 2 critical)**, 18 across
the whole tree. The gate would have failed on day one, so the advisories were fixed by lockfile updates
inside the existing semver ranges. The only `package.json` change is one added dev dependency (`vite`).

| Package | Severity | Verdict |
| :---- | :---- | :---- |
| `next` 16.x (many advisories, including RCE in image optimisation) | critical | **Fixed**, updated to 16.4.6 |
| `proxy-addr` (IP spoofing via IPv4-mapped IPv6) | critical | **Fixed**, 2.0.8. Relevant: rate limiting keys on client IP. |
| `body-parser` | high | **Fixed**, 2.4.0 |
| `sharp` | high | **Fixed**, 0.35.5 |
| `source-map-js` | high | **Fixed**, 1.2.4 |
| `zod` | high | **Fixed**, 4.6.7 |
| `fast-xml-parser`, `ip-address`, `qs`, `nodemailer` | moderate/low | **Fixed** by the same update |
| dev: `concurrently` / `shell-quote` | critical | **Fixed** by `npm update` |
| dev: `brace-expansion`, `vite` | high | **Fixed.** `vite` was held at 8.2.2 and `npm update` crashed on it, so it is now an explicit dev dependency `^8.3.8`; that keeps the floor above the advisory. |
| `uuid` below 11.1.1 via `@google-cloud/storage` 8.1.0 (`gaxios`, `gtoken`) | moderate | **Accepted risk.** The advisory is a missing bounds check in `uuid` v3/v5/v6 when a caller passes its own output buffer; the storage client does not, and the fix needs a breaking major of that client. Below the gate. Revisit at its next upgrade. |
| remaining dev-only moderate/low (`@typescript-eslint/*`, `minimatch`, vitest mocker, `mermaid`/`dompurify`/`katex`) | moderate/low | **Accepted risk.** Tooling that never ships and is below the gate; mermaid's fix is a major bump of a docs-only tool. |

After: `npm audit --audit-level=high` exits 0, and so does the same command with `--omit=dev`.
Verified after the bumps: `npm run lint`, `npm run build` and the full test suite pass (958 passed,
10 skipped; run with `--no-file-parallelism` because the parallel run timed out on this loaded
machine's shared Mongo).

## 5. How to re-run

```bash
# dependency audit (what CI runs)
npm audit --audit-level=high

# Semgrep, as CI runs it. On Windows with Docker Desktop, copy the repo WITHOUT node_modules
# first: scanning a bind-mounted node_modules hangs for tens of minutes.
docker run --rm -e SEMGREP_SEND_METRICS=off -v "$PWD:/src" -w /src semgrep/semgrep:1.186.0 \
  semgrep scan --config p/default --config p/nodejs --config p/typescript --config p/secrets --error
# add  --sarif --output semgrep.sarif  to get the report file

# CodeQL alerts for a PR (token with security_events read)
gh api "repos/TORMomentum/Momentum/code-scanning/alerts?ref=refs/pull/<n>/merge"
```

CodeQL itself is run by its workflow; running it locally needs the CodeQL CLI and a database build,
and was not done here.

## 6. CodeQL alerts from the first PR run

Pulled with `gh api "repos/TORMomentum/Momentum/code-scanning/alerts?ref=refs/pull/54/merge"` after the first run:

- CodeQL: **0 alerts.**
- Semgrep (uploaded as SARIF): 9 alerts, exactly findings 18 to 26 of section 2. Semgrep still emits
  results that carry an inline `nosemgrep`, with a suppression marker, and code scanning lists them as open.
  They were dismissed in code scanning as "false positive" with a pointer to this report. The `--error`
  gate honours the inline comments and passes.

## 7. Not verified

- The Cloud Run services were not redeployed; `USER node` was verified on Docker Compose only.
- Semgrep severities for findings 1 to 17 were not retained in the baseline output.
