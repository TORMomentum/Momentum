/**
 * Imports real TORs from Thailand's national e-GP through the real intake path — the second
 * source beside tools/import_egp_tors.mts (BMA), which stays as it is.
 *
 *   npx tsx tools/import_national_egp_tors.mts [--limit 20]                 newest draft TORs (default)
 *   npx tsx tools/import_national_egp_tors.mts --from invitation [--limit]  newest invitations to bid
 *   npx tsx tools/import_national_egp_tors.mts --pages 5 --limit 250        read 5 pages of the list (50 each)
 *   npx tsx tools/import_national_egp_tors.mts --from feed [--type B0|D0] [--dept 30501]   the RSS feed
 *   npx tsx tools/import_national_egp_tors.mts --project 69099218130        named projects (repeatable,
 *                                                                            or comma-separated)
 *
 * Projects are found on e-GP's public announcement list by default — the draft-TOR list, so a TOR
 * is collected as soon as it is published, or the invitation list with --from invitation. The list
 * states the agency, budget and date as well, recorded as source values. The RSS feed is the other
 * way in (--from feed); its application has been down for days at a time while the list stayed up.
 *
 * For each project: its bid package from e-GP (or, for a B0 feed draft with no package yet, the
 * draft package its feed item links to). The package ZIP is archived whole as an original; its
 * primary TOR and — except from the draft-TOR list — its invitation to bid are submitted
 * through IntakeService, the same code the intake routes use, so file-type checks, content-hash
 * dedupe, immutable storage and the extraction job all apply. Both records carry the project,
 * and extraction links the invitation's deadline onto the TOR (spec 2026-09-16 e-GP project
 * linking). Design: docs/superpowers/specs/2026-10-04-national-egp-source-design.md
 *
 * From the draft-TOR list only the TOR is submitted: that package's announcement is the draft, and
 * its dates are not the final ones. The invitation arrives from the invitation list, and extraction
 * links its deadline onto the TOR then — the same TOR file dedupes onto the record already stored.
 *
 * Run the worker (`npm run worker -w @tor-radar/api`) to extract and publish what this queues.
 *
 * The per-project work lives in modules/collector (spec 2026-11-25-scheduled-collector), which the
 * collector worker also runs on a schedule when COLLECTOR_ENABLED is set; this tool picks its own targets.
 * Run by hand, like the BMA import; each run's outcome is recorded as source
 * `national-egp-import` for the admin source-health page (TOR-87). Re-running is safe — a stored
 * document is recognised by its hash. It is a public government service, so requests are paced.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NationalEgpCollect } from "../apps/api/src/adapters/national-egp.collect.js";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes } from "../apps/api/src/core/db.js";
import { CollectorRepository } from "../apps/api/src/modules/collector/collector.repository.js";
import { CollectorService, type ProjectTarget } from "../apps/api/src/modules/collector/collector.service.js";
import { SourceHealthRepository } from "../apps/api/src/modules/sources/source-health.repository.js";
import { SourceHealthService } from "../apps/api/src/modules/sources/source-health.service.js";
import { NATIONAL_EGP_IMPORT_ID } from "../apps/api/src/modules/sources/sources.registry.js";
import { IntakeRepository } from "../apps/api/src/modules/intake/intake.repository.js";
import { IntakeService } from "../apps/api/src/modules/intake/intake.service.js";
import { fetchAnnouncementList, fetchFeed } from "../apps/api/src/sources/national-egp/client.js";
import { ANNOUNCE_TYPES, type AnnounceType } from "../apps/api/src/sources/national-egp/config.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const LIMIT = Number(argValue("--limit") ?? 20);
/** Pages of e-GP's announcement list to read, 50 rows each; --limit still caps the projects. */
const PAGES = Number(argValue("--pages") ?? 1);
const FROM = argValue("--from") ?? "tor";
const TYPE = (argValue("--type") ?? "D0") as AnnounceType;
const DEPT = argValue("--dept");
const PROJECTS = process.argv
  .flatMap((arg, i) => (process.argv[i - 1] === "--project" ? arg.split(",") : []))
  .map((id) => id.trim())
  .filter(Boolean);
/** Pause between requests to the source. */
const DELAY_MS = Number(process.env.EGP_IMPORT_DELAY_MS ?? 1_000);
const SUBMITTED_BY = "national-egp-import";

