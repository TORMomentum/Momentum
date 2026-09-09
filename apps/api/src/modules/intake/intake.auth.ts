import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../core/errors.js";

/**
 * Constant-time comparison, so a wrong key cannot be discovered one byte at a
 * time by measuring how long the rejection takes.
 */
function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  // timingSafeEqual throws on a length mismatch, and the lengths themselves are
  // not secret, so comparing them first is safe.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function matchesAnyKey(header: string | undefined, keys: string[]): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  // every key is checked, so the time taken does not reveal which one matched
  return keys.reduce((matched, key) => constantTimeEquals(presented, key) || matched, false);
}

/**
 * NFR-S1: admin and API routes enforce access level. Network placement is not
 * access control, so the admin routes carry their own key until slice 4
 * replaces it with session authentication.
 */
export function requireKey(keys: string[], actor: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!matchesAnyKey(req.header("authorization"), keys)) {
      next(new UnauthorizedError());
      return;
    }
    (req as Request & { actor?: string }).actor = actor;
    next();
  };
}
