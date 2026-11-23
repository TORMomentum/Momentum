/**
 * Gives e-GP TOR records the announcement date e-GP itself lists for their draft TOR (TOR-204).
 *
 *   npx tsx tools/backfill_egp_announced_dates.mts                  dry run: what would change, nothing written
 *   npx tsx tools/backfill_egp_announced_dates.mts --apply          fill in records that have no announcement date
 *   npx tsx tools/backfill_egp_announced_dates.mts --apply --fix-mismatch
 *                                                                   also replace a date that disagrees with e-GP
 *   npx tsx tools/backfill_egp_announced_dates.mts --fix-mismatch   dry run that also lists dates e-GP disagrees with
 *   ... --limit 20                                                  only the first 20 projects
 *
 * Without --fix-mismatch only projects with an undated record are looked up, so a run asks e-GP
 * about as many times as there are gaps. Three failed lookups in a row stop the run: e-GP is
 * refusing (429), and pressing on would only add load. Re-run later; dated records are skipped.
 *
 * A TOR collected from e-GP's invitation list was given no announcement date: the list's date is
 * the invitation's, not the TOR's, and the TOR rarely states one. e-GP's project page lists every
 * stage with its date (`fetchProjectStages`); the draft TOR's (B0) is the TOR's announcement date.
 * Design: docs/superpowers/specs/2026-11-23-egp-project-stages-design.md
 *
 * The date is recorded as a source value (`announcedAtOrigin: "source"`), the cohort month is
 * re-derived from it the way extraction derives it, and the statistics windows it leaves and joins
 * are marked for recomputation. Only `announcedAt`, `announcedAtOrigin`, `cohort` and
 * `cohortDateSource` change; the stored document and every extracted field stay as they are.
 * Requests to e-GP are paced; re-running is safe.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, tors } from "../apps/api/src/core/db.js";
import { cohortFor } from "../apps/api/src/modules/stats/cohort.js";
import { StatsRepository, windowKeysFor } from "../apps/api/src/modules/stats/stats.repository.js";
import { fetchProjectStages } from "../apps/api/src/sources/national-egp/client.js";
import { torAnnouncedOn } from "../apps/api/src/sources/national-egp/stages.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const APPLY = process.argv.includes("--apply");
const FIX_MISMATCH = process.argv.includes("--fix-mismatch");
const limitAt = process.argv.indexOf("--limit");
const LIMIT = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;
const DELAY_MS = Number(process.env.NATIONAL_EGP_DELAY_MS ?? 700);
const MAX_FAILURES_IN_A_ROW = 3;

const config = loadConfig(process.env);
const timeZone = config.search.timeZone;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const db = await connect(config.mongoUrl);
const stats = new StatsRepository(db);
const tally = { projects: 0, filled: 0, mismatched: 0, fixed: 0, same: 0, noTorStage: 0, failed: 0 };

try {
  const records = await tors(db)
    .find(
      { "sourceProject.system": "national-egp", documentType: { $ne: "invitation" }, duplicateOf: null },
      { projection: { announcedAt: 1, createdAt: 1, cohort: 1, "fields.category.value": 1, "sourceProject.projectId": 1 } },
    )
    .toArray();
  const byProject = new Map<string, typeof records>();
  for (const record of records) {
    const projectId = record.sourceProject!.projectId;
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), record]);
  }
  // Checking dates that are already there is only worth the requests when they may be replaced.
  const projects = [...byProject].filter(([, group]) => FIX_MISMATCH || group.some((record) => !record.announcedAt));
  console.log(
    `${records.length} e-GP TOR record(s) in ${byProject.size} project(s); looking up ${Math.min(projects.length, LIMIT)}` +
      `${APPLY ? "" : " — dry run, nothing is written"}`,
  );

  let failuresInARow = 0;
  for (const [projectId, group] of projects.slice(0, LIMIT)) {
    tally.projects += 1;
    let b0: string | null;
    try {
      b0 = torAnnouncedOn(await fetchProjectStages(projectId, timeZone));
      failuresInARow = 0;
    } catch (error) {
      tally.failed += 1;
      failuresInARow += 1;
      console.log(`error     ${projectId} — ${(error as Error).message}`);
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        console.log(`stopping: ${failuresInARow} failed lookups in a row; e-GP is refusing, re-run later`);
        break;
      }
      await sleep(DELAY_MS * 5);
      continue;
    }
    await sleep(DELAY_MS);
    if (!b0) {
      tally.noTorStage += 1;
      console.log(`no B0     ${projectId}`);
      continue;
    }

    for (const record of group) {
      const current = record.announcedAt ? record.announcedAt.toISOString().slice(0, 10) : null;
      if (current === b0) {
        tally.same += 1;
        continue;
      }
      const missing = current === null;
      if (missing) tally.filled += 1;
      else tally.mismatched += 1;
      const write = APPLY && (missing || FIX_MISMATCH);
      console.log(`${missing ? "fill    " : "mismatch"}  ${projectId}  ${current ?? "—"} → ${b0}${write ? "" : missing ? "" : "  (kept)"}`);
      if (!write) continue;

      const announcedAt = new Date(`${b0}T00:00:00Z`);
      const category = record.fields?.category?.value;
      const derived = cohortFor(
        { category: typeof category === "string" ? category : "", announcedAt, createdAt: record.createdAt },
        config.stats.timezone,
      );
      await tors(db).updateOne(
        { _id: record._id },
        {
          $set: {
            announcedAt,
            announcedAtOrigin: "source",
            ...(derived ? { cohort: derived.cohort, cohortDateSource: derived.cohortDateSource } : {}),
          },
        },
      );
      // The windows the record leaves and the ones it joins both need recomputing.
      const windows = [record.cohort, derived?.cohort].flatMap((cohort) =>
        cohort ? windowKeysFor(cohort, config.stats.peerWindowMonths) : [],
      );
      if (windows.length > 0) await stats.markCohortsDirty(windows);
      if (!missing) tally.fixed += 1;
    }
  }
} finally {
  console.log(JSON.stringify({ event: "egp_announced_dates_done", apply: APPLY, fixMismatch: FIX_MISMATCH, ...tally }));
  await disconnect();
}
