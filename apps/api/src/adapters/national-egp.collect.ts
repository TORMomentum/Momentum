import type { EgpCollectSource, EgpListKind } from "../ports/egp-collect.port.js";
import {
  awardPdfUrl,
  downloadAward,
  downloadPackage,
  fetchAnnouncementList,
  fetchProjectStages,
  getAwardTemplateId,
  getBidPackage,
  packageUrl,
} from "../sources/national-egp/client.js";
import { torAnnouncedOn } from "../sources/national-egp/stages.js";

/**
 * National e-GP for the collector (spec 2026-11-25-scheduled-collector): the public list, package and
 * award services, through the source client's safe fetch, size caps and retry.
 */
export class NationalEgpCollect implements EgpCollectSource {
  constructor(private readonly timeZone: string) {}

  announcementList(kind: EgpListKind, page: number) {
    return fetchAnnouncementList(kind, page);
  }

  bidPackage(projectId: string) {
    return getBidPackage(projectId);
  }

  downloadPackage(fileId: string) {
    return downloadPackage(fileId);
  }

  packageUrl(fileId: string) {
    return packageUrl(fileId);
  }

  async torAnnouncedOn(projectId: string) {
    return torAnnouncedOn(await fetchProjectStages(projectId, this.timeZone));
  }

  awardTemplateId(projectId: string) {
    return getAwardTemplateId(projectId);
  }

  downloadAward(templateId: string) {
    return downloadAward(templateId);
  }

  awardPdfUrl(templateId: string) {
    return awardPdfUrl(templateId);
  }
}
