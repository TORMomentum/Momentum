// Shared Vertex AI (Gemini) + .env plumbing for the TOR-1x spike scripts.
// ponytail: tiny helper, not a client library. Fold into apps/api's real
// Vertex module once the pipeline moves out of tools/.

import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

/** Load repo-root .env into process.env (no override of already-set vars). */
export function loadEnv(url = new URL("../.env", import.meta.url)) {
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    console.error("No .env at repo root — copy .env.example to .env and fill the GCP block first.");
    process.exit(1);
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Vertex host for a location: "global" has no region prefix. */
export function vertexHost(location) {
  return location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
}

let _client;
async function client() {
  if (!_client) {
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!process.env.GOOGLE_CLOUD_PROJECT || !keyFile) {
      console.error("Set GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS in .env");
      process.exit(1);
    }
    _client = await new GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
  }
  return _client;
}

/**
 * One generateContent call. `parts` is the user-turn parts array
 * (text / inlineData). Returns the raw response body.
 */
export async function geminiGenerate({ parts, generationConfig, systemInstruction } = {}) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION ?? "us-central1";
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://${vertexHost(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const data = { contents: [{ role: "user", parts }] };
  if (generationConfig) data.generationConfig = generationConfig;
  if (systemInstruction) data.systemInstruction = { parts: [{ text: systemInstruction }] };
  const c = await client();
  const res = await c.request({ url, method: "POST", data });
  return res.data;
}

/** First text part of a generateContent response, trimmed. */
export function responseText(body) {
  return body?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("").trim();
}

export { client as authClient };
