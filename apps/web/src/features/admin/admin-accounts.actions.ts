"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "../../shared/lib/staff-session";
import {
  disableAccount,
  enableAccount,
  saveAccountProfile,
  AdminApiFailed,
  sendMatchEmail,
  sendPasswordReset,
  sendVerificationEmail,
  setAccountRole,
  type AccountRole,
  type AdminVendorProfile,
} from "../../shared/lib/admin-api";

/**
 * What the vendor screen can do. Server actions for the same reason as the review queue's: the
 * admin key stays on the server. Each one checks the staff session itself, because an action is a
 * public entry point of its own; the API records every one in the account's audit log.
 */

function refresh(id: string): void {
  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${id}`);
}

export async function saveVendorProfileAction(
  id: string,
  profile: Pick<AdminVendorProfile, "categories" | "areas" | "otherCategories" | "budget">,
): Promise<void> {
  await requireStaff();
  await saveAccountProfile(id, profile);
  refresh(id);
}

export async function setVendorRoleAction(id: string, role: AccountRole): Promise<void> {
  await requireStaff();
  await setAccountRole(id, role);
  refresh(id);
}

export async function disableVendorAction(id: string, reason: string): Promise<void> {
  await requireStaff();
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error("a reason is required to disable an account");
  await disableAccount(id, trimmed);
  refresh(id);
}

export async function enableVendorAction(id: string): Promise<void> {
  await requireStaff();
  await enableAccount(id);
  refresh(id);
}

export async function sendVerificationEmailAction(id: string): Promise<void> {
  await requireStaff();
  await sendVerificationEmail(id);
  refresh(id);
}

export async function sendPasswordResetAction(id: string): Promise<void> {
  await requireStaff();
  await sendPasswordReset(id);
  refresh(id);
}

/**
 * Returns rather than throws: the useful outcomes here are the API's reasons
 * ("the vendor turned email off"), and a thrown error's message does not
 * survive the trip to the browser in production.
 */
export async function sendMatchEmailAction(id: string): Promise<{ ok: true; sent: number } | { ok: false; reason: string }> {
  await requireStaff();
  try {
    const { sent } = await sendMatchEmail(id);
    refresh(id);
    return { ok: true, sent };
  } catch (error) {
    if (error instanceof AdminApiFailed && error.reason) return { ok: false, reason: error.reason };
    console.error("[admin/vendors] match email failed", error);
    return { ok: false, reason: "ส่งไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }
}
