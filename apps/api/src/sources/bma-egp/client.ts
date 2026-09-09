// Typed client for the BMA eGP source API. Everything the rest of the app needs from
// egp2.bangkok.go.th goes through here, so the upstream's quirks stay in one file.
import {
  API_BASE,
  FILE_BASE,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAY_MS,
  SITE_BASE,
  TOR_ANNOUNCE_TYPE_ID,
  TOR_ANNOUNCE_TYPE_NAME,
} from "./config";

/** A project returned by the upstream search endpoint (only the fields we consume). */
export interface BmaEgpProject {
  projectId: string;
  projectNumber: string;
  projectName: string;
  masterOrgGroupName?: string;
  masterOrgDepartmentName?: string;
  projectBudget?: number;
}

export interface BmaEgpPage<T> {
  totalCount: number;
  pageCount: number;
  currentPage: number;
  data: T[];
}

/** One announcement document attached to a project. */
export interface BmaEgpAnnouncement {
  id: string;
  masterAnnounceTypeName?: string;
  projectAnnouncementPath?: string;
  projectAnnouncementPublishDate?: string;
}

export interface TorSearchOptions {
  pageNo?: number;
  pageSize?: number;
  /** Free-text keyword, matched by the upstream against the project name. */
  keyword?: string;
  /** MasterOrgGroups id, to narrow to a single BMA agency. */
  agencyId?: string;
}

export class BmaEgpSourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BmaEgpSourceError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A blip worth retrying: the request never landed, or the source failed on its own side. */
function isTransient(err: BmaEgpSourceError): boolean {
  return err.status === undefined || err.status >= 500;
}

async function fetchOnce(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // The upstream rejects clients that send no accept header; it needs no credentials.
        accept: "application/json, text/plain, */*",
        referer: `${SITE_BASE}/project-search`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new BmaEgpSourceError(`eGP source unreachable: ${(cause as Error).message}`);
  }
  if (!res.ok) {
    throw new BmaEgpSourceError(`eGP source returned HTTP ${res.status}`, res.status);
  }
  return res.json();
}

async function getJson<T>(url: string): Promise<T> {
  let lastError: BmaEgpSourceError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return (await fetchOnce(url)) as T;
    } catch (err) {
      lastError = err as BmaEgpSourceError;
      // Log every upstream failure: a bare 502 with no server-side trace is undebuggable.
      console.warn(
        `[bma-egp] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url} — ${lastError.message}`,
      );
      if (attempt === MAX_ATTEMPTS || !isTransient(lastError)) break;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * Search the upstream, filtered to TOR announcements only.
 * Every query parameter must be present (empty when unused) or the endpoint rejects the request;
 * the misspellings below are the upstream's own.
 */
export async function searchTorProjects(
  options: TorSearchOptions = {},
): Promise<BmaEgpPage<BmaEgpProject>> {
  const params = new URLSearchParams({
    externalUserId: "",
    projectSearchText: options.keyword ?? "",
    masterOrgGroupId: options.agencyId ?? "",
    masterOrgDepartmentId: "",
    masterAnnounceTypeId: TOR_ANNOUNCE_TYPE_ID,
    masterMethodIdId: "",
    masterTypeIdId: "",
    masterGoodIdId: "",
    masterBussinessTypeId: "",
    masterProjectTypeId: "",
    masterProjectCategoryId: "",
    masterBudgetYearId: "",
    startDate: "",
    endDate: "",
    pageNo: String(options.pageNo ?? 1),
    pageSize: String(options.pageSize ?? 20),
    sortBy: "publishDateDesc",
    bidderName: "",
    bidderTaxNumber: "",
  });
  return getJson<BmaEgpPage<BmaEgpProject>>(
    `${API_BASE}/Projects/GetProjectFromFilter?${params.toString()}`,
  );
}

/** List every announcement document attached to one project. */
export async function getProjectAnnouncements(projectId: string): Promise<BmaEgpAnnouncement[]> {
  const res = await getJson<{ data?: BmaEgpAnnouncement[] }>(
    `${API_BASE}/ProjectAnnouncements/GetAnnouncementDetailInProject` +
      `?projectId=${encodeURIComponent(projectId)}`,
  );
  return res.data ?? [];
}

/** Narrow a project's documents to its TOR announcements. */
export function selectTorAnnouncements(announcements: BmaEgpAnnouncement[]): BmaEgpAnnouncement[] {
  return announcements.filter(
    (a) => a.masterAnnounceTypeName === TOR_ANNOUNCE_TYPE_NAME && Boolean(a.projectAnnouncementPath),
  );
}

/**
 * Permanent public URL of a source document — the link every ingested record must keep
 * so the original stays traceable and immutable (FR-A2, NFR-2).
 */
export function buildFileUrl(announcementId: string, filename: string): string {
  return `${FILE_BASE}/${announcementId}/${encodeURIComponent(filename)}`;
}

/** Human-facing page for a project on the source site. */
export function buildProjectUrl(projectId: string): string {
  return `${SITE_BASE}/project-detail/${projectId}`;
}
