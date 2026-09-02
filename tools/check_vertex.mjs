// TOR-19 verification: prove the service account can reach Vertex AI (Gemini)
// and, if configured, Document AI. Reads .env at repo root.
//
//   npm run check:vertex
//
// ponytail: single-purpose smoke test, no framework. Delete once the TOR-20
// spike script exercises the same auth path for real.

import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

// --- tiny .env loader (no dependency; Node 22 has --env-file but npm scripts vary) ---
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("No .env at repo root — copy .env.example to .env and fill the GCP block first.");
  process.exit(1);
}

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.VERTEX_LOCATION ?? "us-central1";
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!project || !keyFile) {
  console.error("Set GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS in .env");
  process.exit(1);
}

const auth = new GoogleAuth({
  keyFile,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function checkVertex() {
  const client = await auth.getClient();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const res = await client.request({
    url,
    method: "POST",
    data: { contents: [{ role: "user", parts: [{ text: "reply with the single word: pong" }] }] },
  });
  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  console.log(`  Vertex AI  ✓  ${model} @ ${location} replied: ${JSON.stringify(text)}`);
}

// 1x1 PNG — real content isn't the point; a non-403 proves the SA can call :process.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

async function checkDocAI() {
  const loc = process.env.DOCAI_LOCATION;
  const procId = process.env.DOCAI_PROCESSOR_ID;
  if (!loc || !procId) return console.log("  Document AI    skipped (DOCAI_LOCATION / DOCAI_PROCESSOR_ID not set)");
  const client = await auth.getClient();
  // documentai.apiUser can :process but not processors.list — exercise the real path.
  const url = `https://${loc}-documentai.googleapis.com/v1/projects/${project}/locations/${loc}/processors/${procId}:process`;
  try {
    await client.request({
      url,
      method: "POST",
      data: { rawDocument: { content: TINY_PNG, mimeType: "image/png" }, skipHumanReview: true },
    });
    console.log(`  Document AI ✓  processor ${procId} @ ${loc} processed a request`);
  } catch (err) {
    // 400 INVALID_ARGUMENT (image too small) still means auth + processor are fine.
    if (err?.response?.status === 400) {
      console.log(`  Document AI ✓  processor ${procId} @ ${loc} reachable (rejected the 1px test doc, as expected)`);
      return;
    }
    throw err;
  }
}

console.log(`Checking GCP access for project "${project}" ...`);
try {
  await checkVertex();
  await checkDocAI();
  console.log("\nTOR-19 access verified.");
} catch (err) {
  const body = err?.response?.data ?? err?.message ?? err;
  console.error("\nFAILED:", JSON.stringify(body, null, 2));
  process.exit(1);
}
