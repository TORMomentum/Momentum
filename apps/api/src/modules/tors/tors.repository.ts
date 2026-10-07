import { ObjectId, type Db, type Filter, type WithId } from "mongodb";
import type { ConfidenceLevel, ExtractedField, Provenance, SourceProject, TorFields } from "@tor-radar/shared";
import { torPeerStats, tors, type TorDocument } from "../../core/db.js";
import type { CohortKey } from "../stats/cohort.js";
import type { SearchCursor, SearchFilter } from "./tors.query.js";
import { stateFilter } from "../../lib/tor-state.js";

export interface PublicTorDocumentRecord {
  storage: { key: string; contentType: string; bytes: number };
  restricted: boolean;
  filename?: string;
}

/** A filter the repository can run: the service has already decided what "today" is. */
export interface SearchCriteria extends Omit<SearchFilter, "open"> {
  /** Required when `state` is set: the five states depend on today's date. */
  today?: string;
  /** Set when only open TORs are wanted: deadlines before this `YYYY-MM-DD` have passed. */
  openOn?: string;
  /**
   * Today as `YYYY-MM-DD`. When set, TORs still taking bids with a stated
   * deadline lead the list, closing soonest first (see `closingOn`).
   */
  closingFirstOn?: string;
}

/** One search result row — only what a list renders (spec §2). */
export interface TorListItem {
  id: string;
  announcedAt: Date | null;
  confidenceLevel: ConfidenceLevel | null;
  unverified: boolean;
  title: { raw: string; verified: boolean };
  /** The project number, shown where the screen names a TOR (e-GP เลขที่โครงการ). */
  referenceNo: { raw: string; verified: boolean };
  agency: { raw: string; value: string | null; verified: boolean };
  category: { raw: string; value: string | null; verified: boolean };
  budget: { raw: string; value: number | null; verified: boolean };
  /**
   * `fromDocument` is carried into the list, not only the detail page: a row
   * showing a date the TOR itself does not state would imply the TOR states it.
   */
  deadline: { raw: string; value: string | null; verified: boolean; fromDocument?: string };
  torStatus: { value: string | null; verified: boolean };
}

/**
 * A row as the repository reads it: the list fields, plus what the anomaly
 * verdict needs and the screen does not — the service derives the verdict and
 * drops these.
 */
export interface SearchRow extends TorListItem {
  cohort: CohortKey | null;
  restricted: boolean;
  state: string;
}

