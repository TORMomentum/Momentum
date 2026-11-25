import "server-only";

import { cookies } from "next/headers";
import { apiRequest } from "../api/api-client";

/** The account session cookie, set by the auth route. */
export const ACCOUNT_COOKIE_NAME = "tor-radar-session";

export class StaffAuthRequired extends Error {
  constructor() {
    super("Staff authentication is required");
    this.name = "StaffAuthRequired";
  }
}

/**
 * The staff area opens to a signed-in account whose role is `admin`, and to nothing else (TOR-199, spec
 * 2026-11-25-admin-accounts). There is no shared staff password any more: the role is read from the API on every
 * request, so a demoted or disabled admin loses the staff area on their next click. If the role cannot be read —
 * no session, an expired one, the API down — the answer is no: the staff area fails closed.
 *
 * Returns the session id. Every admin API call carries it, and the API checks the role again on its side.
 */
export async function requireStaff(): Promise<string> {
  try {
    const sessionId = (await cookies()).get(ACCOUNT_COOKIE_NAME)?.value;
    if (!sessionId) throw new StaffAuthRequired();
    const response = await apiRequest("/api/v1/me", {}, sessionId);
    if (!response.ok) throw new StaffAuthRequired();
    const account = (await response.json()) as { role?: string };
    if (account.role !== "admin") throw new StaffAuthRequired();
    return sessionId;
  } catch {
    // Authentication failures have one stable shape and never expose cookie-store or API details to the caller.
    throw new StaffAuthRequired();
  }
}

/**
 * The same check, as a question rather than an exception.
 *
 * A page wants to redirect, and `redirect()` works by throwing. Asking first keeps that throw on the straight path
 * instead of inside a `catch` handling a different exception. Server Actions keep using `requireStaff`, where
 * throwing is the correct behaviour and nothing catches it.
 */
export async function isStaff(): Promise<boolean> {
  try {
    await requireStaff();
    return true;
  } catch {
    return false;
  }
}
