/**
 * Maps every stored TOR category onto the closed list (packages/shared/src/categories.ts), without
 * re-extracting anything.
 *
 *   npx tsx tools/normalize_categories.mts --dry-run     show what would change
 *   npx tsx tools/normalize_categories.mts               apply it
 *
 * Only `fields.category.value` changes; `raw` — the document's own wording — is kept (NFR-F7), and so
 * is whether the value was verified. A record's dashboard peer group is keyed on its category, so
 * its cohort moves with it and both the old and the new peer groups are marked for the stats worker
 * to recompute. A category nothing maps is left as it is and reported, never guessed.
 * Re-running is safe: a value the mapping already agrees with is skipped.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCategory } from "@tor-radar/shared";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, tors } from "../apps/api/src/core/db.js";
import type { CohortKey } from "../apps/api/src/modules/stats/cohort.js";
import { StatsRepository, windowKeysFor } from "../apps/api/src/modules/stats/stats.repository.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const DRY_RUN = process.argv.includes("--dry-run");
const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
const stats = new StatsRepository(db);

const changes = new Map<string, number>();
const unmapped = new Map<string, number>();
const dirty: CohortKey[] = [];
let updated = 0;

try {
  const cursor = tors(db).find(
    { "fields.category.value": { $type: "string" } },
    { projection: { "fields.category": 1, "fields.title": 1, cohort: 1 } },
  );
  for await (const doc of cursor) {
    const current = doc.fields.category?.value;
    if (typeof current !== "string") continue;

    // The title decides what is bought or built, and refines a value that only states the kind.
    const title = doc.fields.title?.value ?? doc.fields.title?.raw;
    const next = normalizeCategory(current, title) ?? normalizeCategory(doc.fields.category?.raw, title);
    if (next === current) continue;
    if (!next) {
      unmapped.set(current, (unmapped.get(current) ?? 0) + 1);
      continue;
    }
    changes.set(`${current} → ${next}`, (changes.get(`${current} → ${next}`) ?? 0) + 1);
    if (DRY_RUN) continue;

    const cohort = doc.cohort ? { category: next, month: doc.cohort.month } : null;
    await tors(db).updateOne(
      { _id: doc._id, "fields.category.value": current },
      { $set: { "fields.category.value": next, ...(cohort ? { cohort } : {}), updatedAt: new Date() } },
    );
    updated += 1;
    if (doc.cohort && cohort) {
      dirty.push(...windowKeysFor(doc.cohort, config.stats.peerWindowMonths), ...windowKeysFor(cohort, config.stats.peerWindowMonths));
    }
  }

  if (!DRY_RUN && dirty.length > 0) await stats.markCohortsDirty(dirty);

  for (const [change, n] of [...changes].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${change}`);
  for (const [value, n] of unmapped) console.log(`${String(n).padStart(4)}  ${value} → (no match, left as is)`);
  console.log(
    JSON.stringify({ event: "normalize_categories_done", dryRun: DRY_RUN, updated, toChange: [...changes.values()].reduce((a, b) => a + b, 0), unmapped: [...unmapped.values()].reduce((a, b) => a + b, 0) }),
  );
} finally {
  await disconnect();
}
