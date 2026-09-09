// TOR-19 verification: prove the service account can reach Vertex AI (Gemini)
// and, if configured, Document AI. Reads .env at repo root.
//
//   npm run check:vertex
//
// ponytail: single-purpose smoke test, no framework. Delete once the TOR-20
// spike (extract_spike.mjs) is exercising the same auth path in anger.

import { loadEnv, authClient, geminiGenerate, responseText } from "./_vertex.mjs";

loadEnv();
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.VERTEX_LOCATION ?? "us-central1";
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

async function checkVertex() {
  const body = await geminiGenerate({
    parts: [{ text: "reply with the single word: pong" }],
    generationConfig: { temperature: 0, maxOutputTokens: 50 },
  });
  console.log(`  Vertex AI  ✓  ${model} @ ${location} replied: ${JSON.stringify(responseText(body))}`);
}

// 1x1 PNG — real content isn't the point; a non-403 proves the SA can call :process.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

async function checkDocAI() {
  const loc = process.env.DOCAI_LOCATION;
  const procId = process.env.DOCAI_PROCESSOR_ID;
  if (!loc || !procId) return console.log("  Document AI    skipped (DOCAI_LOCATION / DOCAI_PROCESSOR_ID not set)");
  const client = await authClient();
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
