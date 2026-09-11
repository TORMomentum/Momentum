"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "../../shared/lib/staff-session";
import {
  approve as approveRecord,
  reextract as reextractRecord,
  reject as rejectRecord,
  saveEdits,
  setFieldVerification,
  type FieldEdit,
} from "../../shared/lib/admin-api";

/**
 * What the review screen can do, as server actions.
 *
 * Actions rather than a client `fetch` for one reason: the admin key stays on
 * the server. The browser posts to Next, Next talks to the API. Nothing here
 * returns the key, and `admin-api` cannot even be imported into a client
 * component — it is marked `server-only`.
 *
 * Every action revalidates the queue, because acting on a record usually
 * removes it from that list and a stale queue offers work that is already done.
 */

const REVIEW_PATH = "/admin/review";

export async function setFieldVerificationAction(
  id: string,
  field: string,
  confirmed: boolean,
): Promise<void> {
  await requireStaff();
  await setFieldVerification(id, field, confirmed);
  revalidatePath(REVIEW_PATH);
}

export async function saveCorrections(id: string, edits: FieldEdit[]): Promise<void> {
  // Server Actions are public HTTP entry points, so every mutation checks the
  // staff session itself before the server-held admin key can be spent.
  await requireStaff();
  await saveEdits(id, edits);
  revalidatePath(REVIEW_PATH);
}

export async function approveRecordAction(id: string, edits: FieldEdit[]): Promise<void> {
  // Server Actions are public HTTP entry points, so every mutation checks the
  // staff session itself before the server-held admin key can be spent.
  await requireStaff();
  await approveRecord(id, edits);
  revalidatePath(REVIEW_PATH);
}

export async function reextractRecordAction(id: string): Promise<void> {
  // Server Actions are public HTTP entry points, so every mutation checks the
  // staff session itself before the server-held admin key can be spent.
  await requireStaff();
  await reextractRecord(id);
  revalidatePath(REVIEW_PATH);
}

export async function rejectRecordAction(id: string, reason: string): Promise<void> {
  // Server Actions are public HTTP entry points, so every mutation checks the
  // staff session itself before the server-held admin key can be spent.
  await requireStaff();
  await rejectRecord(id, reason);
  revalidatePath(REVIEW_PATH);
}
