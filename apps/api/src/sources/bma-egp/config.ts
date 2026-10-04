// Connection settings for the BMA eGP source API (egp2.bangkok.go.th).
// The upstream endpoints are public and unauthenticated — there is no key or cookie to configure.
// Full endpoint reference: docs/DATA-SOURCES.md

export const API_BASE = process.env.BMA_EGP_API_BASE ?? "https://egp2.bangkok.go.th/appapi/api";
export const FILE_BASE = process.env.BMA_EGP_FILE_BASE ?? "https://egp2.bangkok.go.th/api/file";
export const SITE_BASE = process.env.BMA_EGP_SITE_BASE ?? "https://egp2.bangkok.go.th";

/** MasterAnnounceTypes id for "ร่างขอบเขตของงาน (TOR)" — the announcement type searched by default. */
export const TOR_ANNOUNCE_TYPE_ID =
  process.env.BMA_EGP_TOR_ANNOUNCE_TYPE_ID ?? "24995aa2-d875-4d3d-9dec-d5e22d222aa4";

/** Upstream label for the same type, used to pick the TOR out of a project's document list. */
export const TOR_ANNOUNCE_TYPE_NAME = "ร่างขอบเขตของงาน (TOR)";
/** The invitation to bid — where a project's submission deadline is stated. */
export const INVITATION_ANNOUNCE_TYPE_NAME = "ประกาศเชิญชวน";
/** MasterAnnounceTypes id for the same type, to search for projects with a live tender. */
export const INVITATION_ANNOUNCE_TYPE_ID =
  process.env.BMA_EGP_INVITATION_ANNOUNCE_TYPE_ID ?? "705f1ffb-82e2-4beb-bdd2-2746f0783bf0";

export const REQUEST_TIMEOUT_MS = Number(process.env.BMA_EGP_TIMEOUT_MS ?? 20_000);

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** The source is a public government service with uneven latency; one retry absorbs a blip. */
export const MAX_ATTEMPTS = Number(process.env.BMA_EGP_MAX_ATTEMPTS ?? 2);
export const RETRY_DELAY_MS = Number(process.env.BMA_EGP_RETRY_DELAY_MS ?? 500);
