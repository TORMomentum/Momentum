/**
 * The one place search filters become a URL and a URL becomes filters
 * (rendering spec §3.1, §11). Two spellings of one search must be one URL:
 * keys in a fixed order, repeated values sorted, text in NFC, empty and
 * default values omitted.
 *
 * Parsing is lenient on purpose. A hand-edited or stale link drops the value it
 * cannot read and still shows a result, rather than failing the whole page; the
 * API validates strictly behind this.
 */

import { MATCH_RANGE } from "@tor-radar/shared";

/** The five states the dashboard's chips use; the API defines them. */
export const SEARCH_STATES = ["open", "awaiting-invitation", "closed", "awarded", "cancelled"] as const;
export type SearchState = (typeof SEARCH_STATES)[number];

export interface SearchFilters {
  q: string;
  agencies: string[];
  categories: string[];
  /** Still accepting bids — decided by the API. */
  open: boolean;
  /** One of the five states, or null for every state. */
  state: SearchState | null;
  minBudget: number | null;
  maxBudget: number | null;
  /** `YYYY-MM-DD`, inclusive. */
  deadlineFrom: string | null;
  deadlineTo: string | null;
  /** Whole percentages; null = that end unbounded. */
  minMatch: number | null;
  maxMatch: number | null;
  cursor: string | null;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const EMPTY_FILTERS: SearchFilters = {
  q: "",
  agencies: [],
  categories: [],
  open: false,
  state: null,
  minBudget: null,
  maxBudget: null,
  deadlineFrom: null,
  deadlineTo: null,
  minMatch: null,
  maxMatch: null,
  cursor: null,
};

/** Longest keyword kept from a URL. The API enforces its own configured ceiling. */
const MAX_QUERY_CHARS = 200;
const MAX_VALUES = 20;
const MAX_VALUE_CHARS = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: string): string {
  return value.normalize("NFC").trim();
}

function list(value: string | string[] | undefined): string[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const cleaned = raw.map(text).filter((item) => item && item.length <= MAX_VALUE_CHARS);
  return [...new Set(cleaned)].sort().slice(0, MAX_VALUES);
}

function amount(value: string | string[] | undefined): number | null {
  const raw = first(value);
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

function date(value: string | string[] | undefined): string | null {
  const raw = first(value);
  if (!raw || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(raw) ? raw : null;
}

function matchThreshold(value: string | string[] | undefined): number | null {
  const raw = first(value);
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed >= MATCH_RANGE.floor && parsed <= MATCH_RANGE.ceiling ? parsed : null;
}

export function parseSearchParams(params: RawSearchParams): SearchFilters {
  const cursor = first(params.cursor);
  return {
    q: text(first(params.q) ?? "").slice(0, MAX_QUERY_CHARS),
    agencies: list(params.agency),
    categories: list(params.category),
    open: first(params.open) === "true",
    state: (SEARCH_STATES as readonly string[]).includes(first(params.state) ?? "") ? (first(params.state) as SearchState) : null,
    minBudget: amount(params.minBudget),
    maxBudget: amount(params.maxBudget),
    deadlineFrom: date(params.deadlineFrom),
    deadlineTo: date(params.deadlineTo),
    minMatch: matchThreshold(params.minMatch),
    maxMatch: matchThreshold(params.maxMatch),
    cursor: cursor && /^[A-Za-z0-9_-]{1,200}$/.test(cursor) ? cursor : null,
  };
}

/** The canonical query string, without a leading "?". Empty for no filters. */
export function toSearchQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  // Fixed key order — insertion order is the serialisation order.
  for (const agency of list(filters.agencies)) params.append("agency", agency);
  for (const category of list(filters.categories)) params.append("category", category);
  if (filters.deadlineFrom) params.set("deadlineFrom", filters.deadlineFrom);
  if (filters.deadlineTo) params.set("deadlineTo", filters.deadlineTo);
  if (filters.maxBudget !== null) params.set("maxBudget", String(filters.maxBudget));
  if (filters.maxMatch !== null) params.set("maxMatch", String(filters.maxMatch));
  if (filters.minBudget !== null) params.set("minBudget", String(filters.minBudget));
  if (filters.minMatch !== null) params.set("minMatch", String(filters.minMatch));
  if (filters.open) params.set("open", "true");
  if (filters.state) params.set("state", filters.state);
  const q = text(filters.q);
  if (q) params.set("q", q);
  // Last, so a page change never reorders the filters before it.
  if (filters.cursor) params.set("cursor", filters.cursor);
  return params.toString();
}

/** True when anything narrows the list — which empty state to show depends on it. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return toSearchQuery({ ...filters, cursor: null }) !== "";
}
