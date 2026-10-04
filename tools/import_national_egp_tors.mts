/**
 * Imports real TORs from Thailand's national e-GP through the real intake path — the second
 * source beside tools/import_egp_tors.mts (BMA), which stays as it is.
 *
 *   npx tsx tools/import_national_egp_tors.mts [--limit 20]               today's invitations to bid (D0)
 *   npx tsx tools/import_national_egp_tors.mts --type B0 [--limit 20]     today's draft TORs
 *   npx tsx tools/import_national_egp_tors.mts --dept 30501               one department only
 *   npx tsx tools/import_national_egp_tors.mts --project 69099218130      named projects (repeatable,
 *                                                                          or comma-separated)
 *
 * For each project: its final bid package from e-GP (or, for a B0 draft with no final package
 * yet, the draft package its feed item links to). The package ZIP is archived whole as an
 * original; its primary TOR and — in a final package — its invitation to bid are submitted
 * through IntakeService, the same code the intake routes use, so file-type checks, content-hash
 * dedupe, immutable storage and the extraction job all apply. Both records carry the project,
 * and extraction links the invitation's deadline onto the TOR (spec 2026-09-16 e-GP project
 * linking). Design: docs/superpowers/specs/2026-10-04-national-egp-source-design.md
 *
 * The feed is empty at weekends and outside office hours; use --project then.
 *
 * Run the worker (`npm run worker -w @tor-radar/api`) to extract and publish what this queues.
 *
 * A one-off, like the BMA import: no schedule, no health record. Re-running is safe — a stored
 * document is recognised by its hash. It is a public government service, so requests are paced.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DocumentType, TorFields } from "@tor-radar/shared";
import { createStorage } from "../apps/api/src/adapters/storage.factory.js";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes, tors } from "../apps/api/src/core/db.js";
import { asCalendarDay } from "../apps/api/src/lib/calendar-date.js";
import { sha256 } from "../apps/api/src/lib/hash.js";
import { packageKeyFor } from "../apps/api/src/lib/storage-key.js";
import { IntakeRepository } from "../apps/api/src/modules/intake/intake.repository.js";
import { IntakeService } from "../apps/api/src/modules/intake/intake.service.js";
import {
  downloadPackage,
  fetchFeed,
  fileIdFromLink,
  getBidPackage,
  packageUrl,
  parseFeedDate,
  type FeedItem,
  type PackageRef,
} from "../apps/api/src/sources/national-egp/client.js";
import {
  ANNOUNCE_TYPES,
  MAX_PACKAGE_ENTRIES,
  MAX_PACKAGE_UNPACKED_BYTES,
  type AnnounceType,
} from "../apps/api/src/sources/national-egp/config.js";
import { knownFieldsFromFeedItem } from "../apps/api/src/sources/national-egp/enrich.js";
import { entryFilename, selectPackageDocuments } from "../apps/api/src/sources/national-egp/package.js";
import { readZip, type ZipEntry } from "../apps/api/src/sources/national-egp/zip.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const LIMIT = Number(argValue("--limit") ?? 20);
const TYPE = (argValue("--type") ?? "D0") as AnnounceType;
const DEPT = argValue("--dept");
const PROJECTS = process.argv
  .flatMap((arg, i) => (process.argv[i - 1] === "--project" ? arg.split(",") : []))
  .map((id) => id.trim())
  .filter(Boolean);
/** Pause between requests to the source. */
const DELAY_MS = Number(process.env.EGP_IMPORT_DELAY_MS ?? 1_000);
const SUBMITTED_BY = "national-egp-import";

