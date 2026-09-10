import { AdminReviewView } from "../../../../src/views/AdminReviewView";
import {
  AdminApiUnavailable,
  fetchQueue,
  fetchRecord,
  type ReviewRecord,
} from "../../../../src/shared/lib/admin-api";

/**
 * Staff-only screen (FR-G-1). The queue and the selected record are fetched on
 * the server, so the admin key never reaches the browser; the view below is a
 * client component only because it edits fields.
 */
export const dynamic = "force-dynamic";

export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; reason?: string }>;
}) {
  const { id, reason } = await searchParams;

  let queue: Awaited<ReturnType<typeof fetchQueue>> = { items: [], unverifiedNotQueued: 0 };
  let record: ReviewRecord | null = null;
  let offline: string | null = null;

  try {
    queue = await fetchQueue(reason);
    // Opening the first item by default: a reviewer lands ready to work, and a
    // deep link from the activity log still wins.
    const target = id ?? queue.items[0]?.id;
    if (target) record = await fetchRecord(target);
  } catch (error) {
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับ API — คิวจะปรากฏเมื่อบริการทำงาน"
        : String(error);
  }

  return (
    <AdminReviewView
      queue={queue.items}
      unverifiedNotQueued={queue.unverifiedNotQueued}
      record={record}
      offline={offline}
      activeReason={reason}
    />
  );
}
