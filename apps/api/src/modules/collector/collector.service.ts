import type { DocumentType, TorFields } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { asCalendarDay } from "../../lib/calendar-date.js";
import { sha256 } from "../../lib/hash.js";
import { packageKeyFor } from "../../lib/storage-key.js";
import type { EgpCollectSource, EgpListKind } from "../../ports/egp-collect.port.js";
import type { Storage } from "../../ports/storage.port.js";
import type { ListItem } from "../../sources/national-egp/announcements.js";
import { fileIdFromLink, parseFeedDate, type FeedItem, type PackageRef } from "../../sources/national-egp/client.js";
import { MAX_PACKAGE_ENTRIES, MAX_PACKAGE_UNPACKED_BYTES } from "../../sources/national-egp/config.js";
import { knownFieldsFromFeedItem, knownFieldsFromListItem } from "../../sources/national-egp/enrich.js";
import { entryFilename, selectPackageDocuments } from "../../sources/national-egp/package.js";
import { readZip, type ZipEntry } from "../../sources/national-egp/zip.js";
import type { SubmitResult, SubmitSource } from "../intake/intake.service.js";
import type { AwardTarget, CollectorRepository } from "./collector.repository.js";

/** What the scheduled collector submits as (decision 11); the tools keep their own names. */
export const COLLECTOR_SUBMITTER = "national-egp-collector";

/** Project failures in a row before a pass stops and backs off (decision 8). */
export const FAILURES_BEFORE_BACKOFF = 3;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DAY_MS = 86_400_000;

/** A project to import, with the list row or feed item that named it when there was one. */
export interface ProjectTarget {
  projectId: string;
  /** Where it was found: a list row's kind decides which documents are taken and dated. */
  from: "tor-list" | "invitation-list" | "feed" | "project";
  item?: FeedItem;
  row?: ListItem;
}

/** One document's submission: queued for extraction, linked onto a stored record, or refused. */
export interface DocumentOutcome {
  documentType: DocumentType;
  filename: string;
  status: "queued" | "linked" | "rejected" | "failed";
  bytes: number;
  annexes: number;
  message?: string;
}

/** What importing one project did. Throws instead when e-GP could not be read for it. */
export interface ProjectOutcome {
  projectId: string;
  status: "imported" | "collected-elsewhere" | "no-package" | "not-zip" | "no-tor";
  /** The other source system that holds it, for `collected-elsewhere`. */
  elsewhere?: string;
  package?: { name: string; key: string; bytes: number };
  documents: DocumentOutcome[];
  /** A final package from a list other than the draft-TOR list held no invitation. */
  noInvitation: boolean;
  /** The ceiling was reached after the TOR: the invitation is left for a later pass. */
  invitationDeferred?: boolean;
  /** Why the TOR was left undated, when the stage table could not be read. */
  undated?: string;
}

/** What collecting one winner announcement did. */
export interface AwardOutcome {
  projectId: string;
  status: "queued" | "linked" | "none" | "rejected" | "failed";
  bytes?: number;
  message?: string;
}

/** One source id's share of a pass, as source health records it (decision 10). */
export interface PassPart {
  /** e-GP was asked for this part: a list was read, or an announcement looked up. */
  asked: boolean;
  projects: number;
  queued: number;
  failed: number;
  /** Why this part could not do its work: the list unreadable, or a back-off. */
  error: string | null;
}

export interface CollectorPassResult {
  tors: PassPart;
  awards: PassPart;
  /** True when the pass stopped on FAILURES_BEFORE_BACKOFF failures in a row: wait `backoffMs`. */
  backOff: boolean;
  /** Documents the ceiling still allowed when the pass ended (decision 6). */
  remaining: number;
}

/**
 * What a part of a pass tells source health: failed when it could not run (list unreadable, back-off) or
 * every project failed; succeeded when e-GP answered, even with nothing new; `null` when it asked e-GP
 * nothing (the ceiling was spent, or no announcement was due), which is a heartbeat, not a success.
 */
export function partOutcome(part: PassPart): { ok: boolean; items: number; failed: number; error: string | null } | null {
  if (!part.asked) return null;
  const everyFailed = part.projects > 0 && part.failed >= part.projects;
  const error = part.error ?? (everyFailed ? "every project failed" : null);
  return { ok: error === null, items: part.projects, failed: part.failed, error };
}

