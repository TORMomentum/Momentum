import type { ListItem } from "../sources/national-egp/announcements.js";
import type { PackageRef } from "../sources/national-egp/client.js";

/** Which of e-GP's public announcement lists: draft TORs, or invitations to bid. */
export type EgpListKind = "tor" | "invitation";

/**
 * What the collector reads from national e-GP (spec 2026-11-25-scheduled-collector decision 2). One
 * implementation, adapters/national-egp.collect.ts; the collector module never fetches. Every method that
 * reaches e-GP throws when it is unreachable.
 */
export interface EgpCollectSource {
  /** One page (50 rows) of an announcement list, newest first. */
  announcementList(kind: EgpListKind, page: number): Promise<ListItem[]>;
  /** The project's final bid package, or null when e-GP has none yet. */
  bidPackage(projectId: string): Promise<PackageRef | null>;
  downloadPackage(fileId: string): Promise<Buffer>;
  /** The public address a package is fetched from, recorded as the document's source. */
  packageUrl(fileId: string): string;
  /** The TOR's own announcement day from the project's stage table, `YYYY-MM-DD`, or null. */
  torAnnouncedOn(projectId: string): Promise<string | null>;
  /** The winner announcement's template id, or null when e-GP holds none. */
  awardTemplateId(projectId: string): Promise<string | null>;
  downloadAward(templateId: string): Promise<Buffer>;
  awardPdfUrl(templateId: string): string;
}
