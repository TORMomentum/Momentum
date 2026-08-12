"""Seed the TOR Radar Jira project: epics (= FR groups), stories (US-01..16 +
setup work), and subtasks, labeled by sprint and MoSCoW priority.

Usage (no secrets in this file — pass via environment):
  set JIRA_EMAIL=you@example.com
  set JIRA_TOKEN=<user API token from id.atlassian.com/manage-profile/security/api-tokens>
  set JIRA_SITE=https://momentumm.atlassian.net   (default)
  set JIRA_PROJECT=TOR                            (default; created if missing)
  python tools/jira_seed.py

Idempotent-ish: skips creating an issue when one with the same summary already
exists in the project.
"""
import json
import os
import sys
import urllib.request
import urllib.error
import base64

SITE = os.environ.get("JIRA_SITE", "https://momentumm.atlassian.net").rstrip("/")
EMAIL = os.environ.get("JIRA_EMAIL")
TOKEN = os.environ.get("JIRA_TOKEN")
PROJECT = os.environ.get("JIRA_PROJECT", "TOR")

if not EMAIL or not TOKEN:
    sys.exit("Set JIRA_EMAIL and JIRA_TOKEN environment variables first.")

AUTH = base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        SITE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Basic {AUTH}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code}: {detail[:500]}") from None


def adf(text: str) -> dict:
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]}
            for line in text.split("\n")
            if line.strip()
        ],
    }


# ---------------------------------------------------------------- project ----
def ensure_project() -> dict:
    try:
        return call("GET", f"/rest/api/3/project/{PROJECT}")
    except RuntimeError:
        pass
    me = call("GET", "/rest/api/3/myself")
    print(f"Creating project {PROJECT} (team-managed Scrum)...")
    for template in (
        "com.pyxis.greenhopper.jira:gh-simplified-agility-scrum",
        "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
        "com.pyxis.greenhopper.jira:gh-simplified-agility-kanban",
    ):
        try:
            call(
                "POST",
                "/rest/api/3/project",
                {
                    "key": PROJECT,
                    "name": "TOR Radar BKK",
                    "projectTypeKey": "software",
                    "projectTemplateKey": template,
                    "leadAccountId": me["accountId"],
                },
            )
            break
        except RuntimeError as e:
            print(f"  template {template.split(':')[-1]} failed: {e}")
    return call("GET", f"/rest/api/3/project/{PROJECT}")


def issue_type_ids(project: dict) -> dict:
    types = {"epic": None, "story": None, "subtask": None}
    for t in project.get("issueTypes", []):
        n = t["name"].lower().replace("-", "")
        if n == "epic":
            types["epic"] = t["id"]
        elif n in ("story", "task") and types["story"] is None or n == "story":
            types["story"] = t["id"]
        elif n == "subtask":
            types["subtask"] = t["id"]
    missing = [k for k, v in types.items() if v is None]
    if missing:
        sys.exit(f"Project lacks issue types: {missing} — check project template.")
    return types


def existing_summaries() -> set:
    out, start = set(), 0
    while True:
        r = call(
            "POST",
            "/rest/api/3/search/jql",
            {"jql": f'project = "{PROJECT}"', "fields": ["summary"],
             "maxResults": 100, "startAt": start},
        )
        for it in r.get("issues", []):
            out.add(it["fields"]["summary"])
        if start + 100 >= r.get("total", 0):
            return out
        start += 100


def create(fields: dict) -> str:
    return call("POST", "/rest/api/3/issue", {"fields": fields})["key"]


# ------------------------------------------------------------------- data ----
# (epic key placeholder, summary, description, labels)
EPICS = [
    ("SETUP", "Sprint-1 validation, benchmark & skeleton",
     "Inception/Elaboration gate: interviews, TOR corpus, extraction accuracy benchmark (NFR-1), repo/CI/Docker.", ["sprint-1"]),
    ("FR-A", "TOR ingestion",
     "Upload/URL/API ingestion, immutable raw storage in MinIO, dedup, Bangkok-only validation.", ["sprint-2"]),
    ("FR-B", "AI extraction & normalization",
     "Thai OCR, structured fields, two-tier confidence policy, taxonomy normalization, PII handling.", ["sprint-2"]),
    ("FR-C", "Matching & email notification",
     "Match engine, email delivery <= 5 min (pilot), notification preferences.", ["sprint-4"]),
    ("FR-D", "Profiles & auth",
     "Registration/login, roles, skill profiles, PDPA consent/export/delete.", ["sprint-4"]),
    ("FR-E", "Public dashboard & visualization",
     "Thai-UI public dashboard, pricing plots, documented anomaly rule, shared TOR detail page, archive.", ["sprint-3"]),
    ("FR-F", "AI quality checklist",
     "Heuristic explainable spec-quality score; labeled AI-generated; feeds dashboard.", ["sprint-5"]),
    ("FR-G", "Admin tooling",
     "Review queue (ships with ingestion), correction store as few-shot examples, taxonomy seeds.", ["sprint-2"]),
]