export interface SearchPage {
  items: SearchRow[];
  /** The position after the last item, or null when this page ends the list. */
  next: SearchCursor | null;
  total: number;
  lastUpdatedAt: Date | null;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface TorFacets {
  agencies: FacetValue[];
  categories: FacetValue[];
  budget: { min: number; max: number } | null;
}

/** One published record as the public detail page may see it, before redaction. */
export interface PublicTorRecord {
  id: string;
  fields: Partial<TorFields>;
  cohort: CohortKey | null;
  announcedAt: Date | null;
  sourceUrl: string | null;
  /** The source system's project the TOR belongs to, when it was collected from one. */
  sourceProject: SourceProject | null;
  provenance: Provenance | null;
  confidenceLevel: ConfidenceLevel | null;
  unverified: boolean;
  contentHash: string;
  contentType: string;
  createdAt: Date;
}

/**
 * What every public read is limited to. Confidence is deliberately absent:
 * every tier publishes, marked or not (SRS §4.2.1). A takedown restricts; a
 * duplicate is reachable through the record it duplicates.
 */
export const VISIBLE: Filter<TorDocument> = {
  "pipeline.state": "published",
  "access.restricted": { $ne: true },
  duplicateOf: null,
  // An invitation to bid is a supporting document: its deadline is shown on its TOR.
  documentType: { $ne: "invitation" },
};

const LIST_PROJECTION = {
  announcedAt: 1,
  confidenceLevel: 1,
  unverified: 1,
  "fields.title": 1,
  "fields.referenceNo": 1,
  "fields.agency": 1,
  "fields.category": 1,
  "fields.budget": 1,
  "fields.deadline": 1,
  "fields.torStatus": 1,
  // For the row's anomaly verdict (dashboard spec §6.2), never shown as such.
  cohort: 1,
  "access.restricted": 1,
  "pipeline.state": 1,
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The day after a `YYYY-MM-DD`, so an inclusive "to" bound becomes an exclusive `$lt`. */
function dayAfter(isoDate: string): Date {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function view<T>(field: ExtractedField<T> | undefined) {
  return {
    raw: field?.raw ?? "", value: field?.value ?? null, verified: field?.verified ?? false,
    // Which document a value was read from, when it was not this record's own.
    ...(field?.fromDocument ? { fromDocument: field.fromDocument } : {}),
  };
}

/**
 * Built field by field from parsed primitives. Nothing request-shaped is
 * spread into the query (spec §5.6).
 */
function buildFilter(criteria: SearchCriteria): Filter<TorDocument> {
  const clauses: Filter<TorDocument>[] = [VISIBLE];

  if (criteria.q) {
    // Interim keyword match (search spec §5): a substring, which Thai needs and
    // $text cannot do. Replaced by a lucene.thai $search stage with Atlas.
    const pattern = new RegExp(escapeRegExp(criteria.q), "i");
    clauses.push({
      $or: [
        { "fields.title.raw": pattern },
        { "fields.title.value": pattern },
        { "fields.agency.raw": pattern },
        { "fields.agency.value": pattern },
      ],
    });
  }
  if (criteria.agencies.length > 0) {
    clauses.push({ "fields.agency.value": { $in: criteria.agencies } });
  }
  if (criteria.categories.length > 0) {
    clauses.push({ "fields.category.value": { $in: criteria.categories } });
  }
  if (criteria.status) {
    clauses.push({ "fields.torStatus.value": criteria.status });
  }
  // The same five states the dashboard counts, as a predicate from the one file
  // that defines them, so the list and the counts cannot disagree.
  if (criteria.state && criteria.today) {
    clauses.push(stateFilter(criteria.state, criteria.today) as Filter<TorDocument>);
  }
  if (criteria.openOn) {
    clauses.push({ "fields.torStatus.value": "announced" });
    clauses.push({
      $or: [{ "fields.deadline.value": null }, { "fields.deadline.value": { $gte: criteria.openOn } }],
    });
  }
  if (criteria.minBudget !== undefined || criteria.maxBudget !== undefined) {
    const range: Record<string, number> = {};
    if (criteria.minBudget !== undefined) range.$gte = criteria.minBudget;
    if (criteria.maxBudget !== undefined) range.$lte = criteria.maxBudget;
    clauses.push({ "fields.budget.value": range });
  }
  if (criteria.deadlineFrom || criteria.deadlineTo) {
    // Deadlines are ISO strings, so string order is date order. The upper bound
    // is the next day, exclusive, so a value carrying a time still counts.
    const range: Record<string, string> = {};
    if (criteria.deadlineFrom) range.$gte = criteria.deadlineFrom;
    if (criteria.deadlineTo) range.$lt = dayAfter(criteria.deadlineTo).toISOString().slice(0, 10);
    clauses.push({ "fields.deadline.value": range });
  }
  if (criteria.from || criteria.to) {
    const range: Record<string, Date> = {};
    if (criteria.from) range.$gte = new Date(`${criteria.from}T00:00:00Z`);
    if (criteria.to) range.$lt = dayAfter(criteria.to);
    clauses.push({ announcedAt: range });
  }

  return { $and: clauses };
}

/**
 * The list's leading segment: announced, with a deadline today or later. The
 * same rule as "open" (`isOpenOn`) minus the unstated deadline — a TOR whose
 * invitation to bid is not out yet has no date to put it in order by.
 * Deadlines are ISO strings, so string order is date order.
 */
function closingOn(today: string): Filter<TorDocument> {
  return { "fields.torStatus.value": "announced", "fields.deadline.value": { $gte: today } };
}

/** Resumes after `cursor` in `(deadline asc, _id asc)`. */
function afterClosing(cursor: Extract<SearchCursor, { segment: "closing" }>): Filter<TorDocument> {
  return {
    $or: [
      { "fields.deadline.value": { $gt: cursor.deadline } },
      { "fields.deadline.value": cursor.deadline, _id: { $gt: cursor.id } },
    ],
  };
}

/**
 * Resumes after `cursor` in `(announcedAt desc, _id desc)`. A missing
 * `announcedAt` sorts below every date, so undated records form the tail.
 */
function afterCursor(cursor: Extract<SearchCursor, { segment: "rest" }>): Filter<TorDocument> {
  if (cursor.announcedAt === null) {
    return { announcedAt: null, _id: { $lt: cursor.id } };
  }
  return {
    $or: [
      { announcedAt: { $lt: cursor.announcedAt } },
      { announcedAt: cursor.announcedAt, _id: { $lt: cursor.id } },
      { announcedAt: null },
    ],
  };
}

/** The position just after `doc`, in whichever segment it was read from. */
function cursorAt(doc: WithId<TorDocument>, closing: boolean): SearchCursor {
  return closing
    ? { segment: "closing", deadline: String(doc.fields?.deadline?.value), id: doc._id }
    : { segment: "rest", announcedAt: doc.announcedAt ?? null, id: doc._id };
}

/** The only public-TOR code that touches MongoDB. */
export class TorsRepository {
  constructor(private readonly db: Db) {}

  /**
   * One page of the list. With `closingFirstOn`, the closing segment is read
   * first and the rest fills whatever room the page has left; each segment
   * reads its order straight from an index, so neither sorts in memory.
   */
  async search(criteria: SearchCriteria, pageSize: number, cursor: SearchCursor | null): Promise<SearchPage> {
    const filter = buildFilter(criteria);
    const closing = criteria.closingFirstOn ? closingOn(criteria.closingFirstOn) : null;
    // One extra row says whether another page exists without a second count.
    const wanted = pageSize + 1;

    const [closingDocs, total, latest] = await Promise.all([
      closing && cursor?.segment !== "rest"
        ? tors(this.db)
            .find(
              { $and: [filter, closing, ...(cursor?.segment === "closing" ? [afterClosing(cursor)] : [])] },
              { sort: { "fields.deadline.value": 1, _id: 1 }, limit: wanted, projection: LIST_PROJECTION },
            )
            .toArray()
        : Promise.resolve([]),
      tors(this.db).countDocuments(filter),
      tors(this.db).findOne(VISIBLE, { sort: { createdAt: -1 }, projection: { createdAt: 1 } }),
    ]);

    const restDocs =
      closingDocs.length < wanted
        ? await tors(this.db)
            .find(
              {
                $and: [
                  filter,
                  ...(closing ? [{ $nor: [closing] }] : []),
                  ...(cursor?.segment === "rest" ? [afterCursor(cursor)] : []),
                ],
              },
              { sort: { announcedAt: -1, _id: -1 }, limit: wanted - closingDocs.length, projection: LIST_PROJECTION },
            )
            .toArray()
        : [];

    const docs = [...closingDocs, ...restDocs];
    const page = docs.slice(0, pageSize);
    const last = page.at(-1);

    return {
      items: page.map((doc) => ({
        id: doc._id.toString(),
        announcedAt: doc.announcedAt ?? null,
        confidenceLevel: doc.confidenceLevel ?? null,
        unverified: doc.unverified,
        title: { raw: doc.fields?.title?.raw ?? "", verified: doc.fields?.title?.verified ?? false },
        referenceNo: {
          raw: doc.fields?.referenceNo?.raw ?? "",
          verified: doc.fields?.referenceNo?.verified ?? false,
        },
        agency: view(doc.fields?.agency),
        category: view(doc.fields?.category),
        budget: view(doc.fields?.budget),
        deadline: view(doc.fields?.deadline),
        torStatus: {
          value: doc.fields?.torStatus?.value ?? null,
          verified: doc.fields?.torStatus?.verified ?? false,
        },
        cohort: doc.cohort ?? null,
        restricted: doc.access?.restricted ?? true,
        state: doc.pipeline?.state ?? "",
      })),
      next: docs.length > pageSize && last ? cursorAt(last, closingDocs.includes(last)) : null,
      total,
      lastUpdatedAt: latest?.createdAt ?? null,
    };
  }

  /** The filter options that exist in the published corpus, most frequent first. */
  async facets(limit: number): Promise<TorFacets> {
    const countBy = (path: string) => [
      { $match: { [path]: { $type: "string", $ne: "" } } },
      { $group: { _id: `$${path}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ];

    const [result] = await tors(this.db)
      .aggregate<{
        agencies: Array<{ _id: string; count: number }>;
        categories: Array<{ _id: string; count: number }>;
        budget: Array<{ min: number; max: number }>;
      }>(
        [
          { $match: VISIBLE },
          {
            $facet: {
              agencies: countBy("fields.agency.value"),
              categories: countBy("fields.category.value"),
              budget: [
                { $match: { "fields.budget.value": { $type: "number" } } },
                {
                  $group: {
                    _id: null,
                    min: { $min: "$fields.budget.value" },
                    max: { $max: "$fields.budget.value" },
                  },
                },
              ],
            },
          },
        ],
        // No collation: a collated aggregation cannot use the uncollated
        // indexes behind VISIBLE. Order is by count; the name only breaks ties.
      )
      .toArray();

    const toValues = (rows: Array<{ _id: string; count: number }> = []) =>
      rows.map((row) => ({ value: row._id, count: row.count }));

    return {
      agencies: toValues(result?.agencies),
      categories: toValues(result?.categories),
      budget: result?.budget[0] ? { min: result.budget[0].min, max: result.budget[0].max } : null,
    };
  }

  /** A published, unrestricted record, or null — a takedown is indistinguishable from absence. */
  async loadPublic(id: string): Promise<PublicTorRecord | null> {
    if (!ObjectId.isValid(id)) return null;

    const doc = await tors(this.db).findOne(
      { $and: [{ _id: new ObjectId(id) }, VISIBLE] },
      {
        projection: {
          fields: 1,
          cohort: 1,
          announcedAt: 1,
          sourceUrl: 1,
          sourceProject: 1,
          provenance: 1,
          confidenceLevel: 1,
          unverified: 1,
          contentHash: 1,
          "storage.contentType": 1,
          createdAt: 1,
        },
      },
    );
    if (!doc) return null;

    return {
      id: doc._id.toString(),
      fields: doc.fields ?? {},
      cohort: doc.cohort ?? null,
      announcedAt: doc.announcedAt ?? null,
      sourceUrl: doc.sourceUrl ?? null,
      sourceProject: doc.sourceProject ?? null,
      provenance: doc.provenance ?? null,
      confidenceLevel: doc.confidenceLevel ?? null,
      unverified: doc.unverified,
      contentHash: doc.contentHash,
      contentType: doc.storage.contentType,
      createdAt: doc.createdAt,
    };
  }

  async loadDocument(id: string): Promise<PublicTorDocumentRecord | null> {
    if (!ObjectId.isValid(id)) return null;

    const record = await tors(this.db).findOne(
      { _id: new ObjectId(id) },
      { projection: { storage: 1, "access.restricted": 1, "sourceRefs.originalFilename": 1 } },
    );
    if (!record) return null;

    return {
      storage: {
        key: record.storage.key,
        contentType: record.storage.contentType,
        bytes: record.storage.bytes,
      },
      restricted: record.access.restricted,
      filename: record.sourceRefs?.find((s) => s.originalFilename)?.originalFilename,
    };
  }

  /** The peer-group statistics for the cohorts on one page of results. */
  async boundsFor(keys: CohortKey[]) {
    const unique = [...new Map(keys.map((key) => [`${key.category}\u0000${key.month}`, key])).values()];
    if (unique.length === 0) return [];
    return torPeerStats(this.db).find({
      category: { $in: [...new Set(unique.map((key) => key.category))] },
      month: { $in: [...new Set(unique.map((key) => key.month))] },
    }).toArray();
  }
}
