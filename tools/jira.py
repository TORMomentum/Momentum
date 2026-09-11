"""Read and move Jira issues from the command line.

Auth comes from the environment and is never written to disk:

  JIRA_EMAIL=you@example.com          (or put both in the repo's untracked .env)
  JIRA_TOKEN=<API token from id.atlassian.com/manage-profile/security/api-tokens>
  set JIRA_SITE=https://momentumm.atlassian.net   (default)
  set JIRA_PROJECT=TOR                            (default)

Usage:
  python tools/jira.py show TOR-88            one issue, its subtasks, its status
  python tools/jira.py find "wireframes"      issues whose summary matches text
  python tools/jira.py board                  every issue grouped by status
  python tools/jira.py start TOR-88           -> In Progress
  python tools/jira.py done TOR-88            -> Done
  python tools/jira.py done TOR-88 --subtasks -> Done, subtasks first
  python tools/jira.py move TOR-88 "In Review"
  python tools/jira.py create "Summary" --type Story --parent TOR-8 --body "why"

Every command takes --dry-run, which prints the transition it would make and
changes nothing. Transition names differ per board, so `show` prints the ones
this issue actually offers.
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

# Summaries are Thai and the console here runs on cp874, which cannot encode them
# (or the tree arrows). Print UTF-8 regardless of the console's codepage.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_env_file() -> None:
    """Read the repo's untracked .env, so a token never has to be typed on a
    command line (where it lands in shell history and process listings).
    Real environment variables win — this only fills what is missing."""
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir)
    path = os.path.join(root, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

SITE = os.environ.get("JIRA_SITE", "https://momentumm.atlassian.net").rstrip("/")
PROJECT = os.environ.get("JIRA_PROJECT", "TOR")
EMAIL = os.environ.get("JIRA_EMAIL")
TOKEN = os.environ.get("JIRA_TOKEN")

# Names vary by board, so each intent lists what it will accept, best match first.
TRANSITION_ALIASES = {
    "start": ["in progress", "start progress", "in development", "doing"],
    "done": ["done", "closed", "complete", "completed", "resolve", "resolved"],
    "review": ["in review", "review", "code review", "peer review"],
}


def auth_header() -> str:
    if not EMAIL or not TOKEN:
        sys.exit(
            "Set JIRA_EMAIL and JIRA_TOKEN first — they are read from the environment "
            "and never stored.\n"
            "  Token: https://id.atlassian.com/manage-profile/security/api-tokens"
        )
    return base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        SITE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Basic {auth_header()}",
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
        raise SystemExit(f"{method} {path} -> {e.code}: {detail[:400]}")


def search(jql: str, fields: str = "summary,status,issuetype,parent,subtasks,assignee") -> list[dict]:
    """JQL search. Jira Cloud retired /search in favour of /search/jql (POST)."""
    result = call(
        "POST",
        "/rest/api/3/search/jql",
        {"jql": jql, "maxResults": 100, "fields": fields.split(",")},
    )
    return result.get("issues", [])


def plain(adf_or_text) -> str:
    """Flatten Atlassian Document Format to something printable."""
    if not adf_or_text:
        return ""
    if isinstance(adf_or_text, str):
        return adf_or_text
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text":
                out.append(node.get("text", ""))
            for child in node.get("content", []) or []:
                walk(child)
            if node.get("type") == "paragraph":
                out.append("\n")
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(adf_or_text)
    return "".join(out).strip()


# ------------------------------------------------------------------ commands ----
def cmd_show(args) -> None:
    issue = call(
        "GET",
        f"/rest/api/3/issue/{args.key}?fields=summary,status,description,subtasks,issuetype,parent,labels,customfield_10016",
    )
    f = issue["fields"]
    print(f"{issue['key']}  [{f['status']['name']}]  {f['summary']}")
    if f.get("parent"):
        print(f"  parent: {f['parent']['key']} — {f['parent']['fields']['summary']}")
    if f.get("labels"):
        print(f"  labels: {', '.join(f['labels'])}")
    points = f.get("customfield_10016")
    if points:
        print(f"  points: {points}")

    body = plain(f.get("description"))
    if body:
        print("\n--- description ---")
        print(body[:4000])

    subs = f.get("subtasks") or []
    if subs:
        print(f"\n--- subtasks ({len(subs)}) ---")
        for s in subs:
            print(f"  {s['key']:<10} [{s['fields']['status']['name']:<12}] {s['fields']['summary']}")

    names = [t["name"] for t in call("GET", f"/rest/api/3/issue/{args.key}/transitions")["transitions"]]
    print(f"\navailable transitions: {', '.join(names)}")


def cmd_find(args) -> None:
    escaped = args.text.replace('"', '\\"')
    issues = search(f'project = {PROJECT} AND summary ~ "{escaped}" ORDER BY key ASC')
    if not issues:
        print(f"nothing in {PROJECT} matches {args.text!r}")
        return
    for i in issues:
        f = i["fields"]
        print(f"{i['key']:<10} [{f['status']['name']:<12}] {f['issuetype']['name']:<8} {f['summary']}")


def cmd_board(_args) -> None:
    issues = search(f"project = {PROJECT} ORDER BY status ASC, key ASC")
    by_status: dict[str, list[dict]] = {}
    for i in issues:
        by_status.setdefault(i["fields"]["status"]["name"], []).append(i)
    for status, group in by_status.items():
        print(f"\n=== {status} ({len(group)}) ===")
        for i in group:
            f = i["fields"]
            parent = f" ↳ {f['parent']['key']}" if f.get("parent") else ""
            print(f"  {i['key']:<10} {f['issuetype']['name']:<8} {f['summary'][:70]}{parent}")


def transition_to(key: str, intent: str, dry_run: bool, explicit: str | None = None) -> None:
    available = call("GET", f"/rest/api/3/issue/{key}/transitions")["transitions"]
    wanted = [explicit.lower()] if explicit else TRANSITION_ALIASES[intent]

    match = None
    for candidate in wanted:
        for t in available:
            if t["name"].lower() == candidate:
                match = t
                break
        if match:
            break
    if not match:  # fall back to a substring hit before giving up
        for candidate in wanted:
            for t in available:
                if candidate in t["name"].lower():
                    match = t
                    break
            if match:
                break

    if not match:
        offered = ", ".join(t["name"] for t in available)
        raise SystemExit(f"{key}: no transition matching {wanted}. This issue offers: {offered}")

    if dry_run:
        print(f"[dry-run] {key} -> {match['name']}")
        return
    call("POST", f"/rest/api/3/issue/{key}/transitions", {"transition": {"id": match["id"]}})
    print(f"{key} -> {match['name']}")


def cmd_start(args) -> None:
    transition_to(args.key, "start", args.dry_run)


def cmd_move(args) -> None:
    transition_to(args.key, "done", args.dry_run, explicit=args.status)


def cmd_done(args) -> None:
    if args.subtasks:
        issue = call("GET", f"/rest/api/3/issue/{args.key}?fields=subtasks")
        for s in issue["fields"].get("subtasks") or []:
            if s["fields"]["status"]["name"].lower() in ("done", "closed", "completed"):
                continue
            transition_to(s["key"], "done", args.dry_run)
    transition_to(args.key, "done", args.dry_run)


def cmd_create(args) -> None:
    """Create one issue.

    Kept deliberately small: a summary, a type, an optional parent and an
    optional description. Seeding a whole board is `jira_seed.py`'s job — this
    is for the card that turns up mid-flight, which is the moment the work
    otherwise goes unrecorded.
    """
    fields: dict = {
        "project": {"key": PROJECT},
        "summary": args.summary,
        "issuetype": {"name": args.type},
    }
    if args.parent:
        fields["parent"] = {"key": args.parent}
    if args.body:
        fields["description"] = {
            "type": "doc",
            "version": 1,
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": line}]}
                for line in args.body.splitlines()
                if line.strip()
            ],
        }

    if args.dry_run:
        print(f"would create {args.type} in {PROJECT}: {args.summary}")
        if args.parent:
            print(f"  parent: {args.parent}")
        return

    created = call("POST", "/rest/api/3/issue", {"fields": fields})
    print(f"{created['key']}  {args.summary}")
    print(f"{SITE}/browse/{created['key']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("show", help="one issue, its subtasks and its transitions")
    p.add_argument("key")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("find", help="issues whose summary matches text")
    p.add_argument("text")
    p.set_defaults(func=cmd_find)

    p = sub.add_parser("board", help="every issue grouped by status")
    p.set_defaults(func=cmd_board)

    p = sub.add_parser("start", help="move to In Progress")
    p.add_argument("key")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_start)

    p = sub.add_parser("done", help="move to Done")
    p.add_argument("key")
    p.add_argument("--subtasks", action="store_true", help="close open subtasks first")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_done)

    p = sub.add_parser("create", help="create one issue")
    p.add_argument("summary")
    p.add_argument("--type", default="Story", help="Story | Subtask | Task | Bug (default Story)")
    p.add_argument("--parent", help="epic key for a Story, or story key for a Subtask")
    p.add_argument("--body", help="description; blank-line separated paragraphs")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("move", help="move to a named status")
    p.add_argument("key")
    p.add_argument("status")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_move)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
