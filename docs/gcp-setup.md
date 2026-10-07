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
`.github/workflows/deploy.yml` — is already in the repo (TOR-140, TOR-142). What's below
is the console/CLI setup those files assume, in the order a first deploy needs it.
`${PROJECT_ID}` below is the same project id from §1.

### 7.1 Enable APIs (TOR-138)

Same project as Vertex AI / GCS. APIs & Services → Enable APIs & Services → enable:

- **Cloud Run Admin API** (`run.googleapis.com`)
- **Artifact Registry API** (`artifactregistry.googleapis.com`)
- **Secret Manager API** (`secretmanager.googleapis.com`)

Or, with `gcloud`:

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  --project=${PROJECT_ID}
```

### 7.2 Artifact Registry repo + deploy service account (TOR-139)

```bash
gcloud artifacts repositories create tor-radar \
  --repository-format=docker --location=${REGION} --project=${PROJECT_ID}

gcloud iam service-accounts create tor-radar-deploy \
  --display-name="TOR Radar CI deploy" --project=${PROJECT_ID}
```

Grant it exactly what it needs to push images and deploy — not a project-wide role:

```bash
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:tor-radar-deploy@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:tor-radar-deploy@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:tor-radar-deploy@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Keys → Add key → **JSON** → download. This key goes into a **GitHub secret**, not
`secrets/` (§7.4) — it never touches a developer's machine.

### 7.3 Secret Manager (TOR-141)

Five secrets the Cloud Run services read at request time, none of them in `.env.example`
because they're deployment-only:

```bash
echo -n "<the real mongodb+srv:// URL>"  | gcloud secrets create mongo-url           --data-file=- --project=${PROJECT_ID}
echo -n "<comma-separated intake keys>"  | gcloud secrets create intake-api-keys     --data-file=- --project=${PROJECT_ID}
echo -n "<comma-separated admin keys>"   | gcloud secrets create admin-api-keys      --data-file=- --project=${PROJECT_ID}
echo -n "<the staff login passphrase>"   | gcloud secrets create staff-access-secret --data-file=- --project=${PROJECT_ID}
gcloud secrets create gcs-storage-sa --data-file=secrets/gcs-storage-sa.json --project=${PROJECT_ID}
gcloud secrets create vertex-sa      --data-file=secrets/gcp-sa.json        --project=${PROJECT_ID}
```

Then let the **api** and **worker** services (both run as the api image) read the two
key-file secrets and three of the four string secrets; **web** reads `admin-api-keys` and
`staff-access-secret` only — grant `roles/secretmanager.secretAccessor` on each secret to
that service's own runtime identity (the default compute service account, unless you later
give each service its own):

```bash
for SECRET in mongo-url intake-api-keys admin-api-keys gcs-storage-sa vertex-sa; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
done
gcloud secrets add-iam-policy-binding admin-api-keys \
  --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
gcloud secrets add-iam-policy-binding staff-access-secret \
  --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
```

### 7.4 GitHub repository configuration (TOR-142)

Repo → **Settings → Secrets and variables → Actions**.

**Variables** tab (plain values, not secret):

| Name | Value |
| :--- | :--- |
| `GCP_PROJECT_ID` | `${PROJECT_ID}` from §1 |
| `GCP_REGION` | e.g. `asia-southeast1` |
| `GCP_AR_REPO` | `tor-radar` (the repo name from §7.2) |
| `GCS_BUCKET` | the originals bucket name |

**Secrets** tab:

| Name | Value |
| :--- | :--- |
| `GCP_DEPLOY_SA_KEY` | the full JSON key downloaded in §7.2, pasted as-is |

### 7.5 First deploy

Actions tab → **Deploy to Cloud Run** → **Run workflow**, type `deploy` to confirm. It
builds and pushes both images, then deploys api, worker, and web in that order (web needs
api's URL for `API_BASE_URL`, so api goes first — `.github/workflows/deploy.yml`).

Every service deploys with `--no-allow-unauthenticated` — nothing is public yet (that
switch is a later sprint's decision). After the first deploy, grant the reviewers who need
to see it:

```bash
gcloud run services add-iam-policy-binding tor-radar-web --region=${REGION} \
  --member="user:reviewer@example.com" --role="roles/run.invoker" --project=${PROJECT_ID}
```

This binding persists across redeploys — it's a one-time step per reviewer, not part of
the workflow.

### What goes where

| | Lives in | Committed |
| :--- | :--- | :--- |
| Cloud Run service shape (scaling, ports, env var *names*) | `deploy/cloudrun/*.yaml` | yes |
| Project id, region, repo name, bucket name | GitHub Actions **variables** | no (set per-repo) |
| The deploy service account's key | GitHub Actions **secrets** | never |
| Mongo URL, API keys, staff passphrase, the two SA key files | GCP **Secret Manager** | never |
| Who can call the deployed services | Cloud Run IAM (`run.invoker`) | n/a |
