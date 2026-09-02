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
