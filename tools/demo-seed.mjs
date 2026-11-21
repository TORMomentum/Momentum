/**
 * Seeds the security demo (TOR-375): the two storage buckets, two verified vendor accounts, a file in
 * vendor A's vault, and two sample TORs submitted through the real intake API.
 *
 *   node tools/demo-seed.mjs
 *
 * DEVELOPMENT ONLY — it talks to the Compose stack through its published ports and reads Mailpit to
 * verify the accounts the way a person would. Idempotent: run it twice and nothing is duplicated
 * (a repeated TOR comes back `duplicate`, a verified account just logs in).
 *
 * Everything comes from the environment (the repository `.env` is read if present):
 *   DEMO_VENDOR_PASSWORD   required; one password for both demo vendors
 *   INTAKE_API_KEYS        required; the first key is used for POST /intake
 *   APP_ORIGIN             required; account routes refuse a request from any other Origin
 *   DEMO_API_URL           default http://127.0.0.1:$API_PORT (4000)
 *   DEMO_MAIL_URL          default http://127.0.0.1:$MAIL_UI_PORT (8025) — Mailpit's HTTP API
 *   DEMO_GCS_URL           default http://127.0.0.1:$GCS_EMULATOR_PORT (4443) — to create the buckets
 *   GCS_BUCKET / GCS_VAULT_BUCKET   default tor-raw / tor-vault
 *   DEMO_VENDOR_A_EMAIL / DEMO_VENDOR_B_EMAIL   default vendor-a@demo.example / vendor-b@demo.example
 *   DEMO_TORS              comma-separated files under docs/corpus, default tor-01.pdf,tor-05.pdf
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootEnv = fileURLToPath(new URL(".env", root));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = process.env;
function need(name) {
  const value = env[name];
  if (!value) {
    console.error(`${name} is not set. See "Install and run" in README.md.`);
    process.exit(1);
  }
  return value;
}

const password = need("DEMO_VENDOR_PASSWORD");
const origin = need("APP_ORIGIN");
const intakeKey = need("INTAKE_API_KEYS").split(",")[0].trim();
const apiUrl = env.DEMO_API_URL ?? `http://127.0.0.1:${env.API_PORT ?? 4000}`;
const mailUrl = env.DEMO_MAIL_URL ?? `http://127.0.0.1:${env.MAIL_UI_PORT ?? 8025}`;
const gcsUrl = env.DEMO_GCS_URL ?? `http://127.0.0.1:${env.GCS_EMULATOR_PORT ?? 4443}`;
const buckets = [env.GCS_BUCKET ?? "tor-raw", env.GCS_VAULT_BUCKET ?? "tor-vault"];
const vendors = [
  { name: "A", email: env.DEMO_VENDOR_A_EMAIL ?? "vendor-a@demo.example" },
  { name: "B", email: env.DEMO_VENDOR_B_EMAIL ?? "vendor-b@demo.example" },
];
const torFiles = (env.DEMO_TORS ?? "tor-01.pdf,tor-05.pdf").split(",").map((f) => f.trim());
const corpus = (name) => fileURLToPath(new URL(`docs/corpus/${name}`, root));

const api = (path, init = {}) => fetch(`${apiUrl}/api/v1${path}`, init);
const json = (body, extra = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin, ...extra },
  body: JSON.stringify(body),
});

async function ensureBuckets() {
  for (const name of buckets) {
    const res = await fetch(`${gcsUrl}/storage/v1/b?project=demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    // 409: the bucket is already there.
    if (!res.ok && res.status !== 409) throw new Error(`creating bucket ${name}: ${res.status}`);
    console.log(`bucket ${name}: ${res.status === 409 ? "exists" : "created"}`);
  }
}

async function login(email) {
  const res = await api("/login", json({ email, password }));
  return res.ok ? (await res.json()).sessionId : null;
}

async function verificationToken(email) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    for (const summary of list.messages ?? []) {
      const message = await (await fetch(`${mailUrl}/api/v1/message/${summary.ID}`)).json();
      const match = /\/verify\?token=([A-Za-z0-9_-]+)/.exec(message.Text ?? "");
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no verification email for ${email} in Mailpit (${mailUrl})`);
}

async function ensureVendor({ name, email }) {
  let session = await login(email);
  if (session) {
    console.log(`vendor ${name} ${email}: already verified`);
    return session;
  }
  const registered = await api("/register", json({ email, password, consent: true, displayName: `Demo vendor ${name}` }));
  if (registered.status === 422) {
    console.error(`vendor ${name}: the password was refused (${(await registered.text()).slice(0, 120)}). Pick another DEMO_VENDOR_PASSWORD.`);
    process.exit(1);
  }
  if (registered.status !== 202) throw new Error(`register ${email}: ${registered.status}`);
  const verified = await api("/verify", json({ token: await verificationToken(email) }));
  if (!verified.ok) throw new Error(`verify ${email}: ${verified.status}`);
  session = await login(email);
  if (!session) throw new Error(`login ${email} failed after verification`);
  console.log(`vendor ${name} ${email}: registered, verified`);
  return session;
}

async function ensureVaultFile(session) {
  const headers = { "x-session-id": session, origin };
  const { documents } = await (await api("/me/vault", { headers })).json();
  if (documents.length > 0) return documents[0].id;
  const form = new FormData();
  form.set("kind", "past_work");
  form.set("file", new Blob([await readFile(corpus("tor-05.pdf"))], { type: "application/pdf" }), "vendor-a-private.pdf");
  const res = await api("/me/vault", { method: "POST", headers, body: form });
  if (res.status !== 201) throw new Error(`vault upload: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function submitTor(file) {
  const form = new FormData();
  form.set("file", new Blob([await readFile(corpus(file))], { type: "application/pdf" }), file);
  const res = await api("/intake", { method: "POST", headers: { "x-api-key": intakeKey }, body: form });
  if (!res.ok) throw new Error(`intake ${file}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  console.log(`TOR ${file}: ${body.duplicate ? "already stored" : "stored"} torId=${body.torId} state=${body.state}`);
}

await ensureBuckets();
const sessions = [];
for (const vendor of vendors) sessions.push(await ensureVendor(vendor));
const fileId = await ensureVaultFile(sessions[0]);
console.log(`vendor A's private file id: ${fileId}`);
for (const file of torFiles) await submitTor(file);
console.log(`\nDemo logins: ${vendors.map((v) => v.email).join(" and ")}, password from DEMO_VENDOR_PASSWORD.`);
console.log(`VENDOR_A_FILE_ID=${fileId}`);
