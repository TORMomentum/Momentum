"use server";

import type { IntakeResponse } from "@tor-radar/shared";
import { revalidatePath } from "next/cache";
import { requireStaff } from "../../shared/lib/staff-session";
import {
  AdminApiFailed,
  approve as approveRecord,
  bulkTors,
  fetchEvents,
  fetchTorIds,
  reextract as reextractRecord,
  reject as rejectRecord,
  restore as restoreRecord,
  saveEdits,
  setFieldVerification,
  uploadDocument,
  type AdminBulkAction,
  type AdminTorKind,
  type AdminTorStatus,
  type AdminBulkResult,
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
  revalidatePath(`/admin/tors/${id}`);
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
  revalidatePath(`/admin/tors/${id}`);
}

export async function rejectRecordAction(id: string, reason: string): Promise<void> {
  // Server Actions are public HTTP entry points, so every mutation checks the
  // staff session itself before the server-held admin key can be spent.
  //
  // Authentication comes before validation, not after: answering "the reason is
  // required" to a caller who has no session tells them the action exists and
  // how it validates, for free.
  await requireStaff();

  // FR-B-6: a restriction has to be explainable, so the audit entry cannot be
  // written with an empty reason. The dialog enforces it too; this is the
  // boundary that actually holds.
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("reject reason is required");
  await rejectRecord(id, trimmedReason);
  revalidatePath(REVIEW_PATH);
  revalidatePath(`/admin/tors/${id}`);
}

export interface UploadState {
  result: IntakeResponse | null;
  error: string | null;
}

export async function uploadDocumentAction(
  _previousState: UploadState,
  formData: FormData,
): Promise<UploadState> {
  await requireStaff();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { result: null, error: "กรุณาเลือกไฟล์ก่อนอัปโหลด" };
  }

  try {
    const result = await uploadDocument(file);
    // A successful upload can land straight in the review queue.
    revalidatePath(REVIEW_PATH);
    return { result, error: null };
  } catch (error) {
    console.error("[admin/upload] failed", error);
    return { result: null, error: "อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }
}

export interface RecentUpload {
  torId: string;
  title: string;
  state: string;
  at: string;
}

/**
 * What the upload screen's "recent documents" panel shows: not a raw list of
 * uploaded records (no such endpoint exists), but each upload-originated
 * record's most recent event, which doubles as its current pipeline state —
 * reusing the same activity trail the log page reads, not a new API surface.
 *
 * Correct as long as a record's founding "queued" event is still within the
 * fetched window; fine at this data volume, would need a dedicated endpoint
 * to hold at scale.
 */
export async function fetchRecentUploadsAction(): Promise<RecentUpload[]> {
  await requireStaff();

  const events = await fetchEvents(50); // newest first

  const byTor = new Map<string, typeof events>();
  for (const event of events) {
    const list = byTor.get(event.torId);
    if (list) list.push(event);
    else byTor.set(event.torId, [event]);
  }

  const uploads: RecentUpload[] = [];
  for (const [torId, torEvents] of byTor) {
    const origin = torEvents[torEvents.length - 1];
    if (origin?.source !== "upload") continue;
    const latest = torEvents[0];
    uploads.push({ torId, title: latest.title, state: latest.to, at: latest.at });
  }

  return uploads.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
}

/** Lifts a takedown: the record is public again, and the event log keeps both steps. */
export async function restoreRecordAction(id: string): Promise<void> {
  await requireStaff();
  await restoreRecord(id);
  revalidatePath(REVIEW_PATH);
  revalidatePath("/admin/tors");
  revalidatePath(`/admin/tors/${id}`);
}

/**
 * One action over the TORs selected on "TOR ทั้งหมด". Returns rather than
 * throws, so the API's own Thai refusal reaches the screen in production.
 */
export async function bulkTorsAction(
  action: AdminBulkAction,
  ids: string[],
  reason?: string,
): Promise<{ ok: true; result: AdminBulkResult } | { ok: false; reason: string }> {
  await requireStaff();
  try {
    const result = await bulkTors(action, ids, reason);
    revalidatePath("/admin/tors");
    revalidatePath(REVIEW_PATH);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof AdminApiFailed && error.reason) return { ok: false, reason: error.reason };
    console.error("[admin/tors] bulk action failed", error);
    return { ok: false, reason: "ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }
}

/** "Select everything matching": the ids behind the list's current filters. */
export async function selectAllTorsAction(query: { q?: string; status: AdminTorStatus; kind: AdminTorKind }): Promise<
  { ok: true; ids: string[]; total: number; chunk: number } | { ok: false; reason: string }
> {
  await requireStaff();
  try {
    return { ok: true, ...(await fetchTorIds(query)) };
  } catch (error) {
    console.error("[admin/tors] select all failed", error);
    return { ok: false, reason: "โหลดรายการทั้งหมดไม่สำเร็จ — ลองใหม่อีกครั้ง" };
  }
}

