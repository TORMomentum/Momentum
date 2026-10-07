import type { ExtractedField, TorFields } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import { NotFoundError } from "../../core/errors.js";
import { calendarDate } from "../../lib/calendar-date.js";
import { budgetYearOf } from "../../lib/budget-year.js";
import { extensionFor } from "../../lib/content-disposition.js";
import { redactTor } from "../../lib/redact.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
import { buildProjectUrl } from "../../sources/bma-egp/client.js";
import { buildProjectSearchUrl } from "../../sources/national-egp/client.js";
import { evaluateChecklist } from "../checklist/checklist.js";
import { verdictFor, type AnomalyVerdict, type PeerBounds } from "../stats/anomaly.rule.js";
import type { CohortKey } from "../stats/cohort.js";
import { eligibilityOf } from "../stats/eligibility.js";
import { encodeCursor, type SearchRequest } from "./tors.query.js";
import type { TorsRepository } from "./tors.repository.js";
import type { ObjectId } from "mongodb";

export interface TorsServiceDeps {
  repo: TorsRepository;
  config: Config;
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

/** What the verdict needs from a record. A search row and a detail record both supply it. */
type VerdictRow = {
  cohort: CohortKey | null;
  budget: { value: number | null; verified: boolean };
  category: { value: string | null; verified: boolean };
  state: string;
  restricted: boolean;
};

/** Public reads for published TOR records. */
export class TorsService {
  constructor(private readonly deps: TorsServiceDeps) {}

  async search(request: SearchRequest, matchIds?: ObjectId[]) {
    const { config } = this.deps;
    const { open, minMatch: _minMatch, ...filter } = request.filter;
    const today = calendarDate(this.deps.now?.() ?? new Date(), config.search.timeZone);

    const page = await this.deps.repo.search(
      // A vendor's first question is what they can still bid on, so those lead.
      { ...filter, matchIds, openOn: open ? today : undefined, closingFirstOn: today, today },
      request.pageSize,
      request.cursor,
    );
    const verdicts = await this.verdicts(page.items);

    return {
      // Decided here, beside the filter that uses the same rule, so the screen
      // never re-derives "open" from a deadline and a clock of its own.
      items: page.items.map(({ cohort: _cohort, restricted: _restricted, state: _state, ...item }, index) => ({
        ...item,
        open: isOpenOn(item, today),
        verdict: verdicts[index],
      })),
      total: page.total,
      nextCursor: page.next ? encodeCursor(page.next) : null,
      // FR-E-6: figures say how fresh they are.
      coverage: { lastUpdatedAt: page.lastUpdatedAt },
    };
  }

  /**
   * Each row's statistical-anomaly verdict, derived at read from its cohort's
   * stored bounds (dashboard spec §2.1, §6.2). The bounds are fetched after
   * pagination, so a page never pays for peer groups it cannot show.
   */
  private async verdicts(rows: VerdictRow[]): Promise<AnomalyVerdict[]> {
    const { config } = this.deps;
    const bounds = await this.deps.repo.boundsFor(rows.flatMap((row) => (row.cohort ? [row.cohort] : [])));
    const byKey = new Map(bounds.map((bound) => [`${bound.category}\u0000${bound.month}`, bound]));
    const settings = {
      method: config.stats.method,
      minN: config.stats.peerMinN,
      iqrMultiplier: config.stats.iqrMultiplier,
      zScoreLimit: config.stats.zScoreLimit,
    };

    return rows.map((row) => {
      const stored = row.cohort ? byKey.get(`${row.cohort.category}\u0000${row.cohort.month}`) : undefined;
      const peer: PeerBounds | null = stored?.n === undefined ? null : (stored as PeerBounds);
      const budget = row.budget.value;
      if (typeof budget !== "number") {
        return verdictFor({ budget: 0, eligible: false, reason: "no-budget" }, peer, settings);
      }
      const reason = eligibilityOf(
        {
          pipeline: { state: row.state },
          access: { restricted: row.restricted },
          fields: {
            budget: { value: budget, verified: row.budget.verified },
            category: { value: row.category.value, verified: row.category.verified },
          },
        },
        config,
      );
      return verdictFor(reason ? { budget, eligible: false, reason } : { budget, eligible: true }, peer, settings);
    });
  }

  async facets() {
    return this.deps.repo.facets(this.deps.config.search.facetLimit);
  }

  async detail(id: string) {
    const record = await this.deps.repo.loadPublic(id);
    if (!record) throw new NotFoundError();

    // loadPublic reads only published, unrestricted records, so those two facts are fixed here.
    const budget = { value: record.fields.budget?.value ?? null, verified: record.fields.budget?.verified ?? false };
    const [verdict] = await this.verdicts([
      {
        cohort: record.cohort,
        budget,
        category: { value: record.fields.category?.value ?? null, verified: record.fields.category?.verified ?? false },
        state: "published",
        restricted: false,
      },
    ]);
    const checklist = evaluateChecklist({
      budget,
      budgetRange: { min: this.deps.config.budgetMinThb, max: this.deps.config.budgetMaxThb },
      qualificationTags: record.fields.qualifications?.tags ?? [],
      qualificationsVerified: record.fields.qualifications?.verified ?? false,
      verdict,
    });

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
      // Derived here rather than stored: see lib/budget-year.ts. Null when the
      // announcement date is unknown, never guessed from ingestion time.
      budgetYear: budgetYearOf(record.announcedAt ? new Date(record.announcedAt) : null, this.deps.config.search.timeZone),
      sourceUrl: record.sourceUrl,
      // The project on the source site, where a reader sees every announcement for it — the
      // TOR, the invitation, the award — as the agency published them.
      sourceProject: record.sourceProject
        ? {
            system: record.sourceProject.system,
            projectNumber: record.sourceProject.projectNumber ?? null,
            url:
              record.sourceProject.system === "national-egp"
                ? buildProjectSearchUrl(record.sourceProject.projectId)
                : buildProjectUrl(record.sourceProject.projectId),
          }
        : null,
      provenance: record.provenance,
      confidenceLevel: record.confidenceLevel,
      unverified: record.unverified,
      contentHash: record.contentHash,
      contentType: record.contentType,
      checklist,
    };
  }

  /** What to stream for a public request. A restricted record deliberately looks absent (FR-B-6). */
  async documentToStream(id: string): Promise<StreamableDocument> {
    const record = await this.deps.repo.loadDocument(id);
    if (!record || record.restricted) throw new NotFoundError();
    return {
      key: record.storage.key,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
      filename: record.filename ?? `tor-${id}${extensionFor(record.storage.contentType)}`,
    };
  }
}
