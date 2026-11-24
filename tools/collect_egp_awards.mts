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
 * Run by hand, with no schedule; each run's outcome is recorded as source `national-egp-awards` for the
 * admin source-health page (TOR-87). Re-running is safe — a stored document is recognised by its hash, and a
 * project with an award record is skipped. It is a public government service, so requests are paced.
 * Design: docs/superpowers/specs/2026-11-24-winner-announcements-design.md
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes, tors } from "../apps/api/src/core/db.js";
import { IntakeRepository } from "../apps/api/src/modules/intake/intake.repository.js";
import { IntakeService } from "../apps/api/src/modules/intake/intake.service.js";
import { SourceHealthRepository } from "../apps/api/src/modules/sources/source-health.repository.js";
import { SourceHealthService } from "../apps/api/src/modules/sources/source-health.service.js";
import { NATIONAL_EGP_AWARDS_ID } from "../apps/api/src/modules/sources/sources.registry.js";
import { awardPdfUrl, downloadAward, getAwardTemplateId } from "../apps/api/src/sources/national-egp/client.js";
import { AWARD_STAGE_CODES } from "../apps/api/src/sources/national-egp/stages.js";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
await ensureIndexes(db);

const service = new IntakeService(
  createStorage(config, "worker"),
  new MongoQueue(db, { maxAttempts: config.jobMaxAttempts, backoffMs: config.jobBackoffMs, lockMs: config.jobLockMs }),
  new IntakeRepository(db),
  { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
  { timezone: config.stats.timezone },
);

const tally = { projects: 0, queued: 0, duplicate: 0, noAnnouncement: 0, rejected: 0, failed: 0 };

interface Target {
  projectId: string;
  /** The winner stage's day, `YYYY-MM-DD`: the announcement's own publication date. */
  announcedOn: string | null;
}

/** Awarded projects with a winner stage and no award record yet, newest announcement first. */
async function targets(): Promise<Target[]> {
  const collected = new Set(
    (await tors(db).distinct("sourceProject.projectId", { "sourceProject.system": "national-egp", documentType: "award" })) as string[],
  );
  const records = await tors(db)
    .find(
      {
        "sourceProject.system": "national-egp",
        documentType: { $nin: ["invitation", "award"] },
        duplicateOf: null,
        "stageHistory.code": { $in: [...AWARD_STAGE_CODES] },
        ...(PROJECTS.length > 0 ? { "sourceProject.projectId": { $in: PROJECTS } } : {}),
      },
      { projection: { "sourceProject.projectId": 1, stageHistory: 1 } },
    )
    .toArray();

  const byProject = new Map<string, Target>();
  for (const record of records) {
    const projectId = record.sourceProject?.projectId;
    if (!projectId || collected.has(projectId) || byProject.has(projectId)) continue;
    const winner = (record.stageHistory ?? []).find((stage) => AWARD_STAGE_CODES.includes(stage.code));
    byProject.set(projectId, { projectId, announcedOn: winner?.on ?? null });
  }
  return [...byProject.values()].sort((a, b) => (b.announcedOn ?? "").localeCompare(a.announcedOn ?? "")).slice(0, LIMIT);
}

async function collect(target: Target): Promise<void> {
  tally.projects += 1;
  const label = `award ${target.projectId}`;
  try {
    const templateId = await getAwardTemplateId(target.projectId);
    await sleep(DELAY_MS);
    if (!templateId) {
      tally.noAnnouncement += 1;
      console.log(`none    ${label} — e-GP holds no winner announcement template`);
      return;
    }
    const bytes = await downloadAward(templateId);
    await sleep(DELAY_MS);
    const submitted = await service.submit(bytes, {
      route: "url",
      url: awardPdfUrl(templateId),
      submittedBy: SUBMITTED_BY,
      filename: `${target.projectId}_award.pdf`,
      context: {
        documentType: "award",
        sourceProject: { system: "national-egp", projectId: target.projectId, projectNumber: target.projectId },
        announcedAt: target.announcedOn ? new Date(`${target.announcedOn}T00:00:00Z`) : undefined,
      },
    });
    if (submitted.duplicate) tally.duplicate += 1;
    else tally.queued += 1;
    console.log(`${submitted.duplicate ? "linked" : "queued"}  ${label}  (${Math.round(bytes.byteLength / 1024)} KB)`);
  } catch (error) {
    const message = (error as Error).message;
    if (/Unsupported document type|exceeds/.test(message)) tally.rejected += 1;
    else tally.failed += 1;
    console.log(`error   ${label} — ${message}`);
  }
}

let runError: string | null = null;
try {
  const list = await targets();
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