if (!Number.isInteger(LIMIT) || LIMIT < 1) {
  console.error("--limit must be a positive integer");
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
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
await ensureIndexes(db);

const storage = createStorage(config, "worker");
const service = new IntakeService(
  storage,
  new MongoQueue(db, { maxAttempts: config.jobMaxAttempts, backoffMs: config.jobBackoffMs, lockMs: config.jobLockMs }),
  new IntakeRepository(db),
  { allowedMimeTypes: config.allowedMimeTypes, maxUploadBytes: config.maxUploadBytes },
  // As the intake routes do, so each record joins its dashboard cohort at intake.
  { timezone: config.stats.timezone },
);

const tally = { projects: 0, alreadyCollected: 0, packages: 0, queued: 0, duplicate: 0, noPackage: 0, noTor: 0, noInvitation: 0, rejected: 0, failed: 0 };

/** A project to import, with the feed item that named it when there was one. */
interface Target {
  projectId: string;
  item?: FeedItem;
}

interface Submission {
  target: Target;
  entry: ZipEntry;
  documentType: DocumentType;
  source: PackageRef;
  knownFields?: Partial<TorFields>;
  /** The document's own publication date, when the feed states it. */
  publishedAt?: Date;
}

async function submitDocument({ target, entry, documentType, source, knownFields, publishedAt }: Submission) {
  const filename = entryFilename(entry);
  const label = `${documentType.padEnd(10)} ${target.projectId}  ${filename}`;
  try {
    const submitted = await service.submit(entry.data, {
      route: "url",
      url: packageUrl(source.fileId),
      submittedBy: SUBMITTED_BY,
      filename,
      knownFields,
      context: {
        documentType,
        sourceProject: { system: "national-egp", projectId: target.projectId, projectNumber: target.projectId },
        announcedAt: publishedAt ? asCalendarDay(publishedAt, config.search.timeZone) : undefined,
      },
    });
    if (submitted.duplicate) tally.duplicate += 1;
    else tally.queued += 1;
    console.log(`${submitted.duplicate ? "linked" : "queued"}  ${label}  (${Math.round(entry.data.byteLength / 1024)} KB)`);
  } catch (error) {
    const message = (error as Error).message;
    if (/Unsupported document type|exceeds/.test(message)) tally.rejected += 1;
    else tally.failed += 1;
    console.log(`error   ${label} — ${message}`);
  }
}

/** The final bid package, else — for a draft — the package the feed item links to. */
async function findPackage(target: Target): Promise<{ ref: PackageRef; final: boolean } | null> {
  const bid = await getBidPackage(target.projectId);
  await sleep(DELAY_MS);
  if (bid) return { ref: bid, final: true };

  const draftFileId = target.item?.announceType === "B0" ? fileIdFromLink(target.item.link) : undefined;
  return draftFileId ? { ref: { fileId: draftFileId, name: `${target.projectId}_draft.zip` }, final: false } : null;
}

/**
 * The source system that already collected this project, if another one did. A Bangkok project is
 * published on egp2.bangkok.go.th and on national e-GP under the same e-GP number; collecting it
 * twice would list it twice and leave this source's invitation unable to link to that TOR.
 */
async function collectedElsewhere(projectNumber: string): Promise<string | null> {
  const existing = await tors(db).findOne(
    { "sourceProject.projectNumber": projectNumber, "sourceProject.system": { $ne: "national-egp" } },
    { projection: { "sourceProject.system": 1 } },
  );
  return existing?.sourceProject?.system ?? null;
}

async function importProject(target: Target) {
  tally.projects += 1;
  const elsewhere = await collectedElsewhere(target.projectId);
  if (elsewhere) {
    tally.alreadyCollected += 1;
    console.log(`skip    ${target.projectId} — already collected from ${elsewhere}`);
    return;
  }
  const found = await findPackage(target);
  if (!found) {
    tally.noPackage += 1;
    console.log(`skip    ${target.projectId} — e-GP has no document package for it`);
    return;
  }

  const bytes = await downloadPackage(found.ref.fileId);
  await sleep(DELAY_MS);
  if (!bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    tally.rejected += 1;
    console.log(`skip    ${target.projectId} — the package is not a ZIP archive`);
    return;
  }

  // The package is an original too: archived whole, so nothing in it is lost (spec decision 4).
  const archived = await storage.putIfAbsent(packageKeyFor(sha256(bytes), "application/zip"), bytes, "application/zip", {
    originalFilename: found.ref.name,
    route: "url",
  });
  tally.packages += 1;
  console.log(`archive ${target.projectId}  ${found.ref.name} → ${archived.key}  (${Math.round(bytes.byteLength / 1024)} KB)`);

  const documents = selectPackageDocuments(
    readZip(bytes, {
      maxEntries: MAX_PACKAGE_ENTRIES,
      maxEntryBytes: config.maxUploadBytes,
      maxTotalBytes: MAX_PACKAGE_UNPACKED_BYTES,
    }),
    { final: found.final },
  );
  if (!documents.tor) {
    tally.noTor += 1;
    console.log(`skip    ${target.projectId} — the package holds no TOR document`);
    return;
  }

  const knownFields = knownFieldsFromFeedItem({ ...target.item, projectId: target.projectId });
  // A feed date is the date of the announcement that feed carries: B0 announces the draft TOR,
  // D0 the invitation. The other document's date is left for extraction.
  const feedDate = parseFeedDate(target.item?.pubDate);
  const base = { target, source: found.ref, knownFields };

  await submitDocument({
    ...base,
    entry: documents.tor,
    documentType: "tor",
    publishedAt: target.item?.announceType === "B0" ? feedDate : undefined,
  });
  if (documents.invitation) {
    await submitDocument({
      ...base,
      entry: documents.invitation,
      documentType: "invitation",
      publishedAt: target.item?.announceType === "D0" ? feedDate : undefined,
    });
  } else {
    tally.noInvitation += 1;
  }
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

async function targets(): Promise<Target[]> {
  if (PROJECTS.length > 0) return PROJECTS.map((projectId) => ({ projectId }));

  const items = await fetchFeed(TYPE, DEPT);
  await sleep(DELAY_MS);
  console.log(`feed ${TYPE}${DEPT ? ` dept ${DEPT}` : ""}: ${items.length} announcement(s)`);
  // One project can appear more than once in a day's feed.
  const unique = new Map(items.map((item) => [item.projectId, item]));
  return [...unique.values()].slice(0, LIMIT).map((item) => ({ projectId: item.projectId, item }));
}

try {
  const list = await targets();
  if (list.length === 0) console.log("nothing to import — the feed is empty at weekends; try --project <number>");
  for (const target of list) {
    await skipOnSourceError(target.projectId, () => importProject(target));
  }
} finally {
  console.log(JSON.stringify({ event: "national_egp_import_done", ...tally }));
  await disconnect();
}
