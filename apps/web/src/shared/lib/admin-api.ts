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
  /** Absent from an API older than the all-TORs list. */
  state?: string;
  restricted?: boolean;
  restrictedReason?: string;
  documentType?: "tor" | "invitation";
}

export type AdminTorStatus = "all" | "public" | "restricted" | "unverified" | "processing" | "stuck" | "failed";
export type AdminTorKind = "tor" | "invitation" | "all";

export interface AdminTorRow {
  id: string;
  title: string;
  agency: string;
  documentType: "tor" | "invitation";
  state: string;
  restricted: boolean;
  unverified: boolean;
  confidenceLevel: string | null;
  projectNumber: string | null;
  createdAt: string;
}

export interface AdminTorPage {
  rows: AdminTorRow[];
  total: number;
  page: number;
  pageSize: number;
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
export class AdminApiFailed extends Error {
  /**
   * For a 400 only: the API's own refusal, which it writes in Thai for a
   * person ("ผู้ใช้ปิดการแจ้งเตือนทางอีเมลไว้"). Everything else stays log-only.
   */
  constructor(detail: string, readonly reason?: string) {
    super(detail);
  }
}

/**
 * The API's refusal, if it is one written for a person. A schema rejection
 * carries its reasons in `issues`; only Thai text is shown — that is wording
 * someone chose — while a validator's English default falls back to the
 * screen's own generic message.
 */
function refusalOf(body: string): string | undefined {
  const thai = (value: unknown): value is string => typeof value === "string" && /\p{Script=Thai}/u.test(value);
  try {
    const error = (JSON.parse(body) as { error?: { message?: unknown; issues?: Array<{ message?: unknown }> } }).error;
    return [...(error?.issues ?? []).map((issue) => issue.message), error?.message].find(thai);
  } catch {
    return undefined;
  }
}

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
    throw new AdminApiFailed(detail, response.status === 400 ? refusalOf(body) : undefined);
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
  /** Queued or extracting, untouched longer than a worker should take. */
  stuck: number;
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

export type MatchLabel = "relevant" | "not-relevant" | "unsure";

export interface MatchWorksheetItem {
  torId: string;
  title: string;
  agency: string;
  score: number;
  /** Whether the vendor's email threshold would have sent it. */
  matched: boolean;
  reasons: string[];
  label: MatchLabel | null;
}

export interface MatchQualityFigures {
  labelled: number;
  vendors: number;
  precision: number | null;
  precisionOf: number;
  recall: number | null;
  recallOf: number;
  unsureRate: number | null;
}

export function fetchMatchWorksheet(accountId: string): Promise<{ items: MatchWorksheetItem[] }> {
  return call(`/admin/accounts/${encodeURIComponent(accountId)}/labels`);
}

export function saveMatchLabel(accountId: string, torId: string, label: MatchLabel): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(accountId)}/labels/${encodeURIComponent(torId)}`, { method: "PUT", body: JSON.stringify({ label }) });
}

export function fetchMatchQuality(): Promise<MatchQualityFigures> {
  return call("/admin/match-quality");
}

export interface AdminOtherTerms {
  /** Work vendors do that the taxonomy has no node for. */
  work: Array<{ text: string; vendors: number }>;
  /** Certifications vendors hold outside the listed ones. */
  certifications: Array<{ text: string; vendors: number }>;
}

export function fetchOtherTerms(): Promise<AdminOtherTerms> {
  return call<AdminOtherTerms>("/admin/reports/other-terms");
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

export function fetchAllTors(query: { q?: string; status?: AdminTorStatus; kind?: AdminTorKind; page?: number }): Promise<AdminTorPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.kind && query.kind !== "tor") params.set("kind", query.kind);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return call<AdminTorPage>(`/admin/tors${search ? `?${search}` : ""}`);
}

export function restore(id: string): Promise<{ id: string }> {
  return call(`/admin/tors/${encodeURIComponent(id)}/restore`, { method: "POST" });
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

export type AccountRole = "vendor" | "admin";

export interface AdminAccountRow {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  verified: boolean;
  disabled: boolean;
  createdAt: string;
}

export interface AdminAccountPage {
  rows: AdminAccountRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminVendorProfile {
  categories: string[];
  areas: string[];
  otherCategories: string[];
  budget: { minThb: number; maxThb: number } | null;
  updatedAt: string | null;
  updatedBy?: "vendor" | "admin";
}

export interface AdminAuditEntry {
  action: string;
  actor: string;
  at: string;
  detail?: string;
}

export interface AdminAccountOpen {
  account: AdminAccountRow & { hasPassword: boolean; consentAgreedAt: string | null; consentWithdrawnAt: string | null };
  profile: AdminVendorProfile;
  audit: AdminAuditEntry[];
}

export function fetchAccounts(query: { q?: string; page?: number }): Promise<AdminAccountPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return call<AdminAccountPage>(`/admin/accounts${search ? `?${search}` : ""}`);
}

/** Opening an account is recorded in its audit log by the API. */
export function fetchAccount(id: string): Promise<AdminAccountOpen> {
  return call<AdminAccountOpen>(`/admin/accounts/${encodeURIComponent(id)}`);
}

export function saveAccountProfile(
  id: string,
  profile: Pick<AdminVendorProfile, "categories" | "areas" | "otherCategories" | "budget">,
): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/profile`, { method: "PUT", body: JSON.stringify(profile) });
}

export function setAccountRole(id: string, role: AccountRole): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/role`, { method: "POST", body: JSON.stringify({ role }) });
}

export function disableAccount(id: string, reason: string): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/disable`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function enableAccount(id: string): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/enable`, { method: "POST" });
}

export function sendVerificationEmail(id: string): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/verification-email`, { method: "POST" });
}

export type AdminBulkAction = "reextract" | "reject" | "restore";
export type AdminBulkResult = { done: string[]; failed: Array<{ id: string; reason: string }> };

export function bulkTors(action: AdminBulkAction, ids: string[], reason?: string): Promise<AdminBulkResult> {
  return call("/admin/tors/bulk", { method: "POST", body: JSON.stringify({ action, ids, ...(reason ? { reason } : {}) }) });
}

export function sendMatchEmail(id: string): Promise<{ sent: number }> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/match-email`, { method: "POST" });
}

export function sendPasswordReset(id: string): Promise<unknown> {
  return call(`/admin/accounts/${encodeURIComponent(id)}/password-reset`, { method: "POST" });
}
