/**
 * Seeds the searchable demo corpus (TOR-40, NFR-F2 "the seeded corpus") from the
 * ten benchmark TORs in docs/corpus — real Bangkok procurement PDFs, and what
 * Gemini actually extracted from them in the TOR-20 spike.
 *
 *   npx tsx tools/seed_search_corpus.mts [--clear]
 *
 * DEVELOPMENT ONLY. Nothing here is invented: each record carries the model's
 * own values and confidences, and is graded by the production `grade()` with
 * the configured thresholds, so its tier is the one the pipeline would assign.
 * The PDF goes into object storage through the storage adapter's putIfAbsent,
 * so "open original document" opens the real file.
 *
 * One honest gap: the spike predates the `raw` field, so `raw` is the model's
 * normalised value written as text. A record the live pipeline extracts carries
 * the verbatim document text instead.
 *
 * Records are marked `seed: "search-corpus"`; `--clear` removes exactly those.
 * Their stored objects stay — originals are never deleted (FR-A-2).
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Provenance } from "@tor-radar/shared";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { parseExtraction } from "../apps/api/src/adapters/vertex.ai.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes, tors, type TorDocument } from "../apps/api/src/core/db.js";
import { grade } from "../apps/api/src/modules/extraction/extraction.grading.js";
import { TOR_SCHEMA_VERSION } from "../apps/api/src/modules/intake/intake.repository.js";
import { sha256 } from "../apps/api/src/lib/hash.js";
import { hasTextLayer } from "../apps/api/src/lib/pdf-text.js";
import { storageKeyFor } from "../apps/api/src/lib/storage-key.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const SEED_MARK = "search-corpus";
const CORPUS = fileURLToPath(new URL("../docs/corpus/", import.meta.url));
const PREDICTIONS = `${CORPUS}predictions/gemini-3.5-flash/`;
const CONTENT_TYPE = "application/pdf";

interface ManifestDocument {
  id: string;
  file: string;
  source_url: string;
}

interface Prediction {
  id: string;
  extracted_at: string;
  model: string;
  fields: Record<string, { value?: unknown; confidence?: unknown; evidence?: unknown }>;
}

/** The spike's fields have no `raw`; give each the value as text (see the header). */
function withRaw(fields: Prediction["fields"]) {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = field.value;
    const raw = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("\n") : String(value);
    out[name] = { ...field, raw };
  }
  return out;
}

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);

if (process.argv.includes("--clear")) {
  const { deletedCount } = await tors(db).deleteMany({ seed: SEED_MARK } as never);
  console.log(`removed ${deletedCount} seeded search records (stored originals are kept)`);
  await disconnect();
  process.exit(0);
}

await ensureIndexes(db);
const storage = createStorage(config, "worker");
const manifest = JSON.parse(await readFile(`${CORPUS}manifest.json`, "utf8")) as { documents: ManifestDocument[] };

let created = 0;
let existing = 0;

for (const document of manifest.documents) {
  const predictionPath = `${PREDICTIONS}${document.id}.json`;
  if (!existsSync(predictionPath)) {
    console.warn(`skip ${document.id}: no prediction`);
    continue;
  }

  const prediction = JSON.parse(await readFile(predictionPath, "utf8")) as Prediction;
  const bytes = await readFile(`${CORPUS}${document.file}`);
  const contentHash = sha256(bytes);

  const raw = parseExtraction(withRaw(prediction.fields), prediction.model);
  const announcedAt = raw.announcementDate.value ? new Date(`${raw.announcementDate.value}T00:00:00Z`) : null;
  const textLayer = hasTextLayer(bytes, CONTENT_TYPE);
  const graded = grade(raw, {
    hasTextLayer: textLayer,
    announcedAt: announcedAt && !Number.isNaN(announcedAt.getTime()) ? announcedAt : null,
    tLow: config.tLow,
    tHigh: config.tHigh,
    budgetMinThb: config.budgetMinThb,
    budgetMaxThb: config.budgetMaxThb,
  });

  const submittedAt = new Date(prediction.extracted_at);
  const stored = await storage.putIfAbsent(storageKeyFor(contentHash, CONTENT_TYPE, submittedAt), bytes, CONTENT_TYPE, {
    originalFilename: document.file,
    route: "url",
  });

  const provenance: Provenance = {
    ocrModel: prediction.model,
    extractModel: prediction.model,
    modelVersion: raw.modelVersion,
    extractedAt: prediction.extracted_at,
    thresholdsVersion: config.thresholdsVersion,
  };

  const now = new Date();
  const record: TorDocument & { seed: string; schemaVersion: number } = {
    seed: SEED_MARK,
    // Same shape version intake writes, so a later migration treats seeds like any record.
    schemaVersion: TOR_SCHEMA_VERSION,
    contentHash,
    storage: stored,
    sourceRefs: [{ route: "url", url: document.source_url, submittedBy: "seed", submittedAt }],
    pipeline: { state: "published", attempts: 1 },
    fields: graded.fields,
    announcedAt: announcedAt && !Number.isNaN(announcedAt.getTime()) ? announcedAt : null,
    sourceUrl: document.source_url,
    confidenceLevel: graded.confidenceLevel,
    unverified: graded.unverified,
    reviewReasons: graded.reviewReasons,
    hasTextLayer: textLayer,
    provenance,
    statusHistory: [{ from: null, to: "published", at: now, actor: "seed", source: "seed_search_corpus" }],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: now,
    updatedAt: now,
  };

  // The unique contentHash index is the dedupe guarantee: re-running is a no-op.
  const result = await tors(db).updateOne({ contentHash }, { $setOnInsert: record }, { upsert: true });
  if (result.upsertedCount) created += 1;
  else existing += 1;

  console.log(
    `${document.id}  ${graded.confidenceLevel.padEnd(6)}  ${raw.agency.value ?? "—"}  ${raw.title.value?.slice(0, 50) ?? "—"}`,
  );
}

console.log(`seeded ${created} records, ${existing} already present`);
await disconnect();
