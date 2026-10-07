import "server-only";
import type { IntakeResponse } from "@tor-radar/shared";

/**
 * The admin area's data access — server side only.
 *
 * The `server-only` import above is load-bearing: it makes importing this file
 * from a client component a build error. The admin key must never reach a
 * browser, and a rule that the compiler enforces beats one that a reviewer has
 * to remember.
 *
 * Which is also why the browser never calls the API directly for admin work.
 * The Next server holds the key, calls the API, and returns only the data —
 * the pattern decided for every privileged surface (docs/API.md §2).
 *
 * Every response comes back with Arabic numerals, as on the public pages.
 */

import { withArabicDigits } from "./format";
import { identityToken } from "../api/api-client";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";
const API_PREFIX = "/api/v1";

export interface QueueEntry {
  id: string;
  title: string;
  agency: string;
  confidence: number;
  reviewReasons: string[];
  route: string;
  submittedAt: string;
  contentType: string;
}

export interface ExtractedFieldView {
  raw: string;
  value: unknown;
  confidence: number;
  verified: boolean;
  evidence?: string;
  /** The record this value was read from when not this one — a TOR's deadline from its invitation. */
  fromDocument?: string;
}

export interface ReviewRecord extends QueueEntry {
  /** The fields that put this record in the queue — the only ones marked. */
  flaggedFields?: string[];
  fields: Record<string, ExtractedFieldView | undefined>;
  storage: { key: string; contentType: string; bytes: number };
  hasTextLayer: boolean;
  sourceUrl: string | null;
  contentHash: string;
}

export interface QueueView {
  items: QueueEntry[];
  unverifiedNotQueued: number;
  /** TORs whose category or qualifications await a person; absent from an API older than this field. */
  fieldsToConfirm?: number;
}

/** confidence: the low-confidence queue · fields: TORs whose category or qualifications await a person. */
export type QueueKind = "confidence" | "fields";

function adminKey(): string {
  // The API accepts a list; the web server presents the first.
  return (process.env.ADMIN_API_KEYS ?? "").split(",")[0]?.trim() ?? "";
}

/** The API could not be reached at all — a real outage. */
export class AdminApiUnavailable extends Error {}

/**
 * The API answered, and the record is not there.
 *
 * Distinct from an outage on purpose: a deep link to a record that has since
 * been rejected, merged or cleared is an ordinary thing for a reviewer to
 * click, and telling them the service is down would be false.
 */
export class AdminRecordNotFound extends Error {}

/**
 * The API answered with a failure we have no specific handling for.
 *
 * It carries the detail for the server log; nothing renders `message` to a
 * reader. An API path, a status code and a JSON body are not an error message
 * a person can act on, and they do not belong on a Thai-language screen.
 */
export class AdminApiFailed extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  // FormData bodies (file uploads) need fetch to set their own multipart
  // boundary — a forced "application/json" header would break the request.
  const isFormData = init.body instanceof FormData;
  const token = await identityToken(BASE_URL);
  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "x-api-key": adminKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    // The review queue changes as reviewers work; a cached queue would show a
    // record someone else already handled.
    cache: "no-store",
  }).catch((error: unknown) => {
    throw new AdminApiUnavailable(String(error));
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = `${init.method ?? "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`;
    if (response.status === 404) throw new AdminRecordNotFound(detail);
    throw new AdminApiFailed(detail);
  }
  return withArabicDigits((await response.json()) as T);
}

export interface AdminOverview {
  needsReview: number;
  unverifiedNotQueued: number;
  published: number;
  failed: number;
  corrections: number;
  stored: number;
}

export interface AdminEvent {
  torId: string;
  title: string;
  from: string | null;
  to: string;
  actor: string;
  source: string;
  reason?: string;
  at: string;
}

export function fetchOverview(): Promise<AdminOverview> {
  return call<AdminOverview>("/admin/overview");
}

export function fetchEvents(limit = 50): Promise<AdminEvent[]> {
  return call<AdminEvent[]>(`/admin/events?limit=${limit}`);
}

export function fetchQueue(reason?: string, view: QueueKind = "confidence"): Promise<QueueView> {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (view === "fields") params.set("view", "fields");
  const query = params.toString();
  return call<QueueView>(`/admin/queue${query ? `?${query}` : ""}`);
}

export function fetchRecord(id: string): Promise<ReviewRecord> {
  return call<ReviewRecord>(`/admin/tors/${encodeURIComponent(id)}`);
}

export interface FieldEdit {
  field: string;
  value: string;
}

export function saveEdits(id: string, edits: FieldEdit[]): Promise<ReviewRecord> {
  return call<ReviewRecord>(`/admin/tors/${encodeURIComponent(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ edits }),
  });
}

export function setFieldVerification(
  id: string,
  field: string,
  confirmed: boolean,
): Promise<ReviewRecord> {
  return call<ReviewRecord>(
    `/admin/tors/${encodeURIComponent(id)}/fields/${encodeURIComponent(field)}/verification`,
    {
      method: "PATCH",
      body: JSON.stringify({ confirmed }),
    },
  );
}

export function approve(id: string, edits: FieldEdit[]): Promise<{ id: string }> {
  return call(`/admin/tors/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ edits }),
  });
}

export function reextract(id: string): Promise<{ id: string }> {
  return call(`/admin/tors/${encodeURIComponent(id)}/reextract`, { method: "POST" });
}

export function reject(id: string, reason: string): Promise<{ id: string }> {
  return call(`/admin/tors/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function uploadDocument(file: File): Promise<IntakeResponse> {
  const body = new FormData();
  body.append("file", file, file.name);
  return call<IntakeResponse>("/intake/upload", { method: "POST", body });
}