if (!Number.isInteger(PAGES) || PAGES < 1) {
  console.error("--pages must be a positive whole number");
  process.exit(1);
}
if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}
if (!["tor", "invitation", "feed"].includes(FROM)) {
  console.error("--from must be tor, invitation or feed");
  process.exit(1);
}
if (!ANNOUNCE_TYPES.includes(TYPE)) {
  console.error(`--type must be one of ${ANNOUNCE_TYPES.join(", ")}`);
  process.exit(1);
}
const badProject = PROJECTS.find((id) => !/^\d{11}$/.test(id));
if (badProject) {
  console.error(`--project takes an 11-digit e-GP project number (got "${badProject}")`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
await ensureIndexes(db);

const storage = createStorage(config, "worker");
const intake = new IntakeService(
  storage,
  new MongoQueue(db, { maxAttempts: config.jobMaxAttempts, backoffMs: config.jobBackoffMs, lockMs: config.jobLockMs }),
  new IntakeRepository(db),
  { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
  // As the intake routes do, so each record joins its dashboard cohort at intake.
  { timezone: config.stats.timezone },
);

const service = new CollectorService({
  source: new NationalEgpCollect(config.search.timeZone),
  repo: new CollectorRepository(db),
  intake,
  storage,
  config,
  requestDelayMs: DELAY_MS,
});

const tally = { projects: 0, alreadyCollected: 0, packages: 0, queued: 0, duplicate: 0, noPackage: 0, noTor: 0, noInvitation: 0, rejected: 0, failed: 0 };

/** Imports one project through the collector module, and prints and counts what it did. */
async function importProject(target: ProjectTarget) {
  tally.projects += 1;
  const outcome = await service.importProject(target, SUBMITTED_BY);
  const { projectId } = outcome;
  if (outcome.status === "collected-elsewhere") {
    tally.alreadyCollected += 1;
    console.log(`skip    ${projectId} — already collected from ${outcome.elsewhere}`);
    return;
  }
  if (outcome.status === "no-package") {
    tally.noPackage += 1;
    console.log(`skip    ${projectId} — e-GP has no document package for it`);
    return;
  }
  if (outcome.status === "not-zip") {
    tally.rejected += 1;
    console.log(`skip    ${projectId} — the package is not a ZIP archive`);
    return;
  }
  if (outcome.package) {
    tally.packages += 1;
    console.log(`archive ${projectId}  ${outcome.package.name} → ${outcome.package.key}  (${Math.round(outcome.package.bytes / 1024)} KB)`);
  }
  if (outcome.status === "no-tor") {
    tally.noTor += 1;
    console.log(`skip    ${projectId} — the package holds no TOR document`);
    return;
  }
  if (outcome.undated) console.log(`no date ${projectId} — project stages unavailable: ${outcome.undated}`);
  for (const document of outcome.documents) {
    const label = `${document.documentType.padEnd(10)} ${projectId}  ${document.filename}`;
    if (document.status === "queued" || document.status === "linked") {
      tally[document.status === "linked" ? "duplicate" : "queued"] += 1;
      const withAnnexes = document.annexes > 0 ? ` + ${document.annexes} annex(es)` : "";
      console.log(`${document.status.padEnd(7)} ${label}${withAnnexes}  (${Math.round(document.bytes / 1024)} KB)`);
    } else {
      tally[document.status] += 1;
      console.log(`error   ${label} — ${document.message}`);
    }
  }
  if (outcome.noInvitation) tally.noInvitation += 1;
}

/**
 * The source is a public service that drops requests; one project failing is
 * reported and skipped, not the end of the run. Re-running picks it up.
 */
async function skipOnSourceError(projectId: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    tally.failed += 1;
    console.log(`error   ${projectId} — ${(error as Error).message}`);
    await sleep(DELAY_MS * 5);
  }
}

async function targets(): Promise<ProjectTarget[]> {
  if (PROJECTS.length > 0) return PROJECTS.map((projectId) => ({ projectId, from: "project" as const }));

  if (FROM === "feed") {
    const items = await fetchFeed(TYPE, DEPT);
    await sleep(DELAY_MS);
    console.log(`feed ${TYPE}${DEPT ? ` dept ${DEPT}` : ""}: ${items.length} announcement(s)`);
    // One project can appear more than once in a day's feed.
    const unique = new Map(items.map((item) => [item.projectId, item]));
    return [...unique.values()].slice(0, LIMIT).map((item) => ({ projectId: item.projectId, from: "feed" as const, item }));
  }

  const kind = FROM === "invitation" ? "invitation" : "tor";
  // Pages are read in order and a project seen on an earlier page is not repeated: the list moves
  // while it is being read, so a row can slide from one page onto the next.
  const byProject = new Map<string, Awaited<ReturnType<typeof fetchAnnouncementList>>[number]>();
  for (let page = 1; page <= PAGES; page += 1) {
    const pageRows = await fetchAnnouncementList(kind, page);
    await sleep(DELAY_MS);
    for (const row of pageRows) if (!byProject.has(row.projectId)) byProject.set(row.projectId, row);
    if (pageRows.length === 0) break;
  }
  const rows = [...byProject.values()];
  console.log(`list ${kind === "tor" ? "draft TOR" : "invitation"}: ${rows.length} announcement(s) from ${PAGES} page(s)`);
  return rows.slice(0, LIMIT).map((row) => ({
    projectId: row.projectId,
    from: kind === "tor" ? ("tor-list" as const) : ("invitation-list" as const),
    row,
  }));
}

/** Why the run could not do its work, when it could not: the list unreadable, or a crash (TOR-87). */
let runError: string | null = null;

try {
  let list: ProjectTarget[];
  try {
    list = await targets();
  } catch (error) {
    // The source being down is the source's state, not a crash in this tool: say so plainly.
    console.error(`e-GP is not answering (${(error as Error).message}) — try again later, or use --project <number>`);
    process.exitCode = 1;
    runError = `e-GP list unavailable: ${(error as Error).message}`;
    list = [];
  }
  if (list.length === 0 && !process.exitCode) console.log("nothing to import — e-GP listed no announcements");
  for (const target of list) {
    await skipOnSourceError(target.projectId, () => importProject(target));
  }
} catch (error) {
  runError = error instanceof Error ? error.message : "unknown";
  throw error;
} finally {
  console.log(JSON.stringify({ event: "national_egp_import_done", ...tally }));
  // Source health (TOR-87): the run's outcome, for the admin page. Failed when it could not run at all or
  // every project failed.
  const everyFailed = tally.projects > 0 && tally.failed >= tally.projects;
  const error = runError ?? (everyFailed ? "every project failed" : null);
  try {
    await new SourceHealthService({ repo: new SourceHealthRepository(db), config }).recordRun(NATIONAL_EGP_IMPORT_ID, {
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
