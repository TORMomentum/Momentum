#!/usr/bin/env node
// Smoke-check the BMA eGP source connection end to end.
//   node tools/check-source.mjs                 # checks a running API on localhost:4000
//   API_URL=http://localhost:4123 node tools/check-source.mjs
// Exits non-zero if any check fails, so CI or a teammate can run it unattended.

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const UPSTREAM = "https://egp2.bangkok.go.th/appapi/api";

let failures = 0;
let skipRemaining = false;

async function check(label, fn) {
  if (skipRemaining) {
    console.log(`  SKIP  ${label}`);
    return;
  }
  try {
    const detail = await fn();
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label} — ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    // A connection refused here means the server is down, not that the source is broken.
    throw new Error(
      url.startsWith(API_URL)
        ? `cannot reach ${API_URL} — is the API running? ` +
          `Start it with: npm run --workspace @tor-radar/api start`
        : `cannot reach ${url}`,
    );
  }
  assert(res.ok, `HTTP ${res.status} from ${url}`);
  return res.json();
}

console.log(`\nUpstream source (${UPSTREAM})`);

await check("reference data reachable, no credentials", async () => {
  const body = await getJson(`${UPSTREAM}/Utilities/dropdown?names=MasterAnnounceTypes`);
  const types = body.dropdowns?.[0]?.items ?? [];
  assert(types.length > 0, "no announcement types returned");
  const tor = types.find((t) => t.value === "ร่างขอบเขตของงาน (TOR)");
  assert(tor, "TOR announcement type missing from upstream");
  return `TOR type id ${tor.id}`;
});

console.log(`\nOur API (${API_URL})`);

let apiUp = true;

await check("api is running", async () => {
  try {
    const body = await getJson(`${API_URL}/health`);
    assert(body.status === "ok", `unexpected health payload: ${JSON.stringify(body)}`);
    return "healthy";
  } catch (err) {
    apiUp = false;
    throw err;
  }
});

// Everything below needs the API; without it the remaining failures would just be noise.
skipRemaining = !apiUp;

let sampleProjectId;

await check("GET /sources/bma-egp/tors returns TOR announcements", async () => {
  const body = await getJson(`${API_URL}/sources/bma-egp/tors?pageSize=3`);
  assert(body.totalCount > 0, "totalCount is zero");
  assert(body.data.length > 0, "no projects returned");
  sampleProjectId = body.data[0].projectId;
  return `${body.totalCount} TORs upstream, ${body.data.length} on this page`;
});

await check("issuing agencies resolve against the BMA list (FR-A4)", async () => {
  const body = await getJson(`${API_URL}/sources/bma-egp/tors?pageSize=10`);
  const resolved = body.data.filter((p) => p.isBmaAgency);
  assert(resolved.length > 0, "no project resolved to a canonical BMA agency");
  return `${resolved.length}/${body.data.length} resolved`;
});

await check("GET /:projectId/documents yields a working source URL", async () => {
  assert(sampleProjectId, "no sample project from the previous check");
  // Walk pages until a project actually carries a TOR document.
  let doc;
  for (let page = 1; page <= 3 && !doc; page += 1) {
    const list = await getJson(`${API_URL}/sources/bma-egp/tors?pageSize=5&page=${page}`);
    for (const project of list.data) {
      const detail = await getJson(
        `${API_URL}/sources/bma-egp/tors/${project.projectId}/documents`,
      );
      if (detail.data.length > 0) {
        doc = detail.data[0];
        break;
      }
    }
  }
  assert(doc, "no TOR document found in the first 3 pages");
  const head = await fetch(doc.sourceUrl, { method: "HEAD" });
  assert(head.ok, `source URL returned HTTP ${head.status}`);
  const type = head.headers.get("content-type");
  assert(type?.includes("pdf"), `source URL is not a PDF (${type})`);
  return `${doc.filename} → ${type}`;
});

if (failures === 0) {
  console.log("\nAll checks passed — the source connection is working.\n");
} else if (!apiUp) {
  console.log(
    "\nThe API is not running, so nothing downstream could be checked." +
      "\nStart it in another terminal, then re-run:" +
      "\n  npm run --workspace @tor-radar/api start\n",
  );
} else {
  console.log(`\n${failures} check(s) failed.\n`);
}
process.exit(failures === 0 ? 0 : 1);