# (epic, summary, description, labels, [subtasks])
STORIES = [
    ("SETUP", "Validate demand: >=3 customer-proxy interviews",
     "Interview 2-3 real freelancers + sponsor as customer proxy. Output: revised, confirmed backlog (phase-gate deliverable).",
     ["sprint-1", "must"],
     ["Write interview script", "Recruit interviewees", "Run interviews & take notes", "Fold findings into revised backlog"]),
    ("SETUP", "Collect 10-20 real BMA TOR corpus",
     "Source real TORs from BMA announcement pages covering text PDF, scan, and photo formats.",
     ["sprint-1", "must"],
     ["Identify BMA announcement pages", "Download & catalog documents", "Record format mix and metadata"]),
    ("SETUP", "Extraction accuracy benchmark (NFR-1)",
     "Vertex AI spike on the corpus; measure field-level accuracy; set both FR-B3 confidence thresholds (T_low, T_high) from data. Phase gate: if accuracy insufficient, plan changes.",
     ["sprint-1", "must"],
     ["Set up GCP project + Vertex AI access", "Build extraction spike script", "Hand-label ground truth for corpus", "Score field-level accuracy & pick thresholds"]),
    ("SETUP", "Repo, CI, Docker Compose skeleton",
     "Monorepo skeleton (Next.js + Express), CI running tests on PR, docker compose up brings the stack.",
     ["sprint-1", "must"],
     ["Scaffold Next.js + Express apps", "Write docker-compose (web, api, mongo, minio)", "CI workflow: lint + test on PR", "Commit .env.example; gitignore .env"]),

    ("FR-D", "US-01 Vendor profile with skills & preferences",
     "As a vendor I can create a profile with skills (taxonomy tags), certifications, past projects, budget range. PDPA consent checkbox required.",
     ["sprint-4", "must"],
     ["Profile schema + CRUD API", "Profile UI (Thai)", "Taxonomy tag picker from seeded JSON", "PDPA consent flow"]),
    ("FR-C", "US-02 Email notification on matching TOR",
     "Email delivered <= 5 min after publish (pilot env); message includes match reason.",
     ["sprint-4", "must"],
     ["Notification dispatch worker", "Email template (Thai) with match reasons", "Delivery timing test in pilot env"]),
    ("FR-C", "US-03 Match explanation",
     "Match detail lists >= top 3 matched skill tags + budget-range fit.",
     ["sprint-4", "must"],
     ["Score breakdown in match engine", "Explanation rendering in email + web"]),
    ("FR-E", "US-04 Search & filter TORs",
     "Filters: agency, budget range, category, deadline; composable; < 2 s on seeded corpus.",
     ["sprint-3", "must"],
     ["Search API with composable filters", "Filter UI (Thai)", "Index tuning + timing check"]),
    ("FR-E", "US-05 Structured TOR view with source link",
     "Shared TOR detail page: all extracted fields + link to immutable original + provenance (extracted <date> by <model>).",
     ["sprint-2", "must"],
     ["Detail page UI", "Provenance + confidence display", "Immutable source link from MinIO"]),
    ("FR-F", "US-06 Quality-checklist result on TOR",
     "Score + >= 3 concrete checklist reasons displayed; labeled AI-generated.",
     ["sprint-5", "should"],
     ["Implement heuristic checks (budget/deadline/scope/quals)", "Score + reasons UI", "Methodology page"]),
    ("FR-E", "US-07 Bookmarks, status & personal archive",
     "Bookmark TORs; status announced/closed/awarded with history; private self-reported pursue/won/completed marks move to personal archive (FR-D4). Never public.",
     ["sprint-5", "could"],
     ["Bookmark API + UI", "Status history display (FR-E5)", "Private project marks + archive view"]),
    ("FR-E", "US-08 Public dashboard per agency",
     "No-login dashboard: TOR count + total budget per agency, date filter, data-last-updated + coverage note.",
     ["sprint-3", "must"],
     ["Aggregation API", "Dashboard UI (Thai)", "Data-last-updated + coverage banner"]),
    ("FR-E", "US-09 Pricing plots with statistical anomalies",
     "Scatter/box by category; FR-E2 rule: peer group (category x time window), n >= 8, 1.5xIQR or z > 3; label 'statistical anomaly' only.",
     ["sprint-3", "must"],
     ["Implement anomaly rule as documented function", "Plot component with flagged points", "Unverified fields excluded from stats"]),
    ("FR-E", "US-10 Journalist/researcher dashboard filters",
     "Filters compose; totals update; trend line per period.",
     ["sprint-3", "must"],
     ["Composable filter state", "Totals + trend line rendering"]),
    ("FR-F", "US-11 Checklist scores for journalists",
     "Same surface as US-06; methodology page linked.",
     ["sprint-5", "should"],
     ["Surface checklist on dashboard views"]),
    ("FR-E", "US-12 CSV export of filtered TOR list",
     "Export respects active filters; includes extracted fields + source links; PII-minimized (FR-E6).",
     ["sprint-5", "could"],
     ["Export endpoint respecting filters", "PII minimization pass", "Export button UI"]),
    ("FR-A", "US-13 Ingest TOR via upload, URL, or API",
     "Admin seeds corpus: file upload (PDF/JPG/PNG), URL fetch, authenticated REST endpoint; all feed one pipeline; dedup (FR-A3); Bangkok-only check (FR-A4).",
     ["sprint-2", "must"],
     ["Upload endpoint + MinIO immutable store", "URL fetch route", "Authenticated ingestion API + rate limit", "Dedup by content hash", "BMA agency-list validation"]),
    ("FR-G", "US-14 Admin review queue",
     "Only very-low-confidence / sanity-check failures queue; side-by-side original vs fields; approve clears unverified tag; corrections stored as few-shot examples (FR-G2).",
     ["sprint-2", "must"],
     ["Queue list + filters", "Side-by-side editor", "Approve flow clears tag + feeds anomaly/matching", "Correction store for few-shot reuse"]),
    ("FR-G", "US-15 Taxonomy & agency list management",
     "Skill tags, categories, canonical BMA agency list seeded from JSON; admin edit UI is stretch.",
     ["sprint-2", "could"],
     ["Author seed JSON files", "Seed loader on startup"]),
    ("FR-A", "US-16 Ingestion-source health monitoring",
     "Stretch - only relevant once scraping (FR-A-S1) exists.",
     ["backlog", "could"],
     []),

    ("FR-B", "Extraction pipeline with two-tier confidence policy",
     "FR-B1..B4: OCR -> structured fields -> per-field confidence; all records publish; unverified tag below T_high; queue below T_low or sanity-check hit; below-threshold fields never feed anomaly stats or matching.",
     ["sprint-2", "must"],
     ["Vertex AI extraction service", "Per-field confidence + tier logic", "Sanity checks (missing budget/agency/deadline, implausible values)", "Qualification normalization to taxonomy", "PII minimization in displayed fields (FR-B5)"]),
    ("FR-D", "Auth & roles (vendor / admin / public)",
     "Email + OAuth login; RBAC on admin and API routes; hashed credentials; PDPA export/delete.",
     ["sprint-4", "must"],
     ["Auth flows", "RBAC middleware", "PDPA export + delete endpoints"]),
]


