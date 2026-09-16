/**
 * Populate the stable dashboard cohort key on pre-dashboard records.
 *
 * Usage: node tools/backfill_cohorts.mjs
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) throw new Error("MONGO_URL is required");
const timezone = process.env.COHORT_TIMEZONE ?? "Asia/Bangkok";

function monthKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
}

function cohortFor(record) {
  const category = typeof record.fields?.category?.value === "string" ? record.fields.category.value : "";
  if (!category) return null;
  const announcedAt = record.announcedAt instanceof Date && !Number.isNaN(record.announcedAt.getTime()) ? record.announcedAt : null;
  return {
    cohort: { category, month: monthKey(announcedAt ?? record.createdAt) },
    cohortDateSource: announcedAt ? "announced" : "intake",
  };
}

const client = new MongoClient(mongoUrl);
await client.connect();
try {
  const db = client.db();
  const dirty = new Map();
  let updated = 0;
  let skipped = 0;
  const cursor = db.collection("tors").find(
    { cohort: { $exists: false } },
    { projection: { fields: 1, announcedAt: 1, createdAt: 1 } },
  );
  for await (const record of cursor) {
    const derived = cohortFor(record);
    if (!derived) { skipped += 1; continue; }
    const result = await db.collection("tors").updateOne(
      { _id: record._id, cohort: { $exists: false } },
      { $set: derived },
    );
    if (result.modifiedCount === 1) {
      updated += 1;
      dirty.set(`${derived.cohort.category}\u0000${derived.cohort.month}`, derived.cohort);
    }
  }
  const dirtyAt = new Date();
  if (dirty.size > 0) {
    await db.collection("tor_peer_stats").bulkWrite([...dirty.values()].map((key) => ({
      updateOne: { filter: key, update: { $set: { dirty: true, dirtyAt }, $inc: { generation: 1 } }, upsert: true },
    })));
  }
  console.log(`${updated} records updated; ${dirty.size} cohorts marked dirty; ${skipped} records skipped (no category)`);
} finally {
  await client.close();
}
