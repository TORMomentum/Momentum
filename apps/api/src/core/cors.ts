import type { RequestHandler } from "express";

export interface CorsOptions {
  /** Exact origins (scheme://host[:port]) a browser may call the API from. Never "*". */
  allowedOrigins: readonly string[];
  /** How long a browser may cache a preflight answer, in seconds. */
  maxAgeSeconds: number;
}

const ALLOWED_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-Api-Key, Range";
const EXPOSED_HEADERS = "Content-Disposition, Content-Range, Accept-Ranges";

/**
 * Cross-origin access by allowlist (TOR-317, ASVS V3.4.2).
 *
 * The browser never calls the API directly: every page talks to the Next
 * server, which calls the API server-to-server. CORS therefore only decides
 * what a *browser* on another origin may read, and the answer is: nothing,
 * unless that origin is listed. A listed origin gets its own value echoed back
 * (never "*"), with credentials allowed. An unlisted origin gets no CORS
 * header at all, so the browser blocks the read, and its preflight is refused
 * with 403. Requests without an Origin header (server-to-server, curl) are not
 * a CORS matter and pass untouched; authentication still applies to them.
 */
export function cors(options: CorsOptions): RequestHandler {
  const allowed = new Set(options.allowedOrigins);
  return (req, res, next) => {
    const origin = req.get("Origin");
    // The answer depends on Origin, so caches must key on it.
    res.vary("Origin");
    if (!origin) {
      next();
      return;
    }

    const isAllowed = allowed.has(origin);
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }

    const isPreflight = req.method === "OPTIONS" && req.get("Access-Control-Request-Method") !== undefined;
    if (!isPreflight) {
      next();
      return;
    }
    if (!isAllowed) {
      res.status(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Max-Age", String(options.maxAgeSeconds));
    res.status(204).end();
  };
}
