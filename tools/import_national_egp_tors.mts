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
import type { ListItem } from "../apps/api/src/sources/national-egp/announcements.js";
import {
  downloadPackage,
  fetchAnnouncementList,
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
import { knownFieldsFromFeedItem, knownFieldsFromListItem } from "../apps/api/src/sources/national-egp/enrich.js";
import { entryFilename, selectPackageDocuments } from "../apps/api/src/sources/national-egp/package.js";
import { readZip, type ZipEntry } from "../apps/api/src/sources/national-egp/zip.js";

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

/** A project to import, with the list row or feed item that named it when there was one. */
interface Target {
  projectId: string;
  /** Where it was found: a list row's kind decides which documents are taken and dated. */
  from: "tor-list" | "invitation-list" | "feed" | "project";
  item?: FeedItem;
  row?: ListItem;
}

interface Submission {
  target: Target;
  entry: ZipEntry;
  /** A TOR's other files, read with it (checklist C3). */
  annexes?: ZipEntry[];
  documentType: DocumentType;
  source: PackageRef;
  knownFields?: Partial<TorFields>;
  /** The document's own publication date, when the list or the feed states it. */
  publishedAt?: Date;
}

async function submitDocument({ target, entry, annexes, documentType, source, knownFields, publishedAt }: Submission) {
  const filename = entryFilename(entry);
  const label = `${documentType.padEnd(10)} ${target.projectId}  ${filename}`;
  try {
    const submitted = await service.submit(entry.data, {
      route: "url",
      url: packageUrl(source.fileId),
      submittedBy: SUBMITTED_BY,
      filename,
      knownFields,
      ...(annexes && annexes.length > 0
        ? { annexes: annexes.map((annex) => ({ bytes: annex.data, filename: entryFilename(annex) })) }
        : {}),
      context: {
        documentType,
        sourceProject: { system: "national-egp", projectId: target.projectId, projectNumber: target.projectId },
        announcedAt: publishedAt ? asCalendarDay(publishedAt, config.search.timeZone) : undefined,
      },
    });
    if (submitted.duplicate) tally.duplicate += 1;
    else tally.queued += 1;
    const withAnnexes = annexes && annexes.length > 0 ? ` + ${annexes.length} annex(es)` : "";
    console.log(`${submitted.duplicate ? "linked" : "queued"}  ${label}${withAnnexes}  (${Math.round(entry.data.byteLength / 1024)} KB)`);
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
    // A draft-TOR list row's package carries the draft announcement, not the invitation.
    { final: found.final && target.from !== "tor-list" },
  );
  if (!documents.tor) {
    tally.noTor += 1;
    console.log(`skip    ${target.projectId} — the package holds no TOR document`);
    return;
  }

  const knownFields = target.row
    ? knownFieldsFromListItem(target.row)
    : knownFieldsFromFeedItem({ ...target.item, projectId: target.projectId });
  // A listed or fed date is the date of the announcement it lists: the draft TOR (list type 1,
  // feed B0) or the invitation (list type 2, feed D0). The other document's date is left alone.
  const listedOn = target.row ? new Date(`${target.row.announcedOn}T00:00:00Z`) : parseFeedDate(target.item?.pubDate);
  const datesTor = target.from === "tor-list" || target.item?.announceType === "B0";
  const datesInvitation = target.from === "invitation-list" || target.item?.announceType === "D0";
  const base = { target, source: found.ref, knownFields };

  await submitDocument({
    ...base,
    entry: documents.tor,
    annexes: documents.annexes,
    documentType: "tor",
    publishedAt: datesTor ? listedOn : undefined,
  });
  if (documents.invitation) {
    await submitDocument({
      ...base,
      entry: documents.invitation,
      documentType: "invitation",
      publishedAt: datesInvitation ? listedOn : undefined,
    });
  } else if (target.from !== "tor-list") {
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

try {
  let list: Target[];
  try {
    list = await targets();
  } catch (error) {
    // The source being down is the source's state, not a crash in this tool: say so plainly.
    console.error(`e-GP is not answering (${(error as Error).message}) — try again later, or use --project <number>`);
    process.exitCode = 1;
    list = [];
  }
  if (list.length === 0 && !process.exitCode) console.log("nothing to import — e-GP listed no announcements");
  for (const target of list) {
    await skipOnSourceError(target.projectId, () => importProject(target));
  }
} finally {
  console.log(JSON.stringify({ event: "national_egp_import_done", ...tally }));
  await disconnect();
}
