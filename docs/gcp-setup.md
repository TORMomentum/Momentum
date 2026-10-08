# GCP + Vertex AI setup (TOR-19)

One-time setup so the team can run the extraction benchmark (TOR-18) and, later,
the API's Thai OCR + field extraction. Console steps — no `gcloud` required.

## 1. Project

1. Console → project selector → **New Project**
2. Name: `TOR Radar BKK` → note the generated **Project ID** (e.g. `tor-radar-bkk-4xxxxx`)
3. **Billing** → link a billing account. A new account gets US$300 / 90-day free trial,
   which covers the whole Phase-1 AI budget (PROJECT.md §9.1).

## 2. Enable APIs

APIs & Services → Enable APIs & Services → enable:

- **Vertex AI API** (`aiplatform.googleapis.com`)
- **Cloud Document AI API** (`documentai.googleapis.com`)

## 3. Service account

IAM & Admin → Service Accounts → **Create service account**

- Name: `tor-radar-spike`
- Roles: **Vertex AI User** (`roles/aiplatform.user`), **Document AI API User**
  (`roles/documentai.apiUser`)
- After creating: open it → **Keys** → Add key → **JSON** → download

Save the file as `secrets/gcp-sa.json` in the repo root. `secrets/` is gitignored —
**never commit the key.** Share it with teammates out of band (password manager / DM).

## 3b. A second service account, for object storage

Storage gets its own identity. Vertex AI's key must never be able to write to the
originals bucket, and the storage key must never be able to spend Vertex AI quota:
one compromised key must not carry both powers.

IAM & Admin → Service Accounts → **Create service account**

- Name: `tor-storage`
- Roles: a **custom role** holding exactly `storage.objects.create` and
  `storage.objects.get`, granted **on the originals bucket**, not on the project.
  Deliberately no delete: originals are immutable (`FR-A-2`, `NFR-S3`)
- Keys → Add key → **JSON** → download

Save it as `secrets/gcs-storage-sa.json`. Both key files live in `secrets/`, which
`.gitignore` covers twice — the directory itself and the `*-sa.json` pattern.

### What goes where

`.env` holds **values**; `secrets/` holds **files**. A downloaded JSON key cannot
live inside `.env`, so `.env` carries only the path to it. Nothing else moves out
of `.env`.

| | Lives in | Committed |
| :--- | :--- | :--- |
| Bucket name, project id, timeouts, URLs | `.env` | no — `.env.example` is |
| The two JSON key files | `secrets/` | never |
| The pointers to them | `.env`, as paths | no |
| Deployment | Google Secret Manager (TOR-141) | n/a |

**If a key is ever pasted into a chat, an issue, or a commit, it is public.** Delete
that key and issue a new one:

```bash
gcloud iam service-accounts keys list --iam-account=<account>
gcloud iam service-accounts keys delete <key-id> --iam-account=<account>
```

## 4. Document OCR processor

Document AI → **Create Processor** → **Document OCR** → region **US** (multi-region;
Document AI has no asia region) → note the **Processor ID**.

## 5. Local config

```
cp .env.example .env
```

Fill the Vertex block:

```
GOOGLE_CLOUD_PROJECT=<project-id>
GOOGLE_APPLICATION_CREDENTIALS=./secrets/gcp-sa.json
GCS_CREDENTIALS=./secrets/gcs-storage-sa.json
VERTEX_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=<processor-id>
```

## 6. Verify

```
npm install
npm run check:vertex
```

Expected:

```
  Vertex AI  ✓  gemini-2.5-flash @ us-central1 replied: "pong"
  Document AI ✓  1 processor(s) in us
               - OCR_PROCESSOR  <id>  (ENABLED)

TOR-19 access verified.
```

## Region note

Gemini on Vertex runs in `us-central1` (also `asia-southeast1` if latency matters
later — not for an offline benchmark). Document AI is multi-region only: `us` or `eu`.
Keeping both in the US is the simplest choice for Phase 1.

## 7. Cloud Run deployment (TOR-137–142)

The code side — the three `deploy/cloudrun/*.yaml` service definitions and
`.github/workflows/deploy.yml` — is already in the repo (TOR-140, TOR-142). Everything
below is console-only: no `gcloud` needed, same as §1–§6.

### 7.1 Enable APIs (TOR-138)

Same project as Vertex AI / GCS. **APIs & Services → Enable APIs & Services**, search for
and enable each of these three, one at a time:

- **Cloud Run Admin API**
- **Artifact Registry API**
- **Secret Manager API**

### 7.2 Artifact Registry repo + deploy service account (TOR-139)

**Create the repo:**

1. Console → search bar → **Artifact Registry** → **Repositories** → **Create repository**
2. Name: `tor-radar`
3. Format: **Docker**
4. Mode: **Standard**
5. Location type: **Region** → pick one (e.g. `asia-southeast1` — note it down, it's
   `$REGION` for everything after this)
6. Leave encryption at the default (Google-managed) → **Create**

**Create the deploy service account:**

1. **IAM & Admin → Service Accounts → Create service account**
2. Name: `tor-radar-deploy` → **Create and continue**
3. On the "Grant this service account access to project" step, add these three roles —
   **Add another role** for each:
   - **Artifact Registry Writer**
   - **Cloud Run Admin**
   - **Service Account User**
4. **Continue** → skip the next optional step → **Done**

**Download its key** (this is what becomes the GitHub secret in §7.4):

1. Click into `tor-radar-deploy@...` in the service account list
2. **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**
3. A `.json` file downloads automatically. This file goes into a **GitHub secret**
   (§7.4), never into `secrets/` in this repo and never committed — it's a deploy
   credential, not a local-dev one.

### 7.3 Secret Manager (TOR-141)

