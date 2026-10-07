// Typed client for Thailand's national e-GP. Everything the app needs from gprocurement.go.th goes
// through here, so the upstream's quirks — a Windows-874 feed, ZIP packages, its response envelope —
// stay in one file. Every request goes through safeFetchDocument (spec §5.6).
import { safeFetchDocument } from "../../lib/safe-fetch.js";
import { parseAnnouncementList, type ListItem } from "./announcements.js";
import {
  FEED_URL,
  MAX_ATTEMPTS,
  PROJECT_SEARCH_URL,
  LIST_TYPES,
  SITE_BASE,
  type ListKind,
  MAX_PACKAGE_BYTES,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAY_MS,
  SERVICE_BASE,
  type AnnounceType,
} from "./config.js";

/** One announcement from the daily feed (only the fields we consume). */
export interface FeedItem {
  /** The 11-digit e-GP project number every document of the project carries. */
  projectId: string;
  title: string;
  announceType: AnnounceType;
  link?: string;
  /** As the feed states it. */
  pubDate?: string;
  procurementMethod?: string;
}

/** Where a project's document package is held. */
export interface PackageRef {
  fileId: string;
  name: string;
}

export class NationalEgpSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NationalEgpSourceError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON envelopes are small; a package gets the larger cap. */
const JSON_MAX_BYTES = 1_048_576;

async function getBytes(url: string, maxBytes: number): Promise<Buffer> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const fetched = await safeFetchDocument(url, { timeoutMs: REQUEST_TIMEOUT_MS, maxRedirects: 3, maxBytes });
      return fetched.bytes;
    } catch (err) {
      lastError = err as Error;
      // Log every upstream failure: a bare error with no server-side trace is undebuggable.
      console.warn(`[national-egp] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url} — ${lastError.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  throw new NationalEgpSourceError(`e-GP source unavailable: ${lastError?.message}`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(text: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(text.trim());
  if (cdata) return cdata[1].trim();
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name])
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? decodeXmlText(match[1]) : undefined;
}

/** The feed declares Windows-874; honour the declaration, and read anything else as UTF-8. */
export function decodeFeed(bytes: Buffer): string {
  const prolog = bytes.subarray(0, 100).toString("latin1");
  const declared = /encoding="([^"]+)"/i.exec(prolog)?.[1]?.toLowerCase();
  const thai = declared === "windows-874" || declared === "tis-620";
  return new TextDecoder(thai ? "windows-874" : "utf-8").decode(bytes);
}

/**
 * The feed's items, each with the project number it announces. The description states it first
 * ("69099218130, ประกวดราคาอิเล็กทรอนิกส์ (e-bidding), ร่างเอกสาร…"); an item without one is dropped,
 * because without a project number there is no package to fetch.
 */
export function parseFeed(xml: string, announceType: AnnounceType): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const description = tag(block, "description") ?? "";
    const link = tag(block, "link");
    const projectId = /(?<!\d)(\d{11})(?!\d)/.exec(`${description} ${link ?? ""}`)?.[1];
    const title = tag(block, "title");
    if (!projectId || !title) continue;

    const parts = description.split(",").map((part) => part.trim());
    const item: FeedItem = { projectId, title, announceType };
    if (link) item.link = link;
    const pubDate = tag(block, "pubDate");
    if (pubDate) item.pubDate = pubDate;
    if (parts[0] === projectId && parts[1]) item.procurementMethod = parts[1];
    items.push(item);
  }
  return items;
}

/** A feed date as a Date, or undefined. The feed writes Thai time as "ICT", which Date cannot parse. */
export function parseFeedDate(pubDate: string | undefined): Date | undefined {
  if (!pubDate) return undefined;
  const at = new Date(pubDate.replace(/\bICT$/, "+0700"));
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** Today's announcements of one type, nationally or for one department. */
export async function fetchFeed(announceType: AnnounceType, deptId?: string): Promise<FeedItem[]> {
  const url = new URL(FEED_URL);
  if (deptId) url.searchParams.set("deptId", deptId);
  url.searchParams.set("anounceType", announceType); // sic: the upstream's spelling
  return parseFeed(decodeFeed(await getBytes(url.toString(), JSON_MAX_BYTES * 5)), announceType);
}

interface Envelope<T> {
  response?: { responseCode?: string };
  data?: T | null;
}

/** The project's final bid package, or null when e-GP has not built one. */
export async function getBidPackage(projectId: string): Promise<PackageRef | null> {
  const url =
    `${SERVICE_BASE}/egp-approval-service/apv-common/infoProcureDocAnnounZip` +
    `?projectId=${encodeURIComponent(projectId)}`;
  const body = JSON.parse((await getBytes(url, JSON_MAX_BYTES)).toString("utf8")) as Envelope<{
    zipId?: string;
    buildName1?: string;
  }>;
  // responseCode "1" with data null is the upstream's "no such data" (E0001), not a failure.
  const zipId = body.data?.zipId;
  if (body.response?.responseCode !== "0" || !zipId) return null;
  return { fileId: zipId, name: body.data?.buildName1 ?? `${projectId}.zip` };
}

/** The file id a feed link points at, when it points at a downloadable package. */
export function fileIdFromLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  return /[?&]fileId=([0-9a-f]{32})\b/i.exec(link)?.[1];
}

/** Permanent URL of a package — the source link every record built from it keeps (FR-A-2). */
export function packageUrl(fileId: string): string {
  return `${SERVICE_BASE}/egp-upload-service/v1/downloadFileTest?fileId=${encodeURIComponent(fileId)}`;
}

/** e-GP's public search, opened on one project number — where a reader sees the project as the agency published it. */
export function buildProjectSearchUrl(projectId: string): string {
  const url = new URL(PROJECT_SEARCH_URL);
  url.searchParams.set("keywordSearch", projectId);
  return url.toString();
}

export async function downloadPackage(fileId: string): Promise<Buffer> {
  return getBytes(packageUrl(fileId), MAX_PACKAGE_BYTES);
}

/**
 * The newest announcements of one kind on e-GP's public list — draft TORs or invitations to bid —
 * up to the 50 the list's first page holds. The page is TIS-620; windows-874 is its superset.
 */
export async function fetchAnnouncementList(kind: ListKind): Promise<ListItem[]> {
  const url = new URL("/egp2procmainWeb/procsearch.sch", SITE_BASE);
  url.searchParams.set("homeflag", "A");
  url.searchParams.set("proc_id", "FPRO9965");
  url.searchParams.set("servlet", "FPRO9965Servlet");
  url.searchParams.set("methodId", "");
  url.searchParams.set("announceType", LIST_TYPES[kind]);
  const bytes = await getBytes(url.toString(), JSON_MAX_BYTES * 5);
  return parseAnnouncementList(new TextDecoder("windows-874").decode(bytes));
}
