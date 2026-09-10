import "server-only";

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
 */

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
}

export interface ReviewRecord extends QueueEntry {
  fields: Record<string, ExtractedFieldView | undefined>;
  storage: { key: string; contentType: string; bytes: number };
  hasTextLayer: boolean;
  sourceUrl: string | null;
  contentHash: string;
}

export interface QueueView {
  items: QueueEntry[];
  unverifiedNotQueued: number;
}

function adminKey(): string {
  // The API accepts a list; the web server presents the first.
  return (process.env.ADMIN_API_KEYS ?? "").split(",")[0]?.trim() ?? "";
}

export class AdminApiUnavailable extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminKey()}`,
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
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
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

export function fetchQueue(reason?: string): Promise<QueueView> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return call<QueueView>(`/admin/queue${query}`);
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
