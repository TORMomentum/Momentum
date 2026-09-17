/**
 * Imports real TORs from the BMA e-GP source API through the real intake path.
 *
 *   npx tsx tools/import_egp_tors.mts [--limit 20]    newest TOR projects
 *   npx tsx tools/import_egp_tors.mts --backfill      records imported before project linking
 *
 * For each project: its TOR document, and — when the agency has published one — its invitation to
 * bid (ประกาศเชิญชวน), which is where the submission deadline is stated. Each file is downloaded
 * from its permanent source URL and submitted through IntakeService, the same code the intake
 * routes use, so file-type checks, content-hash dedupe, immutable storage and the extraction job
 * all apply. Both records carry the project they belong to; the TOR stays the public record, and
 * extraction links the invitation's deadline onto it (spec 2026-09-16 e-GP project linking).
 *
 * What the source states is recorded as source values: title, agency, budget and project number
 * as `origin: "source"` fields, and each document's publish date as its announcement date.
 *
 * Run the worker (`npm run worker -w @tor-radar/api`) to extract and publish what this queues.
 *
 * A one-off precursor of the F12 collector (FR-A-4), not the collector: no schedule, no health
 * record. Re-running is safe — a document already stored is recognised by its hash and only gains
 * its source reference and project. It is a public government service, so requests are paced.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DocumentType } from "@tor-radar/shared";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes, tors } from "../apps/api/src/core/db.js";
import { asCalendarDay } from "../apps/api/src/lib/calendar-date.js";
import { IntakeRepository } from "../apps/api/src/modules/intake/intake.repository.js";
import { IntakeService } from "../apps/api/src/modules/intake/intake.service.js";
import {
  buildFileUrl,
  getProjectAnnouncements,
  searchTorProjects,
  selectInvitationAnnouncements,
  selectTorAnnouncements,
  type BmaEgpAnnouncement,
  type BmaEgpProject,
} from "../apps/api/src/sources/bma-egp/client.js";
import { knownFieldsFromProject } from "../apps/api/src/sources/bma-egp/enrich.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 20;
const BACKFILL = process.argv.includes("--backfill");
/** Pause between requests to the source. */
const DELAY_MS = Number(process.env.EGP_IMPORT_DELAY_MS ?? 1_000);
const PAGE_SIZE = 20;
const SUBMITTED_BY = "egp-import";

if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error("--limit must be a positive integer");
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
  // As the intake routes do, so each record joins its dashboard cohort at intake.
  { timezone: config.stats.timezone },
);

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(config.fetchTimeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > config.fetchMaxBytes) throw new Error(`too large (${declared} bytes)`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > config.fetchMaxBytes) throw new Error(`too large (${bytes.byteLength} bytes)`);
  return bytes;
}

const tally = { projects: 0, queued: 0, duplicate: 0, noTor: 0, noInvitation: 0, rejected: 0, failed: 0 };

async function submitDocument(project: BmaEgpProject, announcement: BmaEgpAnnouncement, documentType: DocumentType) {
  const label = `${documentType.padEnd(10)} ${project.projectNumber}  ${project.projectName.slice(0, 45)}`;
  try {
    const url = buildFileUrl(announcement.id, announcement.projectAnnouncementPath!);
    const bytes = await download(url);
    await sleep(DELAY_MS);

    const published = announcement.projectAnnouncementPublishDate
      ? new Date(announcement.projectAnnouncementPublishDate)
      : null;

    const submitted = await service.submit(bytes, {
      route: "url",
      url,
      submittedBy: SUBMITTED_BY,
      filename: announcement.projectAnnouncementPath,
      knownFields: knownFieldsFromProject(project),
      context: {
        documentType,
        sourceProject: { system: "bma-egp", projectId: project.projectId, projectNumber: project.projectNumber },
        announcedAt: published && !Number.isNaN(published.getTime()) ? asCalendarDay(published, config.search.timeZone) : undefined,
      },
    });

    if (submitted.duplicate) tally.duplicate += 1;
    else tally.queued += 1;
    console.log(`${submitted.duplicate ? "linked" : "queued"}  ${label}  (${Math.round(bytes.byteLength / 1024)} KB)`);
  } catch (error) {
    const message = (error as Error).message;
    // Intake refuses what is not a PDF or image (e.g. the source's .zip attachments).
    if (/Unsupported document type|exceeds|too large/.test(message)) tally.rejected += 1;
    else tally.failed += 1;
    console.log(`error   ${label} — ${message}`);
  }
}

async function importProject(project: BmaEgpProject) {
  tally.projects += 1;
  const announcements = await getProjectAnnouncements(project.projectId);
  await sleep(DELAY_MS);

  const [tor] = selectTorAnnouncements(announcements);
  if (!tor) {
    tally.noTor += 1;
    console.log(`skip    ${project.projectNumber} — no TOR document`);
    return;
  }
  await submitDocument(project, tor, "tor");

  const [invitation] = selectInvitationAnnouncements(announcements);
  if (invitation) await submitDocument(project, invitation, "invitation");
  else tally.noInvitation += 1;
}

/**
 * The source is a public service that drops requests; one project failing is
 * reported and skipped, not the end of the run. Re-running picks it up.
 */
async function skipOnSourceError(projectNumber: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    tally.failed += 1;
    console.log(`error   ${projectNumber} — ${(error as Error).message}`);
    await sleep(DELAY_MS * 5);
  }
}

/** The project a stored record came from, found again by the project number it carries. */
async function findProject(projectNumber: string): Promise<BmaEgpProject | undefined> {
  const page = await searchTorProjects({ keyword: projectNumber, pageSize: 5 });
  await sleep(DELAY_MS);
  return page.data.find((project) => project.projectNumber === projectNumber);
}

try {
  if (BACKFILL) {
    const unlinked = await tors(db)
      .find(
        { "sourceRefs.submittedBy": SUBMITTED_BY, sourceProject: { $exists: false } },
        { projection: { "fields.referenceNo.value": 1 } },
      )
      .toArray();
    console.log(`backfilling ${unlinked.length} records imported before project linking`);

    for (const record of unlinked) {
      const projectNumber = record.fields.referenceNo?.value;
      if (typeof projectNumber !== "string") continue;
      await skipOnSourceError(projectNumber, async () => {
        const project = await findProject(projectNumber);
        if (!project) throw new Error("project not found at the source");
        await importProject(project);
      });
    }
  } else {
    for (let page = 1; tally.projects < LIMIT; page += 1) {
      const result = await searchTorProjects({ pageNo: page, pageSize: PAGE_SIZE });
      if (result.data.length === 0) break;
      await sleep(DELAY_MS);

      for (const project of result.data) {
        if (tally.projects >= LIMIT) break;
        await skipOnSourceError(project.projectNumber, () => importProject(project));
      }
    }
  }
} finally {
  console.log(JSON.stringify({ event: "egp_import_done", ...tally }));
  await disconnect();
}
