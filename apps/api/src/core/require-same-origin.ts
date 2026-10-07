import type { RequestHandler } from "express";
import { ForbiddenError } from "./errors.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAllowedOrigin(value: string, appOrigin: string): boolean {
  try {
    return new URL(value).origin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * SameSite=Lax permits a cross-site form POST, so privileged writes need a
 * request provenance check instead of trusting cookie policy alone.
 */
export function requireSameOrigin(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get("Origin");
    const provenance = origin ?? req.get("Referer");
    if (!provenance || !isAllowedOrigin(provenance, appOrigin)) {
      next(new ForbiddenError("Request origin is not allowed"));
      return;
    }
    next();
  };
}