def main():
    project = ensure_project()
    types = issue_type_ids(project)
    done = existing_summaries()
    epic_keys: dict[str, str] = {}

    for code, summary, desc, labels in EPICS:
        title = f"{code}: {summary}"
        if title in done:
            found = call("POST", "/rest/api/3/search/jql",
                         {"jql": f'project = "{PROJECT}" AND summary ~ "\\"{title}\\""',
                          "fields": ["summary"], "maxResults": 5})
            epic_keys[code] = found["issues"][0]["key"]
            print(f"= epic exists {epic_keys[code]}  {title}")
            continue
        key = create({
            "project": {"key": PROJECT},
            "issuetype": {"id": types["epic"]},
            "summary": title,
            "description": adf(desc),
            "labels": labels,
        })
        epic_keys[code] = key
        print(f"+ epic {key}  {title}")

    for epic, summary, desc, labels, subtasks in STORIES:
        if summary in done:
            print(f"= story exists  {summary}")
            continue
        key = create({
            "project": {"key": PROJECT},
            "issuetype": {"id": types["story"]},
            "summary": summary,
            "description": adf(desc),
            "labels": labels,
            "parent": {"key": epic_keys[epic]},
        })
        print(f"+ story {key}  {summary}")
        for st in subtasks:
            create({
                "project": {"key": PROJECT},
                "issuetype": {"id": types["subtask"]},
                "summary": st,
                "parent": {"key": key},
            })
            print(f"    + subtask  {st}")

    print("\nDone. Board: " + SITE + f"/jira/software/projects/{PROJECT}/boards")


if __name__ == "__main__":
    main()