Eight secrets the Cloud Run services read at request time; none of them belong in
`.env.example` because they're deployment-only. **Secret Manager → Create secret**, once
per row. **The name must match the first column exactly, including case** —
`deploy/cloudrun/*.yaml` looks up each secret by this literal name, and Secret Manager
answers a name that doesn't exist with the same "Permission denied" error as a real
permissions problem, so a typo'd case reads as an IAM misconfiguration (found the hard
way: `ADMIN_API_KEYS` and `STAFF_ACCESS_SECRET` got created upper-case against the lower-
case names the YAML expected — the fix was changing the YAML to match what already
existed, not recreating the secrets):

| Secret name | Secret value |
| :--- | :--- |
| `mongo-url` | the real `mongodb+srv://...` connection string, pasted into **Secret value** |
| `intake-api-keys` | your comma-separated intake keys, pasted in |
| `ADMIN_API_KEYS` | your comma-separated admin keys, pasted in |
| `STAFF_ACCESS_SECRET` | the staff login passphrase, pasted in |
| `SESSION_SECRET` | a random string of 32+ characters — generate one, don't reuse a short local-dev value |
| `SMTP_URL` | a real SMTP provider's connection string (Mailtrap, SendGrid, Gmail SMTP relay with an app password, …) — `apps/api` refuses to start in production without one; no local-dev equivalent exists because Compose uses the mailpit container instead |
| `gcs-storage-sa` | switch **Secret value** to **Upload file** → pick `secrets/gcs-storage-sa.json` |
| `vertex-sa` | **Upload file** → pick `secrets/gcp-sa.json` |

Leave replication at **Automatic** for all eight, and **Create secret** each time.

**Grant access to each**, so the running service can actually read it:

1. First find your project's **number** (not its id) — Console home page, the "Project
   info" card, or **IAM & Admin → Settings**
2. Open each of the eight secrets → **Permissions** tab → **Grant access**
3. New principals: `<project-number>-compute@developer.gserviceaccount.com`
4. Role: **Secret Manager Secret Accessor** → **Save**
5. Repeat for all eight — `api` reads all eight; `worker` reads everything except
   `SMTP_URL` (it never sends mail); `web` only ever reads `ADMIN_API_KEYS` and
   `STAFF_ACCESS_SECRET`. Granting access on ones a service never asked for doesn't
   hurt, so it's simpler to just grant all eight everywhere than track the difference.

`APP_ORIGIN` is **not** a secret — it isn't sensitive, and `deploy.yml` fills it in itself
from `tor-radar-web`'s own Cloud Run URL once that service exists (§7.5). Nothing to create
here for it.

### 7.4 GitHub repository configuration (TOR-142)

Repo → **Settings → Secrets and variables → Actions**.

**Variables** tab (plain values, not secret):

| Name | Value |
| :--- | :--- |
| `GCP_PROJECT_ID` | the project id you noted in §1 |
| `GCP_REGION` | the region you picked for the Artifact Registry repo in §7.2 |
| `GCP_AR_REPO` | `tor-radar` (the repo name from §7.2) |
| `GCS_BUCKET` | the originals bucket name |

**Secrets** tab:

| Name | Value |
| :--- | :--- |
| `GCP_DEPLOY_SA_KEY` | the full JSON key downloaded in §7.2, pasted as-is |

### 7.5 First deploy

Actions tab → **Deploy to Cloud Run** → **Run workflow**, type `deploy` to confirm. It
builds and pushes both images, then deploys in three passes because `web` and `api` each
need the other's URL: `web` first with placeholder `API_BASE_URL`/`APP_ORIGIN` values (just
to make the service exist and get a real URL), then `api` and `worker` with `APP_ORIGIN` set
to that URL, then `web` again with the real `API_BASE_URL` now that `api` exists and its own
real `APP_ORIGIN` (`app/api/auth/[...path]/route.ts` needs it too, for the same-origin check
on register/login), then re-asserts Identity-Aware Proxy on `web`
(`.github/workflows/deploy.yml`).

That last step exists because `gcloud run services replace` only ever applies
`deploy/cloudrun/web.yaml`'s own spec, and IAP enablement isn't expressible in that Knative
YAML — it's a separate setting on the service resource, which every `replace` above silently
drops. Left alone, every deploy would quietly turn `web` back into IAM-only and lock out
anyone without an explicit `run.invoker` grant (found live: a deploy re-opened exactly this
gap minutes after IAP had been enabled and verified working). `gcloud run services update
--iap` re-enables it and sets up the IAP service agent's own invoker binding in the same call
(no separate `add-iam-policy-binding` needed — confirmed live by its own "Setting IAP service
agent ... done" output); idempotent, safe to repeat against a service that's already
correctly configured.

IAP itself — the OAuth brand/consent screen, and who's allowed in (currently `domain:ku.th`)
— is a one-time, per-project setup done once by hand in **Cloud Run → tor-radar-web →
Security tab**, not part of this workflow; redeploys only need to keep the toggle on, not
recreate it. `tor-radar-api` stays IAM-only, reached by `web` through the identity-token path
in `apps/web/src/shared/api/api-client.ts`, not by a browser directly.

### What goes where

| | Lives in | Committed |
| :--- | :--- | :--- |
| Cloud Run service shape (scaling, ports, env var *names*) | `deploy/cloudrun/*.yaml` | yes |
| Project id, region, repo name, bucket name | GitHub Actions **variables** | no (set per-repo) |
| The deploy service account's key | GitHub Actions **secrets** | never |
| Mongo URL, API keys, staff passphrase, the two SA key files | GCP **Secret Manager** | never |
| Who can call the deployed services | Cloud Run IAM (`run.invoker`) | n/a |
