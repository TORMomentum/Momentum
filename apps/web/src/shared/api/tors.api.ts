import "server-only";

import type { Checklist } from "@tor-radar/shared";
import { cookies } from "next/headers";
import { withArabicDigits } from "../lib/format";
import { apiRequest, getJson } from "./api-client";

/**
 * Public TOR data access (rendering spec §4). Server-side only, and it sends no
 * admin or intake credential: every route it calls is public.
 *
 * What a screen renders comes back with Arabic numerals (withArabicDigits). The
 * facet values do not: they are filter keys the API matches exactly, so the
 * search screen converts only their labels.
 *
 * Each function returns what a screen renders — the types below are the
 * contract with the API (docs/API.md §4), not the stored record.
 */

export interface ListField<T> {
  raw: string;
  value: T | null;
  verified: boolean;
  /** Set when the value was read from another document — a TOR's deadline from its invitation to bid. */
  fromDocument?: string;
}

export type TorStatusValue = "announced" | "closed" | "awarded" | "cancelled";

export interface TorListItem {
  id: string;
  announcedAt: string | null;
  confidenceLevel: "high" | "medium" | "low" | null;
  unverified: boolean;
  /** Decided by the API, beside the filter that uses the same rule. */
  open: boolean;
  title: { raw: string; verified: boolean };
  /**
   * The project number (เลขที่โครงการ); empty when neither the source nor the
   * document states it. Optional: an API older than this field omits it.
   */
  referenceNo?: { raw: string; verified: boolean };
  agency: ListField<string>;
  category: ListField<string>;
  budget: ListField<number>;
  deadline: ListField<string>;
  torStatus: { value: TorStatusValue | null; verified: boolean };
  /**
   * How well this TOR fits the signed-in vendor's profile, 0..1. Absent for a
   * signed-out visitor and for a vendor with no profile yet, which is why it is
   * optional rather than zero: no profile is not a bad match.
   */
  matchScore?: number;
}

export interface TorSearchResult {
  items: TorListItem[];
  total: number;
  nextCursor: string | null;
  coverage: { lastUpdatedAt: string | null };
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

export interface TorDetailField {
  raw: string;
  value: unknown;
  confidence: number;
  verified: boolean;
  /** "source" when the source system stated it rather than AI reading it. */
  origin?: "source";
  /** The record it was read from, when that is not this TOR's own document. */
  fromDocument?: string;
}

export interface TorDetail {
  id: string;
  fields: Partial<
    Record<
      | "title"
      | "agency"
      | "budget"
      | "category"
      | "scopeSummary"
      | "qualifications"
      | "deadline"
      | "contact"
      | "torStatus"
      | "procurementMethod"
      | "referenceNo",
      TorDetailField
    >
  >;
  announcedAt: string | null;
  /** ปีงบประมาณ in the Buddhist era, derived from the announcement date. */
  budgetYear: number | null;
  sourceUrl: string | null;
  /** Absent from an API older than the checklist. */
  checklist?: Checklist;
  /** The TOR's project page on the source system; absent from an API older than this field. */
  sourceProject?: { system: string; projectNumber: string | null; url: string } | null;
  provenance: {
    ocrModel: string;
    extractModel: string;
    modelVersion: string;
    extractedAt: string;
  } | null;
  confidenceLevel: "high" | "medium" | "low" | null;
  unverified: boolean;
  contentHash: string;
  contentType: string;
}

/** The longest keyword the API accepts; the field stops the reader there. */
export function searchQueryMaxChars(): number {
  const configured = Number(process.env.SEARCH_QUERY_MAX_CHARS);
  return Number.isInteger(configured) && configured > 0 ? configured : 100;
}

/** `query` is already canonical (features/search/search.params.ts). Not cached: §6.1. */
export async function searchTors(query: string): Promise<TorSearchResult> {
  return withArabicDigits(await getJson<TorSearchResult>(`/tors${query ? `?${query}` : ""}`));
}

/** The personal threshold stays server-side: stale signed-out links show an empty result. */
export async function searchOwnTors(query: string): Promise<TorSearchResult> {
  const sessionId = (await cookies()).get("tor-radar-session")?.value;
  if (!sessionId) return { items: [], total: 0, nextCursor: null, coverage: { lastUpdatedAt: null } };
  const response = await apiRequest(`/api/v1/tors${query ? `?${query}` : ""}`, {}, sessionId);
  if (response.status === 401) return { items: [], total: 0, nextCursor: null, coverage: { lastUpdatedAt: null } };
  if (!response.ok) throw new Error(`GET /tors returned ${response.status}`);
  return withArabicDigits((await response.json()) as TorSearchResult);
}

export async function fetchTorFacets(): Promise<TorFacets> {
  return getJson<TorFacets>("/tors/facets");
}

/** One published record, or null when it does not exist or has been taken down. */
export async function fetchTor(id: string): Promise<TorDetail | null> {
  return withArabicDigits(await getJson<TorDetail | null>(`/tors/${encodeURIComponent(id)}`, () => null));
}
