// Connection settings for Thailand's national e-GP (gprocurement.go.th).
// The endpoints used here are public and unauthenticated — no key, cookie or special header.
// Design: docs/superpowers/specs/2026-10-04-national-egp-source-design.md

/** The daily announcements feed. process3.gprocurement.go.th redirects here. */
export const FEED_URL =
  process.env.NATIONAL_EGP_FEED_URL ?? "https://process.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml";

/** Back-end services that locate and serve a project's document packages. */
export const SERVICE_BASE = process.env.NATIONAL_EGP_SERVICE_BASE ?? "https://process5.gprocurement.go.th";

/**
 * e-GP's public announcement search. It runs `keywordSearch` once the visitor passes the site's own
 * bot check, and its keyword box takes a project number. The project page itself takes a param the
 * site encrypts client-side, so the search is the stable public link.
 */
export const PROJECT_SEARCH_URL =
  process.env.NATIONAL_EGP_PROJECT_SEARCH_URL ?? "https://process5.gprocurement.go.th/egp-agpc01-web/announcement";

/**
 * e-GP's public announcement list ("ค้นหาประกาศ…", procsearch.sch FPRO9965): today's announcements
 * of one type, nationally, newest first. Served by the site's main application, so it stays up
 * when the feed application does not. Its default list needs no captcha; only its custom search
 * does, and that is not used.
 */
export const SITE_BASE = process.env.NATIONAL_EGP_SITE_BASE ?? "https://process.gprocurement.go.th";

/**
 * A project's published stages with their dates — the "เอกสาร/ประกาศที่เกี่ยวข้อง" table on e-GP's
 * project page (TOR-204). Answers a plain GET with no token; it needs `pageAnnounceType`, and any
 * stage type returns the whole table. Relative to SERVICE_BASE.
 */
export const PROJECT_STAGES_PATH =
  process.env.NATIONAL_EGP_PROJECT_STAGES_PATH ?? "/egp-oann10-service/pb/a-egp-allt-project/announcement/greenBook";

/** The list's announcement types this source reads: the draft TOR, and the invitation to bid. */
export const LIST_TYPES = { tor: "1", invitation: "2" } as const;
export type ListKind = keyof typeof LIST_TYPES;

/** Feed announcement types: B0 draft TOR and draft documents, D0 invitation to bid. */
export const ANNOUNCE_TYPES = ["B0", "D0"] as const;
export type AnnounceType = (typeof ANNOUNCE_TYPES)[number];

export const REQUEST_TIMEOUT_MS = Number(process.env.NATIONAL_EGP_TIMEOUT_MS ?? 30_000);

/** The source is a public service with uneven latency; one retry absorbs a blip. */
export const MAX_ATTEMPTS = Number(process.env.NATIONAL_EGP_MAX_ATTEMPTS ?? 2);
export const RETRY_DELAY_MS = Number(process.env.NATIONAL_EGP_RETRY_DELAY_MS ?? 1_000);

/** A whole bid package, measured at 7–10 MB; the cap leaves room without inviting abuse. */
export const MAX_PACKAGE_BYTES = Number(process.env.NATIONAL_EGP_MAX_PACKAGE_BYTES ?? 52_428_800);

/**
 * A project's winner announcement (TOR-221): e-GP's own "ประกาศรายชื่อผู้ชนะ" link asks the approval service
 * for the announcement's template id, then opens it as a PDF from the template service. Both are plain public
 * GETs the announcement list calls with no captcha — the bidder price report, which sits behind one, is not used.
 */
export const AWARD_TEMPLATE_PATH =
  process.env.NATIONAL_EGP_AWARD_TEMPLATE_PATH ?? "/egp-approval-service/apv-common/infoApproveTemplate";
export const AWARD_TEMPLATE_TYPE = process.env.NATIONAL_EGP_AWARD_TEMPLATE_TYPE ?? "W13";
export const AWARD_PDF_PATH = process.env.NATIONAL_EGP_AWARD_PDF_PATH ?? "/egp-template-service/dwnt/view-pdf-file";
/** A winner announcement is a page or two; 10 MB is far beyond any seen. */
export const MAX_AWARD_BYTES = Number(process.env.NATIONAL_EGP_MAX_AWARD_BYTES ?? 10_485_760);
/** Unpacking caps (spec decision 10). The largest package seen had 22 entries and 9.5 MB unpacked. */
export const MAX_PACKAGE_ENTRIES = Number(process.env.NATIONAL_EGP_MAX_PACKAGE_ENTRIES ?? 200);
export const MAX_PACKAGE_UNPACKED_BYTES = Number(
  process.env.NATIONAL_EGP_MAX_PACKAGE_UNPACKED_BYTES ?? 157_286_400,
);
