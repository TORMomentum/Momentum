import type { RequestHandler } from "express";
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
