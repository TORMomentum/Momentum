"use server";

import { revalidatePath } from "next/cache";
import {
  approve as approveRecord,
  reextract as reextractRecord,
  reject as rejectRecord,
  saveEdits,
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

export async function saveCorrections(id: string, edits: FieldEdit[]): Promise<void> {
  await saveEdits(id, edits);
  revalidatePath(REVIEW_PATH);
}

export async function approveRecordAction(id: string, edits: FieldEdit[]): Promise<void> {
  await approveRecord(id, edits);
  revalidatePath(REVIEW_PATH);
}

export async function reextractRecordAction(id: string): Promise<void> {
  await reextractRecord(id);
  revalidatePath(REVIEW_PATH);
}

export async function rejectRecordAction(id: string, reason: string): Promise<void> {
  await rejectRecord(id, reason);
  revalidatePath(REVIEW_PATH);
}
