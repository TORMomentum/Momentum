import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger, type Fields } from "./logger.js";

const MAX_USER_AGENT = 120;

declare module "express-serve-static-core" {
  interface Request {
    /** Generated per request, never taken from the caller. */
    id?: string;
  }
}

/** Who and what a security log line is about; the only header it echoes is the truncated user agent. */
export function requestFields(req: Request): Fields {
  return {
    requestId: req.id,
    method: req.method,
    // The query string is dropped: a token can travel there.
    path: req.originalUrl.split("?")[0],
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, MAX_USER_AGENT),
    ...(req.auth ? { accountId: req.auth.account._id.toString() } : {}),
  };
}

/** A handler that already wrote a more specific event sets this so the generic hook stays quiet. */
export function markLogged(res: Response): void { res.locals.securityLogged = true; }

/**
 * Mounted first. Gives every request an id, then, once the response is sent,
 * logs refusals (401/403) and rate-limit hits (429) wherever in the stack they
 * were produced, so no route has to remember to.
 */
export function securityLog(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    res.set("X-Request-Id", req.id);
    res.on("finish", () => {
      if (res.locals.securityLogged) return;
      if (res.statusCode === 401 || res.statusCode === 403) {
        logger.security("auth.denied", { ...requestFields(req), status: res.statusCode });
      } else if (res.statusCode === 429) {
        // keyType says which limit fired; the key itself (an address, an email) is never logged.
        logger.security("ratelimit.hit", { ...requestFields(req), keyType: res.locals.rateLimitKey ?? "ip" });
      }
    });
    next();
  };
}

/**
 * Behind an admin account (TOR-199). Logs every state-changing admin request with the
 * acting identity, the route pattern and the target id, once it is answered.
 */
export function auditAdmin(actorOf: (req: Request) => string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Several routers share the /admin prefix; one request is logged once, by the first.
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || res.locals.adminAudited) { next(); return; }
    res.locals.adminAudited = true;
    res.on("finish", () => {
      logger.security("admin.action", {
        ...requestFields(req),
        actor: actorOf(req),
        authMethod: "session",
        action: `${req.method} ${req.baseUrl}${req.route?.path ?? ""}`,
        target: req.params?.id,
        status: res.statusCode,
      });
    });
    next();
  };
}
