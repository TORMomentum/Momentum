"use server";

import { signOut as endStaffSession } from "../../shared/lib/staff-session";

/**
 * Ending the staff session, from the account menu's sign-out.
 *
 * Signing out has to mean signing out of everything. The prototype viewer
 * lives in browser storage and the client clears it; the staff session is an
 * httpOnly cookie and only the server can. Without this, "ออกจากระบบ" cleared
 * the visible identity and left the privileged session intact — a sign-out
 * that does not drop privileges is worse than no sign-out, because it is
 * believed.
 *
 * No authorisation check: clearing your own cookie is not a privileged
 * operation, and it is safe to call when there is no session to clear.
 */
export async function endStaffSessionAction(): Promise<void> {
  await endStaffSession();
}
