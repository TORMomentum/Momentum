import helmet from "helmet";
import type { RequestHandler } from "express";

/**
 * Response hardening for a JSON and document API (ASVS V3/V13, threat T05).
 *
 * Helmet's defaults (which also drop x-powered-by) plus a CSP that allows
 * nothing: no response from this API is a page, so there is nothing for a
 * script, frame or sub-resource to load. The in-app PDF viewer is not affected,
 * because the browser's frame loads the web server's proxy route, which
 * forwards only content-type/-disposition/-length from the API response.
 * `streamDocument` keeps setting its own nosniff, no-store and
 * Content-Disposition; helmet leaves those in place.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    // Nothing cross-origin embeds an API response (helmet's default, stated on purpose).
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
}

/**
 * CORS allowlist. The browser talks to the Next server, which calls this API
 * server-to-server, so the only origin ever allowed is APP_ORIGIN (an exact
 * match, never `*`). A foreign origin gets no Access-Control-* header at all
 * and the browser blocks the read; its preflight is answered 204 without them.
 * Credentials are allowed for the one allowed origin only.
 */
export function corsAllowlist(appOrigin: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("Origin");
    if (!origin) {
      next();
      return;
    }
    res.append("Vary", "Origin");
    const preflight = req.method === "OPTIONS" && req.get("Access-Control-Request-Method");
    if (origin !== appOrigin) {
      if (preflight) {
        res.status(204).end();
        return;
      }
      next();
      return;
    }
    res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" });
    if (preflight) {
      res.set({
        "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE",
        "Access-Control-Allow-Headers": req.get("Access-Control-Request-Headers") ?? "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      res.status(204).end();
      return;
    }
    next();
  };
}
