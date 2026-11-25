/**
 * Collects e-GP winner announcements for projects we already hold (TOR-221), through the real intake path.
 *
 *   npx tsx tools/collect_egp_awards.mts [--limit 5]              awarded projects with no announcement yet
 *   npx tsx tools/collect_egp_awards.mts --project 69099218130    named projects (repeatable, or comma-separated)
 *
 * Which projects: national e-GP records whose stage table (TOR-205) lists a winner announcement (W0, or its
 * amendment W2) and that have no award record yet. For each one, e-GP's public approval service names the
 * announcement's template (`infoApproveTemplate?templateType=W13`), and its template service returns the
 * announcement as a PDF with a text layer — the same public document the agency's project page opens, with
 * no captcha on the way. The bidders' price report is behind a captcha and is not collected.
 *
 * The PDF goes through IntakeService, the same code the intake routes use — file-type and magic-byte checks,
 * content-hash dedupe, immutable storage, and an extraction job — as `documentType: "award"` with the project
 * attached. The extraction worker reads the winner, the price and the date with Gemini, and copies the result
 * onto the project's TORs. Run the worker to extract what this queues; every reading is a billed model call.
 *
 * The per-announcement work lives in modules/collector (spec 2026-11-25-scheduled-collector), which the
 * collector worker also runs on a schedule when COLLECTOR_ENABLED is set.
 * Run by hand; each run's outcome is recorded as source `national-egp-awards` for the
 * admin source-health page (TOR-87). Re-running is safe — a stored document is recognised by its hash, and a
 * project with an award record is skipped. It is a public government service, so requests are paced.
 * Design: docs/superpowers/specs/2026-11-24-winner-announcements-design.md
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AwardTarget } from "../apps/api/src/modules/collector/collector.repository.js";
import { NationalEgpCollect } from "../apps/api/src/adapters/national-egp.collect.js";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes } from "../apps/api/src/core/db.js";
import { CollectorRepository } from "../apps/api/src/modules/collector/collector.repository.js";
import { CollectorService } from "../apps/api/src/modules/collector/collector.service.js";
import { IntakeRepository } from "../apps/api/src/modules/intake/intake.repository.js";
import { IntakeService } from "../apps/api/src/modules/intake/intake.service.js";
import { SourceHealthRepository } from "../apps/api/src/modules/sources/source-health.repository.js";
import { SourceHealthService } from "../apps/api/src/modules/sources/source-health.service.js";
import { NATIONAL_EGP_AWARDS_ID } from "../apps/api/src/modules/sources/sources.registry.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const LIMIT = Number(argValue("--limit") ?? 5);
const PROJECTS = process.argv.flatMap((arg, i) => (process.argv[i - 1] === "--project" ? arg.split(",") : []));
const DELAY_MS = Number(process.env.EGP_IMPORT_DELAY_MS ?? 2_000);
const SUBMITTED_BY = "national-egp-awards";

if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}
const badProject = PROJECTS.find((id) => !/^\d{11}$/.test(id));
if (badProject) {
  console.error(`--project takes an 11-digit e-GP project number (got "${badProject}")`);
  process.exit(1);
}


const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
await ensureIndexes(db);

const storage = createStorage(config, "worker");
const service = new CollectorService({
  source: new NationalEgpCollect(config.search.timeZone),
  repo: new CollectorRepository(db),
  intake: new IntakeService(
    storage,
    new MongoQueue(db, { maxAttempts: config.jobMaxAttempts, backoffMs: config.jobBackoffMs, lockMs: config.jobLockMs }),
    new IntakeRepository(db),
    { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
    { timezone: config.stats.timezone },
  ),
  storage,
  config,
  requestDelayMs: DELAY_MS,
});

const tally = { projects: 0, queued: 0, duplicate: 0, noAnnouncement: 0, rejected: 0, failed: 0 };

/** Collects one announcement through the collector module, and prints and counts what it did. */
async function collect(target: AwardTarget): Promise<void> {
  tally.projects += 1;
  const label = `award ${target.projectId}`;
  try {
    const outcome = await service.collectAward(target, SUBMITTED_BY);
    if (outcome.status === "none") {
      tally.noAnnouncement += 1;
      console.log(`none    ${label} — e-GP holds no winner announcement template`);
    } else if (outcome.status === "queued" || outcome.status === "linked") {
      tally[outcome.status === "linked" ? "duplicate" : "queued"] += 1;
      console.log(`${outcome.status.padEnd(7)} ${label}  (${Math.round((outcome.bytes ?? 0) / 1024)} KB)`);
    } else {
      tally[outcome.status] += 1;
      console.log(`error   ${label} — ${outcome.message}`);
    }
  } catch (error) {
    tally.failed += 1;
    console.log(`error   ${label} — ${(error as Error).message}`);
  }
}

let runError: string | null = null;
try {
  const list = await service.awardTargets(PROJECTS.length > 0 ? PROJECTS.length : LIMIT, PROJECTS);
  if (list.length === 0) console.log("nothing to collect — every awarded project already has its announcement");
  for (const target of list) await collect(target);
} catch (error) {
  runError = error instanceof Error ? error.message : "unknown";
  throw error;
} finally {
  console.log(JSON.stringify({ event: "national_egp_awards_done", ...tally }));
  const everyFailed = tally.projects > 0 && tally.failed >= tally.projects;
  const error = runError ?? (everyFailed ? "every project failed" : null);
  try {
    await new SourceHealthService({ repo: new SourceHealthRepository(db), config }).recordRun(NATIONAL_EGP_AWARDS_ID, {
      ok: error === null,
      items: tally.projects,
      failed: tally.failed,
      error,
    });
  } catch (healthError) {
    console.error(`source health not recorded: ${(healthError as Error).message}`);
  }
  await disconnect();
}
