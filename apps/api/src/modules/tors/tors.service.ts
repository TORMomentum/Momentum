import type { ExtractedField, TorFields } from "@tor-radar/shared";
import { NotFoundError } from "../../core/errors.js";
import { calendarDate } from "../../lib/calendar-date.js";
import { redactTor } from "../../lib/redact.js";
import { buildProjectUrl } from "../../sources/bma-egp/client.js";
import type { Storage } from "../../ports/storage.port.js";
import { encodeCursor, type SearchRequest } from "./tors.query.js";
import type { TorsRepository } from "./tors.repository.js";

export interface TorsServiceDeps {
  repo: TorsRepository;
  storage: Storage;
  signedUrlTtlSeconds: number;
  /** How many agency and category options the facets return. */
  facetLimit: number;
  /** Whose calendar decides whether a deadline has passed. */
  timeZone: string;
  /** Injected so "open" is testable on a fixed date. */
  now?: () => Date;
}

/**
 * A field as the public sees it: no evidence quote, which is for reviewers. The
 * origin stays, because a value the source stated must not be labelled AI output (NFR-F6).
 */
function publicField<T>(field: ExtractedField<T> | undefined) {
  if (!field) return undefined;
  return {
    raw: field.raw,
    value: field.value,
    confidence: field.confidence,
    verified: field.verified,
    ...(field.origin ? { origin: field.origin } : {}),
    ...(field.fromDocument ? { fromDocument: field.fromDocument } : {}),
  };
}

/**
 * Still accepting bids: announced, and the deadline is today or later, or not
 * stated. Mirrors the repository's `openOn` filter; the search tests pin both.
 * ISO strings compare as dates, and a value carrying a time still counts today.
 */
export function isOpenOn(
  item: { torStatus: { value: string | null }; deadline: { value: string | null } },
  today: string,
): boolean {
  return item.torStatus.value === "announced" && (item.deadline.value === null || item.deadline.value >= today);
}

/** Public reads for published TOR records. */
export class TorsService {
  constructor(private readonly deps: TorsServiceDeps) {}

  async search(request: SearchRequest) {
    const { open, ...filter } = request.filter;
    const today = calendarDate(this.deps.now?.() ?? new Date(), this.deps.timeZone);

    const page = await this.deps.repo.search(
      { ...filter, openOn: open ? today : undefined },
      request.pageSize,
      request.cursor,
    );

    return {
      // Decided here, beside the filter that uses the same rule, so the screen
      // never re-derives "open" from a deadline and a clock of its own.
      items: page.items.map((item) => ({ ...item, open: isOpenOn(item, today) })),
      total: page.total,
      nextCursor: page.next ? encodeCursor(page.next) : null,
      // FR-E-6: figures say how fresh they are.
      coverage: { lastUpdatedAt: page.lastUpdatedAt },
    };
  }

  async facets() {
    return this.deps.repo.facets(this.deps.facetLimit);
  }

  async detail(id: string) {
    const record = await this.deps.repo.loadPublic(id);
    if (!record) throw new NotFoundError();

    // The one redaction serializer (FR-B-5), before anything leaves the service.
    const { fields } = redactTor(record, "public");
    const publicFields: Partial<Record<keyof TorFields, ReturnType<typeof publicField>>> = {};
    for (const [name, field] of Object.entries(fields) as [keyof TorFields, ExtractedField<unknown>][]) {
      publicFields[name] = publicField(field);
    }

    return {
      id: record.id,
      fields: publicFields,
      announcedAt: record.announcedAt,
      sourceUrl: record.sourceUrl,
      // The project's own page on the source site, where a reader sees every announcement
      // for it — the TOR, the invitation, the award — as the agency published them.
      sourceProject:
        record.sourceProject?.system === "bma-egp"
          ? {
              system: record.sourceProject.system,
              projectNumber: record.sourceProject.projectNumber ?? null,
              url: buildProjectUrl(record.sourceProject.projectId),
            }
          : null,
      provenance: record.provenance,
      confidenceLevel: record.confidenceLevel,
      unverified: record.unverified,
      contentHash: record.contentHash,
      contentType: record.contentType,
    };
  }

  async document(id: string) {
    const record = await this.deps.repo.loadDocument(id);

    // A restricted record deliberately looks absent. Returning 403 would
    // confirm both that the record exists and that it was taken down (FR-B-6).
    if (!record || record.restricted) throw new NotFoundError();

    // The storage key is trusted only because it came from the loaded record;
    // callers cannot choose another object in the bucket to sign.
    const url = await this.deps.storage.signedUrl(
      record.storage.key,
      this.deps.signedUrlTtlSeconds,
    );

    return {
      url,
      expiresInSeconds: this.deps.signedUrlTtlSeconds,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
    };
  }
}