const isRejection = (message: string) => /Unsupported document type|exceeds/.test(message);

/**
 * Collects national e-GP TORs, invitations and winner announcements through the real intake path
 * (spec 2026-11-25-scheduled-collector). The tools call `importProject` and `collectAward` with their own
 * targets; the collector worker calls `runPass`.
 */
export class CollectorService {
  constructor(
    private readonly deps: {
      source: EgpCollectSource;
      repo: CollectorRepository;
      intake: { submit(bytes: Buffer, source: SubmitSource): Promise<SubmitResult> };
      storage: Storage;
      config: Config;
      /** Pause between requests to e-GP; the tools pass their own, the worker uses COLLECTOR_REQUEST_DELAY_MS. */
      requestDelayMs?: number;
      now?: () => Date;
      pause?: (ms: number) => Promise<void>;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async rest(multiple = 1): Promise<void> {
    const ms = (this.deps.requestDelayMs ?? this.deps.config.collector.requestDelayMs) * multiple;
    if (ms <= 0) return;
    const pause = this.deps.pause ?? ((wait: number) => new Promise<void>((resolve) => setTimeout(resolve, wait)));
    await pause(ms);
  }

  /** The final bid package, else — for a feed draft — the package the feed item links to. */
  private async findPackage(target: ProjectTarget): Promise<{ ref: PackageRef; final: boolean } | null> {
    const bid = await this.deps.source.bidPackage(target.projectId);
    await this.rest();
    if (bid) return { ref: bid, final: true };
    const draftFileId = target.item?.announceType === "B0" ? fileIdFromLink(target.item.link) : undefined;
    return draftFileId ? { ref: { fileId: draftFileId, name: `${target.projectId}_draft.zip` }, final: false } : null;
  }

  private async submitDocument(input: {
    projectId: string;
    submittedBy: string;
    source: PackageRef;
    entry: ZipEntry;
    annexes?: ZipEntry[];
    documentType: DocumentType;
    knownFields?: Partial<TorFields>;
    publishedAt?: Date;
  }): Promise<DocumentOutcome> {
    const { projectId, entry, annexes = [], documentType } = input;
    const filename = entryFilename(entry);
    const base = { documentType, filename, bytes: entry.data.byteLength, annexes: annexes.length };
    try {
      const submitted = await this.deps.intake.submit(entry.data, {
        route: "url",
        url: this.deps.source.packageUrl(input.source.fileId),
        submittedBy: input.submittedBy,
        filename,
        knownFields: input.knownFields,
        ...(annexes.length > 0 ? { annexes: annexes.map((annex) => ({ bytes: annex.data, filename: entryFilename(annex) })) } : {}),
        context: {
          documentType,
          sourceProject: { system: "national-egp", projectId, projectNumber: projectId },
          announcedAt: input.publishedAt ? asCalendarDay(input.publishedAt, this.deps.config.search.timeZone) : undefined,
        },
      });
      return { ...base, status: submitted.duplicate ? "linked" : "queued" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return { ...base, status: isRejection(message) ? "rejected" : "failed", message };
    }
  }

  /**
   * Imports one project: its package archived whole as an original, its TOR (with annexes) and — except
   * from the draft-TOR list — its invitation submitted through intake (spec 2026-10-04 national e-GP).
   */
  async importProject(target: ProjectTarget, submittedBy: string, limits: { maxNew?: number } = {}): Promise<ProjectOutcome> {
    const { source, repo, storage, config } = this.deps;
    const outcome: ProjectOutcome = { projectId: target.projectId, status: "imported", documents: [], noInvitation: false };

    const elsewhere = await repo.collectedElsewhere(target.projectId);
    if (elsewhere) return { ...outcome, status: "collected-elsewhere", elsewhere };

    const found = await this.findPackage(target);
    if (!found) return { ...outcome, status: "no-package" };

    const bytes = await source.downloadPackage(found.ref.fileId);
    await this.rest();
    if (!bytes.subarray(0, 4).equals(ZIP_MAGIC)) return { ...outcome, status: "not-zip" };

    // The package is an original too: archived whole, so nothing in it is lost (spec 2026-10-04 decision 4).
    const archived = await storage.putIfAbsent(packageKeyFor(sha256(bytes), "application/zip"), bytes, "application/zip", {
      originalFilename: found.ref.name,
      route: "url",
    });
    outcome.package = { name: found.ref.name, key: archived.key, bytes: bytes.byteLength };

    const documents = selectPackageDocuments(
      readZip(bytes, { maxEntries: MAX_PACKAGE_ENTRIES, maxEntryBytes: config.maxUploadBytes, maxTotalBytes: MAX_PACKAGE_UNPACKED_BYTES }),
      // A draft-TOR list row's package carries the draft announcement, not the invitation.
      { final: found.final && target.from !== "tor-list" },
    );
    if (!documents.tor) return { ...outcome, status: "no-tor" };

    const knownFields = target.row ? knownFieldsFromListItem(target.row) : knownFieldsFromFeedItem({ ...target.item, projectId: target.projectId });
    // A listed or fed date is the date of the announcement it lists: the draft TOR (list type 1, feed B0) or
    // the invitation (list type 2, feed D0). The other document's date is left alone.
    const listedOn = target.row ? new Date(`${target.row.announcedOn}T00:00:00Z`) : parseFeedDate(target.item?.pubDate);
    const datesTor = target.from === "tor-list" || target.item?.announceType === "B0";
    const datesInvitation = target.from === "invitation-list" || target.item?.announceType === "D0";
    const common = { projectId: target.projectId, submittedBy, source: found.ref, knownFields };

    // Otherwise e-GP's project page lists the draft TOR's own date (TOR-204), or its first invitation's.
    let torPublishedAt = datesTor ? listedOn : undefined;
    if (!torPublishedAt) {
      try {
        const day = await source.torAnnouncedOn(target.projectId);
        if (day) torPublishedAt = new Date(`${day}T00:00:00Z`);
      } catch (error) {
        // The date is optional: the TOR is still collected, and the backfill tool can date it later.
        outcome.undated = error instanceof Error ? error.message : "unknown";
      }
      await this.rest();
    }

    outcome.documents.push(
      await this.submitDocument({ ...common, entry: documents.tor, annexes: documents.annexes, documentType: "tor", publishedAt: torPublishedAt }),
    );
    const queuedSoFar = outcome.documents.filter((doc) => doc.status === "queued").length;
    if (documents.invitation && limits.maxNew !== undefined && queuedSoFar >= limits.maxNew) {
      // The ceiling is spent: the invitation waits for a later pass, which finds the TOR already stored.
      outcome.invitationDeferred = true;
    } else if (documents.invitation) {
      outcome.documents.push(
        await this.submitDocument({ ...common, entry: documents.invitation, documentType: "invitation", publishedAt: datesInvitation ? listedOn : undefined }),
      );
    } else if (target.from !== "tor-list") {
      outcome.noInvitation = true;
    }
    return outcome;
  }

  /** Awarded projects still without their announcement (TOR-221), newest first. */
  awardTargets(limit: number, projects: readonly string[] = []): Promise<AwardTarget[]> {
    return this.deps.repo.awardTargets(limit, projects);
  }

  /**
   * Collects one winner announcement: e-GP's template service returns it as a PDF with a text layer, which
   * goes through intake as an `award` document of the project (spec 2026-11-24-winner-announcements).
   */
  async collectAward(target: AwardTarget, submittedBy: string): Promise<AwardOutcome> {
    const { source, intake } = this.deps;
    const templateId = await source.awardTemplateId(target.projectId);
    await this.rest();
    if (!templateId) return { projectId: target.projectId, status: "none" };
    const bytes = await source.downloadAward(templateId);
    await this.rest();
    try {
      const submitted = await intake.submit(bytes, {
        route: "url",
        url: source.awardPdfUrl(templateId),
        submittedBy,
        filename: `${target.projectId}_award.pdf`,
        context: {
          documentType: "award",
          sourceProject: { system: "national-egp", projectId: target.projectId, projectNumber: target.projectId },
          announcedAt: target.announcedOn ? new Date(`${target.announcedOn}T00:00:00Z`) : undefined,
        },
      });
      return { projectId: target.projectId, status: submitted.duplicate ? "linked" : "queued", bytes: bytes.byteLength };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return { projectId: target.projectId, status: isRejection(message) ? "rejected" : "failed", bytes: bytes.byteLength, message };
    }
  }

  /** Documents the daily ceiling still allows: COLLECTOR_MAX_NEW_PER_DAY less what the last 24 hours queued. */
  async remainingToday(): Promise<number> {
    const { repo, config } = this.deps;
    const used = await repo.createdSince(COLLECTOR_SUBMITTER, new Date(this.now().getTime() - DAY_MS));
    return Math.max(0, config.collector.maxNewPerDay - used);
  }

  /** The newest rows of one list, `COLLECTOR_LIST_PAGES` pages, each project once. */
  private async listRows(kind: EgpListKind): Promise<ListItem[]> {
    const byProject = new Map<string, ListItem>();
    for (let page = 1; page <= this.deps.config.collector.listPages; page += 1) {
      const rows = await this.deps.source.announcementList(kind, page);
      await this.rest();
      // The list moves while it is read, so a row can slide from one page onto the next.
      for (const row of rows) if (!byProject.has(row.projectId)) byProject.set(row.projectId, row);
      if (rows.length === 0) break;
    }
    return [...byProject.values()];
  }

  /**
   * One pass (decisions 4–8): the invitation list, then the draft-TOR list, then winner announcements, each
   * project paced, stopping when the daily ceiling is reached or e-GP refuses three projects in a row.
   */
  async runPass(): Promise<CollectorPassResult> {
    const result: CollectorPassResult = {
      tors: { asked: false, projects: 0, queued: 0, failed: 0, error: null },
      awards: { asked: false, projects: 0, queued: 0, failed: 0, error: null },
      backOff: false,
      remaining: await this.remainingToday(),
    };
    let failuresInARow = 0;
    const failed = (part: PassPart, projectId: string, error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown";
      part.failed += 1;
      failuresInARow += 1;
      logger.warn("collector_project_failed", { projectId, error: message });
      if (failuresInARow >= FAILURES_BEFORE_BACKOFF) {
        result.backOff = true;
        part.error = `${FAILURES_BEFORE_BACKOFF} projects in a row failed: ${message}`;
      }
    };

    for (const kind of ["invitation", "tor"] as const) {
      if (result.remaining <= 0 || result.backOff) break;
      let rows: ListItem[];
      result.tors.asked = true;
      try {
        rows = await this.listRows(kind);
      } catch (error) {
        result.tors.error = `e-GP ${kind} list unavailable: ${error instanceof Error ? error.message : "unknown"}`;
        logger.warn("collector_list_unavailable", { kind, error: result.tors.error });
        await this.rest(5);
        continue;
      }
      for (const row of rows) {
        if (result.remaining <= 0 || result.backOff) break;
        // Already held: nothing to download (decision 5).
        if (await this.deps.repo.holds(row.projectId, kind)) continue;
        result.tors.projects += 1;
        try {
          const outcome = await this.importProject(
            { projectId: row.projectId, from: kind === "tor" ? "tor-list" : "invitation-list", row },
            COLLECTOR_SUBMITTER,
            { maxNew: result.remaining },
          );
          failuresInARow = 0;
          const queued = outcome.documents.filter((doc) => doc.status === "queued").length;
          result.tors.queued += queued;
          result.remaining -= queued;
          if (outcome.documents.some((doc) => doc.status === "failed")) result.tors.failed += 1;
          logger.info("collector_project", { projectId: row.projectId, list: kind, status: outcome.status, queued });
        } catch (error) {
          failed(result.tors, row.projectId, error);
          await this.rest(5);
        }
      }
    }

    if (result.remaining > 0 && !result.backOff) {
      for (const target of await this.deps.repo.awardTargets(result.remaining)) {
        if (result.remaining <= 0 || result.backOff) break;
        result.awards.asked = true;
        result.awards.projects += 1;
        try {
          const outcome = await this.collectAward(target, COLLECTOR_SUBMITTER);
          failuresInARow = 0;
          if (outcome.status === "queued") {
            result.awards.queued += 1;
            result.remaining -= 1;
          }
          if (outcome.status === "failed") result.awards.failed += 1;
          logger.info("collector_award", { projectId: target.projectId, status: outcome.status });
        } catch (error) {
          failed(result.awards, target.projectId, error);
          await this.rest(5);
        }
      }
    }
    return result;
  }
}
