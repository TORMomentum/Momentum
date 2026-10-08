import { ObjectId } from "mongodb";
import { z } from "zod";
import { MATCH_RANGE } from "@tor-radar/shared";
import type { SearchConfig } from "../../core/config.js";
import { BadRequestError } from "../../core/errors.js";
import { TOR_STATES, type TorState } from "../../lib/tor-state.js";

export const TOR_STATUSES = ["announced", "closed", "awarded", "cancelled"] as const;
export type TorStatusValue = (typeof TOR_STATUSES)[number];

/** What a reader asked for, before "today" or any database shape is involved. */
export interface SearchFilter {
  q?: string;
  agencies: string[];
  categories: string[];
  status?: TorStatusValue;
  /**
   * The state a reader acts on, which the dashboard's chips also set. Richer
   * than `status`: it folds in whether the deadline has passed and whether the
   * invitation to bid is out at all.
   */
  state?: TorState;
  /** Still accepting bids: announced, and the deadline has not passed (spec §1 decision 4). */
  open: boolean;
  minBudget?: number;
  maxBudget?: number;
  /** Inclusive `YYYY-MM-DD` bounds on the extracted submission deadline. */
  deadlineFrom?: string;
  deadlineTo?: string;
  /** Inclusive `YYYY-MM-DD` bounds on `announcedAt` — the agency's date, never ingestion time. */
  from?: string;
  to?: string;
  /** Vendor-only: keep TORs this vendor matches within these whole percentages, inclusive. */
  minMatch?: number;
  maxMatch?: number;
}

/**
 * A position in the list, which has three segments: verified TORs still taking bids
 * with a stated deadline, in `(deadline asc, _id asc)` — closing soonest first —
 * then every other verified record, then every unverified one ("ยังไม่ยืนยันการสกัด"),
 * each of the last two in `(announcedAt desc, _id desc)`. Unverified records stay
 * listed — confidence controls marking, not visibility (SRS §4.2.1) — just not first.
 */
export type SearchCursor =
  | { segment: "closing"; deadline: string; id: ObjectId }
  | { segment: "rest"; announcedAt: Date | null; id: ObjectId }
  | { segment: "unverified"; announcedAt: Date | null; id: ObjectId };

export interface SearchRequest {
  filter: SearchFilter;
  cursor: SearchCursor | null;
  pageSize: number;
}

/** Longest single agency or category value accepted; extracted values are far shorter. */
const MAX_VALUE_CHARS = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z
  .string()
  .regex(ISO_DATE)
  .refine(
    (value) => {
      // "2026-02-30" parses to an invalid date rather than rolling over; reject both.
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    },
    { message: "Not a calendar date" },
  );

const baht = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number);

/**
 * Text is normalised to NFC before it is compared with anything: Thai has more
 * than one code-point spelling of the same visible word (rendering spec §11).
 */
const text = (maxChars: number) =>
  z
    .string()
    .transform((value) => value.normalize("NFC").trim())
    .pipe(z.string().max(maxChars));

/**
 * Every parameter is a string or a list of strings. An object — the shape a Mongo
 * operator would need — fails the schema, so it never reaches a query (spec §5.6).
 */
const matchBound = z.coerce.number().int().min(MATCH_RANGE.floor).max(MATCH_RANGE.ceiling);

export function buildSearchQuerySchema(config: SearchConfig) {
  const values = z
    .union([z.string(), z.array(z.string())])
    .transform((raw) => (Array.isArray(raw) ? raw : [raw]))
    .pipe(z.array(text(MAX_VALUE_CHARS)).max(config.maxFilterValues))
    .transform((list) => [...new Set(list.filter(Boolean))]);

  return z.object({
    q: text(config.queryMaxChars).optional(),
    agency: values.optional(),
    category: values.optional(),
    status: z.enum(TOR_STATUSES).optional(),
    state: z.enum(TOR_STATES as unknown as [TorState, ...TorState[]]).optional(),
    open: z.enum(["true"]).optional(),
    minBudget: baht.optional(),
    maxBudget: baht.optional(),
    deadlineFrom: isoDate.optional(),
    deadlineTo: isoDate.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    minMatch: matchBound.optional(),
    maxMatch: matchBound.optional(),
    cursor: z.string().max(200).optional(),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(config.maxPageSize))
      .optional(),
  });
}

export function parseSearchQuery(query: unknown, config: SearchConfig): SearchRequest {
  const parsed = buildSearchQuerySchema(config).parse(query);

  return {
    filter: {
      q: parsed.q || undefined,
      agencies: parsed.agency ?? [],
      categories: parsed.category ?? [],
      status: parsed.status,
      state: parsed.state,
      open: parsed.open === "true",
      minBudget: parsed.minBudget,
      maxBudget: parsed.maxBudget,
      deadlineFrom: parsed.deadlineFrom,
      deadlineTo: parsed.deadlineTo,
      from: parsed.from,
      to: parsed.to,
      minMatch: parsed.minMatch,
      maxMatch: parsed.maxMatch,
    },
    cursor: parsed.cursor ? decodeCursor(parsed.cursor) : null,
    pageSize: parsed.pageSize ?? config.pageSize,
  };
}

/** Opaque to callers: base64url JSON, so its shape can change without a contract change. */
export function encodeCursor(cursor: SearchCursor): string {
  const payload =
    cursor.segment === "closing"
      ? { s: "c", d: cursor.deadline, i: cursor.id.toHexString() }
      : {
          // "rest" keeps its original shape, so a link made before this segment existed still works.
          ...(cursor.segment === "unverified" ? { s: "u" } : {}),
          a: cursor.announcedAt?.toISOString() ?? null,
          i: cursor.id.toHexString(),
        };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(value: string): SearchCursor {
  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      s?: unknown;
      d?: unknown;
      a?: unknown;
      i?: unknown;
    };
    if (typeof payload.i !== "string" || !ObjectId.isValid(payload.i)) throw new Error("id");
    const id = new ObjectId(payload.i);

    if (payload.s === "c") {
      if (typeof payload.d !== "string" || payload.d.length > 40) throw new Error("deadline");
      return { segment: "closing", deadline: payload.d, id };
    }

    if (payload.a !== null && typeof payload.a !== "string") throw new Error("announcedAt");
    const announcedAt = payload.a === null ? null : new Date(payload.a);
    if (announcedAt && Number.isNaN(announcedAt.getTime())) throw new Error("announcedAt");

    return { segment: payload.s === "u" ? "unverified" : "rest", announcedAt, id };
  } catch {
    throw new BadRequestError("cursor is not valid");
  }
}
