#!/usr/bin/env bash
# DAST baseline (TOR-322): OWASP ZAP passive scan of the running Compose stack.
#
#   docker compose up -d --build        # the stack must already be running
#   tools/zap/run.sh                    # scans web, then the API
#
# Two scans, both PASSIVE (no attack traffic): zap-baseline.py spiders the web
# app; zap-api-scan.py -S imports tools/zap/openapi.json for the API. ZAP runs in
# a container on the Compose network and reaches the services by name, so no host
# port or localhost is involved. Reports land in zap-reports/<label>.<run>/ (gitignored).
#
# Exit: 0 = no FAIL rule and no High alert, 1 = a FAIL rule fired or a High alert
# exists, 3 = a scan did not run. WARN-level alerts never fail the run.
#
# Environment (all optional):
#   COMPOSE_PROJECT_NAME  Compose project whose network is joined (default: repo folder name)
#   ZAP_NETWORK           network name, overrides <project>_default
#   ZAP_WEB_URL           default http://web:3000
#   ZAP_API_URL           default http://api:4000
#   ZAP_LABEL             report sub-folder, default "run"
#   ZAP_SESSION_COOKIE    value of the tor-radar-session cookie: scan as a signed-in vendor
#   ZAP_SPIDER_MINUTES    spider time box, default 2
#   ZAP_IMAGE             default ghcr.io/zaproxy/zaproxy:2.17.0
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# Compose takes the project name from the shell, else from .env, else the folder name.
env_project=""
[ -f "$root/.env" ] && env_project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$root/.env" | tr -d '\r' | head -n 1)"
project="${COMPOSE_PROJECT_NAME:-${env_project:-$(basename "$root" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')}}"
network="${ZAP_NETWORK:-${project}_default}"
web_url="${ZAP_WEB_URL:-http://web:3000}"
api_url="${ZAP_API_URL:-http://api:4000}"
label="${ZAP_LABEL:-run}"
minutes="${ZAP_SPIDER_MINUTES:-2}"
image="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0}"

if [[ ! "$label" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "ZAP_LABEL must contain only letters, digits, underscores or hyphens" >&2
  exit 3
fi
mkdir -p "$root/zap-reports"
out="$(mktemp -d "$root/zap-reports/$label.XXXXXXXX")"
# ZAP reads its -c / -f inputs from, and writes reports to, /zap/wrk.
cp "$here/zap-rules.tsv" "$here/openapi.json" "$out/"
chmod 777 "$out"

# Git Bash on Windows would rewrite the container paths below; Docker wants the
# host path in its native form.
export MSYS_NO_PATHCONV=1
host_out="$(cd "$out" && (pwd -W 2>/dev/null || pwd))"

docker network inspect "$network" >/dev/null 2>&1 || {
  echo "network $network not found - is the stack up? (set COMPOSE_PROJECT_NAME or ZAP_NETWORK)" >&2
  exit 3
}

zap_opts=()
if [ -n "${ZAP_SESSION_COOKIE:-}" ]; then
  # A replacer rule adds the session cookie to every request ZAP sends.
  zap_opts=(-z "-config replacer.full_list(0).description=session -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Cookie -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=tor-radar-session=${ZAP_SESSION_COOKIE}")
fi

zap() {
  docker run --rm --network "$network" -v "$host_out:/zap/wrk:rw" "$image" "$@"
}

status=0
run_scan() { # name, then the command and its arguments
  local name="$1"
  shift
  echo "== ZAP $name"
  local code=0
  "$@" || code=$?
  # 0 clean, 2 warnings only (accepted here); 1 = a FAIL rule; anything else = scan error.
  case "$code" in
    0 | 2) ;;
    1) status=1 ;;
    *) echo "ZAP $name exited $code" >&2; status=3 ;;
  esac
}

run_scan web zap zap-baseline.py -t "$web_url" -c zap-rules.tsv -m "$minutes" -I \
  -r web.html -J web.json -w web.md "${zap_opts[@]}"
run_scan api zap zap-api-scan.py -t openapi.json -f openapi -O "$api_url" -c zap-rules.tsv -S -I \
  -r api.html -J api.json -w api.md "${zap_opts[@]}"

# High (riskcode 3) always fails the run, whatever the rules file says.
high="$(node -e '
const fs = require("fs");
let n = 0;
for (const f of ["web", "api"]) {
  const p = process.argv[1] + "/" + f + ".json";
  if (!fs.existsSync(p)) continue;
  for (const s of JSON.parse(fs.readFileSync(p, "utf8")).site ?? [])
    for (const a of s.alerts ?? []) if (a.riskcode === "3") { n++; console.error("HIGH: " + a.name); }
}
console.log(n);
' "$out")"
[ "$high" -gt 0 ] && [ "$status" -eq 0 ] && status=1

echo "reports: $out  (high alerts: $high, exit $status)"
exit "$status"
