import type { ExtractedField, Provenance, StageKind, TorFields } from "@tor-radar/shared";
import type { Config } from "../../core/config.js";
import { NotFoundError } from "../../core/errors.js";
import { calendarDate } from "../../lib/calendar-date.js";
import { budgetYearOf } from "../../lib/budget-year.js";
import { extensionFor } from "../../lib/content-disposition.js";
import { redactAward, redactTor } from "../../lib/redact.js";
import { torStateOf, type TorState } from "../../lib/tor-state.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
import { buildProjectUrl } from "../../sources/bma-egp/client.js";
import { buildProjectSearchUrl } from "../../sources/national-egp/client.js";
import { checklistFieldsOf, evaluateChecklist } from "../checklist/checklist.js";
import { verdictFor, type AnomalyVerdict, type PeerBounds } from "../stats/anomaly.rule.js";
import type { CohortKey } from "../stats/cohort.js";
import { eligibilityOf } from "../stats/eligibility.js";
import { encodeCursor, type SearchRequest } from "./tors.query.js";
import type { TorsRepository } from "./tors.repository.js";
import { ObjectId } from "mongodb";

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

/** What `torStateOf` needs from a row: the extracted status and deadline, and the project's stage. */
type StateInput = {
  torStatus: { value: string | null };
  deadline: { value: string | null };
  stage?: { kind: StageKind } | null;
};

/** The row's state by the one rule (lib/tor-state.ts): a final stage from the source decides first (TOR-205). */
export function torStateOfRow(item: StateInput, today: string): TorState {
  return torStateOf(
    { torStatus: item.torStatus.value as never, deadline: item.deadline.value, stageKind: item.stage?.kind ?? null },
    today,
  );
}

/**
 * Still accepting bids: announced, the deadline today or later or not stated,
 * and no final stage. The same rule as the repository's `openFilter`; the
 * tor-state tests pin both. ISO strings compare as dates.
 */
export function isOpenOn(item: StateInput, today: string): boolean {
  const state = torStateOfRow(item, today);
  return state === "open" || state === "awaiting-invitation";
}

/** `YYYY-MM-DD` plus whole days, on the calendar (no time zone involved). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

  /**
   * For the CSV export: each record's extraction provenance (NFR-F6) and the public page it was
   * collected from — the e-GP project when there is one, the same link the detail page gives.
   */
  async exportDetailsFor(ids: string[]): Promise<Map<string, { provenance?: Provenance; source: string | null }>> {
    const found = await this.deps.repo.exportDetailsFor(ids.map((id) => new ObjectId(id)));
    return new Map(
      [...found].map(([id, record]) => [
        id,
        {
          provenance: record.provenance,
          source: record.sourceProject
            ? record.sourceProject.system === "national-egp"
              ? buildProjectSearchUrl(record.sourceProject.projectId)
              : buildProjectUrl(record.sourceProject.projectId)
            : record.sourceUrl,
        },
      ]),
    );
  }

  async search(request: SearchRequest, matchIds?: ObjectId[]) {
    const { config } = this.deps;
    const { open, minMatch: _minMatch, maxMatch: _maxMatch, minDaysLeft, ...filter } = request.filter;
    const today = calendarDate(this.deps.now?.() ?? new Date(), config.search.timeZone);
    if (minDaysLeft !== undefined) {
      // "At least N days to prepare" is a lower deadline bound; the later of it and
      // any explicit deadlineFrom wins, so both constraints hold.
      const earliest = addDays(today, minDaysLeft);
      filter.deadlineFrom = filter.deadlineFrom && filter.deadlineFrom > earliest ? filter.deadlineFrom : earliest;
    }

    const page = await this.deps.repo.search(
      // A vendor's first question is what they can still bid on, so those lead.
      // Among those, the ones a vendor still has time to prepare for come first (2026-10-15 review).
      {
        ...filter,
        matchIds,
        openOn: open ? today : undefined,
        closingFirstOn: today,
        prepFrom: config.search.minPrepDays > 0 ? addDays(today, config.search.minPrepDays) : undefined,
        today,
      },
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
        // The badge's state, decided once here so no screen re-derives it (TOR-205).
        torState: torStateOfRow(item, today),
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
      ...checklistFieldsOf(record, this.deps.config.search.timeZone),
      thresholds: this.deps.config.checklist,
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
      // The project's published stages as the source lists them, and the badge's state (TOR-205).
      stageHistory: record.stageHistory,
      stage: record.stage,
      // How fresh the stages are: the detail page says when they were last read (TOR-206).
      stagesCheckedAt: record.stagesCheckedAt,
      // Who won and at what price, from the winner announcement (TOR-221); an individual is not named (FR-B-5).
      award: redactAward(record.award, "public"),
      torState: torStateOfRow(
        {
          torStatus: { value: typeof record.fields.torStatus?.value === "string" ? record.fields.torStatus.value : null },
          deadline: { value: typeof record.fields.deadline?.value === "string" ? record.fields.deadline.value : null },
          stage: record.stage,
        },
        calendarDate(this.deps.now?.() ?? new Date(), this.deps.config.search.timeZone),
      ),
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
