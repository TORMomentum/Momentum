import type { Request, RequestHandler } from "express";
import type { AccountRole } from "./db.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";

export function requireRole(role: AccountRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
      return;
    }
    if (req.auth.account.role !== role) {
      next(new ForbiddenError("Insufficient permissions"));
      return;
    }
    next();
  };
}

/**
 * The acting admin, for every audit entry (TOR-300): the account id of the session `requireRole("admin")` let
 * through. An id rather than an email, so the security log carries no personal data (NFR-S2). Called only behind
 * that check; without a session it refuses rather than record an action by nobody.
 */
export function adminActor(req: Request): string {
  const id = req.auth?.account._id.toString();
  if (!id) throw new UnauthorizedError();
  return id;
}
