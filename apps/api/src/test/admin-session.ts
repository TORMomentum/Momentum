import type { RequestHandler } from "express";
import { ObjectId } from "mongodb";

/** The account id every test admin acts as: what audit entries must name (TOR-300). */
export const TEST_ADMIN_ID = "0123456789abcdef0123abcd";

/** Headers for a request as a signed-in admin account, or as a vendor. */
export const AS_ADMIN = { "x-test-role": "admin" } as const;
export const AS_VENDOR = { "x-test-role": "vendor" } as const;

/**
 * Stands in for `sessionContext` in router tests: the account a request is signed in as, chosen by a test-only
 * header. The real session lookup is proven in the accounts and access-control tests; these test what a router
 * does with an account it is given.
 */
export function testSession(): RequestHandler {
  return (req, _res, next) => {
    const role = req.get("x-test-role");
    if (role === "admin" || role === "vendor") {
      req.auth = { account: { _id: new ObjectId(TEST_ADMIN_ID), role } as never, role };
    }
    next();
  };
}
